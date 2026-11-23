import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4175);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname);
    const safePath = normalize(requestPath).replace(/^([/\\])+/, '');
    let filePath = resolve(DIST, safePath);

    if (!filePath.startsWith(resolve(DIST))) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      fileStat = null;
    }
    if (!fileStat?.isFile()) {
      if (extname(requestPath)) {
        response.writeHead(404).end('Not found');
        return;
      }
      filePath = join(DIST, 'index.html');
      fileStat = await stat(filePath);
    }

    response.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': fileStat.size,
      'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Service-Worker-Allowed': '/',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(`Internal error: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Tích Lũy đang chạy tại http://${HOST}:${PORT}`);
});
