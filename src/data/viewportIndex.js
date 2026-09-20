/**
 * Viewport culling for dense point layers (cherry-pick from uhrichsam4).
 * Degree-grid index; antimeridian-safe box queries.
 */

export function createViewportIndex(points) {
  const CELL = 1;
  const key = (lonCell, latCell) => `${lonCell}:${latCell}`;
  const cells = new Map();
  const items = [];

  for (const point of points || []) {
    const lon = Number(point?.lon);
    const lat = Number(point?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    items.push(point);
    const k = key(Math.floor(lon / CELL), Math.floor(lat / CELL));
    const bucket = cells.get(k);
    if (bucket) bucket.push(point);
    else cells.set(k, [point]);
  }

  function collect(west, south, east, north, into) {
    const lon0 = Math.floor(west / CELL);
    const lon1 = Math.floor(east / CELL);
    const lat0 = Math.floor(south / CELL);
    const lat1 = Math.floor(north / CELL);
    for (let x = lon0; x <= lon1; x += 1) {
      for (let y = lat0; y <= lat1; y += 1) {
        const bucket = cells.get(key(x, y));
        if (!bucket) continue;
        for (const point of bucket) {
          if (
            point.lon >= west &&
            point.lon <= east &&
            point.lat >= south &&
            point.lat <= north
          ) {
            into.add(point);
          }
        }
      }
    }
  }

  return {
    size() {
      return items.length;
    },
    cells() {
      return cells.size;
    },
    search(box) {
      if (!box) return items.slice();
      const { west, south, east, north } = box;
      if (![west, south, east, north].every(Number.isFinite)) {
        return items.slice();
      }
      const minY = Math.min(south, north);
      const maxY = Math.max(south, north);
      const found = new Set();
      if (west > east) {
        collect(-180, minY, east, maxY, found);
        collect(west, minY, 180, maxY, found);
      } else {
        collect(west, minY, east, maxY, found);
      }
      return [...found];
    },
    all() {
      return items.slice();
    },
  };
}

export function cameraViewBox(viewer, Cesium, padFraction = 0.25) {
  const rect = viewer?.camera?.computeViewRectangle?.();
  if (!rect) return null;
  const west = Cesium.Math.toDegrees(rect.west);
  const east = Cesium.Math.toDegrees(rect.east);
  const south = Cesium.Math.toDegrees(rect.south);
  const north = Cesium.Math.toDegrees(rect.north);
  if (![west, east, south, north].every(Number.isFinite)) return null;

  const height = Math.abs(north - south);
  if (height >= 140) return null;

  const padY = height * padFraction;
  const spanX = west > east ? 180 - west + (east + 180) : east - west;
  const padX = spanX * padFraction;
  const wrap = (deg) => (((deg + 540) % 360) - 180);

  return {
    west: wrap(west - padX),
    east: wrap(east + padX),
    south: Math.max(-90, south - padY),
    north: Math.min(90, north + padY),
  };
}
