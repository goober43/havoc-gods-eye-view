/** TeleGeography submarine cables (CC BY-NC-SA) were deleted for HAVOC. */

const EMPTY = Object.freeze({
  type: 'FeatureCollection',
  features: Object.freeze([]),
});

/** Empty stand-in so leftover cable modules do not load CC BY-NC-SA data. */
export function createBundledCableSource() {
  return {
    label: 'TeleGeography (removed)',
    async fetch(signal) {
      signal?.throwIfAborted();
      return { cables: EMPTY, landingPoints: EMPTY };
    },
  };
}
