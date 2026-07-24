import { BaseSemanticDataset } from '../semantics/BaseSemanticDataset.js';

const toPoint = (value = {}) => {
  if (Array.isArray(value)) {
    return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  }
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
};

function normalizeNode(rawNode, index) {
  const position = toPoint(rawNode.position ?? rawNode.coordinate ?? rawNode);
  const id = rawNode.id ?? rawNode.nodeId ?? rawNode.name ?? `Node_${index}`;
  return {
    ...rawNode,
    id,
    idx: rawNode.idx ?? index,
    x: position.x,
    y: position.y,
    z: position.z,
    position,
    coordinate: [position.x, position.y, position.z]
  };
}

function normalizeEdge(rawEdge, index, nodeMap) {
  const id = rawEdge.id ?? rawEdge.edgeId ?? rawEdge.name ?? `Edge_${index}`;
  const source = rawEdge.source ?? rawEdge.j1 ?? rawEdge.from ?? rawEdge.start;
  const target = rawEdge.target ?? rawEdge.j2 ?? rawEdge.to ?? rawEdge.end;
  const sourceNode = nodeMap.get(source);
  const targetNode = nodeMap.get(target);
  const rawPath = rawEdge.path ?? rawEdge.verts ?? rawEdge.points ?? rawEdge.centerline ?? [];
  const path = rawPath.length
    ? rawPath.map(toPoint)
    : [sourceNode?.position, targetNode?.position].filter(Boolean).map(toPoint);

  return {
    ...rawEdge,
    id,
    idx: rawEdge.idx ?? index,
    source,
    target,
    from: rawEdge.from ?? source,
    to: rawEdge.to ?? target,
    j1: rawEdge.j1 ?? source,
    j2: rawEdge.j2 ?? target,
    path,
    verts: rawEdge.verts?.length ? rawEdge.verts.map(toPoint) : path
  };
}

export class RoadwayDataset extends BaseSemanticDataset {
  constructor({
    nodes = [],
    edges = [],
    source = null,
    topologyPath = source?.topologyPath ?? null,
    modelPath = source?.modelPath ?? null,
    objText = null,
    meshPartsMapping = null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    super({
      type: 'RoadwayDataset',
      semanticClass: contract?.class ?? 'Roadway',
      taxonomyId: 'roadways-infrastructure',
      contract,
      templates,
      roleMapping,
      validation,
      adaptorResults,
      source: source ?? { topologyPath, modelPath }
    });
    this.topologyPath = topologyPath;
    this.modelPath = modelPath;
    this.objText = objText;

    this.nodes = nodes.map(normalizeNode);
    this.nodeMap = new Map(this.nodes.map((node) => [node.id, node]));
    this.edges = edges.map((edge, index) => normalizeEdge(edge, index, this.nodeMap));
    this.edgeMap = new Map(this.edges.map((edge) => [edge.id, edge]));
    this.meshPartsMapping = meshPartsMapping ?? this.createDefaultMeshMapping();
  }

  createDefaultMeshMapping() {
    const mapping = new Map();
    this.nodes.forEach((node, index) => {
      mapping.set(`Node_${index}`, { type: 'Node', id: node.id, index });
      mapping.set(String(node.id), { type: 'Node', id: node.id, index });
    });
    this.edges.forEach((edge, index) => {
      mapping.set(`Edge_${index}`, { type: 'Connection', id: edge.id, index });
      mapping.set(String(edge.id), { type: 'Connection', id: edge.id, index });
    });
    return mapping;
  }

  getTopology() {
    return this;
  }

  getGeometry() {
    return {
      modelPath: this.modelPath,
      objText: this.objText,
      meshPartsMapping: this.meshPartsMapping
    };
  }

  getMeshPartsMapping() {
    return this.meshPartsMapping;
  }

  getRenderableSupport() {
    return {
      topology: this,
      geometry: this.getGeometry()
    };
  }

  getNodePosition(id) {
    return this.nodeMap.get(id)?.position ?? null;
  }

  getEdges() {
    return this.edges;
  }

  getNodes() {
    return this.nodes;
  }

  edgeLength(edge) {
    const points = edge.path || edge.verts || [];
    if (points.length < 2) return 0;
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      const prev = toPoint(points[i - 1]);
      const next = toPoint(points[i]);
      length += Math.hypot(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    }
    return length;
  }
}
