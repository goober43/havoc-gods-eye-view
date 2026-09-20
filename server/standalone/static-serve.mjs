/**
 * Production static host for `dist/` — no Vite, no Host allowlist, no HMR.
 * Serves the built globe and the same /api/havoc/* + /healthz middleware
 * used in preview, so Cloudflare tunnels can front the page.
 */
import { createServer } from 'node:http';
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { havocProxy } from '../providers/havoc.js';
import { healthzPlugin } from '../providers/healthz.js';
import { apiNotFoundPlugin } from './api-not-found.js';

export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_PORT = 4173;

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export function repoRootFrom(here = import.meta.url) {
  return fileURLToPath(new URL('../../', here));
}

/** Fill unset process.env keys from a dotenv file. Never overwrites live env. */
export function loadDotenvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cut = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!cut) continue;
    const [, name, raw] = cut;
    if (process.env[name] !== undefined) continue;
    let value = raw;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

function matchesMount(pathname, mount) {
  return pathname === mount || pathname.startsWith(`${mount}/`);
}

function createMiddlewareStack() {
  const layers = [];
  return {
    use(pathOrHandler, maybeHandler) {
      if (typeof pathOrHandler === 'function') {
        layers.push({ mount: null, handler: pathOrHandler });
        return;
      }
      layers.push({ mount: pathOrHandler, handler: maybeHandler });
    },
    layers,
    handle(req, res, done) {
      let index = 0;
      const next = (error) => {
        if (error) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Internal server error');
          }
          return;
        }
        const layer = layers[index++];
        if (!layer) {
          done();
          return;
        }
        const url = req.url || '/';
        const q = url.indexOf('?');
        const pathname = q === -1 ? url : url.slice(0, q);
        const search = q === -1 ? '' : url.slice(q);
        if (layer.mount && !matchesMount(pathname, layer.mount)) {
          next();
          return;
        }
        const original = req.url;
        if (layer.mount) {
          const suffix = pathname.slice(layer.mount.length) || '/';
          req.url = `${suffix}${search}`;
        }
        try {
          const result = layer.handler(req, res, () => {
            req.url = original;
            next();
          });
          if (result && typeof result.then === 'function') {
            result.catch(next);
          }
        } catch (caught) {
          next(caught);
        }
      };
      next();
    },
  };
}

/** Attach /healthz and /api/havoc/* (PostgREST or stubs). No Vite, no key-setup. */
export function attachProductionApi(middlewares) {
  const fake = { middlewares, httpServer: null };
  healthzPlugin().configurePreviewServer(fake);
  havocProxy().configurePreviewServer(fake);
  apiNotFoundPlugin().configurePreviewServer(fake);
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const relative = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  const rootReal = path.resolve(root);
  if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  createReadStream(filePath).pipe(res);
}

export function serveDistFile(distDir, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  const url = req.url || '/';
  const pathname = url.split('?')[0] || '/';
  const target =
    pathname === '/'
      ? path.join(distDir, 'index.html')
      : safeJoin(distDir, pathname);
  if (!target) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  try {
    const stat = statSync(target);
    if (stat.isFile()) {
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.end();
        return;
      }
      sendFile(res, target);
      return;
    }
  } catch {
    // missing
  }
  const looksLikeAsset = path.extname(pathname) !== '';
  const index = path.join(distDir, 'index.html');
  if (!looksLikeAsset && existsSync(index)) {
    sendFile(res, index);
    return;
  }
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

export function createHavocStaticListener(distDir) {
  const stack = createMiddlewareStack();
  attachProductionApi(stack);
  return (req, res) => {
    stack.handle(req, res, () => serveDistFile(distDir, req, res));
  };
}

export async function listenHavocStaticServer({
  host = process.env.HOST || DEFAULT_HOST,
  port = process.env.PORT || DEFAULT_PORT,
  distDir,
  root = repoRootFrom(),
} = {}) {
  const resolvedDist = distDir || path.join(root, 'dist');
  if (!existsSync(path.join(resolvedDist, 'index.html'))) {
    throw new Error(
      `Missing ${path.join(resolvedDist, 'index.html')}. Run \`npm run build\` first, then \`npm run start\`.`,
    );
  }
  const server = createServer(createHavocStaticListener(resolvedDist));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port) || DEFAULT_PORT, host, () => {
      const address = server.address();
      resolve({
        server,
        host,
        port: typeof address === 'object' && address ? address.port : Number(port),
        distDir: resolvedDist,
      });
    });
  });
}

export async function main(argv = process.argv.slice(2)) {
  const root = repoRootFrom();
  loadDotenvFile(path.join(root, '.env'));
  const host = process.env.HOST || DEFAULT_HOST;
  const port = process.env.PORT || DEFAULT_PORT;
  const distDir = argv[0] ? path.resolve(argv[0]) : path.join(root, 'dist');
  const { server, port: bound } = await listenHavocStaticServer({
    host,
    port,
    distDir,
    root,
  });
  console.log(
    `[havoc] static dist on http://${host}:${bound} (no Vite host check; /api/havoc + /healthz attached)`,
  );
  return server;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
