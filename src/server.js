// Serveur web : API REST, fichiers statiques de l'interface et endpoint MCP HTTP.
//
// Variables d'environnement (toutes optionnelles en local) :
//   APP_PASSWORD  protège l'API par un mot de passe (cookie de session).
//   MCP_TOKEN     active l'endpoint MCP distant sur /mcp/<MCP_TOKEN>.
//   STORAGE, TABLE_NAME, TODO_DATA : voir src/backends.js.
// Sans APP_PASSWORD, le serveur n'écoute que sur 127.0.0.1.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createStore, NotFoundError, ValidationError } from './store.js';
import { backendFromEnv } from './backends.js';
import { buildMcpServer } from './mcp-tools.js';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const SESSION_DAYS = 30;

// Comparaison à temps constant, quelle que soit la longueur des chaînes.
const safeEqual = (a, b) => {
  const h = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(h(a), h(b));
};

const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );

export function createApp(store, { password = process.env.APP_PASSWORD, mcpToken = process.env.MCP_TOKEN } = {}) {
  // Le jeton de session dérive du mot de passe : le changer déconnecte tout le monde.
  const sessionToken = password ? createHmac('sha256', password).update('todo-session-v1').digest('hex') : null;

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

  const send = (res, status, data, type = 'application/json', headers = {}) => {
    res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, ...headers });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };

  const readBody = async (req) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  };

  const sessionCookie = (req, value, maxAge) => {
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return `session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
  };

  const isLoggedIn = (req) => !password || safeEqual(parseCookies(req.headers.cookie).session ?? '', sessionToken);

  async function login(req, res) {
    const { password: given = '' } = await readBody(req);
    if (!password) return send(res, 200, { ok: true });
    if (!safeEqual(given, password)) {
      await new Promise((r) => setTimeout(r, 500)); // freine les essais en série
      return send(res, 401, { error: 'Mot de passe incorrect' });
    }
    send(res, 200, { ok: true }, 'application/json', {
      'Set-Cookie': sessionCookie(req, sessionToken, SESSION_DAYS * 86400),
    });
  }

  // MCP sans état : un serveur et un transport par requête, réponses JSON simples
  // (compatible Lambda, qui ne garde rien entre deux invocations).
  async function handleMcp(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Méthode non supportée (MCP sans état)' });
    const server = buildMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readBody(req));
  }

  const serveStatic = async (res, pathname) => {
    const file = resolve(join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR + '/')) return send(res, 403, { error: 'Interdit' });
    try {
      send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
    } catch {
      send(res, 404, { error: 'Introuvable' });
    }
  };

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/mcp/')) {
        if (!mcpToken || !safeEqual(pathname.slice('/mcp/'.length), mcpToken)) return send(res, 404, { error: 'Introuvable' });
        return await handleMcp(req, res);
      }
      if (!pathname.startsWith('/api/')) return await serveStatic(res, pathname);
      if (pathname === '/api/login' && req.method === 'POST') return await login(req, res);
      if (pathname === '/api/logout' && req.method === 'POST') {
        return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': sessionCookie(req, '', 0) });
      }
      if (!isLoggedIn(req)) return send(res, 401, { error: 'Connexion requise' });

      for (const [method, pattern, handler] of routes) {
        const match = pathname.match(pattern);
        if (match && req.method === method) {
          const body = ['POST', 'PATCH'].includes(method) ? await readBody(req) : {};
          return send(res, method === 'POST' ? 201 : 200, await handler(match.slice(1), body));
        }
      }
      send(res, 404, { error: 'Route inconnue' });
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof NotFoundError) return send(res, 404, { error: err.message });
      if (err instanceof ValidationError || err instanceof SyntaxError) return send(res, 400, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Erreur interne' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = createStore(await backendFromEnv());
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || (process.env.APP_PASSWORD ? '0.0.0.0' : '127.0.0.1');
  createApp(store).listen(port, host, () => {
    console.log(`Todo list sur http://${host}:${port} (stockage : ${store.describe()})`);
    if (process.env.MCP_TOKEN) console.log(`MCP HTTP actif sur /mcp/<MCP_TOKEN>`);
  });
}
