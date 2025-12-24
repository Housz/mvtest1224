import { v4 as uuidv4 } from 'uuid';

/**
 * Node/Port/Edge centric graph model with simple type checking.
 */
export class GraphModel {
  constructor(definitionRegistry) {
    this.definitionRegistry = definitionRegistry;
    this.nodes = [];
    this.edges = [];
    this.view = { panX: 0, panY: 0, zoom: 1 };
  }

  createNode(typeId, position = { x: 0, y: 0 }) {
    const def = this.definitionRegistry.get(typeId);
    if (!def) throw new Error(`Unknown node type ${typeId}`);
    const node = {
      id: uuidv4(),
      typeId,
      kind: def.kind,
      label: def.label,
      position,
      params: def.defaultParams ? { ...def.defaultParams } : {},
      roleMapping: def.defaultRoleMapping ? { ...def.defaultRoleMapping } : {},
      bindings: def.defaultBindings ? { ...def.defaultBindings } : {},
      ports: def.buildPorts ? def.buildPorts({ typeId, params: def.defaultParams || {} }) : def.ports?.map((p) => ({ ...p })) || [],
      runtime: def.createRuntime()
    };
    if (node.runtime.updateFacets) node.runtime.updateFacets(node);
    this.nodes.push(node);
    return node;
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
    // enforce single inbound connection per input port
    this.edges = this.edges.filter((e) => !(e.to.nodeId === to.nodeId && e.to.portId === to.portId));
    this.edges.push({ id: uuidv4(), from, to });
    return true;
  }

  removeNode(nodeId) {
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    this.edges = this.edges.filter((e) => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
  }

  removeEdge(edgeId) {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
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
          roleMapping: n.roleMapping,
          bindings: n.bindings,
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
      const node = {
        id: n.id,
        typeId: n.typeId,
        kind: def.kind,
        label: n.label || def.label,
        position: n.position,
        params: n.params || {},
        roleMapping: n.roleMapping || {},
        bindings: n.bindings || {},
        ports: n.ports || (def.buildPorts ? def.buildPorts(n) : def.ports.map((p) => ({ ...p }))),
        runtime: def.createRuntime()
      };
      if (node.runtime.updateFacets) node.runtime.updateFacets(node);
      this.nodes.push(node);
    }
    this.edges = parsed.edges || [];
  }
}
