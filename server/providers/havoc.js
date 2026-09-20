import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HAVOC_LIMIT,
  HAVOC_LANE_BY_TABLE,
  MAX_HAVOC_LIMIT,
  isBlockedHavocHost,
  isHavocLane,
} from '../../src/havoc/lanes.js';
import { toFeatureCollection } from '../../src/havoc/geojson.js';

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

function parseBbox(url) {
  const bbox = String(url.searchParams.get('bbox') || '').trim();
  if (bbox) {
    const parts = bbox.split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
    }
  }
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const pad = 8;
    return {
      west: lon - pad,
      south: lat - pad,
      east: lon + pad,
      north: lat + pad,
    };
  }
  return null;
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
  const box = parseBbox(url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = Math.min(
    MAX_HAVOC_LIMIT,
    Math.max(
      1,
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.trunc(rawLimit)
        : DEFAULT_HAVOC_LIMIT,
    ),
  );
  const id = String(url.searchParams.get('id') || '').trim().toLowerCase();
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

function havocConfigured() {
  const url = String(process.env.HAVOC_SUPABASE_URL || '').trim();
  const key = String(process.env.HAVOC_SUPABASE_KEY || '').trim();
  if (!url || !key) return null;
  if (isBlockedHavocHost(url)) {
    throw new Error('HAVOC_SUPABASE_URL host is blocked by commercial_ok policy');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

function postgrestFilter(table, url) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.min(MAX_HAVOC_LIMIT, DEFAULT_HAVOC_LIMIT)));
  const limit = Number(url.searchParams.get('limit'));
  if (Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.min(MAX_HAVOC_LIMIT, Math.trunc(limit))));
  }
  const box = parseBbox(url);
  if (box) {
    // Prefer numeric lat/lon columns when present; PostgREST ignores unknown filters.
    params.set('lat', `gte.${box.south}`);
    params.append('lat', `lte.${box.north}`);
    params.set('lon', `gte.${box.west}`);
    params.append('lon', `lte.${box.east}`);
  }
  const id = String(url.searchParams.get('id') || '').trim();
  if (id) params.set('or', `(id.eq.${id},icao24.eq.${id},mmsi.eq.${id})`);
  return params;
}

async function fetchLive(table, requestUrl) {
  const creds = havocConfigured();
  if (!creds) return null;
  const params = postgrestFilter(table, requestUrl);
  const upstream = await fetch(
    `${creds.url}/rest/v1/${encodeURIComponent(table)}?${params}`,
    {
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
    },
  );
  if (!upstream.ok) {
    const error = new Error(`PostgREST HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  const payload = await upstream.json();
  return toFeatureCollection(payload, table);
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
      try {
        collection = await fetchLive(table, url);
        if (collection) source = 'postgrest';
      } catch (error) {
        console.warn(`[havoc] ${table} live fetch failed: ${error.message}`);
      }
      if (!collection) collection = await readStub(table);
      const sampled = sample(collection, url);
      return json(res, 200, sampled, {
        'x-havoc-source': source,
        'x-havoc-coverage': 'bbox/limit sample',
        'x-havoc-lane': table,
        'x-havoc-layer': HAVOC_LANE_BY_TABLE[table].layerId,
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
