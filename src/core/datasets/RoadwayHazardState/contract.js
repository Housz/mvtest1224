import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const RoadwayHazardStateContract = defineSemanticContract({
    id: 'RoadwayHazardStateContract',
    class: 'RoadwayHazardState',
    taxonomyClass: 'Safety, Hazard & Emergency',
    label: 'Roadway Hazard State',
    description: 'A derived time-indexed hazard state defined on roadway graph supports.',
    requiredTemplates: ['State', 'Field', 'Relation'],
    roles: [
      role('support', 'Roadway Support', 'Roadway support on which hazard values are defined.', true, 'string', 'roadwayEdgeId', [
        'roadwayEdgeId',
        'roadway_edge_id',
        'edgeId'
      ]),
      role('roadwayEdgeId', 'Roadway Edge ID', 'Roadway edge referenced by a hazard state row.', false, 'string', 'roadwayEdgeId', [
        'roadwayEdgeId',
        'roadway_edge_id',
        'edgeId'
      ]),
      role('roadwayNodeId', 'Roadway Node ID', 'Roadway node referenced by a hazard state row.', false, 'string', 'roadwayNodeId', [
        'roadwayNodeId',
        'roadway_node_id',
        'nodeId'
      ]),
      role('time', 'Time', 'Hazard state time.', true, 'datetime', 'time', ['time', 'timestamp', 't', 'step']),
      role('hazardType', 'Hazard Type', 'Hazard type such as water, smoke, fire, or gas.', true, 'string', 'hazard_type', [
        'hazardType',
        'hazard_type',
        'type'
      ]),
      role('hazardValue', 'Hazard Value', 'Numeric hazard intensity value.', true, 'number', 'hazard_value', [
        'hazardValue',
        'hazard_value',
        'value',
        'intensity'
      ]),
      role('severity', 'Severity', 'Categorical severity level.', false, 'string', 'severity', ['severity']),
      role('passability', 'Passability', 'Roadway passability status.', false, 'string', 'passability', ['passability']),
      role('arrivalTime', 'Arrival Time', 'Hazard arrival time on the support.', false, 'datetime', 'arrival_time', [
        'arrivalTime',
        'arrival_time'
      ]),
      role('scenarioId', 'Scenario ID', 'Scenario identifier.', false, 'string', 'scenario_id', [
        'scenarioId',
        'scenario_id'
      ])
    ],
    constraints: [
      'Time values must be valid.',
      'Hazard type must be defined.',
      'Hazard values must be numeric when provided.',
      'Hazard state should reference roadway edge or node.',
      'Passability should be passable, risky, or blocked when provided.'
    ]
  });
