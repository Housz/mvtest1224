import { applyHeatmapColoring } from '../algorithms/FieldSolver.js';
import { setCustomColorMap, resetColorMap } from '../../utils/colors.js';
import { syncRoadwayFieldLayerColors } from '../../scene/RoadwayFieldLayer.js';

// Low-level implementation kernels used inside configurator-facing operators.
// These are intentionally not node definitions and should not appear in the editor palette.
export class SampleSnapshotKernel {
  constructor(dataset) {
    this.dataset = dataset;
  }

  run(time, toleranceMs) {
    return this.dataset.getSnapshot(time, toleranceMs);
  }
}

export class HeatmapColorKernel {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.colormap = 'rainbow';
    this.min = 10;
    this.max = 40;
    this.customStops = null;
    this.targetRoot = null;
  }

  setTarget(root) {
    this.targetRoot = root || null;
  }

  setRange(min, max) {
    this.min = min;
    this.max = max;
  }

  setMap(name) {
    this.colormap = name;
    this.customStops = null;
    resetColorMap(name);
  }

  setCustomForCurrent(stops) {
    if (!stops) return;
    this.customStops = stops;
    setCustomColorMap(this.colormap, stops);
  }

  apply(connections, nodeValues, sensors) {
    applyHeatmapColoring(this.targetRoot || this.sceneManager.roadwayObject || this.sceneManager.scene, connections || [], nodeValues || new Map(), sensors, {
      min: this.min,
      max: this.max,
      map: this.colormap
    });
    syncRoadwayFieldLayerColors(this.targetRoot);
  }
}
