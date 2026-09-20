import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAVOC_LANE_BY_TABLE, isBlockedHavocHost, isHavocLane } from '../../src/havoc/lanes.js';
import { toFeatureCollection } from '../../src/havoc/geojson.js';
import {
  havocLaneRestUrl,
  parseHavocBbox,
  resolveHavocLimit,
} from '../../src/havoc/postgrest.js';

const STUB_ROOT = fileURLToPath(new URL('../../public/havoc/', import.meta.url));

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(payload);
}

function inBbox(feature, box) {
  if (!box) return true;
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords)) return true;
  const [lon, lat] = coords;
  if (box.west > box.east) {
    return (
      lat >= box.south &&
      lat <= box.north &&
      (lon >= box.west || lon <= box.east)
    );
  }
  return lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;
}

function sample(collection, url) {
  const box = parseHavocBbox(url.searchParams);
  const limit = resolveHavocLimit(url.searchParams);
  const id = String(url.searchParams.get('id') || '')
    .trim()
    .toLowerCase();
  let features = collection.features.filter((feature) => inBbox(feature, box));
  if (id) {
    features = features.filter((feature) => {
      const props = feature.properties || {};
      return [feature.id, props.id, props.icao24, props.mmsi]
        .map((value) => String(value || '').toLowerCase())
        .includes(id);
    });
  }
  return {
    type: 'FeatureCollection',
    features: features.slice(0, limit),
  };
}

async function readStub(table) {
  const text = await readFile(path.join(STUB_ROOT, `${table}.geojson`), 'utf8');
  return toFeatureCollection(JSON.parse(text), table);
}

/** Service role required for vessel_history / aircraft_history / event_clusters (anon RLS empty). */
function havocConfigured() {
  const url = String(
    process.env.HAVOC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  ).trim();
  const key = String(
    process.env.HAVOC_SUPABASE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      '',
  ).trim();
  if (!url || !key) return null;
  if (isBlockedHavocHost(url)) {
    throw new Error('HAVOC_SUPABASE_URL host is blocked by commercial_ok policy');
  }
  return { url, key };
}

async function fetchLive(table, requestUrl) {
  const creds = havocConfigured();
  if (!creds) return null;
  const upstream = await fetch(
    havocLaneRestUrl(creds.url, table, requestUrl.searchParams),
    {
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
    },
  );
  // PostgREST returns 206 when Prefer: count=exact and the page is a sample.
  if (!upstream.ok) {
    const error = new Error(`PostgREST HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  const payload = await upstream.json();
  return {
    collection: toFeatureCollection(payload, table),
    status: upstream.status,
    contentRange: upstream.headers.get('content-range') || '',
  };
}

function attachHavocRoutes(server) {
  server.middlewares.use(async (req, res, next) => {
    const raw = req.url || '';
    if (!raw.startsWith('/api/havoc')) return next();
    let url;
    try {
      url = new URL(raw, 'http://127.0.0.1');
    } catch {
      return json(res, 400, { error: 'Invalid HAVOC request' });
    }
    const match = /^\/api\/havoc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (!match || !isHavocLane(match[1])) {
      return json(res, 404, { error: 'Unknown HAVOC lane' });
    }
    const table = match[1];
    if (req.method !== 'GET') {
      return json(res, 405, { error: 'Method not allowed' });
    }
    try {
      let collection = null;
      let source = 'stub';
      let upstreamStatus = '';
      let contentRange = '';
      try {
        const live = await fetchLive(table, url);
        if (live) {
          collection = live.collection;
          source = 'postgrest';
          upstreamStatus = String(live.status);
          contentRange = live.contentRange;
        }
      } catch (error) {
        console.warn(`[havoc] ${table} live fetch failed: ${error.message}`);
      }
      if (!collection) collection = await readStub(table);
      const sampled = sample(collection, url);
      const lane = HAVOC_LANE_BY_TABLE[table];
      return json(res, 200, sampled, {
        'x-havoc-source': source,
        'x-havoc-coverage':
          lane.geo === 'none'
            ? 'no-point-geometry'
            : 'bbox/limit sample',
        'x-havoc-lane': table,
        'x-havoc-layer': lane.layerId,
        'x-havoc-geo': lane.geo,
        ...(upstreamStatus ? { 'x-havoc-upstream-status': upstreamStatus } : {}),
        ...(contentRange ? { 'content-range': contentRange } : {}),
      });
    } catch (error) {
      return json(res, 500, { error: error.message || 'HAVOC lane failed' });
    }
  });
}

export function havocProxy() {
  return {
    name: 'havoc-lanes',
    configureServer(server) {
      attachHavocRoutes(server);
    },
    configurePreviewServer(server) {
      attachHavocRoutes(server);
    },
  };
}
