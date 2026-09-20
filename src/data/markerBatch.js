import * as Cesium from 'cesium';

/**
 * Batched, non-blocking point markers (cherry-pick from uhrichsam4).
 * One PointPrimitiveCollection + chunked adds so dense HAVOC layers stay
 * responsive. Points sit at the height they are given — supply altitude or 0.
 */

const CHUNK_SIZE = 2000;

function scheduleChunk(fn) {
  if (typeof requestAnimationFrame === 'function')
    return requestAnimationFrame(() => fn());
  return setTimeout(fn, 0);
}

function cancelChunk(handle) {
  if (handle === null || handle === undefined) return;
  if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

export function createMarkerBatch({
  scene,
  onProgress = () => {},
  onDone = () => {},
  requestRender = () => {},
  chunkSize = CHUNK_SIZE,
} = {}) {
  let collection = null;
  let pending = null;
  let generation = 0;
  let visible = true;

  function ensureCollection() {
    if (collection || !scene?.primitives) return collection;
    collection = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    collection.show = visible;
    return collection;
  }

  return {
    setPoints(points) {
      const rows = Array.isArray(points) ? points : [];
      generation += 1;
      const mine = generation;
      cancelChunk(pending);
      pending = null;

      const target = ensureCollection();
      if (!target) return;
      target.removeAll();

      let index = 0;
      const addChunk = () => {
        if (mine !== generation) return;
        const end = Math.min(index + chunkSize, rows.length);
        for (; index < end; index += 1) {
          const point = rows[index];
          if (!point) continue;
          const lon = Number(point.lon);
          const lat = Number(point.lat);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          try {
            target.add({
              position: Cesium.Cartesian3.fromDegrees(
                lon,
                lat,
                Number(point.height) || 0,
              ),
              color: point.color,
              outlineColor: point.outlineColor,
              outlineWidth: Number.isFinite(point.outlineWidth)
                ? point.outlineWidth
                : 0,
              pixelSize: Number(point.size) || 6,
              disableDepthTestDistance: Number.isFinite(point.depthTestDistance)
                ? point.depthTestDistance
                : 50_000,
              distanceDisplayCondition: Number.isFinite(point.distanceMax)
                ? new Cesium.DistanceDisplayCondition(0, point.distanceMax)
                : undefined,
              id: point.id,
            });
          } catch {
            /* one bad row must not abandon the rest */
          }
        }
        onProgress(index, rows.length);
        requestRender();
        if (index < rows.length) {
          pending = scheduleChunk(addChunk);
          return;
        }
        pending = null;
        onDone(rows.length);
      };

      if (!rows.length) {
        onDone(0);
        return;
      }
      addChunk();
    },

    setVisible(value) {
      visible = value !== false;
      if (collection) collection.show = visible;
    },

    length() {
      return collection ? collection.length : 0;
    },

    building() {
      return pending !== null;
    },

    clear() {
      generation += 1;
      cancelChunk(pending);
      pending = null;
      if (collection) collection.removeAll();
    },

    destroy() {
      this.clear();
      if (collection && scene?.primitives) {
        try {
          scene.primitives.remove(collection);
        } catch {
          /* already gone */
        }
      }
      collection = null;
    },
  };
}
