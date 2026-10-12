// Outils MCP : exposent la todo list à Claude pour qu'il puisse lire les
// missions, créer des tâches et rendre compte de son avancement.
// Utilisés par le serveur stdio (src/mcp.js) et par l'endpoint HTTP (src/server.js).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STATUSES } from './store.js';

const status = z.enum(STATUSES);
const labels = z
  .array(z.string())
  .describe('Noms de labels, ex. ["urgent", "achat"]. Créés à la volée s\'ils n\'existent pas.');

export function buildMcpServer(store) {
  const server = new McpServer({ name: 'todo-list', version: '0.2.0' });

  // Chaque outil renvoie du JSON ; les erreurs du store remontent comme erreurs d'outil.
  const tool = (name, description, inputSchema, fn) =>
    server.registerTool(name, { description, inputSchema }, async (args) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await fn(args), null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    });

  tool('list_categories', 'Liste les catégories avec le nombre de tâches ouvertes.', {}, () => store.listCategories());

  tool('create_category', 'Crée une catégorie.', { name: z.string() }, (a) => store.createCategory(a));

  tool('rename_category', 'Renomme une catégorie.', { id: z.string(), name: z.string() }, ({ id, name }) =>
    store.updateCategory(id, { name }),
  );

  tool(
    'delete_category',
    "Supprime une catégorie ET toutes ses tâches. Demander confirmation à l'utilisateur avant.",
    { id: z.string() },
    ({ id }) => store.deleteCategory(id),
  );

  tool('list_labels', 'Liste les labels existants avec leur nombre de tâches.', {}, () => store.listLabels());

  tool(
    'list_tasks',
    'Liste les tâches (à plat) avec filtres combinables. Ex. label "urgent" + status "todo" pour les urgences ouvertes, ou label "claude" pour les missions confiées à Claude.',
    {
      categoryId: z.string().optional(),
      label: z.string().optional(),
      status: status.optional(),
      search: z.string().optional().describe('Recherche dans le titre et les notes'),
    },
    (a) => store.listTasks(a),
  );

  tool('get_task', "Détail d'une tâche : notes, journal et arbre des sous-tâches.", { id: z.string() }, ({ id }) =>
    store.getTask(id),
  );

  tool(
    'get_category_tree',
    "Toutes les tâches d'une catégorie, sous-tâches imbriquées.",
    { categoryId: z.string() },
    ({ categoryId }) => store.getCategoryTree(categoryId),
  );

  tool(
    'create_task',
    'Crée une tâche dans une catégorie, ou une sous-tâche si parentId est fourni (elle hérite alors de la catégorie du parent).',
    {
      title: z.string(),
      categoryId: z.string().optional().describe('Requis sauf pour une sous-tâche'),
      parentId: z.string().optional(),
      notes: z.string().optional(),
      labels: labels.optional(),
      status: status.optional(),
    },
    (a) => store.createTask(a),
  );

  tool(
    'update_task',
    'Modifie une tâche. Seuls les champs fournis changent ; labels remplace la liste entière.',
    {
      id: z.string(),
      title: z.string().optional(),
      notes: z.string().optional(),
      labels: labels.optional(),
      status: status.optional(),
      categoryId: z.string().optional().describe('Déplace la tâche et ses sous-tâches'),
    },
    ({ id, ...changes }) => store.updateTask(id, changes),
  );

  tool('delete_task', 'Supprime une tâche et ses sous-tâches.', { id: z.string() }, ({ id }) => store.deleteTask(id));

  tool(
    'add_log',
    "Ajoute une entrée au journal d'une tâche : compte rendu d'avancement, résultat, blocage ou question pour l'utilisateur.",
    { id: z.string(), text: z.string() },
    ({ id, text }) => store.addLog(id, { text, by: 'claude' }),
  );

  return server;
}
