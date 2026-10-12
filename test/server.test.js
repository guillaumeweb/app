import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/server.js';
import { createStore } from '../src/store.js';
import { fileBackend } from '../src/backends.js';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'todo-')), 'todos.json');

let app, base;
before(async () => {
  app = createApp(createStore(fileBackend(tmpFile())), { password: 'secret', mcpToken: 'tok123' });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(() => app.close());

const login = (password) =>
  fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });

test("l'API exige le mot de passe ; les fichiers statiques restent publics", async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/login.html`)).status, 200);
  assert.equal((await fetch(`${base}/api/state`, { headers: { cookie: 'session=faux' } })).status, 401);
  assert.equal((await login('mauvais')).status, 401);

  const res = await login('secret');
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  assert.match(res.headers.getSetCookie()[0], /HttpOnly/);
  assert.equal((await fetch(`${base}/api/state`, { headers: { cookie } })).status, 200);
});

test('MCP HTTP : jeton requis, outils utilisables', async () => {
  assert.equal((await fetch(`${base}/mcp/mauvais`, { method: 'POST' })).status, 404);

  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/tok123`)));
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === 'add_log'));
  const res = await client.callTool({ name: 'create_category', arguments: { name: 'Depuis Claude' } });
  assert.equal(JSON.parse(res.content[0].text).name, 'Depuis Claude');
  await client.close();
});

test("Lambda : l'adaptateur relaie requêtes, corps et cookies", async () => {
  Object.assign(process.env, { TODO_DATA: tmpFile(), APP_PASSWORD: 'pw', MCP_TOKEN: 'x' });
  const { handler } = await import('../src/lambda.js');
  const event = (method, rawPath, { body, cookies } = {}) => ({
    rawPath,
    rawQueryString: '',
    headers: { 'content-type': 'application/json', host: 'exemple.lambda-url.aws' },
    cookies,
    body: body && Buffer.from(JSON.stringify(body)).toString('base64'),
    isBase64Encoded: true,
    requestContext: { http: { method } },
  });
  const decode = (r) => JSON.parse(Buffer.from(r.body, 'base64').toString());

  assert.equal((await handler(event('GET', '/api/state'))).statusCode, 401);
  const loggedIn = await handler(event('POST', '/api/login', { body: { password: 'pw' } }));
  assert.equal(loggedIn.statusCode, 200);
  const cookies = loggedIn.cookies.map((c) => c.split(';')[0]);

  const created = await handler(event('POST', '/api/categories', { body: { name: 'Lambda' }, cookies }));
  assert.equal(created.statusCode, 201);
  const state = decode(await handler(event('GET', '/api/state', { cookies })));
  assert.deepEqual(state.categories.map((c) => c.name), ['Lambda']);

  const page = await handler(event('GET', '/'));
  assert.match(page.headers['content-type'], /text\/html/);
});
