import {
  httpError,
  LiveSourceError,
  readResponse,
} from '../sources/live/contract.js';
import { DEFAULT_HAVOC_LIMIT, isHavocLane } from './lanes.js';
import { emptyFeatureCollection, toFeatureCollection } from './geojson.js';

const defaultFetch = (...args) => globalThis.fetch(...args);

function bboxParams(query = {}) {
  const params = new URLSearchParams();
  const lat = Number(query.latitude ?? query.lat);
  const lon = Number(query.longitude ?? query.lon);
  if (Number.isFinite(query.west) && Number.isFinite(query.south)) {
    params.set(
      'bbox',
      [query.west, query.south, query.east, query.north].join(','),
    );
  } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
    params.set('lat', lat.toFixed(4));
    params.set('lon', lon.toFixed(4));
  }
  const limit = Number(query.limit);
  params.set(
    'limit',
    String(
      Number.isFinite(limit) && limit > 0
        ? Math.trunc(limit)
        : DEFAULT_HAVOC_LIMIT,
    ),
  );
  return params;
}

/** Same-origin HAVOC lane feed. Stubs demo without secrets; live uses PostgREST. */
export function createHavocLaneSource(
  table,
  { fetchImpl = defaultFetch, now = () => Date.now() } = {},
) {
  if (!isHavocLane(table)) {
    throw new TypeError(`Unknown HAVOC lane: ${table}`);
  }
  return {
    label: `HAVOC ${table}`,
    table,
    async getSnapshot(query = {}, { signal } = {}) {
      const params = bboxParams(query);
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/havoc/${table}${params.size ? `?${params}` : ''}`,
        { signal },
        'HAVOC',
      );
      if (!response.ok) throw httpError(response, 'HAVOC');
      const collection = toFeatureCollection(payload, table);
      const observedAtMs = now();
      return {
        records: collection.features,
        collection,
        complete: true,
        rejectedCount: 0,
        source:
          response.headers?.get?.('x-havoc-source') ||
          'HAVOC',
        coverage:
          response.headers?.get?.('x-havoc-coverage') ||
          'bbox/limit sample',
        stub: response.headers?.get?.('x-havoc-source') === 'stub',
        observedAtMs,
        ageMs: 0,
        stale: false,
        freshness: 'current',
        status: response.status,
      };
    },
  };
}

export function createHavocLaneSources(options) {
  return Object.fromEntries(
    [
      'lane_events',
      'havoc_intel',
      'event_clusters',
      'vessel_history',
      'aircraft_history',
      'io_campaigns',
      'whale_movements',
      'polymarket_signals',
    ].map((table) => [table, createHavocLaneSource(table, options)]),
  );
}

export function emptyHavocSnapshot(table) {
  return {
    records: [],
    collection: emptyFeatureCollection(),
    complete: true,
    rejectedCount: 0,
    source: 'HAVOC',
    coverage: 'empty',
    stub: true,
    observedAtMs: Date.now(),
    ageMs: 0,
    stale: false,
    freshness: 'unknown',
  };
}

export { LiveSourceError };
