import * as Cesium from 'cesium';
import { createMarkerBatch } from '../data/markerBatch.js';
import { cameraViewBox, createViewportIndex } from '../data/viewportIndex.js';
import { HAVOC_LANE_BY_LAYER } from './lanes.js';
import { featureToPoint } from './geojson.js';
import { createHavocLaneSource } from './source.js';

function creditFor(lane) {
  return `HAVOC ${lane.table}`;
}

/** Dense GeoJSON points via markerBatch + viewport culling (jazzjabu pattern). */
export function createHavocLaneLayer({
  lane,
  source,
  overlayHost,
  requestRender = () => {},
} = {}) {
  const spec = typeof lane === 'string' ? HAVOC_LANE_BY_LAYER[lane] : lane;
  if (!spec?.layerId) throw new TypeError('HAVOC layer requires a lane spec');
  const feed = source || createHavocLaneSource(spec.table);
  const color = Cesium.Color.fromCssColorString(spec.color);

  let _viewer = null;
  let _request = null;
  let _batch = null;
  let _index = null;
  let _points = [];
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _moveRemover = null;
  let _credit = null;

  function paintedPoints() {
    if (!_viewer) return _points;
    const box = cameraViewBox(_viewer, Cesium);
    if (!_index) return _points;
    return box ? _index.search(box) : _index.all();
  }

  function paint() {
    if (!_batch) return;
    _batch.setPoints(paintedPoints());
  }

  function publishOverlay() {
    if (!overlayHost) return;
    const entries = paintedPoints()
      .slice(0, 80)
      .map((point) => ({
        id: String(point.id),
        source: spec.layerId,
        position: Cesium.Cartesian3.fromDegrees(
          point.lon,
          point.lat,
          point.height || 0,
        ),
        variant: 'card',
        title: point.title || spec.name,
        details: point.details ? [point.details] : [],
        accent: spec.color,
      }));
    overlayHost.setEntries(spec.layerId, entries, { visible: _enabled });
  }

  const layer = {
    id: spec.layerId,
    name: spec.name,
    icon: spec.icon,
    source: spec.source,
    updateInterval: 120000,

    init(viewer) {
      if (_viewer) throw new Error(`${spec.layerId} is already initialized`);
      _viewer = viewer;
      _batch = createMarkerBatch({
        scene: viewer.scene,
        requestRender: () => {
          requestRender();
          viewer.scene?.requestRender?.();
        },
      });
      _batch.setVisible(false);
      _credit = new Cesium.Credit(creditFor(spec), false);
      viewer.creditDisplay?.addStaticCredit?.(_credit);
      overlayHost?.setVisible(spec.layerId, false);
    },

    enable() {
      _enabled = true;
      _batch?.setVisible(true);
      overlayHost?.setVisible(spec.layerId, true);
      if (_viewer?.camera && !_moveRemover) {
        _moveRemover = _viewer.camera.moveEnd.addEventListener(() => {
          if (!_enabled) return;
          paint();
          publishOverlay();
        });
      }
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      _batch?.setVisible(false);
      overlayHost?.clearSource?.(spec.layerId);
      overlayHost?.setVisible(spec.layerId, false);
      if (_moveRemover) {
        _moveRemover();
        _moveRemover = null;
      }
    },

    async update() {
      if (!_enabled) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const box = cameraViewBox(_viewer, Cesium);
        const snapshot = await feed.getSnapshot(
          { limit: 2000, ...(box || {}) },
          { signal: request.signal },
        );
        if (request.signal.aborted || _request !== request || !_enabled) {
          return false;
        }
        _points = (snapshot.collection?.features || snapshot.records || [])
          .map(featureToPoint)
          .filter(Boolean)
          .map((point) => ({
            ...point,
            color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            size: 8,
          }));
        _index = createViewportIndex(_points);
        _count = _points.length;
        _lastUpdate = Date.now();
        _lastError = null;
        paint();
        publishOverlay();
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        _lastError = error?.message || String(error);
        return false;
      }
    },

    getParams() {
      return {};
    },

    setParams() {
      return true;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stub: false,
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _points.slice(0, limit).map((point, index) => ({
        id: point.id,
        title: point.title || spec.name,
        lat: point.lat,
        lon: point.lon,
        layerId: spec.layerId,
        index,
      }));
    },

    destroy() {
      this.disable();
      _batch?.destroy();
      _batch = null;
      _viewer = null;
      _index = null;
      _points = [];
    },
  };
  return layer;
}

export function createHavocLayers(options = {}) {
  return Object.values(HAVOC_LANE_BY_LAYER).map((lane) =>
    createHavocLaneLayer({ ...options, lane }),
  );
}
