import {
  httpError,
  LiveSourceError,
  readResponse,
} from '../sources/live/contract.js';
import { DEFAULT_HAVOC_LIMIT } from './lanes.js';
import { featureToAircraftRecord, toFeatureCollection } from './geojson.js';

const defaultFetch = (...args) => globalThis.fetch(...args);

function header(response, name) {
  return response.headers?.get?.(name);
}

/** OpenSky replacement: live flights snapshot from HAVOC aircraft_history. */
export function createHavocAircraftSource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    label: 'HAVOC aircraft_history',
    async getSnapshot(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (Number.isFinite(query.latitude) && Number.isFinite(query.longitude)) {
        params.set('lat', query.latitude.toFixed(4));
        params.set('lon', query.longitude.toFixed(4));
      }
      if (Number.isFinite(query.west) && Number.isFinite(query.south)) {
        params.set(
          'bbox',
          [query.west, query.south, query.east, query.north].join(','),
        );
      }
      params.set('limit', String(query.limit || DEFAULT_HAVOC_LIMIT));
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/havoc/aircraft_history${params.size ? `?${params}` : ''}`,
        { signal },
        'HAVOC aircraft',
      );
      if (!response.ok) throw httpError(response, 'HAVOC aircraft');
      const collection = toFeatureCollection(payload, 'aircraft_history');
      const records = [];
      const ids = new Set();
      for (const feature of collection.features) {
        const record = featureToAircraftRecord(feature);
        if (!record || ids.has(record.id)) continue;
        ids.add(record.id);
        records.push(record);
      }
      const observedAtMs = now();
      return {
        records,
        complete: true,
        rejectedCount: collection.features.length - records.length,
        source: header(response, 'x-havoc-source') || 'HAVOC aircraft_history',
        coverage:
          header(response, 'x-havoc-coverage') || 'bbox/limit sample',
        observedAtMs,
        ageMs: 0,
        stale: false,
        freshness: 'current',
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/havoc/aircraft_history?id=${encodeURIComponent(reference)}&limit=200`,
        { signal },
        'HAVOC aircraft',
      );
      if (!response.ok) throw httpError(response, 'HAVOC aircraft');
      const collection = toFeatureCollection(payload, 'aircraft_history');
      const records = collection.features
        .map((feature) => featureToAircraftRecord(feature))
        .filter(Boolean)
        .map((record) => ({
          latitude: record.latitude,
          longitude: record.longitude,
          observedAtMs: record.positionTimeMs || now(),
          baroAltitudeM: record.baroAltitudeM,
        }));
      return { records, complete: false };
    },
    async getEnrichment(query, { signal } = {}) {
      if (!['type', 'route'].includes(query.kind)) {
        throw new LiveSourceError('unsupported', 'Enrichment unavailable');
      }
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/adsbdb/${query.kind}/${encodeURIComponent(query.id)}`,
        { signal },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return payload;
    },
  };
}
