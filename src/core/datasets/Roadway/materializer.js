import { RoadwayDataset } from '../RoadwayDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeRoadway({ contract, adaptorResults, roleMapping, sources }) {
  const topology = adaptorResults.topology || {};
  const geometry = adaptorResults.geometry || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawNodes = topology.nodes || [];
  const rawEdges = topology.edges || [];

  const nodes = rawNodes.map((rawNode, index) => {
    const positionPath = relativePath(rolePath(mapping, 'graph.nodePosition', 'position'), 'nodes');
    return {
      ...rawNode,
      id: getPathValue(rawNode, relativePath(rolePath(mapping, 'graph.nodeId', 'id'), 'nodes')) ?? `Node_${index}`,
      position: getPathValue(rawNode, positionPath) ?? rawNode.position ?? rawNode.coordinate ?? rawNode,
      idx: index
    };
  });

  const edges = rawEdges.map((rawEdge, index) => ({
    ...rawEdge,
    id: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.edgeId', 'id'), 'edges')) ?? `Edge_${index}`,
    source: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.fromNode', 'source'), 'edges')),
    target: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.toNode', 'target'), 'edges')),
    path: getPathValue(rawEdge, relativePath(rolePath(mapping, 'graph.path', 'path'), 'edges')) ?? rawEdge.path ?? [],
    idx: index
  }));

  const meshParts = geometry.meshParts || [];
  const templates = {
    graph: new GraphTemplate({
      id: 'graph',
      label: 'Roadway graph',
      role: 'networkStructure',
      data: { nodes, edges },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('graph.')))
    }),
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Roadway geometry',
      role: 'spatialSupport',
      data: {
        form: 'MeshSurface',
        modelPath: sources.geometry?.path,
        objText: geometry.objText,
        meshParts
      },
      roleMapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => key.startsWith('geometry.')))
    }),
    geometryToGraph: new RelationTemplate({
      id: 'geometryToGraph',
      label: 'Geometry to roadway graph',
      role: 'constitutiveCorrespondence',
      data: {
        source: 'geometry.meshPartId',
        target: 'graph.edgeId / graph.nodeId',
        rows: meshParts.map((part) => ({ meshPartId: part.name, graphEntityId: part.name }))
      },
      roleMapping: { geometryTarget: mapping['relation.geometryTarget'] },
      metadata: { relation: 'geometry parts are attached to roadway graph entities by id/name correspondence' }
    })
  };

  const report = makeReport();
  if (!nodes.length) report.errors.push('Roadway graph has no nodes.');
  if (!edges.length) report.errors.push('Roadway graph has no edges.');
  validateUnique(nodes.map((node) => node.id), 'Roadway node ids', report);
  validateUnique(edges.map((edge) => edge.id), 'Roadway edge ids', report);
  const nodeIds = new Set(nodes.map((node) => node.id));
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source)) report.errors.push(`Edge ${edge.id} references missing from node ${edge.source}.`);
    if (!nodeIds.has(edge.target)) report.errors.push(`Edge ${edge.id} references missing to node ${edge.target}.`);
  });
  if (!geometry.objText && !sources.geometry?.path) report.errors.push('Roadway geometry source is missing.');
  if (!meshParts.length) report.warnings.push('Roadway geometry contains no parsed mesh parts.');
  report.summary = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    meshPartCount: meshParts.length
  };

  return new RoadwayDataset({
    nodes,
    edges,
    source: { topologyPath: sources.topology?.path, modelPath: sources.geometry?.path },
    topologyPath: sources.topology?.path,
    modelPath: sources.geometry?.path,
    objText: geometry.objText,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
