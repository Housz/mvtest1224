import { RoadwayDataset } from './RoadwayDataset.js';
import { SensorDataset } from './SensorDataset.js';
import { ContractRegistry } from '../contracts/ContractRegistry.js';

export class DataResource {
  constructor(params) {
    this.source = params.source || { type: 'file', path: '' };
    this.contractId = params.contractId;
    this.roleMapping = params.roleMapping || params.roleMapping || {};
    this.bindings = params.bindings || {};
    this.facets = params.facets || [];
    this.raw = null;
    this.bindingResolver = null;
  }

  async load(registry) {
    if (this.source.type === 'inline') {
      this.raw = this.source.data;
      return this;
    }
    if (this.contractId === 'RoadwayGeometry' && this.source.type === 'auto') {
      const topo = this.resolveBinding('topo_ref_id');
      if (topo?.edges?.length) {
        this.raw = topo.edges.map((e) => ({ name: e.id, topo: e.id }));
      }
      return this;
    }
    if (this.source.type === 'file') {
      if (this.source.path.endsWith('.csv')) {
        this.raw = await registry.loadCsv(this.source.path);
      } else {
        this.raw = await registry.loadJson(this.source.path);
      }
    }
    return this;
  }

  getContract() {
    return ContractRegistry.get(this.contractId);
  }

  getByPath(obj, path, fallback = undefined) {
    if (!obj || !path) return fallback;
    const parts = Array.isArray(path) ? path : `${path}`.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return fallback;
      if (Array.isArray(cur) && !Number.isNaN(Number(p))) cur = cur[Number(p)];
      else cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  }

  validateRoles() {
    const contract = this.getContract();
    if (!contract) return [];
    const missing = [];
    for (const role of contract.required_roles || []) {
      if (!this.roleMapping[role.roleKey]) missing.push(role.roleKey);
    }
    return missing;
  }

  resolveBinding(contractRole) {
    if (!this.bindingResolver) return null;
    const target = this.bindings?.[contractRole];
    if (!target) return null;
    return this.bindingResolver(target);
  }

  resolveFacet(facetId) {
    const preset = this.facets.find((f) => f.id === facetId || `facet-${f.id}` === facetId);
    if (!preset) return null;
    const contract = this.getContract();
    if (!contract) return null;
    switch (contract.id) {
      case 'RoadwayTopology':
        return this.resolveRoadwayTopology(preset);
      case 'SensorStationRegistry':
        return this.resolveSensorRegistry(preset);
      case 'SensorReadingTimeSeries':
        return this.resolveSensorReadings(preset);
      case 'RoadwayGeometry':
        return this.resolveRoadwayGeometry();
      default:
        return this.raw;
    }
  }

  resolveRoadwayTopology() {
    const map = this.roleMapping;
    const nodes = (this.raw.nodes || []).map((n) => {
      const pos =
        this.getByPath(n, map.node_pos || 'coordinate') || this.getByPath(n, 'position') || this.getByPath(n, 'coordinate');
      const coordinate = Array.isArray(pos) ? pos : pos ? [pos.x, pos.y, pos.z] : [0, 0, 0];
      return {
        id: this.getByPath(n, map.node_id || 'id'),
        name: this.getByPath(n, map.node_name || 'name'),
        coordinate
      };
    });
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edges = (this.raw.edges || []).map((e) => ({
      id: this.getByPath(e, map.edge_id || 'id'),
      name: e.name || this.getByPath(e, map.edge_id || 'id'),
      from:
        this.getByPath(e, map.from_node || 'from') ?? this.getByPath(e, 'from') ?? this.getByPath(e, 'source'),
      to: this.getByPath(e, map.to_node || 'to') ?? this.getByPath(e, 'to') ?? this.getByPath(e, 'target'),
      path: this.getByPath(e, map.edge_path || 'path')
    }));
    return new RoadwayDataset({ nodes, edges, nodeMap });
  }

  resolveSensorRegistry() {
    const map = this.roleMapping;
    return this.raw.map((r) => ({
      sensorID: this.getByPath(r, map.sensor_id || 'sensorID'),
      x: Number(this.getByPath(r, map.x || 'x')), 
      y: Number(this.getByPath(r, map.y || 'y')),
      z: Number(this.getByPath(r, map.z || 'z')),
      roadwayID: this.getByPath(r, map.roadway_node_ref || 'roadwayID')
    }));
  }

  resolveSensorReadings(preset) {
    const registry = this.resolveBinding('sensor_id');
    const map = this.roleMapping;
    const remapped = (this.raw || []).map((r) => ({
      sensorID: this.getByPath(r, map.sensor_id || 'sensorID'),
      time: (() => {
        const raw = this.getByPath(r, map.timestamp || 'time');
        return typeof raw === 'number' ? raw : Date.parse(raw);
      })(),
      value: (() => {
        const raw = this.getByPath(r, map.value || 'value');
        return typeof raw === 'number' ? raw : Number(raw);
      })()
    }));
    return new SensorDataset(registry?.raw || registry || [], remapped);
  }

  resolveRoadwayGeometry() {
    const map = this.roleMapping;
    const items = (this.raw || []).map((r) => ({
      mesh_part_id: r[map.mesh_part_id || 'name'],
      topo_ref_id: r[map.topo_ref_id || 'topo'] || r[map.mesh_part_id || 'name']
    }));
    return items;
  }
}
