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

const normalizeAnchor = (resource = {}) => {
  const anchor = resource.roadwayAnchor || {};
  const edgeId = anchor.edgeId ?? resource.edgeId ?? resource.roadwayEdgeId ?? null;
  const nodeId = anchor.nodeId ?? resource.nodeId ?? resource.roadwayNodeId ?? null;
  const ratioValue = anchor.ratio ?? resource.ratio ?? null;
  return {
    type: anchor.type || (nodeId ? 'node' : edgeId ? 'edge' : null),
    edgeId: edgeId == null || edgeId === '' ? null : String(edgeId),
    nodeId: nodeId == null || nodeId === '' ? null : String(nodeId),
    ratio: ratioValue == null || ratioValue === '' ? null : Number(ratioValue)
  };
};

function normalizeResource(resource, index) {
  const position = toPoint(resource.position ?? resource);
  const roadwayAnchor = normalizeAnchor(resource);
  const id = resource.resourceId ?? resource.resource_id ?? resource.id ?? `ER_${String(index + 1).padStart(3, '0')}`;
  return {
    ...resource,
    id: String(id),
    resourceId: String(id),
    label: resource.label ?? resource.name ?? `Emergency Resource ${index + 1}`,
    resourceType: resource.resourceType ?? resource.type ?? 'resource',
    status: resource.status ?? 'unknown',
    capacity: resource.capacity == null || resource.capacity === '' ? null : Number(resource.capacity),
    position,
    x: position.x,
    y: position.y,
    z: position.z,
    roadwayAnchor,
    edgeId: roadwayAnchor.edgeId,
    nodeId: roadwayAnchor.nodeId,
    ratio: roadwayAnchor.ratio,
    idx: index
  };
}

export class EmergencyResourcesDataset {
  constructor({
    resources = [],
    source = null,
    resourcesPath = source?.resourcesPath ?? null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'EmergencyResourcesDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'EmergencyResources';
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source ?? { resourcesPath };
    this.resourcesPath = resourcesPath;
    this.resources = resources.map(normalizeResource);
    this.resourceMap = new Map(this.resources.map((resource) => [resource.resourceId, resource]));
  }

  listResources() {
    return this.resources;
  }

  listResourceIDs() {
    return this.resources.map((resource) => resource.resourceId);
  }

  getResource(resourceId) {
    return this.resourceMap.get(String(resourceId)) ?? null;
  }

  getResourcePosition(resourceId) {
    return this.getResource(resourceId)?.position ?? null;
  }

  getRoadwayAnchor(resourceId) {
    return this.getResource(resourceId)?.roadwayAnchor ?? null;
  }

  getResourcesByType(type) {
    const target = String(type).toLowerCase();
    return this.resources.filter((resource) => String(resource.resourceType).toLowerCase() === target);
  }

  getAvailableResources() {
    return this.resources.filter((resource) => String(resource.status).toLowerCase() === 'available');
  }

  getExits() {
    return this.getResourcesByType('exit');
  }

  getRefuges() {
    return this.getResourcesByType('refuge');
  }
}
