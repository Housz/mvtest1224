import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const SensorRegistryContract = defineSemanticContract({
    id: 'SensorRegistryContract',
    class: 'SensorRegistry',
    taxonomyClass: 'Monitoring & Sensing',
    label: 'Sensor Registry',
    description: 'A registry of monitoring sensors with identity, position, and mounting relation to roadways.',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    roles: [
      role('sensorIdentity', 'Sensor identity', 'Stable identity of each sensor.', true, 'string', 'sensorID'),
      role('sensorType', 'Sensor type', 'Sensor category or measured variable.', false, 'string', 'type'),
      role('positionX', 'Position X', 'Sensor position X coordinate.', true, 'number', 'x'),
      role('positionY', 'Position Y', 'Sensor position Y coordinate.', true, 'number', 'y'),
      role('positionZ', 'Position Z', 'Sensor position Z coordinate.', true, 'number', 'z'),
      role('roadwayAnchor', 'Roadway anchor', 'Roadway edge or node id on which the sensor is mounted.', false, 'string', 'roadwayID'),
      role('ratio', 'Roadway ratio', 'Relative position along the mounted roadway edge.', false, 'number', 'ratio')
    ],
    constraints: [
      'Sensor identities should be unique.',
      'Sensor point coordinates must be numeric.',
      'Missing roadway anchors are warnings because unmounted sensors can still be shown as points.'
    ]
  });
