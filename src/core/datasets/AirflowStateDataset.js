import { BaseSemanticDataset } from '../semantics/BaseSemanticDataset.js';

const toTimestamp = (value) => {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function normalizeRow(row) {
  return {
    ...row,
    branchId: String(row.branch_id ?? row.branchId ?? row.branchID ?? row.id ?? ''),
    time: row.time ?? row.timestamp ?? row.t ?? row.step ?? 0,
    timeValue: toTimestamp(row.time ?? row.timestamp ?? row.t ?? row.step ?? 0),
    airQuantity: Number(row.air_quantity_m3s ?? row.airQuantity ?? row.Q ?? row.flow ?? row.airflow),
    velocity: Number(row.velocity_ms ?? row.velocity ?? row.v ?? row.air_velocity),
    pressureDrop: Number(row.pressure_drop_pa ?? row.pressureDrop ?? row.deltaP ?? row.dp),
    pressureFrom: Number(row.pressure_from_pa ?? row.pressureFrom ?? row.p_from),
    pressureTo: Number(row.pressure_to_pa ?? row.pressureTo ?? row.p_to),
    directionSign: Number(row.direction_sign ?? row.directionSign ?? row.sign),
    direction: row.direction,
    anomalyType: row.anomaly_type ?? row.anomalyType ?? 'normal',
    scenarioId: row.scenario_id ?? row.scenarioId ?? 'default'
  };
}

function interpolateNumber(left, right, ratio) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * ratio;
  if (Number.isFinite(a)) return a;
  if (Number.isFinite(b)) return b;
  return NaN;
}

function nearestCategorical(left, right, ratio, key, fallback = '') {
  return ratio <= 0.5 ? left?.[key] ?? right?.[key] ?? fallback : right?.[key] ?? left?.[key] ?? fallback;
}

function interpolateState(left, right, target) {
  if (!left && !right) return null;
  if (!right || left?.timeValue === right?.timeValue) return { ...left, timeValue: target, time: target, interpolated: target !== left.timeValue };
  if (!left) return { ...right, timeValue: target, time: target, interpolated: target !== right.timeValue };
  const span = right.timeValue - left.timeValue;
  const ratio = span === 0 ? 0 : Math.max(0, Math.min(1, (target - left.timeValue) / span));
  const airQuantity = interpolateNumber(left.airQuantity, right.airQuantity, ratio);
  const directionSign = Number.isFinite(airQuantity)
    ? airQuantity < 0
      ? -1
      : 1
    : Math.sign(interpolateNumber(left.directionSign, right.directionSign, ratio)) || nearestCategorical(left, right, ratio, 'directionSign', 1);
  return {
    ...left,
    branchId: left.branchId,
    time: target,
    timeValue: target,
    airQuantity,
    velocity: interpolateNumber(left.velocity, right.velocity, ratio),
    pressureDrop: interpolateNumber(left.pressureDrop, right.pressureDrop, ratio),
    pressureFrom: interpolateNumber(left.pressureFrom, right.pressureFrom, ratio),
    pressureTo: interpolateNumber(left.pressureTo, right.pressureTo, ratio),
    directionSign,
    direction: directionSign < 0 ? 'to_from' : 'from_to',
    anomalyType:
      left.anomalyType === right.anomalyType
        ? left.anomalyType
        : nearestCategorical(left, right, ratio, 'anomalyType', 'normal'),
    scenarioId:
      left.scenarioId === right.scenarioId
        ? left.scenarioId
        : nearestCategorical(left, right, ratio, 'scenarioId', 'default'),
    interpolated: target !== left.timeValue && target !== right.timeValue,
    before: left,
    after: right
  };
}

export class AirflowStateDataset extends BaseSemanticDataset {
  constructor({
    rows = [],
    source = null,
    statePath = source?.statePath ?? null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    super({
      type: 'AirflowStateDataset',
      semanticClass: contract?.class ?? 'AirflowState',
      taxonomyId: 'ventilation',
      contract,
      templates,
      roleMapping,
      validation,
      adaptorResults,
      source: source ?? { statePath }
    });
    this.statePath = statePath;
    this.rows = rows.map(normalizeRow).filter((row) => row.branchId);
    this.seriesMap = new Map();
    this.rows.forEach((row) => {
      if (!this.seriesMap.has(row.branchId)) this.seriesMap.set(row.branchId, []);
      this.seriesMap.get(row.branchId).push(row);
    });
    this.seriesMap.forEach((series) => series.sort((a, b) => a.timeValue - b.timeValue));
  }

  listVariables() {
    return [
      'airQuantity',
      'velocity',
      'pressureDrop',
      'pressureFrom',
      'pressureTo',
      'directionSign',
      'direction',
      'anomalyType',
      'scenarioId'
    ];
  }

  listBranchIDs() {
    return [...this.seriesMap.keys()];
  }

  getTimeRange() {
    const values = this.rows.map((row) => row.timeValue).filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 0, times: [] };
    const times = [...new Set(values)].sort((a, b) => a - b);
    return { min: times[0], max: times[times.length - 1], times };
  }

  getSeries(branchId, variable = 'airQuantity', start = null, end = null) {
    const series = this.seriesMap.get(String(branchId)) ?? [];
    const startValue = start == null ? -Infinity : toTimestamp(start);
    const endValue = end == null ? Infinity : toTimestamp(end);
    return series
      .filter((row) => row.timeValue >= startValue && row.timeValue <= endValue)
      .map((row) => ({
        branchId: row.branchId,
        time: row.time,
        timeValue: row.timeValue,
        value: row[variable],
        airQuantity: row.airQuantity,
        velocity: row.velocity,
        pressureDrop: row.pressureDrop,
        pressureFrom: row.pressureFrom,
        pressureTo: row.pressureTo,
        directionSign: row.directionSign,
        direction: row.direction,
        anomalyType: row.anomalyType,
        scenarioId: row.scenarioId,
        row
      }));
  }

  getBranchState(branchId, time, tolerance = Infinity) {
    const target = toTimestamp(time);
    const toleranceValue = Number.isFinite(Number(tolerance)) ? Number(tolerance) : Infinity;
    const series = this.seriesMap.get(String(branchId)) ?? [];
    let before = null;
    let after = null;
    let best = null;
    let bestDistance = Infinity;
    series.forEach((row) => {
      const distance = Math.abs(row.timeValue - target);
      if (distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
      if (row.timeValue <= target) before = row;
      if (!after && row.timeValue >= target) after = row;
    });
    if (before && after) {
      const leftDistance = Math.abs(target - before.timeValue);
      const rightDistance = Math.abs(after.timeValue - target);
      if (Math.max(leftDistance, rightDistance) <= toleranceValue) {
        return interpolateState(before, after, target);
      }
    }
    return best && bestDistance <= toleranceValue ? { ...best, interpolated: false } : null;
  }

  getSnapshot(time, tolerance = Infinity) {
    const snapshot = new Map();
    this.seriesMap.forEach((series, branchId) => {
      const row = this.getBranchState(branchId, time, tolerance);
      if (row) snapshot.set(branchId, row);
    });
    return snapshot;
  }
}
