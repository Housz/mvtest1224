const toPoint = (value = {}) => {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
};

function normalizeNode(node, index) {
  const position = toPoint(node.position ?? node);
  return {
    ...node,
    id: String(node.id ?? `VN_${index + 1}`),
    type: node.type || 'junction',
    roadwayNodeId: node.roadwayNodeId ?? null,
    position,
    x: position.x,
    y: position.y,
    z: position.z,
    pressurePotential: Number(node.pressurePotential ?? 0)
  };
}

function normalizeBranch(branch, index) {
  return {
    ...branch,
    id: String(branch.id ?? `VB_${index + 1}`),
    from: String(branch.from ?? branch.source ?? ''),
    to: String(branch.to ?? branch.target ?? ''),
    branchType: branch.branchType || 'main_intake',
    roadwayEdgeIds: Array.isArray(branch.roadwayEdgeIds) ? branch.roadwayEdgeIds.map(String) : [],
    nominalDirection: branch.nominalDirection || branch.inferredDirection || 'from_to',
    inferredDirection: branch.inferredDirection || branch.nominalDirection || 'from_to',
    directionConfidence: Number(branch.directionConfidence ?? 0),
    length: Number(branch.length ?? 0),
    area: Number(branch.area ?? 0),
    resistance: Number(branch.resistance ?? 0),
    designAirQuantity: Number(branch.designAirQuantity ?? 0),
    path: (branch.path || []).map(toPoint),
    idx: index
  };
}

function normalizeFacility(facility, index) {
  return {
    ...facility,
    id: String(facility.id ?? `FAC_${index + 1}`),
    type: facility.type || 'facility',
    branchId: String(facility.branchId ?? ''),
    ratio: Number(facility.ratio ?? 0.5),
    status: facility.status || 'unknown',
    parameters: facility.parameters || {},
    idx: index
  };
}

export class VentilationNetworkDataset {
  constructor({
    nodes = [],
    branches = [],
    facilities = [],
    relations = [],
    boundaryConditions = { intakes: [], returns: [] },
    source = null,
    networkPath = source?.networkPath ?? null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'VentilationNetworkDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'VentilationNetwork';
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source ?? { networkPath };
    this.networkPath = networkPath;
    this.nodes = nodes.map(normalizeNode);
    this.branches = branches.map(normalizeBranch);
    this.facilities = facilities.map(normalizeFacility);
    this.relations = relations;
    this.boundaryConditions = {
      intakes: boundaryConditions?.intakes || [],
      returns: boundaryConditions?.returns || []
    };
    this.nodeMap = new Map(this.nodes.map((node) => [node.id, node]));
    this.branchMap = new Map(this.branches.map((branch) => [branch.id, branch]));
    this.facilityMap = new Map(this.facilities.map((facility) => [facility.id, facility]));
  }

  listNodes() {
    return this.nodes;
  }

  listBranches() {
    return this.branches;
  }

  listFacilities() {
    return this.facilities;
  }

  getNode(id) {
    return this.nodeMap.get(String(id)) ?? null;
  }

  getBranch(id) {
    return this.branchMap.get(String(id)) ?? null;
  }

  getFacility(id) {
    return this.facilityMap.get(String(id)) ?? null;
  }

  getBranchPath(branchId) {
    return this.getBranch(branchId)?.path || [];
  }

  getBranchRoadwayRelation(branchId) {
    const branch = this.getBranch(branchId);
    return branch ? { branchId: branch.id, roadwayEdgeIds: branch.roadwayEdgeIds } : null;
  }

  getBoundaryConditions() {
    return this.boundaryConditions;
  }

  getBranchesByRoadwayEdge(edgeId) {
    const target = String(edgeId);
    return this.branches.filter((branch) => branch.roadwayEdgeIds.includes(target));
  }

  facilitiesForBranch(branchId) {
    const target = String(branchId);
    return this.facilities.filter((facility) => facility.branchId === target);
  }
}
