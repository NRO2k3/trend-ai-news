import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from './lib/data.js';

const PORT = Number(process.env.PORT) || 5050;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

// Locally, /data/<name>.json is computed live; on a static host the same paths
// are files written by scripts/build.js.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = url.pathname.match(/^\/data\/(\w+)\.json$/)?.[1];
  if (name && DATA[name]) {
    try {
      const data = await DATA[name]({ force: url.searchParams.has('refresh') });
      send(res, 200, JSON.stringify(data), TYPES['.json']);
    } catch (err) {
      console.error(url.pathname, err);
      send(res, 502, JSON.stringify({ error: err.message }), TYPES['.json']);
    }
    return;
  }
  const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Trend AI News đang chạy: http://localhost:${PORT}`);
  // Warm the caches so the first page load is fast.
  for (const load of Object.values(DATA)) load().catch((err) => console.error('warmup:', err.message));
});
