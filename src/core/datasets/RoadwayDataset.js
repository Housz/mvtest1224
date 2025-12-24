import * as THREE from 'three';

export class RoadwayDataset {
  constructor(topo) {
    this.nodes = topo.nodes;
    this.edges = topo.edges;
    this.nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    this.edgeMap = new Map(this.edges.map((e) => [e.id, e]));
  }

  getNodePosition(id) {
    const n = this.nodeMap.get(id);
    if (!n) return new THREE.Vector3();
    const coord = Array.isArray(n.coordinate)
      ? n.coordinate
      : n.coordinate && typeof n.coordinate === 'object'
      ? [n.coordinate.x, n.coordinate.y, n.coordinate.z]
      : [0, 0, 0];
    return new THREE.Vector3(...coord);
  }

  edgeLength(edge) {
    const a = this.getNodePosition(edge.from);
    const b = this.getNodePosition(edge.to);
    return a.distanceTo(b);
  }
}
