import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureToAircraftRecord,
  rowToFeature,
  toFeatureCollection,
} from './geojson.js';
import { isBlockedHavocHost, isHavocLane } from './lanes.js';
import {
  buildPostgrestSearchParams,
  havocLaneRestUrl,
  normalizeHavocRestUrl,
  parseHavocBbox,
} from './postgrest.js';

test('PostgREST rows and FeatureCollections normalize to GeoJSON', () => {
  const fromRows = toFeatureCollection(
    [{ id: 'a', lon: -97.74, lat: 30.27, title: 'Austin' }],
    'lane_events',
  );
  assert.equal(fromRows.features.length, 1);
  assert.deepEqual(fromRows.features[0].geometry.coordinates, [-97.74, 30.27]);
  const fromFc = toFeatureCollection(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [8.68, 50.11] },
          properties: { id: 'b', title: 'Frankfurt' },
        },
      ],
    },
    'havoc_intel',
  );
  assert.equal(fromFc.features[0].properties.title, 'Frankfurt');
});

test('lane_events location_lat/location_lon map to points', () => {
  const fromCols = toFeatureCollection(
    [
      {
        id: 'e1',
        location_lat: 26.57,
        location_lon: 56.25,
        title: 'Hormuz',
        map_eligible: true,
      },
    ],
    'lane_events',
  );
  assert.equal(fromCols.features.length, 1);
  assert.deepEqual(fromCols.features[0].geometry.coordinates, [56.25, 26.57]);
});

test('aircraft features map onto the live flight record contract', () => {
  const record = featureToAircraftRecord(
    rowToFeature(
      {
        icao24: 'A12345',
        lon: -97.6,
        lat: 30.3,
        callsign: 'DAL123',
        altitude_m: 10668,
        speed_mps: 250,
      },
      0,
      'aircraft_history',
    ),
  );
  assert.equal(record.id, 'a12345');
  assert.equal(record.callsign, 'DAL123');
  assert.equal(record.latitude, 30.3);
  assert.equal(record.baroAltitudeM, 10668);
});

test('havoc_intel geo_lat/geo_lon and geom map to points', () => {
  const fromCols = toFeatureCollection(
    [{ id: 'i1', geo_lat: 38.9072, geo_lon: -77.0369, title: 'DC' }],
    'havoc_intel',
  );
  assert.deepEqual(fromCols.features[0].geometry.coordinates, [-77.0369, 38.9072]);
  const fromGeom = toFeatureCollection(
    [{ id: 'i2', geom: { type: 'Point', coordinates: [8.68, 50.11] } }],
    'havoc_intel',
  );
  assert.deepEqual(fromGeom.features[0].geometry.coordinates, [8.68, 50.11]);
});

test('place-only rows become an empty FeatureCollection', () => {
  const empty = toFeatureCollection(
    [{ id: 'c1', place: 'Austin, TX' }, { id: 'c2', regions: 'EU' }],
    'event_clusters',
  );
  assert.equal(empty.features.length, 0);
});

test('PostgREST filters match the live column matrix', () => {
  assert.equal(
    normalizeHavocRestUrl('https://example.supabase.co/'),
    'https://example.supabase.co/rest/v1',
  );
  assert.equal(
    normalizeHavocRestUrl('https://example.supabase.co/rest/v1'),
    'https://example.supabase.co/rest/v1',
  );
  const lane = buildPostgrestSearchParams(
    'lane_events',
    new URLSearchParams('bbox=-99,29,-96,31&limit=50'),
  );
  assert.equal(lane.get('map_eligible'), 'eq.true');
  assert.match(lane.get('and'), /location_lat\.gte\.29/);
  assert.match(lane.get('and'), /location_lon\.lte\.-96/);
  assert.match(lane.get('and'), /location_lat\.not\.is\.null/);
  assert.doesNotMatch(lane.get('and'), /(?<!location_)lat\./);
  const intel = buildPostgrestSearchParams(
    'havoc_intel',
    new URLSearchParams('bbox=-80,38,-76,40'),
  );
  assert.match(intel.get('and'), /geo_lat\.gte\.38/);
  assert.match(intel.get('and'), /geo_lon\.lte\.-76/);
  assert.equal(intel.get('lat'), null);
  const clusters = buildPostgrestSearchParams(
    'event_clusters',
    new URLSearchParams('bbox=-99,29,-96,31&limit=10'),
  );
  assert.equal(clusters.get('and'), null);
  assert.equal(clusters.get('lat'), null);
  assert.equal(clusters.get('limit'), '10');
  const url = havocLaneRestUrl(
    'https://example.supabase.co',
    'aircraft_history',
    new URLSearchParams('lat=30&lon=-97&limit=25'),
  );
  assert.match(url, /\/rest\/v1\/aircraft_history\?/);
  assert.match(url, /lat\.not\.is\.null/);
  const unbounded = buildPostgrestSearchParams(
    'aircraft_history',
    new URLSearchParams('limit=20'),
  );
  assert.equal(unbounded.get('and'), '(lat.not.is.null,lon.not.is.null)');
  assert.equal(parseHavocBbox(new URLSearchParams('limit=20')), null);
});

test('commercial_ok=false hosts stay out of HAVOC adapters', () => {
  assert.equal(isBlockedHavocHost('https://opensky-network.org/api'), true);
  assert.equal(isBlockedHavocHost('gdacs.org'), true);
  assert.equal(isBlockedHavocHost('news.google.com'), true);
  assert.equal(isBlockedHavocHost('example.supabase.co'), false);
  assert.equal(isHavocLane('aircraft_history'), true);
  assert.equal(isHavocLane('opensky'), false);
});
