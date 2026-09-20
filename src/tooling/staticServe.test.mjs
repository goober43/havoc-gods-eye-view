import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createHavocStaticListener,
  listenHavocStaticServer,
  loadDotenvFile,
} from '../../server/standalone/static-serve.mjs';

function httpGet(port, urlPath, host) {
  return new Promise((resolve, reject) => {
    http
      .get(
        { hostname: '127.0.0.1', port, path: urlPath, headers: { host } },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      )
      .on('error', reject);
  });
}

function env(t, name, value) {
  const old = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  });
}

function fixtureDist() {
  const dir = mkdtempSync(path.join(tmpdir(), 'havoc-dist-'));
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><title>HAVOC God View</title><div id="cesiumContainer"></div>',
  );
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'window.__HAVOC_STATIC=1;');
  return dir;
}

function invoke(listener, { method = 'GET', url = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = {
      method,
      url,
      headers: { host: 'trycloudflare.example', ...headers },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(status, values = {}) {
        this.statusCode = status;
        for (const [key, value] of Object.entries(values)) this.setHeader(key, value);
      },
      write(chunk) {
        chunks.push(Buffer.from(chunk));
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      },
    };
    try {
      listener(req, res);
    } catch (error) {
      reject(error);
    }
  });
}

test('dotenv fill never overwrites a live environment value', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'havoc-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.env');
  writeFileSync(file, 'HAVOC_STATIC_TEST=from-file\n');
  env(t, 'HAVOC_STATIC_TEST', 'from-process');
  loadDotenvFile(file);
  assert.equal(process.env.HAVOC_STATIC_TEST, 'from-process');
  delete process.env.HAVOC_STATIC_TEST;
  loadDotenvFile(file);
  assert.equal(process.env.HAVOC_STATIC_TEST, 'from-file');
});

test('static listener serves dist and ignores Vite-blocked tunnel Host headers', async (t) => {
  const dist = fixtureDist();
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  env(t, 'HAVOC_SUPABASE_URL');
  env(t, 'HAVOC_SUPABASE_KEY');
  env(t, 'SUPABASE_URL');
  env(t, 'SUPABASE_SERVICE_ROLE_KEY');
  const { server, port } = await listenHavocStaticServer({
    host: '127.0.0.1',
    port: 0,
    distDir: dist,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const page = await httpGet(port, '/', 'random-name.trycloudflare.com');
  assert.equal(page.status, 200);
  assert.match(page.body, /cesiumContainer/);
  assert.doesNotMatch(page.body, /Blocked request/);
  const asset = await httpGet(port, '/assets/app.js', 'random-name.trycloudflare.com');
  assert.equal(asset.status, 200);
  assert.match(asset.body, /__HAVOC_STATIC/);
  const health = await httpGet(port, '/healthz', 'random-name.trycloudflare.com');
  assert.equal(health.status, 200);
  assert.equal(health.body, 'ok');
});

test('static listener proxies /api/havoc/lane_events and accepts 206', async (t) => {
  const dist = fixtureDist();
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  env(t, 'HAVOC_SUPABASE_URL', 'https://example.supabase.co');
  env(t, 'HAVOC_SUPABASE_KEY', 'service-role-test');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(String(url), /\/rest\/v1\/lane_events/);
    assert.match(decodeURIComponent(String(url)), /location_lat/);
    assert.match(decodeURIComponent(String(url)), /map_eligible=eq\.true/);
    assert.equal(init.headers.Prefer, 'count=exact');
    return {
      ok: true,
      status: 206,
      headers: new Headers({ 'content-range': '0-0/80000' }),
      json: async () => [
        {
          id: 'e1',
          location_lat: 26.57,
          location_lon: 56.25,
          map_eligible: true,
        },
      ],
    };
  });
  const listener = createHavocStaticListener(dist);
  const result = await invoke(listener, {
    url: '/api/havoc/lane_events?limit=20',
    headers: { host: 'acceptance.trycloudflare.com' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers['x-havoc-source'], 'postgrest');
  assert.equal(result.headers['x-havoc-upstream-status'], '206');
  const body = JSON.parse(result.body);
  assert.equal(body.features.length, 1);
  assert.deepEqual(body.features[0].geometry.coordinates, [56.25, 26.57]);
});

test('listen refuses to start without a built index.html', async () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'havoc-empty-'));
  await assert.rejects(
    listenHavocStaticServer({ host: '127.0.0.1', port: 0, distDir: empty }),
    /npm run build/,
  );
  rmSync(empty, { recursive: true, force: true });
});
