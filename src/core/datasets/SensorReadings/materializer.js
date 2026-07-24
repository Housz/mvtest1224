import { SensorReadingsDataset } from '../SensorReadingsDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeSensorReadings({ contract, adaptorResults, roleMapping, sources, variable, unit = '', displayRange = null }) {
  const table = adaptorResults.readings || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const variablePath = rolePath(mapping, 'variableName', '');
  const unitPath = rolePath(mapping, 'unitName', '');
  const fixedVariable = variable || '';
  const rows = (table.rows || [])
    .map((row) => {
      const rowVariable = variablePath ? getPathValue(row, variablePath) : null;
      const rowUnit = unitPath ? getPathValue(row, unitPath) : null;
      return {
        ...row,
        sensorID: getPathValue(row, rolePath(mapping, 'observedEntity', 'sensorID')),
        time: getPathValue(row, rolePath(mapping, 'timestamp', 'time')),
        value: getPathValue(row, rolePath(mapping, 'measuredValue', 'value')),
        variable: rowVariable || fixedVariable,
        unit: rowUnit || unit
      };
    })
    .filter((row) => {
      if (!fixedVariable || !variablePath || !row.variable) return true;
      return String(row.variable).toLowerCase() === String(fixedVariable).toLowerCase();
    });
  const parsedRows = rows.map((row) => ({
    ...row,
    value: Number(row.value)
  }));

  const validTimes = parsedRows
    .map((row) => {
      const numeric = Number(row.time);
      return Number.isFinite(numeric) ? numeric : Date.parse(row.time);
    })
    .filter(Number.isFinite);
  const timeRange = validTimes.length ? { min: Math.min(...validTimes), max: Math.max(...validTimes) } : null;
  const validValues = parsedRows.map((row) => row.value).filter(Number.isFinite);
  const valueRange = validValues.length ? { min: Math.min(...validValues), max: Math.max(...validValues) } : null;

  const templates = {
    state: new StateTemplate({
      id: 'state',
      label: 'Sensor reading state',
      role: 'timeIndexedObservation',
      data: { rows: parsedRows },
      roleMapping: {
        observedEntity: mapping.observedEntity,
        timestamp: mapping.timestamp,
        measuredValue: mapping.measuredValue
      },
      metadata: {
        subjectRole: 'observedEntity',
        timeRole: 'timestamp',
        valueRole: 'measuredValue',
        variable: fixedVariable,
        unit,
        timeRange
      }
    }),
    readingOfSensor: new RelationTemplate({
      id: 'readingOfSensor',
      label: 'Reading of sensor',
      role: 'observationTargetRelation',
      data: {
        source: 'state.observedEntity',
        target: 'SensorRegistry.registry.sensorIdentity',
        rows: parsedRows.map((row) => ({ observedEntity: row.sensorID }))
      },
      roleMapping: { observedEntity: mapping.observedEntity },
      metadata: { relation: 'readings reference sensor registry identities' }
    })
  };

  const report = makeReport();
  if (!fixedVariable) report.errors.push('Sensor readings variable is not defined.');
  parsedRows.forEach((row, index) => {
    if (!row.sensorID) report.errors.push(`Reading row ${index + 1} is missing observed entity.`);
    const parsedTime = Number.isFinite(Number(row.time)) ? Number(row.time) : Date.parse(row.time);
    if (!Number.isFinite(parsedTime)) report.errors.push(`Reading row ${index + 1} has an invalid timestamp.`);
    if (!Number.isFinite(row.value)) report.errors.push(`Reading row ${index + 1} has a non-numeric value.`);
  });
  const subjectSet = new Set(parsedRows.map((row) => row.sensorID).filter(Boolean));
  if (!subjectSet.size) report.errors.push('Sensor readings series map would be empty.');
  report.summary = {
    rowCount: parsedRows.length,
    seriesCount: subjectSet.size,
    variable: fixedVariable,
    unit,
    timeRange,
    valueRange
  };

  return new SensorReadingsDataset({
    readings: parsedRows,
    source: { readingsPath: sources.readings?.path },
    readingsPath: sources.readings?.path,
    variable: fixedVariable,
    unit,
    displayRange,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
