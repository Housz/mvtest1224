import { VentilationNetworkOverviewRuntime } from './runtime.js';
import { defineOperator } from '../../shared/OperatorDefinitionFactory.js';
import { VentilationNetworkOverviewInputRequirements } from '../contracts.js';

export const VentilationNetworkOverviewDefinition = defineOperator({
  RuntimeClass: VentilationNetworkOverviewRuntime,
  typeId: 'VentilationNetworkOverviewOperator',
  label: 'Ventilation Network Overview',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'ventilation',
      'overview',
      'spatial-reference',
      'scene',
      'topology-view',
      'facility',
      'selection-linked'
    ]
  },
  inputRequirements: VentilationNetworkOverviewInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    showFacilities: true,
    showDirection: true,
    showIntakeReturn: true,
    branchColorMode: 'type',
    branchColormap: 'viridis',
    autoFocusOnSelection: true
  },
  paramSchema: [
    { key: 'showFacilities', label: 'Show facilities', type: 'boolean' },
    { key: 'showDirection', label: 'Show direction', type: 'boolean' },
    { key: 'showIntakeReturn', label: 'Show intake / return', type: 'boolean' },
    {
      key: 'branchColorMode',
      label: 'Branch color',
      type: 'select',
      options: ['type', 'designAirQuantity', 'pressureDrop', 'resistance', 'area', 'uniform']
    },
    { key: 'branchColormap', label: 'Color map', type: 'select', options: ['viridis', 'rainbow', 'heat'] },
    { key: 'autoFocusOnSelection', label: 'Focus on selection', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'checkbox', key: 'showDirection', label: 'Show direction' },
    { type: 'checkbox', key: 'showFacilities', label: 'Show facilities' },
    { type: 'checkbox', key: 'showIntakeReturn', label: 'Show intake / return' }
  ],
});
