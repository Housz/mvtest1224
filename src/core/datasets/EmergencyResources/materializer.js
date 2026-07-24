import { EmergencyResourcesDataset } from '../EmergencyResourcesDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeEmergencyResources({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.resources || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawResources = source.resources || source.raw?.resources || [];
  const resources = rawResources.map((row, index) => {
    const positionValue = getPathValue(row, relativePath(rolePath(mapping, 'position', 'position'), 'resources'));
    const position =
      positionValue && typeof positionValue === 'object'
        ? toPoint(positionValue)
        : {
            x: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionX', 'position.x'), 'resources'))),
            y: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionY', 'position.y'), 'resources'))),
            z: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionZ', 'position.z'), 'resources')))
          };
    const edgeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayEdgeId', 'roadwayAnchor.edgeId'), 'resources'));
    const nodeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayNodeId', 'roadwayAnchor.nodeId'), 'resources'));
    const ratio = getPathValue(row, relativePath(rolePath(mapping, 'ratio', 'roadwayAnchor.ratio'), 'resources'));
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'resourceId', 'resourceId'), 'resources')) ??
      row.resource_id ??
      row.id ??
      `ER_${String(index + 1).padStart(3, '0')}`;
    return {
      ...row,
      resourceId: String(id),
      label: getPathValue(row, relativePath(rolePath(mapping, 'label', 'label'), 'resources')) ?? row.name ?? `Resource ${index + 1}`,
      resourceType: getPathValue(row, relativePath(rolePath(mapping, 'resourceType', 'resourceType'), 'resources')) ?? row.type,
      status: getPathValue(row, relativePath(rolePath(mapping, 'status', 'status'), 'resources')) ?? 'unknown',
      capacity: getPathValue(row, relativePath(rolePath(mapping, 'capacity', 'capacity'), 'resources')),
      position,
      roadwayAnchor: {
        type: nodeId ? 'node' : edgeId ? 'edge' : null,
        edgeId: edgeId == null || edgeId === '' ? null : String(edgeId),
        nodeId: nodeId == null || nodeId === '' ? null : String(nodeId),
        ratio: ratio == null || ratio === '' ? null : Number(ratio)
      },
      idx: index
    };
  });

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Emergency resource registry',
      role: 'resourceIdentity',
      data: {
        entities: resources.map((resource) => ({
          resourceId: resource.resourceId,
          label: resource.label,
          resourceType: resource.resourceType,
          status: resource.status,
          capacity: resource.capacity
        }))
      },
      roleMapping: {
        resourceId: mapping.resourceId,
        label: mapping.label,
        resourceType: mapping.resourceType,
        status: mapping.status,
        capacity: mapping.capacity
      },
      metadata: { keyRole: 'resourceId' }
    }),
    pointGeometry: new GeometryTemplate({
      id: 'pointGeometry',
      label: 'Emergency resource point geometry',
      role: 'resourcePosition',
      data: {
        form: 'PointSet',
        points: resources.map((resource) => ({ id: resource.resourceId, ...toPoint(resource.position) }))
      },
      roleMapping: {
        position: mapping.position,
        positionX: mapping.positionX,
        positionY: mapping.positionY,
        positionZ: mapping.positionZ
      },
      metadata: { form: 'PointSet' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'Emergency resource roadway location',
      role: 'resourceRoadwayAnchor',
      data: {
        source: 'registry.resourceId',
        target: 'Roadway.graph.edgeId / nodeId',
        anchors: resources.map((resource) => ({
          resourceId: resource.resourceId,
          edgeId: resource.roadwayAnchor.edgeId,
          nodeId: resource.roadwayAnchor.nodeId,
          ratio: resource.roadwayAnchor.ratio
        }))
      },
      roleMapping: {
        roadwayEdgeId: mapping.roadwayEdgeId,
        roadwayNodeId: mapping.roadwayNodeId,
        ratio: mapping.ratio
      },
      metadata: { relation: 'emergency resources are located on roadway edges or nodes' }
    })
  };

  const report = makeReport();
  if (!resources.length) report.errors.push('Emergency resources dataset has no resources.');
  validateUnique(resources.map((resource) => resource.resourceId), 'Emergency resource ids', report);
  const allowedStatuses = new Set(['available', 'unavailable', 'limited', 'unknown']);
  resources.forEach((resource) => {
    const position = toPoint(resource.position);
    if (!resource.resourceType) report.errors.push(`Resource ${resource.resourceId} is missing resource type.`);
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(position.z)) {
      report.errors.push(`Resource ${resource.resourceId} has invalid position.`);
    }
    if (resource.capacity != null && resource.capacity !== '' && !isFiniteNumber(resource.capacity)) {
      report.errors.push(`Resource ${resource.resourceId} has non-numeric capacity.`);
    }
    if (resource.status && !allowedStatuses.has(String(resource.status).toLowerCase())) {
      report.warnings.push(`Resource ${resource.resourceId} has custom status ${resource.status}.`);
    }
    if (!resource.roadwayAnchor.edgeId && !resource.roadwayAnchor.nodeId) {
      report.warnings.push(`Resource ${resource.resourceId} has no roadway anchor.`);
    }
    if (resource.roadwayAnchor.edgeId && resource.roadwayAnchor.ratio != null) {
      const ratio = Number(resource.roadwayAnchor.ratio);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        report.errors.push(`Resource ${resource.resourceId} has invalid roadway ratio.`);
      }
    }
  });
  report.summary = {
    resourceCount: resources.length,
    exitCount: resources.filter((resource) => String(resource.resourceType).toLowerCase() === 'exit').length,
    availableCount: resources.filter((resource) => String(resource.status).toLowerCase() === 'available').length
  };

  return new EmergencyResourcesDataset({
    resources,
    source: { resourcesPath: sources.resources?.path },
    resourcesPath: sources.resources?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
