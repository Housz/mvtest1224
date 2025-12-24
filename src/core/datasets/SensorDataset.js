export class SensorDataset {
  constructor(registryRows, readingsRows) {
    this.registry = registryRows || [];
    this.readings = readingsRows
      .map((r) => ({
        ...r,
        time: typeof r.time === 'string' ? new Date(r.time).getTime() : r.time
      }))
      .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.value));
    this.grouped = this.groupBySensor();
  }

  groupBySensor() {
    const map = new Map();
    for (const row of this.readings) {
      if (!map.has(row.sensorID)) map.set(row.sensorID, []);
      map.get(row.sensorID).push(row);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.time - b.time);
    }
    return map;
  }

  getSensor(sensorID) {
    return this.registry.find((s) => s.sensorID === sensorID);
  }

  getSeries(sensorID, start = -Infinity, end = Infinity) {
    const series = this.grouped.get(sensorID) || [];
    return series.filter((r) => r.time >= start && r.time <= end);
  }

  getSnapshot(time, toleranceMinutes = 10) {
    const toleranceMs = toleranceMinutes * 60 * 1000;
    const result = new Map();
    for (const [sensorID, series] of this.grouped.entries()) {
      let nearest = null;
      let best = Infinity;
      for (const r of series) {
        const d = Math.abs(r.time - time);
        if (d < best && d <= toleranceMs) {
          best = d;
          nearest = r;
        }
      }
      if (nearest) result.set(sensorID, nearest.value);
    }
    return result;
  }

  listSensors() {
    return this.registry;
  }
}
