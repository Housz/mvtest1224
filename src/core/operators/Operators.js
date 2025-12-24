import * as THREE from 'three';
import { sampleColor } from '../../utils/colors.js';

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

export class InterpolateOnRoadwayGraphOperator {
  constructor(topo) {
    this.topo = topo;
  }

  run(valuesMap) {
    // valuesMap: sensorID -> value, sensor tied to registry with roadwayID in context
    const nodeValues = new Map();
    // valuesMap keys are sensorIDs with property roadwayID accessible? we pass actual mapping instead
    for (const { nodeId, value } of valuesMap) {
      if (value === undefined || value === null || Number.isNaN(value)) continue;
      nodeValues.set(nodeId, value);
    }

    // compute shortest paths from each node to observed nodes
    const graph = this.buildGraph();
    const allNodes = this.topo.nodes.map((n) => n.id);
    const estimated = new Map();
    for (const nodeId of allNodes) {
      const distances = this.dijkstra(graph, nodeId);
      let num = 0;
      let den = 0;
      for (const [obsId, obsVal] of nodeValues.entries()) {
        const d = distances.get(obsId) ?? Infinity;
        if (!isFinite(d)) continue;
        const w = 1 / (d + 1e-3);
        num += obsVal * w;
        den += w;
      }
      estimated.set(nodeId, den > 0 ? num / den : 0);
    }

    const edgeValues = new Map();
    for (const edge of this.topo.edges) {
      const a = estimated.get(edge.from) ?? 0;
      const b = estimated.get(edge.to) ?? 0;
      edgeValues.set(edge.id, (a + b) / 2);
    }

    return { nodeValues: estimated, edgeValues };
  }

  buildGraph() {
    const g = new Map();
    for (const node of this.topo.nodes) {
      g.set(node.id, []);
    }
    for (const edge of this.topo.edges) {
      const a = this.topo.nodeMap.get(edge.from);
      const b = this.topo.nodeMap.get(edge.to);
      const dist = new THREE.Vector3(...a.coordinate).distanceTo(new THREE.Vector3(...b.coordinate));
      g.get(edge.from).push({ id: edge.to, w: dist });
      g.get(edge.to).push({ id: edge.from, w: dist });
    }
    return g;
  }

  dijkstra(graph, source) {
    const dist = new Map();
    const visited = new Set();
    for (const key of graph.keys()) dist.set(key, Infinity);
    dist.set(source, 0);
    while (visited.size < graph.size) {
      let u = null;
      let best = Infinity;
      for (const [node, d] of dist.entries()) {
        if (!visited.has(node) && d < best) {
          best = d;
          u = node;
        }
      }
      if (u === null) break;
      visited.add(u);
      for (const nb of graph.get(u)) {
        const alt = dist.get(u) + nb.w;
        if (alt < dist.get(nb.id)) dist.set(nb.id, alt);
      }
    }
    return dist;
  }
}

export class MapFieldToMeshOperator {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }

  apply(edgeValues) {
    this.sceneManager.applyEdgeValues(edgeValues);
  }
}

export class ColorEncodeMeshOperator {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.colormap = 'rainbow';
    this.min = 10;
    this.max = 40;
  }

  setRange(min, max) {
    this.min = min;
    this.max = max;
  }

  setMap(name) {
    this.colormap = name;
  }

  run(edgeValues) {
    this.sceneManager.colorEdges(edgeValues, (v) => {
      const t = (v - this.min) / (this.max - this.min || 1);
      return sampleColor(this.colormap, t);
    });
  }
}
