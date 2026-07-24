import { AirflowDistributionAnalysisRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { AirflowDistributionInputRequirements } from '../contracts.js';

export const AirflowDistributionAnalysisDefinition = defineOperator({
  RuntimeClass: AirflowDistributionAnalysisRuntime,
  typeId: 'AirflowDistributionAnalysisOperator',
  label: 'Airflow Distribution Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'ventilation',
      'airflow-state',
      'graph-supported-field',
      'spatial',
      'temporal',
      'scene',
      'topology-view',
      'chart',
      'legend',
      'time-synchronized',
      'selection-linked'
    ]
  },
  inputRequirements: AirflowDistributionInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    defaultVariable: 'velocity',
    displayMode: 'balanced',
    showDirection: true,
    showAnomalyHighlight: true,
    showPressureMarkers: false,
    showTopologyStateView: true,
    showBranchSummary: true,
    colormap: 'rainbow',
    minValue: null,
    maxValue: null,
    opacity: 0.85,
    timeToleranceMinutes: 60,
    chartPresentation: 'docked',
    comparisonLayout: 'auto',
    selectionMode: 'multiple',
    maxComparedItems: 8,
    worldChartScale: 1,
    worldChartOcclusion: 'depth-aware'
  },
  paramSchema: [
    { key: 'defaultVariable', label: 'Default variable', type: 'select', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { key: 'displayMode', label: 'Display mode', type: 'select', options: ['balanced', 'quantity-focused', 'velocity-focused', 'pressure-focused', 'direction-focused'] },
    { key: 'colormap', label: 'Color map', type: 'select', options: ['rainbow', 'viridis', 'heat'] },
    { key: 'minValue', label: 'Min value', type: 'number' },
    { key: 'maxValue', label: 'Max value', type: 'number' },
    { key: 'opacity', label: 'Overlay opacity', type: 'number' },
    { key: 'timeToleranceMinutes', label: 'Time tolerance minutes', type: 'number' },
    { key: 'showDirection', label: 'Show direction', type: 'boolean' },
    { key: 'showAnomalyHighlight', label: 'Show anomaly highlight', type: 'boolean' },
    { key: 'showPressureMarkers', label: 'Show pressure markers', type: 'boolean' },
    { key: 'chartPresentation', label: 'Chart presentation', type: 'select', options: ['docked', 'scene-callout', 'world-billboard', 'world-plane'] },
    { key: 'comparisonLayout', label: 'Comparison layout', type: 'select', options: ['auto', 'superimposed', 'small-multiples'] },
    { key: 'selectionMode', label: 'Selection mode', type: 'select', options: ['single', 'multiple'] },
    { key: 'maxComparedItems', label: 'Max compared branches', type: 'number', min: 1, max: 8 },
    { key: 'worldChartScale', label: 'World chart scale', type: 'number', min: 0.25, max: 4 },
    { key: 'worldChartOcclusion', label: 'World chart occlusion', type: 'select', options: ['depth-aware', 'always-visible'] }
  ],
  inlineControls: [
    { type: 'select', key: 'defaultVariable', label: 'Variable', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { type: 'colormap', key: 'colormap', label: 'Color map', options: ['rainbow', 'viridis', 'heat'] },
    { type: 'checkbox', key: 'showDirection', label: 'Show direction' },
    { type: 'checkbox', key: 'showAnomalyHighlight', label: 'Show anomaly' },
    { type: 'select', key: 'chartPresentation', label: 'Chart', options: ['docked', 'scene-callout', 'world-billboard', 'world-plane'] },
    { type: 'select', key: 'comparisonLayout', label: 'Comparison', options: ['auto', 'superimposed', 'small-multiples'] }
  ],
});
