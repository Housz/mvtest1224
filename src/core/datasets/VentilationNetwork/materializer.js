import { VentilationNetworkDataset } from '../VentilationNetworkDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeVentilationNetwork({ contract, adaptorResults, roleMapping, sources }) {
  const network = adaptorResults.network || {};
  const raw = network.raw || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const nodes = (network.nodes || raw.nodes || []).map((node, index) => ({
    ...node,
    id: getPathValue(node, relativePath(rolePath(mapping, 'graph.nodeId', 'id'), 'nodes')) ?? `VN_${index + 1}`,
    type: getPathValue(node, relativePath(rolePath(mapping, 'graph.nodeType', 'type'), 'nodes')) ?? node.type ?? 'junction',
    roadwayNodeId: getPathValue(node, relativePath(rolePath(mapping, 'relation.roadwayNode', 'roadwayNodeId'), 'nodes')) ?? node.roadwayNodeId ?? null,
    position: getPathValue(node, relativePath(rolePath(mapping, 'graph.nodePosition', 'position'), 'nodes')) ?? node.position ?? node
  }));
  const branches = (network.branches || raw.branches || raw.edges || []).map((branch, index) => ({
    ...branch,
    id: getPathValue(branch, relativePath(rolePath(mapping, 'graph.branchId', 'id'), 'branches')) ?? `VB_${index + 1}`,
    from: getPathValue(branch, relativePath(rolePath(mapping, 'graph.fromNode', 'from'), 'branches')),
    to: getPathValue(branch, relativePath(rolePath(mapping, 'graph.toNode', 'to'), 'branches')),
    branchType: getPathValue(branch, relativePath(rolePath(mapping, 'graph.branchType', 'branchType'), 'branches')) ?? branch.branchType,
    nominalDirection:
      getPathValue(branch, relativePath(rolePath(mapping, 'graph.nominalDirection', 'nominalDirection'), 'branches')) ??
      branch.nominalDirection,
    roadwayEdgeIds:
      getPathValue(branch, relativePath(rolePath(mapping, 'relation.roadwayEdges', 'roadwayEdgeIds'), 'branches')) ??
      branch.roadwayEdgeIds ??
      [],
    path: getPathValue(branch, relativePath(rolePath(mapping, 'graph.path', 'path'), 'branches')) ?? branch.path ?? []
  }));
  const facilities = (network.facilities || raw.facilities || []).map((facility, index) => ({
    ...facility,
    id: getPathValue(facility, relativePath(rolePath(mapping, 'facility.facilityId', 'id'), 'facilities')) ?? `FAC_${index + 1}`,
    type: getPathValue(facility, relativePath(rolePath(mapping, 'facility.facilityType', 'type'), 'facilities')) ?? facility.type,
    branchId:
      getPathValue(facility, relativePath(rolePath(mapping, 'facility.branchId', 'branchId'), 'facilities')) ?? facility.branchId,
    ratio: getPathValue(facility, relativePath(rolePath(mapping, 'facility.ratio', 'ratio'), 'facilities')) ?? facility.ratio
  }));
  const boundaryConditions = network.boundaryConditions || raw.boundaryConditions || { intakes: [], returns: [] };
  const relations = network.relations || raw.relations || [];

  const templates = {
    graph: new GraphTemplate({
      id: 'graph',
      label: 'Ventilation graph',
      role: 'ventilationNetworkStructure',
      data: { nodes, edges: branches },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('graph.'))),
      metadata: { edgeName: 'branch' }
    }),
    facilityRegistry: new RegistryTemplate({
      id: 'facilityRegistry',
      label: 'Ventilation facility registry',
      role: 'facilityIdentity',
      data: { entities: facilities },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('facility.'))),
      metadata: { keyRole: 'facility.facilityId' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'Ventilation to roadway relation',
      role: 'roadwayReference',
      data: {
        source: 'ventilation.branchId / facilityId / nodeId',
        target: 'Roadway.graph.edgeId / nodeId',
        rows: [
          ...branches.map((branch) => ({ branchId: branch.id, roadwayEdgeIds: branch.roadwayEdgeIds })),
          ...nodes.map((node) => ({ nodeId: node.id, roadwayNodeId: node.roadwayNodeId })),
          ...facilities.map((facility) => ({ facilityId: facility.id, branchId: facility.branchId }))
        ]
      },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('relation.'))),
      metadata: { relation: 'ventilation branches, facilities, and nodes reference roadway objects' }
    }),
    branchGeometry: new GeometryTemplate({
      id: 'branchGeometry',
      label: 'Ventilation branch geometry',
      role: 'branchCenterline',
      data: {
        form: 'Polyline',
        paths: branches.map((branch) => ({ id: branch.id, path: branch.path || [] }))
      },
      roleMapping: { path: mapping['graph.path'] },
      metadata: { form: 'Polyline' }
    })
  };

  const report = makeReport();
  if (!nodes.length) report.errors.push('Ventilation network has no nodes.');
  if (!branches.length) report.errors.push('Ventilation network has no branches.');
  validateUnique(nodes.map((node) => node.id), 'Ventilation node ids', report);
  validateUnique(branches.map((branch) => branch.id), 'Ventilation branch ids', report);
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  branches.forEach((branch) => {
    if (!nodeIds.has(String(branch.from))) report.errors.push(`Branch ${branch.id} references missing from node ${branch.from}.`);
    if (!nodeIds.has(String(branch.to))) report.errors.push(`Branch ${branch.id} references missing to node ${branch.to}.`);
    if (branch.roadwayEdgeIds && !Array.isArray(branch.roadwayEdgeIds)) {
      report.warnings.push(`Branch ${branch.id} roadwayEdgeIds is not an array.`);
    }
  });
  const branchIds = new Set(branches.map((branch) => String(branch.id)));
  facilities.forEach((facility) => {
    if (facility.branchId && !branchIds.has(String(facility.branchId))) {
      report.errors.push(`Facility ${facility.id} references missing branch ${facility.branchId}.`);
    }
  });
  [...(boundaryConditions.intakes || []), ...(boundaryConditions.returns || [])].forEach((entry) => {
    if (entry.nodeId && !nodeIds.has(String(entry.nodeId))) {
      report.errors.push(`Boundary condition references missing ventilation node ${entry.nodeId}.`);
    }
  });
  report.summary = {
    nodeCount: nodes.length,
    branchCount: branches.length,
    facilityCount: facilities.length,
    intakeCount: boundaryConditions.intakes?.length || 0,
    returnCount: boundaryConditions.returns?.length || 0
  };

  return new VentilationNetworkDataset({
    nodes,
    branches,
    facilities,
    relations,
    boundaryConditions,
    source: { networkPath: sources.network?.path },
    networkPath: sources.network?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
