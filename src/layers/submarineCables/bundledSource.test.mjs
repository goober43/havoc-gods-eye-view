import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundledCableSource } from './bundledSource.js';

test('TeleGeography bundled source is an empty HAVOC tombstone', async () => {
  const source = createBundledCableSource();
  const snapshot = await source.fetch();
  assert.equal(snapshot.cables.features.length, 0);
  assert.equal(snapshot.landingPoints.features.length, 0);
});

test('cancellation still aborts the empty cable source', async () => {
  const controller = new AbortController();
  controller.abort();
  const source = createBundledCableSource();
  await assert.rejects(source.fetch(controller.signal), { name: 'AbortError' });
});
