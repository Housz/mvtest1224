import { WaterInrushSimulationRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { WaterInrushSimulationInputRequirements } from '../contracts.js';

export const WaterInrushSimulationDefinition = defineOperator({
  RuntimeClass: WaterInrushSimulationRuntime,
  typeId: 'WaterInrushSimulationOperator',
  label: 'Water Inrush Simulation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Simulation',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Simulation',
    auxiliaryTags: [
      'emergency',
      'water-inrush',
      'scenario',
      'what-if',
      'roadway-hazard-state',
      'produces-dataset',
      'dataset-closure',
      'spatial',
      'temporal'
    ]
  },
  inputRequirements: WaterInrushSimulationInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'hazardState', name: 'Roadway Hazard State', direction: 'out', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sourceMode: 'pick',
    sourceEdgeId: null,
    sourceNodeId: null,
    sourceRatio: 0.5,
    startTime: 0,
    duration: 20,
    inflowMode: 'continuous',
    timeSteps: 30,
    timeInterval: 1,
    intensity: 1,
    inflowRate: 8,
    propagationSpeed: 1,
    depthGrowthRate: 1,
    decay: 0.15,
    cellLength: 10,
    roadwayWidth: 4,
    roadwayHeight: 3,
    conductanceScale: 1.2,
    leakageRate: 0,
    riskyDepthThreshold: 0.3,
    blockedDepthThreshold: 0.8,
    fullFlowRatio: 0.95,
    scenarioId: 'water_inrush_demo',
    autoRun: true
  },
  paramSchema: [
    { key: 'sourceMode', label: 'Source mode', type: 'select', options: ['pick', 'edge'] },
    { key: 'sourceEdgeId', label: 'Source edge', type: 'text' },
    { key: 'sourceRatio', label: 'Source ratio', type: 'number' },
    { key: 'startTime', label: 'Start time', type: 'number' },
    { key: 'inflowMode', label: 'Inflow mode', type: 'select', options: ['continuous', 'timed'] },
    { key: 'duration', label: 'Inflow duration', type: 'number' },
    { key: 'timeSteps', label: 'Time steps', type: 'number' },
    { key: 'timeInterval', label: 'Time interval', type: 'number' },
    { key: 'inflowRate', label: 'Inflow rate', type: 'number' },
    { key: 'intensity', label: 'Intensity', type: 'number' },
    { key: 'cellLength', label: 'Cell length', type: 'number' },
    { key: 'roadwayWidth', label: 'Roadway width', type: 'number' },
    { key: 'roadwayHeight', label: 'Roadway height', type: 'number' },
    { key: 'conductanceScale', label: 'Conductance', type: 'number' },
    { key: 'leakageRate', label: 'Leakage', type: 'number' },
    { key: 'riskyDepthThreshold', label: 'Risky threshold', type: 'number' },
    { key: 'blockedDepthThreshold', label: 'Blocked threshold', type: 'number' },
    { key: 'fullFlowRatio', label: 'Full flow ratio', type: 'number' },
    { key: 'autoRun', label: 'Auto run', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'text', key: 'sourceEdgeId', label: 'Source edge' },
    { type: 'checkbox', key: 'autoRun', label: 'Auto run' }
  ],
});
