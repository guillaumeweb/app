import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, NotFoundError, ValidationError } from '../src/store.js';
import { fileBackend } from '../src/backends.js';

let store;
beforeEach(() => {
  store = createStore(fileBackend(join(mkdtempSync(join(tmpdir(), 'todo-')), 'todos.json')));
});

test('crée catégorie, tâche et sous-tâche ; la sous-tâche hérite de la catégorie', async () => {
  const cat = await store.createCategory({ name: 'Maison' });
  const task = await store.createTask({ title: 'Courses', categoryId: cat.id });
  const sub = await store.createTask({ title: 'Lait', parentId: task.id });
  assert.equal(sub.categoryId, cat.id);
  assert.deepEqual((await store.getTask(task.id)).subtasks.map((t) => t.title), ['Lait']);
});

test('les labels sont normalisés, créés à la volée et filtrables', async () => {
  const cat = await store.createCategory({ name: 'Perso' });
  await store.createTask({ title: 'Pain', categoryId: cat.id, labels: [' Achat ', 'achat', 'URGENT'] });
  await store.createTask({ title: 'Lire', categoryId: cat.id });
  assert.deepEqual((await store.listLabels()).map((l) => l.name), ['achat', 'urgent']);
  assert.deepEqual((await store.listTasks({ label: 'Urgent' })).map((t) => t.title), ['Pain']);
});

test('supprimer une tâche supprime ses descendants', async () => {
  const cat = await store.createCategory({ name: 'Projet' });
  const a = await store.createTask({ title: 'A', categoryId: cat.id });
  const b = await store.createTask({ title: 'B', parentId: a.id });
  await store.createTask({ title: 'C', parentId: b.id });
  await store.deleteTask(a.id);
  assert.equal((await store.listTasks()).length, 0);
});

test('déplacer une tâche déplace ses sous-tâches', async () => {
  const c1 = await store.createCategory({ name: 'Un' });
  const c2 = await store.createCategory({ name: 'Deux' });
  const a = await store.createTask({ title: 'A', categoryId: c1.id });
  const b = await store.createTask({ title: 'B', parentId: a.id });
  await store.updateTask(a.id, { categoryId: c2.id });
  assert.equal((await store.getTask(b.id)).categoryId, c2.id);
  await assert.rejects(() => store.updateTask(b.id, { categoryId: c1.id }), ValidationError);
});

test('supprimer un label le retire des tâches ; supprimer une catégorie supprime ses tâches', async () => {
  const cat = await store.createCategory({ name: 'X' });
  const t = await store.createTask({ title: 'T', categoryId: cat.id, labels: ['urgent'] });
  await store.deleteLabel('urgent');
  assert.deepEqual((await store.getTask(t.id)).labels, []);
  await store.deleteCategory(cat.id);
  assert.equal((await store.listTasks()).length, 0);
});

test('journal et erreurs', async () => {
  const cat = await store.createCategory({ name: 'X' });
  const t = await store.createTask({ title: 'Mission', categoryId: cat.id, labels: ['claude'] });
  await store.addLog(t.id, { text: 'Recherche terminée', by: 'claude' });
  assert.equal((await store.getTask(t.id)).log[0].by, 'claude');
  await assert.rejects(() => store.getTask('nope'), NotFoundError);
  await assert.rejects(() => store.updateTask(t.id, { status: 'fini' }), ValidationError);
  await assert.rejects(() => store.createTask({ title: 'Sans catégorie' }), NotFoundError);
});
