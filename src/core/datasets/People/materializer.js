import { PeopleDataset } from '../PeopleDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializePeople({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.people || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawPeople = source.people || source.raw?.people || [];
  const people = rawPeople.map((row, index) => {
    const positionValue = getPathValue(row, relativePath(rolePath(mapping, 'position', 'position'), 'people'));
    const position =
      positionValue && typeof positionValue === 'object'
        ? toPoint(positionValue)
        : {
            x: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionX', 'position.x'), 'people'))),
            y: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionY', 'position.y'), 'people'))),
            z: Number(getPathValue(row, relativePath(rolePath(mapping, 'positionZ', 'position.z'), 'people')))
          };
    const edgeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayEdgeId', 'roadwayAnchor.edgeId'), 'people'));
    const nodeId = getPathValue(row, relativePath(rolePath(mapping, 'roadwayNodeId', 'roadwayAnchor.nodeId'), 'people'));
    const ratio = getPathValue(row, relativePath(rolePath(mapping, 'ratio', 'roadwayAnchor.ratio'), 'people'));
    const id =
      getPathValue(row, relativePath(rolePath(mapping, 'personId', 'personId'), 'people')) ??
      row.person_id ??
      row.id ??
      `P_${String(index + 1).padStart(3, '0')}`;
    return {
      ...row,
      personId: String(id),
      label: getPathValue(row, relativePath(rolePath(mapping, 'label', 'label'), 'people')) ?? row.name ?? `Person ${index + 1}`,
      personType: getPathValue(row, relativePath(rolePath(mapping, 'personType', 'personType'), 'people')) ?? row.type ?? 'worker',
      team: getPathValue(row, relativePath(rolePath(mapping, 'team', 'team'), 'people')) ?? row.group ?? '',
      status: getPathValue(row, relativePath(rolePath(mapping, 'status', 'status'), 'people')) ?? 'unknown',
      timestamp: getPathValue(row, relativePath(rolePath(mapping, 'timestamp', 'timestamp'), 'people')) ?? row.time ?? null,
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
      label: 'People registry',
      role: 'personIdentity',
      data: {
        entities: people.map((person) => ({
          personId: person.personId,
          label: person.label,
          personType: person.personType,
          team: person.team
        }))
      },
      roleMapping: {
        personId: mapping.personId,
        label: mapping.label,
        personType: mapping.personType,
        team: mapping.team
      },
      metadata: { keyRole: 'personId' }
    }),
    pointGeometry: new GeometryTemplate({
      id: 'pointGeometry',
      label: 'People point geometry',
      role: 'personPosition',
      data: {
        form: 'PointSet',
        points: people.map((person) => ({ id: person.personId, ...toPoint(person.position) }))
      },
      roleMapping: {
        position: mapping.position,
        positionX: mapping.positionX,
        positionY: mapping.positionY,
        positionZ: mapping.positionZ
      },
      metadata: { form: 'PointSet' }
    }),
    currentState: new StateTemplate({
      id: 'currentState',
      label: 'People current state',
      role: 'personCurrentState',
      data: {
        rows: people.map((person) => ({
          personId: person.personId,
          status: person.status,
          timestamp: person.timestamp
        }))
      },
      roleMapping: {
        personId: mapping.personId,
        status: mapping.status,
        timestamp: mapping.timestamp
      },
      metadata: { subjectRole: 'personId', timeRole: 'timestamp', valueRole: 'status' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'People roadway location',
      role: 'personRoadwayAnchor',
      data: {
        source: 'registry.personId',
        target: 'Roadway.graph.edgeId / nodeId',
        anchors: people.map((person) => ({
          personId: person.personId,
          edgeId: person.roadwayAnchor.edgeId,
          nodeId: person.roadwayAnchor.nodeId,
          ratio: person.roadwayAnchor.ratio
        }))
      },
      roleMapping: {
        roadwayEdgeId: mapping.roadwayEdgeId,
        roadwayNodeId: mapping.roadwayNodeId,
        ratio: mapping.ratio
      },
      metadata: { relation: 'people are located on roadway edges or nodes' }
    })
  };

  const report = makeReport();
  if (!people.length) report.errors.push('People dataset has no people.');
  validateUnique(people.map((person) => person.personId), 'Person ids', report);
  const allowedStatuses = new Set(['normal', 'trapped', 'evacuating', 'rescued', 'unknown']);
  people.forEach((person) => {
    const position = toPoint(person.position);
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y) || !isFiniteNumber(position.z)) {
      report.errors.push(`Person ${person.personId} has invalid position.`);
    }
    if (!person.status) report.warnings.push(`Person ${person.personId} has no status.`);
    if (person.status && !allowedStatuses.has(String(person.status).toLowerCase())) {
      report.warnings.push(`Person ${person.personId} has custom status ${person.status}.`);
    }
    if (!person.roadwayAnchor.edgeId && !person.roadwayAnchor.nodeId) {
      report.warnings.push(`Person ${person.personId} has no roadway anchor.`);
    }
    if (person.roadwayAnchor.edgeId && person.roadwayAnchor.ratio != null) {
      const ratio = Number(person.roadwayAnchor.ratio);
      if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        report.errors.push(`Person ${person.personId} has invalid roadway ratio.`);
      }
    }
  });
  report.summary = {
    personCount: people.length,
    anchoredPersonCount: people.filter((person) => person.roadwayAnchor.edgeId || person.roadwayAnchor.nodeId).length,
    statusCounts: people.reduce((counts, person) => {
      counts[person.status] = (counts[person.status] || 0) + 1;
      return counts;
    }, {})
  };

  return new PeopleDataset({
    people,
    source: { peoplePath: sources.people?.path },
    peoplePath: sources.people?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
