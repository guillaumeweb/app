import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dynamoBackend } from '../src/backends.js';
import { createStore } from '../src/store.js';

// Faux DynamoDBDocumentClient : Get/Put avec la même sémantique de condition
// que DynamoDB, et une latence pour que les requêtes concurrentes s'entrelacent.
function fakeDynamo() {
  const items = new Map();
  return {
    items,
    async send(cmd) {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const { input } = cmd;
      if (cmd.constructor.name === 'GetCommand') {
        const item = items.get(input.Key.pk);
        return { Item: item && structuredClone(item) };
      }
      if (cmd.constructor.name === 'PutCommand') {
        const current = items.get(input.Item.pk);
        if (current && current.version !== input.ExpressionAttributeValues[':v']) {
          throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
        }
        items.set(input.Item.pk, structuredClone(input.Item));
        return {};
      }
      throw new Error(`Commande inattendue : ${cmd.constructor.name}`);
    },
  };
}

test('DynamoDB : lecture, écriture et numéro de version', async () => {
  const client = fakeDynamo();
  const store = createStore(await dynamoBackend({ tableName: 'todos', client }));
  const cat = await store.createCategory({ name: 'Maison' });
  await store.createTask({ title: 'Courses', categoryId: cat.id });
  assert.equal(client.items.get('todo-list').version, 2);
  assert.equal((await store.listTasks()).length, 1);
});

test('DynamoDB : les écritures concurrentes ne se perdent pas', async () => {
  const client = fakeDynamo();
  const backend = await dynamoBackend({ tableName: 'todos', client });
  const store = createStore(backend);
  const cat = await store.createCategory({ name: 'Maison' });
  // Deux « processus » (ex. l'interface et Claude) écrivent en même temps.
  const other = createStore(backend);
  await Promise.all([1, 2, 3, 4].map((i) => (i % 2 ? store : other).createTask({ title: `T${i}`, categoryId: cat.id })));
  assert.deepEqual((await store.listTasks()).map((t) => t.title).sort(), ['T1', 'T2', 'T3', 'T4']);
});
