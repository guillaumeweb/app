// Point d'entrée AWS Lambda (Function URL). Démarre le serveur HTTP de
// l'application sur un port local au premier appel, puis lui relaie chaque
// événement : le même code tourne ainsi en local et sur Lambda.
import { createApp } from './server.js';
import { createStore } from './store.js';
import { backendFromEnv } from './backends.js';

// En-têtes gérés par la couche HTTP elle-même, à ne pas recopier.
const HOP_BY_HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'content-encoding']);

let port;

async function start() {
  const app = createApp(createStore(await backendFromEnv()));
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  return app.address().port;
}

export async function handler(event) {
  port ??= await start();
  const { method } = event.requestContext.http;

  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).filter(([k]) => !HOP_BY_HOP.has(k)));
  if (event.cookies?.length) headers.cookie = event.cookies.join('; ');

  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const hasBody = event.body && !['GET', 'HEAD'].includes(method);
  const res = await fetch(`http://127.0.0.1:${port}${event.rawPath}${query}`, {
    method,
    headers,
    body: hasBody ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8') : undefined,
  });

  const responseHeaders = {};
  for (const [k, v] of res.headers) if (k !== 'set-cookie' && !HOP_BY_HOP.has(k)) responseHeaders[k] = v;

  return {
    statusCode: res.status,
    headers: responseHeaders,
    cookies: res.headers.getSetCookie(),
    body: Buffer.from(await res.arrayBuffer()).toString('base64'),
    isBase64Encoded: true,
  };
}
