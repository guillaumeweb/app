// Logique de la todo list (catégories, tâches, labels, journal), indépendante
// du stockage. Chaque modification relit le document, l'applique puis le
// réécrit ; en cas d'écriture concurrente (DynamoDB), elle est rejouée.
import { randomUUID } from 'node:crypto';
import { fileBackend, ConflictError } from './backends.js';

export const STATUSES = ['todo', 'doing', 'done'];

const MAX_ATTEMPTS = 5;

const emptyDb = () => ({ categories: [], labels: [], tasks: [] });
const newId = () => randomUUID().slice(0, 8);
const now = () => new Date().toISOString();

export class NotFoundError extends Error {}
export class ValidationError extends Error {}

export function createStore(backend = fileBackend()) {
  const load = async () => {
    const { db, version } = await backend.read();
    return { db: { ...emptyDb(), ...db }, version };
  };

  const read = async () => (await load()).db;

  const mutate = async (fn) => {
    for (let attempt = 1; ; attempt++) {
      const { db, version } = await load();
      const result = fn(db);
      try {
        await backend.write(db, version);
        return result;
      } catch (err) {
        if (!(err instanceof ConflictError) || attempt >= MAX_ATTEMPTS) throw err;
      }
    }
  };

  const findCategory = (db, id) => {
    const cat = db.categories.find((c) => c.id === id);
    if (!cat) throw new NotFoundError(`Catégorie introuvable : ${id}`);
    return cat;
  };

  const findTask = (db, id) => {
    const task = db.tasks.find((t) => t.id === id);
    if (!task) throw new NotFoundError(`Tâche introuvable : ${id}`);
    return task;
  };

  const descendantIds = (db, id) => {
    const ids = [];
    for (const t of db.tasks.filter((t) => t.parentId === id)) {
      ids.push(t.id, ...descendantIds(db, t.id));
    }
    return ids;
  };

  // Crée les labels inconnus à la volée pour qu'on puisse taguer sans étape préalable.
  const ensureLabels = (db, names = []) => {
    const clean = [...new Set(names.map((n) => String(n).trim().toLowerCase()).filter(Boolean))];
    for (const name of clean) {
      if (!db.labels.some((l) => l.name === name)) db.labels.push({ name, color: null });
    }
    return clean;
  };

  const checkStatus = (status) => {
    if (!STATUSES.includes(status)) {
      throw new ValidationError(`Statut invalide : ${status} (attendu : ${STATUSES.join(', ')})`);
    }
  };

  const withSubtasks = (db, task) => ({
    ...task,
    subtasks: db.tasks.filter((t) => t.parentId === task.id).map((t) => withSubtasks(db, t)),
  });

  return {
    describe: () => backend.describe(),

    snapshot: read,

    // --- Catégories ---
    async listCategories() {
      const db = await read();
      return db.categories.map((c) => {
        const tasks = db.tasks.filter((t) => t.categoryId === c.id);
        return { ...c, taskCount: tasks.length, openCount: tasks.filter((t) => t.status !== 'done').length };
      });
    },

    async createCategory({ name, color = null }) {
      if (!name?.trim()) throw new ValidationError('Le nom de la catégorie est requis');
      return mutate((db) => {
        const cat = { id: newId(), name: name.trim(), color, createdAt: now() };
        db.categories.push(cat);
        return cat;
      });
    },

    async updateCategory(id, { name, color }) {
      return mutate((db) => {
        const cat = findCategory(db, id);
        if (name !== undefined) {
          if (!name.trim()) throw new ValidationError('Le nom de la catégorie est requis');
          cat.name = name.trim();
        }
        if (color !== undefined) cat.color = color;
        return cat;
      });
    },

    // Supprime aussi toutes les tâches de la catégorie.
    async deleteCategory(id) {
      return mutate((db) => {
        findCategory(db, id);
        db.categories = db.categories.filter((c) => c.id !== id);
        db.tasks = db.tasks.filter((t) => t.categoryId !== id);
        return { deleted: id };
      });
    },

    // --- Labels ---
    async listLabels() {
      const db = await read();
      return db.labels.map((l) => ({ ...l, taskCount: db.tasks.filter((t) => t.labels.includes(l.name)).length }));
    },

    async upsertLabel({ name, color = null }) {
      return mutate((db) => {
        const [clean] = ensureLabels(db, [name]);
        if (!clean) throw new ValidationError('Le nom du label est requis');
        const label = db.labels.find((l) => l.name === clean);
        label.color = color;
        return label;
      });
    },

    // Retire aussi le label de toutes les tâches.
    async deleteLabel(name) {
      return mutate((db) => {
        const clean = String(name).trim().toLowerCase();
        if (!db.labels.some((l) => l.name === clean)) throw new NotFoundError(`Label introuvable : ${name}`);
        db.labels = db.labels.filter((l) => l.name !== clean);
        for (const t of db.tasks) t.labels = t.labels.filter((l) => l !== clean);
        return { deleted: clean };
      });
    },

    // --- Tâches ---
    // Filtres combinables. Sans parentId, renvoie toutes les tâches à plat.
    async listTasks({ categoryId, label, status, parentId, search } = {}) {
      const db = await read();
      const q = search?.toLowerCase();
      return db.tasks.filter(
        (t) =>
          (categoryId === undefined || t.categoryId === categoryId) &&
          (label === undefined || t.labels.includes(label.toLowerCase())) &&
          (status === undefined || t.status === status) &&
          (parentId === undefined || t.parentId === parentId) &&
          (!q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q)),
      );
    },

    // Renvoie la tâche avec son arbre de sous-tâches.
    async getTask(id) {
      const db = await read();
      return withSubtasks(db, findTask(db, id));
    },

    // Arbre complet d'une catégorie : tâches racines + sous-tâches imbriquées.
    async getCategoryTree(categoryId) {
      const db = await read();
      const cat = findCategory(db, categoryId);
      const roots = db.tasks.filter((t) => t.categoryId === categoryId && !t.parentId);
      return { ...cat, tasks: roots.map((t) => withSubtasks(db, t)) };
    },

    async createTask({ title, categoryId, parentId = null, notes = '', labels = [], status = 'todo' }) {
      if (!title?.trim()) throw new ValidationError('Le titre est requis');
      checkStatus(status);
      return mutate((db) => {
        // Une sous-tâche hérite toujours de la catégorie de son parent.
        const catId = parentId ? findTask(db, parentId).categoryId : categoryId;
        findCategory(db, catId);
        const task = {
          id: newId(),
          categoryId: catId,
          parentId,
          title: title.trim(),
          notes,
          labels: ensureLabels(db, labels),
          status,
          log: [],
          createdAt: now(),
          updatedAt: now(),
        };
        db.tasks.push(task);
        return task;
      });
    },

    async updateTask(id, { title, notes, labels, status, categoryId }) {
      return mutate((db) => {
        const task = findTask(db, id);
        if (title !== undefined) {
          if (!title.trim()) throw new ValidationError('Le titre est requis');
          task.title = title.trim();
        }
        if (notes !== undefined) task.notes = notes;
        if (labels !== undefined) task.labels = ensureLabels(db, labels);
        if (status !== undefined) {
          checkStatus(status);
          task.status = status;
        }
        if (categoryId !== undefined && categoryId !== task.categoryId) {
          if (task.parentId) throw new ValidationError('Une sous-tâche reste dans la catégorie de son parent');
          findCategory(db, categoryId);
          const moved = new Set([id, ...descendantIds(db, id)]);
          for (const t of db.tasks) if (moved.has(t.id)) t.categoryId = categoryId;
        }
        task.updatedAt = now();
        return task;
      });
    },

    // Supprime la tâche et toutes ses sous-tâches.
    async deleteTask(id) {
      return mutate((db) => {
        findTask(db, id);
        const ids = new Set([id, ...descendantIds(db, id)]);
        db.tasks = db.tasks.filter((t) => !ids.has(t.id));
        return { deleted: [...ids] };
      });
    },

    // Journal d'activité : c'est là que Claude (ou toi) note l'avancement d'une mission.
    async addLog(id, { text, by = 'user' }) {
      if (!text?.trim()) throw new ValidationError('Le texte du journal est requis');
      return mutate((db) => {
        const task = findTask(db, id);
        const entry = { at: now(), by, text: text.trim() };
        task.log.push(entry);
        task.updatedAt = entry.at;
        return entry;
      });
    },
  };
}
