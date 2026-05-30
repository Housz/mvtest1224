import { collectObjectPaths, extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';

export class VentilationNetworkJsonAdaptor {
  constructor() {
    this.id = 'VentilationNetworkJsonAdaptor';
    this.label = 'Ventilation Network JSON Adaptor';
    this.kind = 'Ventilation network JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /ventilation[_-]?network/i.test(path);
  }

  async load(source, contract) {
    const raw = source.data ?? JSON.parse(source.text ?? (await fetchText(source.path)));
    const nodes = raw.nodes ?? [];
    const branches = raw.branches ?? raw.edges ?? [];
    const facilities = raw.facilities ?? [];
    const boundaryConditions = raw.boundaryConditions ?? { intakes: [], returns: [] };
    const relations = raw.relations ?? [];
    const paths = new Set();
    collectObjectPaths(
      {
        nodes: nodes[0] || {},
        branches: branches[0] || {},
        facilities: facilities[0] || {},
        boundaryConditions
      },
      '',
      paths
    );
    [
      'nodes.id',
      'nodes.type',
      'nodes.roadwayNodeId',
      'nodes.position',
      'branches.id',
      'branches.from',
      'branches.to',
      'branches.branchType',
      'branches.nominalDirection',
      'branches.roadwayEdgeIds',
      'branches.path',
      'facilities.id',
      'facilities.type',
      'facilities.branchId',
      'facilities.ratio',
      'facilities.status'
    ].forEach((path) => paths.add(path));
    const pathList = [...paths].sort();
    return {
      source,
      kind: this.kind,
      raw,
      nodes,
      branches,
      facilities,
      boundaryConditions,
      relations,
      fields: pathList,
      paths: pathList,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, pathList),
      summary: {
        nodeCount: nodes.length,
        branchCount: branches.length,
        facilityCount: facilities.length,
        intakeCount: boundaryConditions.intakes?.length || 0,
        returnCount: boundaryConditions.returns?.length || 0
      }
    };
  }
}
