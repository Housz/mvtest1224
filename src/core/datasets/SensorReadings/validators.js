export const SensorReadingsDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'sensor-readings-non-empty',
    severity: 'error',
    description: 'Sensor Readings must contain at least one sensor series.',
    validate(dataset) {
      if (Boolean(dataset?.listSensorIDs?.().length)) return true;
      return {
        message: 'Sensor Readings must contain at least one sensor series.',
        path: 'templates'
      };
    }
  })
]);
