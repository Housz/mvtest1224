import { VentilationAnomalyInspectionRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { VentilationAnomalyInputRequirements } from '../contracts.js';

export const VentilationAnomalyInspectionDefinition = defineOperator({
  RuntimeClass: VentilationAnomalyInspectionRuntime,
  typeId: 'VentilationAnomalyInspectionOperator',
  label: 'Ventilation Anomaly Inspection',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'ventilation',
      'diagnostic',
      'anomaly',
      'threshold',
      'temporal',
      'summary',
      'selection-linked',
      'scene',
      'topology-view'
    ]
  },
  inputRequirements: VentilationAnomalyInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    lowAirQuantityThreshold: null,
    highVelocityThreshold: null,
    highPressureDropThreshold: null,
    lowAirQuantityRatio: 0.6,
    detectReverseFlow: true,
    detectMissingData: true,
    mode: 'currentTime',
    timeToleranceMinutes: 60,
    defaultSort: 'severity',
    showTimeline: true,
    show3DHighlight: true,
    showTopologyHighlight: true
  },
  paramSchema: [
    { key: 'lowAirQuantityThreshold', label: 'Low airflow threshold', type: 'number' },
    { key: 'lowAirQuantityRatio', label: 'Low airflow ratio', type: 'number' },
    { key: 'highVelocityThreshold', label: 'High velocity threshold', type: 'number' },
    { key: 'highPressureDropThreshold', label: 'High pressure drop threshold', type: 'number' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['currentTime', 'timeWindow'] },
    { key: 'timeToleranceMinutes', label: 'Time tolerance minutes', type: 'number' },
    { key: 'defaultSort', label: 'Default sort', type: 'select', options: ['severity', 'type', 'branchId', 'value'] },
    { key: 'detectReverseFlow', label: 'Detect reverse flow', type: 'boolean' },
    { key: 'detectMissingData', label: 'Detect missing data', type: 'boolean' },
    { key: 'showTimeline', label: 'Show timeline', type: 'boolean' },
    { key: 'show3DHighlight', label: 'Show 3D highlight', type: 'boolean' },
    { key: 'showTopologyHighlight', label: 'Show topology highlight', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'checkbox', key: 'detectReverseFlow', label: 'Reverse flow' },
    { type: 'checkbox', key: 'detectMissingData', label: 'Missing data' },
    { type: 'checkbox', key: 'show3DHighlight', label: '3D highlight' }
  ],
});
