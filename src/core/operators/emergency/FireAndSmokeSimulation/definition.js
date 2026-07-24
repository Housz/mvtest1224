import { FireAndSmokeSimulationRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { FireAndSmokeSimulationInputRequirements } from '../contracts.js';

export const FireAndSmokeSimulationDefinition = defineOperator({
  RuntimeClass: FireAndSmokeSimulationRuntime,
  typeId: 'FireAndSmokeSimulationOperator',
  label: 'Fire and Smoke Simulation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Simulation',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Simulation',
    auxiliaryTags: [
      'emergency',
      'fire',
      'smoke',
      'ventilation-coupled',
      'roadway-hazard-state',
      'temporal',
      'spatial',
      'produces-dataset',
      'what-if'
    ]
  },
  inputRequirements: FireAndSmokeSimulationInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset', optional: true },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset', optional: true },
    { id: 'hazardState', name: 'Roadway Hazard State', direction: 'out', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sourceEdgeId: null,
    sourceRatio: 0.5,
    ignitionTime: 0,
    simulationDuration: 1800,
    timeSteps: 60,
    timeInterval: 30,
    cellLength: 10,
    roadwayWidth: 4,
    roadwayHeight: 3,
    initialHeatRelease: 1,
    burnRate: 0.03,
    fuelLoad: 4,
    heatYield: 1,
    heatLossRate: 0.006,
    ignitionThreshold: 1,
    smokeYield: 1,
    coYield: 0.1,
    smokeDiffusion: 0.05,
    ventilationAdvectionScale: 1,
    ventilationDilutionScale: 0.2,
    airflowFireBoost: 0.5,
    riskyTempThreshold: 60,
    blockedTempThreshold: 120,
    riskySmokeThreshold: 0.25,
    blockedSmokeThreshold: 0.6,
    riskyVisibilityThreshold: 20,
    blockedVisibilityThreshold: 5,
    riskyCOThreshold: 50,
    blockedCOThreshold: 150,
    useVentilation: true,
    showFireLayer: true,
    showSmokeLayer: true,
    showRiskLayer: true,
    showSourceMarker: true,
    scenarioId: 'fire_smoke_demo',
    autoRun: true
  },
  paramSchema: [
    { key: 'sourceEdgeId', label: 'Source edge', type: 'text' },
    { key: 'sourceRatio', label: 'Source ratio', type: 'number' },
    { key: 'ignitionTime', label: 'Ignition time', type: 'number' },
    { key: 'timeSteps', label: 'Time steps', type: 'number' },
    { key: 'timeInterval', label: 'Time interval', type: 'number' },
    { key: 'fuelLoad', label: 'Fuel load', type: 'number' },
    { key: 'burnRate', label: 'Burn rate', type: 'number' },
    { key: 'smokeYield', label: 'Smoke yield', type: 'number' },
    { key: 'coYield', label: 'CO yield', type: 'number' },
    { key: 'useVentilation', label: 'Use ventilation', type: 'boolean' },
    { key: 'autoRun', label: 'Auto run', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'text', key: 'sourceEdgeId', label: 'Source edge' },
    { type: 'checkbox', key: 'useVentilation', label: 'Ventilation' },
    { type: 'checkbox', key: 'autoRun', label: 'Auto run' }
  ],
});
