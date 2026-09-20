import { cleanText, coordinates, finite } from '../sources/live/contract.js';

function firstFinite(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number != null) return number;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

/** Read lon/lat from a GeoJSON position, PostgREST row, or nested geometry. */
export function readLonLat(row) {
  if (!row || typeof row !== 'object') return null;
  if (Array.isArray(row.geometry?.coordinates)) {
    const [lon, lat] = row.geometry.coordinates;
    if (coordinates(lat, lon)) return { lon, lat };
  }
  if (row.type === 'Feature') return readLonLat(row);
  const lon = firstFinite(
    row.lon,
    row.lng,
    row.longitude,
    row.long,
    row.location_lon,
    row.geo_lon,
    row.x,
    row.properties?.lon,
    row.properties?.lng,
    row.properties?.longitude,
    row.properties?.location_lon,
    row.properties?.geo_lon,
  );
  const lat = firstFinite(
    row.lat,
    row.latitude,
    row.location_lat,
    row.geo_lat,
    row.y,
    row.properties?.lat,
    row.properties?.latitude,
    row.properties?.location_lat,
    row.properties?.geo_lat,
  );
  if (coordinates(lat, lon)) return { lon, lat };
  const location = row.location || row.geojson || row.geom;
  if (location && typeof location === 'object') {
    if (Array.isArray(location.coordinates)) {
      const [glon, glat] = location.coordinates;
      if (coordinates(glat, glon)) return { lon: glon, lat: glat };
    }
    if (location.type === 'Point' && Array.isArray(location.coordinates)) {
      const [glon, glat] = location.coordinates;
      if (coordinates(glat, glon)) return { lon: glon, lat: glat };
    }
  }
  if (typeof location === 'string' && location.includes('POINT')) {
    const match = /\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/.exec(
      location,
    );
    if (match) {
      const glon = Number(match[1]);
      const glat = Number(match[2]);
      if (coordinates(glat, glon)) return { lon: glon, lat: glat };
    }
  }
  return null;
}

export function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

export function isFeatureCollection(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.type === 'FeatureCollection' &&
    Array.isArray(value.features)
  );
}

function featureId(row, index, table) {
  return (
    firstText(
      row.id,
      row.uuid,
      row.icao24,
      row.mmsi,
      row.slug,
      row.callsign,
      row.properties?.id,
      row.properties?.icao24,
      row.properties?.mmsi,
    ) || `${table || 'havoc'}-${index}`
  );
}

export function rowToFeature(row, index = 0, table = 'havoc') {
  if (row?.type === 'Feature' && row.geometry) {
    const props =
      row.properties && typeof row.properties === 'object'
        ? { ...row.properties }
        : {};
    if (!props.id) props.id = featureId(row.properties || row, index, table);
    return {
      type: 'Feature',
      id: row.id ?? props.id,
      geometry: row.geometry,
      properties: props,
    };
  }
  const point = readLonLat(row);
  if (!point) return null;
  const props = { ...(row.properties || {}) };
  for (const [key, value] of Object.entries(row)) {
    if (
      key === 'geometry' ||
      key === 'properties' ||
      key === 'type' ||
      key === 'location' ||
      key === 'geojson' ||
      key === 'geom'
    ) {
      continue;
    }
    if (props[key] === undefined) props[key] = value;
  }
  const id = featureId(row, index, table);
  props.id = props.id || id;
  props.lon = point.lon;
  props.lat = point.lat;
  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Point',
      coordinates: [point.lon, point.lat],
    },
    properties: props,
  };
}

/** Admit PostgREST rows, a FeatureCollection, or a single Feature as GeoJSON. */
export function toFeatureCollection(payload, table = 'havoc') {
  if (isFeatureCollection(payload)) {
    return {
      type: 'FeatureCollection',
      features: payload.features
        .map((feature, index) => rowToFeature(feature, index, table))
        .filter(Boolean),
    };
  }
  if (payload?.type === 'Feature') {
    const feature = rowToFeature(payload, 0, table);
    return {
      type: 'FeatureCollection',
      features: feature ? [feature] : [],
    };
  }
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return {
    type: 'FeatureCollection',
    features: rows
      .map((row, index) => rowToFeature(row, index, table))
      .filter(Boolean),
  };
}

export function featureToPoint(feature) {
  const point = readLonLat(feature);
  if (!point) return null;
  const props = feature?.properties || {};
  return {
    id: firstText(props.id, feature?.id) || `${point.lon},${point.lat}`,
    lon: point.lon,
    lat: point.lat,
    height: firstFinite(props.altitude_m, props.alt_m, props.height, 0) || 0,
    title: firstText(props.title, props.name, props.callsign, props.label),
    details: firstText(props.details, props.summary, props.description),
    properties: props,
  };
}

/** Map a HAVOC aircraft feature/row onto the live aircraft record contract. */
export function featureToAircraftRecord(feature) {
  const point = readLonLat(feature);
  if (!point) return null;
  const props = feature?.properties && typeof feature.properties === 'object'
    ? feature.properties
    : feature || {};
  const id = firstText(
    props.icao24,
    props.id,
    props.hex,
    feature?.id,
  ).toLowerCase();
  if (!id) return null;
  const altitude = firstFinite(
    props.altitude_m,
    props.baro_altitude_m,
    props.alt_m,
    props.altitude,
  );
  const altitudeFt = firstFinite(props.alt_baro, props.altitude_ft);
  return {
    id,
    reference: id,
    latitude: point.lat,
    longitude: point.lon,
    callsign: firstText(props.callsign, props.flight, props.name),
    originCountry: firstText(props.origin_country, props.country) || null,
    positionTimeMs: firstFinite(props.position_time_ms, props.ts_ms, props.t),
    contactTimeMs: firstFinite(props.contact_time_ms, props.updated_at_ms),
    baroAltitudeM:
      altitude ?? (altitudeFt == null ? null : altitudeFt * 0.3048),
    ellipsoidAltitudeM: firstFinite(props.ellipsoid_altitude_m, props.geo_alt_m),
    onGround: props.on_ground === true || props.onGround === true,
    speedMps: firstFinite(props.speed_mps, props.velocity, props.gs_mps),
    courseDeg: firstFinite(props.course_deg, props.heading, props.track),
    verticalRateMps: firstFinite(props.vertical_rate_mps, props.baro_rate_mps),
    category: firstFinite(props.category),
    typeCode: firstText(props.type_code, props.t) || null,
    registration: firstText(props.registration, props.r) || null,
    operator: firstText(props.operator, props.ownop) || null,
  };
}
