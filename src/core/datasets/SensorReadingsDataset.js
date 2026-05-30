const toTimestamp = (value) => {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function normalizeReading(rawReading) {
  const sensorID =
    rawReading.sensor_id ??
    rawReading.sensorId ??
    rawReading.sensorID ??
    rawReading.id ??
    rawReading.sensor ??
    rawReading.SensorID;
  const time = rawReading.timestamp ?? rawReading.time ?? rawReading.t ?? rawReading.Time ?? rawReading.step ?? 0;
  const value = rawReading.value ?? rawReading.temperature ?? rawReading.Temperature ?? rawReading.temp;
  return {
    ...rawReading,
    sensorID: String(sensorID),
    time,
    timestamp: time,
    timeValue: toTimestamp(time),
    value: Number(value),
    variable: rawReading.variable,
    unit: rawReading.unit
  };
}

export class SensorReadingsDataset {
  constructor({
    readings = [],
    source = null,
    readingsPath = source?.readingsPath ?? null,
    variable = 'temperature',
    unit = '',
    displayRange = null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'SensorReadingsDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'SensorReadings';
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source ?? { readingsPath };
    this.readingsPath = readingsPath;
    this.variable = variable;
    this.unit = unit;
    this.displayRange = displayRange;
    this.rows = readings.map(normalizeReading).filter((row) => row.sensorID && Number.isFinite(row.value));
    this.seriesMap = new Map();
    this.rows.forEach((row) => {
      if (!this.seriesMap.has(row.sensorID)) this.seriesMap.set(row.sensorID, []);
      this.seriesMap.get(row.sensorID).push(row);
    });
    this.seriesMap.forEach((series) => series.sort((a, b) => a.timeValue - b.timeValue));
  }

  listSensorIDs() {
    return [...this.seriesMap.keys()];
  }

  getTimeRange() {
    const values = this.rows.map((row) => row.timeValue).filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 0, times: [] };
    const times = [...new Set(values)].sort((a, b) => a - b);
    return { min: times[0], max: times[times.length - 1], times };
  }

  getSeries(sensorID, start = null, end = null) {
    const series = this.seriesMap.get(String(sensorID)) ?? [];
    const startValue = start == null ? -Infinity : toTimestamp(start);
    const endValue = end == null ? Infinity : toTimestamp(end);
    return series
      .filter((row) => row.timeValue >= startValue && row.timeValue <= endValue)
      .map((row) => ({
        time: row.time,
        timestamp: row.timestamp,
        timeValue: row.timeValue,
        value: row.value,
        variable: row.variable ?? this.variable,
        unit: row.unit ?? this.unit
      }));
  }

  getSnapshot(time, tolerance = Infinity) {
    const target = toTimestamp(time);
    const toleranceValue = Number.isFinite(Number(tolerance)) ? Number(tolerance) : Infinity;
    const snapshot = new Map();
    this.seriesMap.forEach((series, sensorID) => {
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
          const span = after.timeValue - before.timeValue;
          const ratio = span === 0 ? 0 : (target - before.timeValue) / span;
          snapshot.set(sensorID, before.value + (after.value - before.value) * ratio);
        }
      } else if (best && bestDistance <= toleranceValue) {
        snapshot.set(sensorID, best.value);
      }
    });
    return snapshot;
  }
}
