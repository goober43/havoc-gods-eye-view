import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { havocProxy } from '../../server/providers/havoc.js';
import { healthzPlugin } from '../../server/providers/healthz.js';

function captureMiddleware(plugin) {
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(routeOrHandler, maybeHandler) {
        middleware = typeof routeOrHandler === 'function' ? routeOrHandler : maybeHandler;
      },
    },
  });
  return middleware;
}

function invoke(middleware, { method = 'GET', url = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([]);
    Object.assign(req, { method, url, headers: { host: '127.0.0.1' } });
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(body = '') {
        resolve({
          status: this.statusCode,
          headers,
          body: String(body),
          json: () => JSON.parse(String(body)),
        });
      },
    };
    Promise.resolve(middleware(req, res, () => resolve({ status: 0, passed: true }))).catch(
      reject,
    );
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

test('/healthz returns ok', async () => {
  const result = await invoke(captureMiddleware(healthzPlugin()), { url: '/healthz' });
  assert.equal(result.status, 200);
  assert.equal(result.body, 'ok');
});

test('HAVOC stub serves aircraft_history GeoJSON without secrets', async (t) => {
  env(t, 'HAVOC_SUPABASE_URL');
  env(t, 'HAVOC_SUPABASE_KEY');
  const result = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/aircraft_history?bbox=-99,29,-96,31&limit=10',
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers['x-havoc-source'], 'stub');
  assert.equal(result.headers['x-havoc-lane'], 'aircraft_history');
  const body = result.json();
  assert.equal(body.type, 'FeatureCollection');
  assert.ok(body.features.length >= 1);
  assert.equal(body.features[0].properties.callsign, 'DAL123');
});

test('unknown HAVOC lane is 404 and blocked hosts never go live', async (t) => {
  env(t, 'HAVOC_SUPABASE_URL', 'https://opensky-network.org');
  env(t, 'HAVOC_SUPABASE_KEY', 'not-a-secret');
  const unknown = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/opensky',
  });
  assert.equal(unknown.status, 404);
  const blocked = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/lane_events',
  });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.headers['x-havoc-source'], 'stub');
});
