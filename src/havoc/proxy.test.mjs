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

test.describe('havoc proxy', { concurrency: false }, () => {
test('/healthz returns ok', async () => {
  const result = await invoke(captureMiddleware(healthzPlugin()), { url: '/healthz' });
  assert.equal(result.status, 200);
  assert.equal(result.body, 'ok');
});

test('HAVOC stub serves aircraft_history GeoJSON without secrets', async (t) => {
  env(t, 'HAVOC_SUPABASE_URL');
  env(t, 'HAVOC_SUPABASE_KEY');
  env(t, 'SUPABASE_URL');
  env(t, 'SUPABASE_SERVICE_ROLE_KEY');
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

test('live PostgREST 206 maps lane_events and havoc_intel columns', async (t) => {
  env(t, 'HAVOC_SUPABASE_URL', 'https://example.supabase.co');
  env(t, 'HAVOC_SUPABASE_KEY', 'service-role-test');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), prefer: init.headers.Prefer });
    const href = String(url);
    const rows = href.includes('lane_events')
      ? [{ id: 'e1', lat: 30.27, lon: -97.74, title: 'Austin', map_eligible: true }]
      : [{ id: 'i1', geo_lat: 38.9072, geo_lon: -77.0369, title: 'DC' }];
    return {
      ok: true,
      status: 206,
      headers: new Headers({ 'content-range': '0-0/80000' }),
      json: async () => rows,
    };
  });
  const lanes = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/lane_events?bbox=-99,29,-96,31&limit=50',
  });
  assert.equal(lanes.status, 200);
  assert.equal(lanes.headers['x-havoc-source'], 'postgrest');
  assert.equal(lanes.headers['x-havoc-upstream-status'], '206');
  assert.deepEqual(lanes.json().features[0].geometry.coordinates, [-97.74, 30.27]);
  assert.match(calls[0].url, /map_eligible=eq\.true/);
  assert.equal(calls[0].prefer, 'count=exact');

  const intel = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/havoc_intel?bbox=-80,38,-76,40&limit=50',
  });
  assert.equal(intel.headers['x-havoc-source'], 'postgrest');
  assert.deepEqual(intel.json().features[0].geometry.coordinates, [-77.0369, 38.9072]);
  assert.match(calls[1].url, /geo_lat/);
  assert.doesNotMatch(calls[1].url, /[?&]lat=/);
});

test('live place-only lanes stay empty', async (t) => {
  env(t, 'HAVOC_SUPABASE_URL', 'https://example.supabase.co');
  env(t, 'HAVOC_SUPABASE_KEY', 'service-role-test');
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.doesNotMatch(String(url), /[?&]lat=/);
    return {
      ok: true,
      status: 206,
      headers: new Headers({ 'content-range': '0-1/12' }),
      json: async () => [{ id: 'c1', place: 'Austin, TX' }],
    };
  });
  const live = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/event_clusters?limit=20',
  });
  assert.equal(live.headers['x-havoc-source'], 'postgrest');
  assert.equal(live.headers['x-havoc-coverage'], 'no-point-geometry');
  assert.equal(live.json().features.length, 0);
});

test('stub-without-env still boots event_clusters sample GeoJSON', async (t) => {
  env(t, 'HAVOC_SUPABASE_URL');
  env(t, 'HAVOC_SUPABASE_KEY');
  env(t, 'SUPABASE_URL');
  env(t, 'SUPABASE_SERVICE_ROLE_KEY');
  const stub = await invoke(captureMiddleware(havocProxy()), {
    url: '/api/havoc/event_clusters?limit=20',
  });
  assert.equal(stub.headers['x-havoc-source'], 'stub');
  assert.ok(stub.json().features.length >= 1);
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
});
