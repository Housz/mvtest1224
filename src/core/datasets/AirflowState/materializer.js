import { AirflowStateDataset } from '../AirflowStateDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeAirflowState({ contract, adaptorResults, roleMapping, sources }) {
  const table = adaptorResults.state || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rows = (table.rows || []).map((row) => ({
    ...row,
    branch_id: getPathValue(row, rolePath(mapping, 'branchId', 'branch_id')),
    time: getPathValue(row, rolePath(mapping, 'timestamp', 'time')),
    air_quantity_m3s: getPathValue(row, rolePath(mapping, 'airQuantity', 'air_quantity_m3s')),
    velocity_ms: getPathValue(row, rolePath(mapping, 'velocity', 'velocity_ms')),
    pressure_drop_pa: getPathValue(row, rolePath(mapping, 'pressureDrop', 'pressure_drop_pa')),
    pressure_from_pa: getPathValue(row, rolePath(mapping, 'pressureFrom', 'pressure_from_pa')),
    pressure_to_pa: getPathValue(row, rolePath(mapping, 'pressureTo', 'pressure_to_pa')),
    direction_sign: getPathValue(row, rolePath(mapping, 'directionSign', 'direction_sign')),
    direction: getPathValue(row, rolePath(mapping, 'direction', 'direction')),
    anomaly_type: getPathValue(row, rolePath(mapping, 'anomalyType', 'anomaly_type')),
    scenario_id: getPathValue(row, rolePath(mapping, 'scenarioId', 'scenario_id'))
  }));
  const validTimes = rows
    .map((row) => {
      const numeric = Number(row.time);
      return Number.isFinite(numeric) ? numeric : Date.parse(row.time);
    })
    .filter(Number.isFinite);
  const timeRange = validTimes.length ? { min: Math.min(...validTimes), max: Math.max(...validTimes) } : null;
  const branchIds = new Set(rows.map((row) => row.branch_id).filter(Boolean));
  const templates = {
    state: new StateTemplate({
      id: 'state',
      label: 'Airflow branch state',
      role: 'branchTimeState',
      data: { rows },
      roleMapping: {
        branchId: mapping.branchId,
        timestamp: mapping.timestamp,
        airQuantity: mapping.airQuantity
      },
      metadata: {
        subjectRole: 'branchId',
        timeRole: 'timestamp',
        valueRole: 'airQuantity',
        variable: 'airflow',
        timeRange
      }
    }),
    airflowField: createTemplate('Field', {
      id: 'airflowField',
      label: 'Graph-supported airflow field',
      role: 'branchSupportedField',
      data: {
        support: 'VentilationNetwork.graph.branches',
        rows
      },
      roleMapping: {
        support: mapping.branchId,
        value: mapping.airQuantity
      },
      metadata: { support: 'ventilationBranch' }
    }),
    stateOfBranch: new RelationTemplate({
      id: 'stateOfBranch',
      label: 'Airflow state of branch',
      role: 'stateBranchRelation',
      data: {
        source: 'state.branchId',
        target: 'VentilationNetwork.graph.branchId',
        rows: [...branchIds].map((branchId) => ({ branchId }))
      },
      roleMapping: { branchId: mapping.branchId },
      metadata: { relation: 'airflow states are defined on ventilation branches' }
    })
  };

  const report = makeReport();
  if (!rows.length) report.errors.push('Airflow state has no rows.');
  rows.forEach((row, index) => {
    if (!row.branch_id) report.errors.push(`Airflow row ${index + 1} is missing branch id.`);
    const parsedTime = Number.isFinite(Number(row.time)) ? Number(row.time) : Date.parse(row.time);
    if (!Number.isFinite(parsedTime)) report.errors.push(`Airflow row ${index + 1} has invalid time.`);
    if (!isFiniteNumber(row.air_quantity_m3s)) report.errors.push(`Airflow row ${index + 1} has invalid air quantity.`);
    if (row.direction_sign != null && row.direction_sign !== '' && ![-1, 0, 1].includes(Number(row.direction_sign))) {
      report.warnings.push(`Airflow row ${index + 1} has unusual direction_sign ${row.direction_sign}.`);
    }
  });
  report.summary = {
    rowCount: rows.length,
    branchCount: branchIds.size,
    timeRange
  };

  return new AirflowStateDataset({
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
