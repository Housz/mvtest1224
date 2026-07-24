import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const SensorReadingsContract = defineSemanticContract({
    id: 'SensorReadingsContract',
    class: 'EnvironmentalSensorReadings',
    taxonomyClass: 'Monitoring & Sensing',
    label: 'Environmental Sensor Readings',
    description: 'Time-indexed environmental sensor observations such as temperature, CO, humidity, or CH4.',
    requiredTemplates: ['State', 'Relation'],
    roles: [
      role('observedEntity', 'Observed sensor', 'Sensor identity referenced by each reading.', true, 'string', 'sensorID', [
        'sensorID',
        'sensor_id',
        'sensorId',
        'station_code'
      ]),
      role('timestamp', 'Observation time', 'Observation time for each reading.', true, 'datetime', 'time', [
        'time',
        'timestamp',
        'record_time',
        'Time'
      ]),
      role('measuredValue', 'Measured value', 'Numeric environmental value.', true, 'number', 'value', [
        'value',
        'temperature',
        'temp',
        'CO',
        'co',
        'humidity',
        'rh',
        'CH4',
        'ch4',
        'methane'
      ]),
      role('variableName', 'Variable field', 'Optional field that names the measured variable in long-form tables.', false, 'string', 'variable', [
        'variable',
        'measurement',
        'variableName',
        'type'
      ]),
      role('unitName', 'Unit field', 'Optional field that provides the measurement unit.', false, 'string', 'unit', [
        'unit',
        'units'
      ])
    ],
    constraints: [
      'Observed entity must be present for each reading.',
      'Timestamp values should be parseable.',
      'Measured values must be numeric.',
      'The materialized series map must be non-empty.',
      'A measured variable should be declared by preset, parameter, or source field.'
    ]
  });
