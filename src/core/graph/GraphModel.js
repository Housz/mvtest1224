import { v4 as uuidv4 } from 'uuid';

export const GRAPH_SCHEMA_VERSION = 1;

export function migrateGraphDocument(document) {
  const parsed = clone(document || {});
  const version = Number(parsed.schemaVersion || 0);
  if (version > GRAPH_SCHEMA_VERSION) {
    throw new Error(`Graph schema version ${version} is newer than supported version ${GRAPH_SCHEMA_VERSION}.`);
  }
  if (version === 0) {
    parsed.nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    parsed.view = parsed.view || { panX: 0, panY: 0, zoom: 1 };
  }
  parsed.schemaVersion = GRAPH_SCHEMA_VERSION;
  return parsed;
}

const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

const buildPortsFromDefinition = (def, nodeLike) => {
  if (def.buildPorts) return def.buildPorts(nodeLike).map((p) => ({ ...p }));
  return def.ports?.map((p) => ({ ...p })) || [];
};

/**
 * Node/Port/Edge centric graph model with simple type checking.
 */
export class GraphModel {
  constructor(definitionRegistry) {
    this.definitionRegistry = definitionRegistry;
    this.nodes = [];
    this.edges = [];
    this.view = { panX: 0, panY: 0, zoom: 1 };
    this.listeners = new Set();
    this.nodeIndex = new Map();
    this.edgeIndex = new Map();
    this.incomingEdgeIndex = new Map();
    this.outgoingEdgeIndex = new Map();
    this.incidentEdgeIndex = new Map();
  }

  portKey(nodeId, portId) {
    return `${nodeId}:${portId}`;
  }

  rebuildIndexes() {
    this.nodeIndex = new Map(this.nodes.map((node) => [node.id, node]));
    this.edgeIndex = new Map();
    this.incomingEdgeIndex = new Map();
    this.outgoingEdgeIndex = new Map();
    this.incidentEdgeIndex = new Map();
    this.edges.forEach((edge) => {
      this.edgeIndex.set(edge.id, edge);
      this.incomingEdgeIndex.set(this.portKey(edge.to.nodeId, edge.to.portId), edge);
      const outputKey = this.portKey(edge.from.nodeId, edge.from.portId);
      const outgoing = this.outgoingEdgeIndex.get(outputKey) || [];
      outgoing.push(edge);
      this.outgoingEdgeIndex.set(outputKey, outgoing);
      [edge.from.nodeId, edge.to.nodeId].forEach((nodeId) => {
        const incident = this.incidentEdgeIndex.get(nodeId) || [];
        incident.push(edge);
        this.incidentEdgeIndex.set(nodeId, incident);
      });
    });
  }

  getNode(nodeId) {
    return this.nodeIndex.get(nodeId) || null;
  }

  getEdge(edgeId) {
    return this.edgeIndex.get(edgeId) || null;
  }

  getIncomingEdge(nodeId, portId) {
    return this.incomingEdgeIndex.get(this.portKey(nodeId, portId)) || null;
  }

  getOutgoingEdges(nodeId, portId = null) {
    if (portId != null) return this.outgoingEdgeIndex.get(this.portKey(nodeId, portId)) || [];
    return (this.incidentEdgeIndex.get(nodeId) || []).filter((edge) => edge.from.nodeId === nodeId);
  }

