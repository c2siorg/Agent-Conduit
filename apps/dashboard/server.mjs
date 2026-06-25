// Tiny static file server + /api proxy for the built dashboard. Pure node builtins (no nginx, no deps),
// so it runs on the same node image as the gateway. Serves ./dist with SPA fallback and forwards
// /api/* to the gateway (stripping the /api prefix), e.g. /api/agents -> CONDUIT_ORIGIN/agents.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8080);
const ORIGIN = process.env.CONDUIT_ORIGIN ?? 'http://localhost:8443';
const origin = new URL(ORIGIN);
const DIST = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname === '/') pathname = '/index.html';
  let filePath = normalize(join(DIST, pathname));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(DIST, 'index.html'); // SPA fallback
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

function proxy(req, res) {
  const path = req.url.replace(/^\/api/, '') || '/';
  const upstream = httpRequest(
    {
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port,
      method: req.method,
      path,
      headers: { ...req.headers, host: origin.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"bad_gateway"}');
  });
  req.pipe(upstream);
}

createServer((req, res) => {
  if (req.url && (req.url === '/api' || req.url.startsWith('/api/'))) {
    proxy(req, res);
  } else {
    serveStatic(req, res);
  }
}).listen(PORT, () => {
  process.stdout.write(`dashboard serving on :${PORT} -> api ${ORIGIN}\n`);
});
