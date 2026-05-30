import { v4 as uuidv4 } from 'uuid';

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
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChange(change = {}) {
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
    this.emitChange({ type: 'node-created', node });
    return node;
  }

  syncModuleNodes() {
    this.nodes
      .filter((node) => node.kind === 'module')
      .forEach((node) => node.runtime?.syncFunctionSlots?.(node, { edges: this.edges, nodes: this.nodes }));
  }

  connect(from, to) {
    const fromNode = this.nodes.find((n) => n.id === from.nodeId);
    const toNode = this.nodes.find((n) => n.id === to.nodeId);
    if (!fromNode || !toNode) return false;
    const fromPort = fromNode.ports.find((p) => p.id === from.portId);
    const toPort = toNode.ports.find((p) => p.id === to.portId);
    if (!fromPort || !toPort) return false;
    if (fromPort.direction !== 'out' || toPort.direction !== 'in') return false;
    if (fromPort.type !== toPort.type) return false;
    if (toNode.kind === 'module' && toPort.type === 'OperatorRef') {
      // A module function slot accepts exactly one root operator. Connecting to an occupied
      // slot replaces the previous operator, and one operator can appear only once per module.
      this.edges = this.edges.filter(
        (e) =>
          !(e.to.nodeId === to.nodeId && e.to.portId === to.portId) &&
          !(e.to.nodeId === to.nodeId && e.from.nodeId === from.nodeId)
      );
      toNode.runtime?.onOperatorConnected?.(toNode, fromNode, toPort.id);
    } else {
      this.edges = this.edges.filter((e) => !(e.to.nodeId === to.nodeId && e.to.portId === to.portId));
    }
    this.edges.push({ id: uuidv4(), from, to });
    this.syncModuleNodes();
    this.emitChange({ type: 'edge-connected', from, to });
    return true;
  }

  removeNode(nodeId) {
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    this.edges = this.edges.filter((e) => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
    this.syncModuleNodes();
    this.emitChange({ type: 'node-removed', nodeId });
  }

  removeEdge(edgeId) {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
    this.syncModuleNodes();
    this.emitChange({ type: 'edge-removed', edgeId });
  }

  serialize() {
    return JSON.stringify(
      {
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
    this.nodes = [];
    this.edges = [];
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    this.view = parsed.view || { panX: 0, panY: 0, zoom: 1 };
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
      this.nodes.push(node);
    }
    this.edges = parsed.edges || [];
    this.syncModuleNodes();
    this.emitChange({ type: 'graph-loaded' });
  }
}
