import { applyHeatmapColoring } from '../algorithms/FieldSolver.js';
import { setCustomColorMap, resetColorMap, getDefaultStops } from '../../utils/colors.js';

export class PickSensorOperator {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }

  pickById(sensorID) {
    const obj = this.sceneManager.getSensorObject(sensorID);
    if (obj) this.sceneManager.highlightSensor(obj);
    return obj;
  }
}

export class FocusCameraOperator {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }

  focusOn(object3D) {
    this.sceneManager.focusOn(object3D);
  }
}

export class QuerySeriesOperator {
  constructor(dataset) {
    this.dataset = dataset;
  }

  run(sensorID, range) {
    const [start, end] = range || [-Infinity, Infinity];
    return this.dataset.getSeries(sensorID, start, end);
  }
}

export class SampleSnapshotOperator {
  constructor(dataset) {
    this.dataset = dataset;
  }

  run(time, toleranceMinutes) {
    return this.dataset.getSnapshot(time, toleranceMinutes);
  }
}

export class HeatmapColorOperator {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.colormap = 'rainbow';
    this.min = 10;
    this.max = 40;
    this.customStops = null;
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
    const connList = connections || [];
    applyHeatmapColoring(this.sceneManager.scene, connList, nodeValues || new Map(), sensors, {
      min: this.min,
      max: this.max,
      map: this.colormap
    });
  }
}
