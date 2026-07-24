import { BranchAirflowTrendInspectionRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { BranchAirflowTrendInputRequirements } from '../contracts.js';

export const BranchAirflowTrendInspectionDefinition = defineOperator({
  RuntimeClass: BranchAirflowTrendInspectionRuntime,
  typeId: 'BranchAirflowTrendInspectionOperator',
  label: 'Branch Airflow Trend Inspection',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Temporal',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Temporal',
    auxiliaryTags: [
      'ventilation',
      'airflow-state',
      'branch',
      'time-series',
      'scene',
      'topology-view',
      'chart',
      'statistics',
      'selection-linked',
      'time-synchronized'
    ]
  },
  inputRequirements: BranchAirflowTrendInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    defaultVariable: 'airQuantity',
    availableVariables: ['airQuantity', 'velocity', 'pressureDrop'],
    timeWindowMode: 'all',
    showStatistics: true,
    showAnomalyMarkers: true,
    allowBranchSelector: true,
    syncWithWorkspaceTime: true,
    showDirection: true,
    showIntakeReturn: true,
    showFacilities: false,
    autoFocusOnSelection: true,
    chartPresentation: 'docked',
    comparisonLayout: 'auto',
    selectionMode: 'multiple',
    maxComparedItems: 8,
    worldChartScale: 1,
    worldChartOcclusion: 'depth-aware'
  },
  paramSchema: [
    { key: 'defaultVariable', label: 'Default variable', type: 'select', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { key: 'timeWindowMode', label: 'Time window', type: 'select', options: ['all', 'recent', 'custom'] },
    { key: 'showStatistics', label: 'Show statistics', type: 'boolean' },
    { key: 'showAnomalyMarkers', label: 'Show anomaly markers', type: 'boolean' },
    { key: 'allowBranchSelector', label: 'Allow branch selector', type: 'boolean' },
    { key: 'syncWithWorkspaceTime', label: 'Sync with workspace time', type: 'boolean' },
    { key: 'showDirection', label: 'Show direction', type: 'boolean' },
    { key: 'showIntakeReturn', label: 'Show intake / return', type: 'boolean' },
    { key: 'autoFocusOnSelection', label: 'Focus on selection', type: 'boolean' },
    { key: 'chartPresentation', label: 'Chart presentation', type: 'select', options: ['docked', 'scene-callout', 'world-billboard', 'world-plane'] },
    { key: 'comparisonLayout', label: 'Comparison layout', type: 'select', options: ['auto', 'superimposed', 'small-multiples'] },
    { key: 'selectionMode', label: 'Selection mode', type: 'select', options: ['single', 'multiple'] },
    { key: 'maxComparedItems', label: 'Max compared branches', type: 'number', min: 1, max: 8 },
    { key: 'worldChartScale', label: 'World chart scale', type: 'number', min: 0.25, max: 4 },
    { key: 'worldChartOcclusion', label: 'World chart occlusion', type: 'select', options: ['depth-aware', 'always-visible'] }
  ],
  inlineControls: [
    { type: 'select', key: 'defaultVariable', label: 'Variable', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { type: 'checkbox', key: 'showDirection', label: 'Direction' },
    { type: 'checkbox', key: 'showStatistics', label: 'Statistics' },
    { type: 'checkbox', key: 'syncWithWorkspaceTime', label: 'Sync time' },
    { type: 'select', key: 'chartPresentation', label: 'Chart', options: ['docked', 'scene-callout', 'world-billboard', 'world-plane'] },
    { type: 'select', key: 'comparisonLayout', label: 'Comparison', options: ['auto', 'superimposed', 'small-multiples'] }
  ],
});
