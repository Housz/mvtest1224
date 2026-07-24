export const SensorRegistryDatasetValidators = Object.freeze([
  Object.freeze({
    id: 'sensor-registry-non-empty',
    severity: 'error',
    description: 'Sensor Registry must contain at least one sensor.',
    validate(dataset) {
      if (Boolean(dataset?.listSensors?.().length)) return true;
      return {
        message: 'Sensor Registry must contain at least one sensor.',
        path: 'templates'
      };
    }
  })
]);