  getIncidentEdges(nodeId) {
    return this.incidentEdgeIndex.get(nodeId) || [];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChange(change = {}) {
    this.rebuildIndexes();
    this.listeners.forEach((listener) => listener(change));
  }

  createNode(typeId, position = { x: 0, y: 0 }) {
    const def = this.definitionRegistry.get(typeId);
    if (!def) throw new Error(`Unknown node type ${typeId}`);
    const params = def.defaultParams ? clone(def.defaultParams) : {};
    const node = {
      id: uuidv4(),
      typeId,
      kind: def.kind,
      label: def.label,
      position,
      params,
      ports: buildPortsFromDefinition(def, { typeId, params }),
      runtime: def.createRuntime()
    };
    this.nodes.push(node);
    this.syncModuleNodes();
    this.emitChange({ type: 'node-created', node, nodeId: node.id, affectedNodeIds: [node.id] });
    return node;
  }

  syncModuleNodes() {
    this.nodes
      .filter((node) => node.kind === 'module')
      .forEach((node) => node.runtime?.syncFunctionSlots?.(node, { edges: this.edges, nodes: this.nodes }));
  }

  connect(from, to) {
    const fromNode = this.getNode(from.nodeId);
    const toNode = this.getNode(to.nodeId);
    if (!fromNode || !toNode) return false;
    const fromPort = fromNode.ports.find((port) => port.id === from.portId);
    const toPort = toNode.ports.find((port) => port.id === to.portId);
    if (!fromPort || !toPort) return false;
    if (fromPort.direction !== 'out' || toPort.direction !== 'in') return false;
    if (fromPort.type !== toPort.type) return false;

    const removedEdgeIds = [];
    if (toNode.kind === 'module' && toPort.type === 'OperatorRef') {
      // A module function slot accepts exactly one root operator. Connecting to an occupied
      // slot replaces the previous operator, and one operator can appear only once per module.
      this.edges = this.edges.filter((edge) => {
        const replaced =
          (edge.to.nodeId === to.nodeId && edge.to.portId === to.portId) ||
          (edge.to.nodeId === to.nodeId && edge.from.nodeId === from.nodeId);
        if (replaced) removedEdgeIds.push(edge.id);
        return !replaced;
      });
      toNode.runtime?.onOperatorConnected?.(toNode, fromNode, toPort.id);
    } else {
      this.edges = this.edges.filter((edge) => {
        const replaced = edge.to.nodeId === to.nodeId && edge.to.portId === to.portId;
        if (replaced) removedEdgeIds.push(edge.id);
        return !replaced;
      });
    }

    const edge = { id: uuidv4(), from, to };
    this.edges.push(edge);
    this.syncModuleNodes();
    this.emitChange({
      type: 'edge-connected',
      edge,
      edgeId: edge.id,
      from,
      to,
      removedEdgeIds,
      affectedNodeIds: [from.nodeId, to.nodeId]
    });
    return true;
  }

  removeNode(nodeId) {
    const removedEdgeIds = this.getIncidentEdges(nodeId).map((edge) => edge.id);
    this.nodes = this.nodes.filter((node) => node.id !== nodeId);
    this.edges = this.edges.filter((edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId);
    this.syncModuleNodes();
    this.emitChange({ type: 'node-removed', nodeId, removedEdgeIds, affectedNodeIds: [nodeId] });
  }

  removeEdge(edgeId) {
    const edge = this.getEdge(edgeId);
    this.edges = this.edges.filter((candidate) => candidate.id !== edgeId);
    this.syncModuleNodes();
    this.emitChange({
      type: 'edge-removed',
      edgeId,
      edge,
      affectedNodeIds: edge ? [edge.from.nodeId, edge.to.nodeId] : []
    });
  }

  serialize() {
    return JSON.stringify(
      {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        nodes: this.nodes.map((n) => ({
          id: n.id,
          typeId: n.typeId,
          kind: n.kind,
          label: n.label,
          position: n.position,
          params: n.params,
          ports: n.ports
        })),
        edges: this.edges,
        view: this.view
      },
      null,
      2
    );
  }

  load(json) {
    const raw = typeof json === 'string' ? JSON.parse(json) : json;
    const parsed = migrateGraphDocument(raw);
    const nextNodes = [];
    const nextEdges = parsed.edges || [];
    const nextView = parsed.view || { panX: 0, panY: 0, zoom: 1 };
    for (const n of parsed.nodes) {
      const def = this.definitionRegistry.get(n.typeId);
      if (!def) continue;
      const params = { ...clone(def.defaultParams || {}), ...(n.params ? clone(n.params) : {}) };
      const definitionPorts = buildPortsFromDefinition(def, { ...n, params });
      const savedPorts = n.ports || [];
      const ports = definitionPorts.length
        ? definitionPorts.map((port) => ({ ...savedPorts.find((saved) => saved.id === port.id), ...port }))
        : savedPorts;
      const node = {
        id: n.id,
        typeId: n.typeId,
        kind: def.kind,
        label: def.kind === 'module' ? params.workspaceName || n.label || def.label : n.label || def.label,
        position: n.position,
        params,
        ports,
        runtime: def.createRuntime()
      };
      nextNodes.push(node);
    }
    nextNodes
      .filter((node) => node.kind === 'module')
      .forEach((node) => node.runtime?.syncFunctionSlots?.(node, { edges: nextEdges, nodes: nextNodes }));

    this.schemaVersion = parsed.schemaVersion;
    this.nodes = nextNodes;
    this.edges = nextEdges;
    this.view = nextView;
    this.emitChange({ type: 'graph-loaded', affectedNodeIds: this.nodes.map((node) => node.id) });
  }
}
