import {
  DEFAULT_HAVOC_LIMIT,
  HAVOC_LANE_BY_TABLE,
  MAX_HAVOC_LIMIT,
} from './lanes.js';

/** Accept SUPABASE_URL or an already-suffixed /rest/v1 origin. */
export function normalizeHavocRestUrl(raw) {
  const url = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!url) return '';
  return url.endsWith('/rest/v1') ? url : `${url}/rest/v1`;
}

export function parseHavocBbox(searchParams) {
  const bbox = String(searchParams.get('bbox') || '').trim();
  if (bbox) {
    const parts = bbox.split(',').map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
    }
  }
  const latRaw = searchParams.get('lat');
  const lonRaw = searchParams.get('lon');
  const lat = latRaw == null || latRaw === '' ? NaN : Number(latRaw);
  const lon = lonRaw == null || lonRaw === '' ? NaN : Number(lonRaw);
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

export function resolveHavocLimit(searchParams) {
  const rawLimit = Number(searchParams.get('limit'));
  return Math.min(
    MAX_HAVOC_LIMIT,
    Math.max(
      1,
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.trunc(rawLimit)
        : DEFAULT_HAVOC_LIMIT,
    ),
  );
}

function bboxClauses(lane, box) {
  const lat = lane.latColumn;
  const lon = lane.lonColumn;
  const clauses = [`${lat}.gte.${box.south}`, `${lat}.lte.${box.north}`];
  if (box.west <= box.east) {
    clauses.push(`${lon}.gte.${box.west}`, `${lon}.lte.${box.east}`);
  } else {
    clauses.push(`or(${lon}.gte.${box.west},${lon}.lte.${box.east})`);
  }
  return clauses;
}

/**
 * PostgREST query for one HAVOC lane.
 * Point tables get lat/lon (or geo_lat/geo_lon) bbox sampling.
 * Place-only tables omit coordinate filters so unknown columns do not 400.
 */
export function buildPostgrestSearchParams(table, searchParams) {
  const lane = HAVOC_LANE_BY_TABLE[table];
  if (!lane) throw new TypeError(`Unknown HAVOC lane: ${table}`);
  const params = new URLSearchParams();
  params.set('limit', String(resolveHavocLimit(searchParams)));

  for (const filter of lane.filters || []) {
    params.set(filter.column, filter.value);
  }

  if (lane.latColumn && lane.lonColumn) {
    const box = parseHavocBbox(searchParams);
    const clauses = [`${lane.latColumn}.not.is.null`, `${lane.lonColumn}.not.is.null`];
    if (box) clauses.push(...bboxClauses(lane, box));
    params.set('and', `(${clauses.join(',')})`);
  }

  const id = String(searchParams.get('id') || '').trim();
  const idColumns = lane.idColumns || [];
  if (id && idColumns.length === 1) {
    params.set(idColumns[0], `eq.${id}`);
  } else if (id && idColumns.length > 1) {
    params.set('or', `(${idColumns.map((column) => `${column}.eq.${id}`).join(',')})`);
  }
  return params;
}

export function havocLaneRestUrl(origin, table, searchParams) {
  const rest = normalizeHavocRestUrl(origin);
  const query = buildPostgrestSearchParams(table, searchParams);
  return `${rest}/${encodeURIComponent(table)}?${query}`;
}
