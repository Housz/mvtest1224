export class SensorComparisonAdapter {
  constructor({ sensorRegistry, sensorReadings, sceneManager } = {}) {
    this.sensorRegistry = sensorRegistry;
    this.sensorReadings = sensorReadings;
    this.sceneManager = sceneManager;
  }

  listComparableEntities() {
    return (this.sensorRegistry?.listSensors?.() || []).map((sensor) => ({
      id: String(sensor.sensorID ?? sensor.id),
      label: sensor.name || sensor.label || String(sensor.sensorID ?? sensor.id),
      entity: sensor
    }));
  }

  getTimeSeries(entityId) {
    return this.sensorReadings?.getSeries?.(String(entityId)) || [];
  }

  getWorldAnchor(entityId) {
    return this.sceneManager?.getSensorObject?.(String(entityId))
      || this.sensorRegistry?.getSensorPosition?.(String(entityId))
      || null;
  }
}
