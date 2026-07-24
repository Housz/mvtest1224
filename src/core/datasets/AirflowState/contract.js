import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const AirflowStateContract = defineSemanticContract({
    id: 'AirflowStateContract',
    class: 'AirflowState',
    taxonomyClass: 'Ventilation & Utility Network',
    label: 'Airflow State',
    description: 'Time-indexed airflow states defined on ventilation branches.',
    requiredTemplates: ['State', 'Field', 'Relation'],
    roles: [
      role('branchId', 'Ventilation branch', 'Ventilation branch referenced by each state row.', true, 'string', 'branch_id', [
        'branch_id',
        'branchId',
        'branchID',
        'id'
      ]),
      role('timestamp', 'State time', 'Time of each airflow state row.', true, 'datetime', 'time', ['time', 'timestamp', 't', 'step']),
      role('airQuantity', 'Air quantity', 'Branch air quantity in m3/s.', true, 'number', 'air_quantity_m3s', [
        'air_quantity_m3s',
        'airQuantity',
        'Q',
        'flow',
        'airflow'
      ]),
      role('velocity', 'Velocity', 'Branch airflow velocity.', false, 'number', 'velocity_ms', [
        'velocity_ms',
        'velocity',
        'v',
        'air_velocity'
      ]),
      role('pressureDrop', 'Pressure drop', 'Branch pressure drop.', false, 'number', 'pressure_drop_pa', [
        'pressure_drop_pa',
        'pressureDrop',
        'deltaP',
        'dp'
      ]),
      role('pressureFrom', 'From pressure', 'Pressure at branch from node.', false, 'number', 'pressure_from_pa', [
        'pressure_from_pa',
        'pressureFrom',
        'p_from'
      ]),
      role('pressureTo', 'To pressure', 'Pressure at branch to node.', false, 'number', 'pressure_to_pa', [
        'pressure_to_pa',
        'pressureTo',
        'p_to'
      ]),
      role('directionSign', 'Direction sign', 'Direction sign relative to nominal direction.', false, 'number', 'direction_sign', [
        'direction_sign',
        'directionSign',
        'sign'
      ]),
      role('direction', 'Direction', 'Actual airflow direction.', false, 'string', 'direction', ['direction']),
      role('anomalyType', 'Anomaly type', 'Airflow anomaly label.', false, 'string', 'anomaly_type', [
        'anomaly_type',
        'anomalyType'
      ]),
      role('scenarioId', 'Scenario id', 'Scenario identifier.', false, 'string', 'scenario_id', ['scenario_id', 'scenarioId'])
    ],
    constraints: [
      'Airflow state rows must reference branch ids.',
      'Time values should be parseable.',
      'Air quantity values should be numeric.',
      'Rows should be non-empty.'
    ]
  });
