// Serveur web : API REST + fichiers statiques de l'interface.
// Écoute sur 127.0.0.1 par défaut : il n'y a pas d'authentification.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, NotFoundError, ValidationError } from './store.js';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function createApp(store = createStore()) {
  const routes = [
    ['GET', /^\/api\/state$/, () => store.snapshot()],
    ['POST', /^\/api\/categories$/, (_, body) => store.createCategory(body)],
    ['PATCH', /^\/api\/categories\/([\w-]+)$/, ([id], body) => store.updateCategory(id, body)],
    ['DELETE', /^\/api\/categories\/([\w-]+)$/, ([id]) => store.deleteCategory(id)],
    ['POST', /^\/api\/labels$/, (_, body) => store.upsertLabel(body)],
    ['DELETE', /^\/api\/labels\/([^/]+)$/, ([name]) => store.deleteLabel(decodeURIComponent(name))],
    ['POST', /^\/api\/tasks$/, (_, body) => store.createTask(body)],
    ['PATCH', /^\/api\/tasks\/([\w-]+)$/, ([id], body) => store.updateTask(id, body)],
    ['DELETE', /^\/api\/tasks\/([\w-]+)$/, ([id]) => store.deleteTask(id)],
    ['POST', /^\/api\/tasks\/([\w-]+)\/log$/, ([id], body) => store.addLog(id, body)],
  ];

  const send = (res, status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };

  const readBody = async (req) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  };

  const serveStatic = async (res, pathname) => {
    const file = resolve(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Interdit' });
    try {
      send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
    } catch {
      send(res, 404, { error: 'Introuvable' });
    }
  };

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (!pathname.startsWith('/api/')) return await serveStatic(res, pathname);
      for (const [method, pattern, handler] of routes) {
        const match = pathname.match(pattern);
        if (match && req.method === method) {
          const body = ['POST', 'PATCH'].includes(method) ? await readBody(req) : {};
          return send(res, method === 'POST' ? 201 : 200, handler(match.slice(1), body));
        }
      }
      send(res, 404, { error: 'Route inconnue' });
    } catch (err) {
      if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
      if (err instanceof ValidationError || err instanceof SyntaxError) return send(res, 400, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Erreur interne' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => console.log(`Todo list sur http://${host}:${port}`));
}
