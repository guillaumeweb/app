import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, NotFoundError, ValidationError } from '../src/store.js';

let store;
beforeEach(() => {
  store = createStore(join(mkdtempSync(join(tmpdir(), 'todo-')), 'todos.json'));
});

test('crée catégorie, tâche et sous-tâche ; la sous-tâche hérite de la catégorie', () => {
  const cat = store.createCategory({ name: 'Maison' });
  const task = store.createTask({ title: 'Courses', categoryId: cat.id });
  const sub = store.createTask({ title: 'Lait', parentId: task.id });
  assert.equal(sub.categoryId, cat.id);
  assert.deepEqual(store.getTask(task.id).subtasks.map((t) => t.title), ['Lait']);
});

test('les labels sont normalisés, créés à la volée et filtrables', () => {
  const cat = store.createCategory({ name: 'Perso' });
  store.createTask({ title: 'Pain', categoryId: cat.id, labels: [' Achat ', 'achat', 'URGENT'] });
  store.createTask({ title: 'Lire', categoryId: cat.id });
  assert.deepEqual(store.listLabels().map((l) => l.name), ['achat', 'urgent']);
  assert.deepEqual(store.listTasks({ label: 'Urgent' }).map((t) => t.title), ['Pain']);
});

test('supprimer une tâche supprime ses descendants', () => {
  const cat = store.createCategory({ name: 'Projet' });
  const a = store.createTask({ title: 'A', categoryId: cat.id });
  const b = store.createTask({ title: 'B', parentId: a.id });
  store.createTask({ title: 'C', parentId: b.id });
  store.deleteTask(a.id);
  assert.equal(store.listTasks().length, 0);
});

test('déplacer une tâche déplace ses sous-tâches', () => {
  const c1 = store.createCategory({ name: 'Un' });
  const c2 = store.createCategory({ name: 'Deux' });
  const a = store.createTask({ title: 'A', categoryId: c1.id });
  const b = store.createTask({ title: 'B', parentId: a.id });
  store.updateTask(a.id, { categoryId: c2.id });
  assert.equal(store.getTask(b.id).categoryId, c2.id);
  assert.throws(() => store.updateTask(b.id, { categoryId: c1.id }), ValidationError);
});

test('supprimer un label le retire des tâches ; supprimer une catégorie supprime ses tâches', () => {
  const cat = store.createCategory({ name: 'X' });
  const t = store.createTask({ title: 'T', categoryId: cat.id, labels: ['urgent'] });
  store.deleteLabel('urgent');
  assert.deepEqual(store.getTask(t.id).labels, []);
  store.deleteCategory(cat.id);
  assert.equal(store.listTasks().length, 0);
});

test('journal et erreurs', () => {
  const cat = store.createCategory({ name: 'X' });
  const t = store.createTask({ title: 'Mission', categoryId: cat.id, labels: ['claude'] });
  store.addLog(t.id, { text: 'Recherche terminée', by: 'claude' });
  assert.equal(store.getTask(t.id).log[0].by, 'claude');
  assert.throws(() => store.getTask('nope'), NotFoundError);
  assert.throws(() => store.updateTask(t.id, { status: 'fini' }), ValidationError);
  assert.throws(() => store.createTask({ title: 'Sans catégorie' }), NotFoundError);
});
