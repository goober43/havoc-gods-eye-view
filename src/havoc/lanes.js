/** HAVOC God View lane catalog. Table names match PostgREST/Supabase. */

export const HAVOC_LANE_IDS = Object.freeze([
  'lane_events',
  'havoc_intel',
  'event_clusters',
  'vessel_history',
  'aircraft_history',
  'io_campaigns',
  'whale_movements',
  'polymarket_signals',
]);

export const HAVOC_LAYER_PREFIX = 'havoc-';

/** Hosts that must never be wired (commercial_ok=false). */
export const HAVOC_BLOCKED_HOSTS = Object.freeze([
  'gdacs',
  'energynow.com',
  'konbriefing.com',
  'bellingcat.com',
  'opensky',
  'opensky-network.org',
  'who.int',
  'www.nyse.com',
  'nyse.com',
  'news.google.com',
  'marinetraffic.com',
  'apnews.com',
]);

export const HAVOC_LANES = Object.freeze(
  [
    {
      table: 'lane_events',
      layerId: 'havoc-lane-events',
      token: 'k',
      name: 'HAVOC Lane Events',
      icon: '⚡',
      color: '#ff6b35',
      source: 'HAVOC',
      geo: 'point',
      latColumn: 'location_lat',
      lonColumn: 'location_lon',
      filters: Object.freeze([{ column: 'map_eligible', value: 'eq.true' }]),
      idColumns: Object.freeze(['id']),
    },
    {
      table: 'havoc_intel',
      layerId: 'havoc-intel',
      token: 'l',
      name: 'HAVOC Intel',
      icon: '◎',
      color: '#c084fc',
      source: 'HAVOC',
      geo: 'point',
      latColumn: 'geo_lat',
      lonColumn: 'geo_lon',
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id']),
    },
    {
      table: 'event_clusters',
      layerId: 'havoc-event-clusters',
      token: 'o',
      name: 'Event Clusters',
      icon: '◈',
      color: '#fbbf24',
      source: 'HAVOC',
      geo: 'none',
      latColumn: null,
      lonColumn: null,
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id']),
    },
    {
      table: 'vessel_history',
      layerId: 'havoc-vessel-history',
      token: 'v',
      name: 'Vessel History',
      icon: '⛴',
      color: '#38bdf8',
      source: 'HAVOC',
      geo: 'point',
      latColumn: 'lat',
      lonColumn: 'lon',
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id', 'mmsi']),
    },
    {
      table: 'aircraft_history',
      layerId: 'havoc-aircraft-history',
      token: 'y',
      name: 'Aircraft History',
      icon: '✈',
      color: '#34d399',
      source: 'HAVOC',
      geo: 'point',
      latColumn: 'lat',
      lonColumn: 'lon',
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id', 'icao24']),
    },
    {
      table: 'io_campaigns',
      layerId: 'havoc-io-campaigns',
      token: 'u',
      name: 'IO Campaigns',
      icon: '⌖',
      color: '#f472b6',
      source: 'HAVOC',
      geo: 'none',
      latColumn: null,
      lonColumn: null,
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id']),
    },
    {
      table: 'whale_movements',
      layerId: 'havoc-whale-movements',
      token: '0',
      name: 'Whale Movements',
      icon: '🐋',
      color: '#22d3ee',
      source: 'HAVOC',
      geo: 'optional',
      latColumn: 'lat',
      lonColumn: 'lon',
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id']),
    },
    {
      table: 'polymarket_signals',
      layerId: 'havoc-polymarket-signals',
      token: '1',
      name: 'Polymarket Signals',
      icon: '▣',
      color: '#a3e635',
      source: 'HAVOC',
      geo: 'none',
      latColumn: null,
      lonColumn: null,
      filters: Object.freeze([]),
      idColumns: Object.freeze(['id']),
    },
  ].map((lane) => Object.freeze(lane)),
);

export const HAVOC_LANE_BY_TABLE = Object.freeze(
  Object.fromEntries(HAVOC_LANES.map((lane) => [lane.table, lane])),
);

export const HAVOC_LANE_BY_LAYER = Object.freeze(
  Object.fromEntries(HAVOC_LANES.map((lane) => [lane.layerId, lane])),
);

export const DEFAULT_HAVOC_LIMIT = 2000;
export const MAX_HAVOC_LIMIT = 5000;

export function isHavocLane(table) {
  return HAVOC_LANE_BY_TABLE[String(table || '')] != null;
}

export function layerIdForTable(table) {
  return HAVOC_LANE_BY_TABLE[table]?.layerId || null;
}

/** True when a URL/host is on the commercial_ok=false exclusion list. */
export function isBlockedHavocHost(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return false;
  let host = raw;
  try {
    host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    host = raw.replace(/^https?:\/\//, '').split('/')[0];
  }
  host = host.replace(/^www\./, '');
  return HAVOC_BLOCKED_HOSTS.some((blocked) => {
    const needle = blocked.replace(/^www\./, '');
    return host === needle || host.endsWith(`.${needle}`) || raw.includes(needle);
  });
}
