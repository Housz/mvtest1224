import { RoadwayHazardStateDataset } from '../RoadwayHazardStateDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeRoadwayHazardState({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.state || adaptorResults.hazard || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rows = (source.rows || source.raw?.rows || []).map((row) => ({
    ...row,
    roadwayEdgeId: getPathValue(row, rolePath(mapping, 'roadwayEdgeId', 'roadwayEdgeId')) ?? row.edgeId,
    roadwayNodeId: getPathValue(row, rolePath(mapping, 'roadwayNodeId', 'roadwayNodeId')) ?? row.nodeId,
    time: getPathValue(row, rolePath(mapping, 'time', 'time')),
    hazardType: getPathValue(row, rolePath(mapping, 'hazardType', 'hazardType')),
    hazardValue: getPathValue(row, rolePath(mapping, 'hazardValue', 'hazardValue')),
    severity: getPathValue(row, rolePath(mapping, 'severity', 'severity')),
    passability: getPathValue(row, rolePath(mapping, 'passability', 'passability')),
    arrivalTime: getPathValue(row, rolePath(mapping, 'arrivalTime', 'arrivalTime')),
    scenarioId: getPathValue(row, rolePath(mapping, 'scenarioId', 'scenarioId'))
  }));
  let minTime = Infinity;
  let maxTime = -Infinity;
  rows.forEach((row) => {
    const numeric = Number(row.time);
    const parsed = Number.isFinite(numeric) ? numeric : Date.parse(row.time);
    if (!Number.isFinite(parsed)) return;
    if (parsed < minTime) minTime = parsed;
    if (parsed > maxTime) maxTime = parsed;
  });
  const timeRange = Number.isFinite(minTime) ? { min: minTime, max: maxTime } : null;
  const templates = {
    hazardState: new StateTemplate({
      id: 'hazardState',
      label: 'Roadway hazard state',
      role: 'roadwayHazardTimeState',
      data: { rows },
      roleMapping: {
        time: mapping.time,
        hazardType: mapping.hazardType,
        hazardValue: mapping.hazardValue,
        severity: mapping.severity,
        passability: mapping.passability
      },
      metadata: {
        subjectRole: 'roadwayEdgeId / roadwayNodeId',
        timeRole: 'time',
        valueRole: 'hazardValue',
        timeRange
      }
    }),
    hazardField: createTemplate('Field', {
      id: 'hazardField',
      label: 'Roadway-supported hazard field',
      role: 'roadwayHazardField',
      data: {
        support: 'Roadway.graph.edgeId / nodeId',
        fieldType: 'graph-supported scalar / categorical field',
        rows
      },
      roleMapping: {
        support: mapping.support,
        value: mapping.hazardValue
      },
      metadata: { support: 'roadway', fieldType: 'graph-supported', valueRole: 'hazardValue' }
    }),
    roadwayRelation: new RelationTemplate({
      id: 'roadwayRelation',
      label: 'Hazard state roadway relation',
      role: 'hazardRoadwaySupport',
      data: {
        source: 'state row',
        target: 'Roadway.graph.edgeId / nodeId',
        rows: rows.map((row) => ({
          roadwayEdgeId: row.roadwayEdgeId,
          roadwayNodeId: row.roadwayNodeId
        }))
      },
      roleMapping: {
        roadwayEdgeId: mapping.roadwayEdgeId,
        roadwayNodeId: mapping.roadwayNodeId
      },
      metadata: { relation: 'hazard state rows are defined on roadway graph supports' }
    })
  };

  const report = makeReport();
  if (!rows.length) report.errors.push('Roadway hazard state has no rows.');
  const allowedPassability = new Set(['passable', 'risky', 'blocked', '', null, undefined]);
  const allowedSeverity = new Set(['none', 'low', 'medium', 'high', 'critical', 'unknown', '', null, undefined]);
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const parsedTime = Number.isFinite(Number(row.time)) ? Number(row.time) : Date.parse(row.time);
    if (!Number.isFinite(parsedTime)) report.errors.push(`Hazard row ${rowNumber} has invalid time.`);
    if (!row.hazardType) report.errors.push(`Hazard row ${rowNumber} is missing hazard type.`);
    if (!isFiniteNumber(row.hazardValue)) report.errors.push(`Hazard row ${rowNumber} has invalid hazard value.`);
    if (!row.roadwayEdgeId && !row.roadwayNodeId) {
      report.errors.push(`Hazard row ${rowNumber} does not reference a roadway edge or node.`);
    }
    if (!allowedPassability.has(row.passability)) report.warnings.push(`Hazard row ${rowNumber} has custom passability ${row.passability}.`);
    if (!allowedSeverity.has(row.severity)) report.warnings.push(`Hazard row ${rowNumber} has custom severity ${row.severity}.`);
  });
  report.summary = {
    rowCount: rows.length,
    affectedEdgeCount: new Set(rows.map((row) => row.roadwayEdgeId).filter(Boolean)).size,
    hazardType: rows.find((row) => row.hazardType)?.hazardType ?? null,
    timeRange
  };

  return new RoadwayHazardStateDataset({
    rows,
    source: { statePath: sources.state?.path },
    statePath: sources.state?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
