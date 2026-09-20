import test from 'node:test';
import assert from 'node:assert/strict';
import {
  featureToAircraftRecord,
  rowToFeature,
  toFeatureCollection,
} from './geojson.js';
import { isBlockedHavocHost, isHavocLane } from './lanes.js';

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

test('commercial_ok=false hosts stay out of HAVOC adapters', () => {
  assert.equal(isBlockedHavocHost('https://opensky-network.org/api'), true);
  assert.equal(isBlockedHavocHost('gdacs.org'), true);
  assert.equal(isBlockedHavocHost('news.google.com'), true);
  assert.equal(isBlockedHavocHost('example.supabase.co'), false);
  assert.equal(isHavocLane('aircraft_history'), true);
  assert.equal(isHavocLane('opensky'), false);
});
