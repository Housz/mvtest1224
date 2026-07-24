import { contribution, interaction, operatorManifest } from './manifestUtils.js';

const ventilationContext = {
  consumes: ['selectedVentilationBranch', 'selectedVentilationFacility', 'activeAirflowVariable', 'timeCursor', 'selection', 'selectionSet', 'hoveredSelection'],
  publishes: ['selectedVentilationBranch', 'selectedVentilationFacility', 'activeAirflowVariable', 'timeCursor', 'selection', 'selectionSet', 'hoveredSelection']
};

const overview = operatorManifest({
  context: ventilationContext,
  processing: {
    processorId: 'ventilation.network-overview',
    inputs: ['roadway', 'ventilationNetwork'],
    result: 'ventilationNetworkView'
  },
  contributions: [
    contribution('ventilation-network-layer', 'main-3d-scene', 'layer', 'structure', 'ventilationNetwork', {
      color: 'branchType',
      line: 'networkBranch'
    }),
    contribution('ventilation-drawing-view', 'bottom-panel', 'panel', 'detail', 'ventilationNetwork'),
    contribution('ventilation-topology-view', 'topology-view', 'panel', 'detail', 'ventilationNetwork'),
    contribution('ventilation-network-controls', 'right-panel', 'control', 'control', 'ventilationNetwork'),
    contribution('ventilation-network-detail', 'right-panel', 'panel', 'detail', 'ventilationNetwork'),
    contribution('ventilation-network-legend', 'legend', 'legend', 'legend', 'ventilationNetwork', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction(
      'select-ventilation-object',
      'Select a network branch or facility across linked views.',
      ['pointer'],
      ['selectedVentilationBranch', 'selectedVentilationFacility', 'selection']
    )
  ]
});

const distribution = operatorManifest({
  context: ventilationContext,
  processing: {
    processorId: 'ventilation.airflow-distribution',
    inputs: ['roadway', 'ventilationNetwork', 'airflowState'],
    result: 'airflowDistribution'
  },
  contributions: [
    contribution('airflow-distribution-layer', 'main-3d-scene', 'layer', 'state', 'ventilationNetwork', {
      color: 'airflowVariable',
      width: 'airQuantity',
      direction: 'airflowDirection'
    }),
    contribution('airflow-distribution-view', 'bottom-panel', 'panel', 'detail', 'airflowState'),
    contribution('airflow-distribution-controls', 'right-panel', 'control', 'control', 'airflowState'),
    contribution('airflow-branch-detail', 'right-panel', 'panel', 'detail', 'airflowState'),
    contribution('airflow-distribution-legend', 'legend', 'legend', 'legend', 'airflowState', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction(
      'select-airflow-branch',
      'Select a ventilation branch and inspect its airflow state.',
      ['pointer'],
      ['selectedVentilationBranch', 'selection']
    ),
    interaction('change-airflow-time', 'Change the active airflow time.', ['timeCursor'], ['timeCursor'])
  ]
});

const trend = operatorManifest({
  context: ventilationContext,
  processing: {
    processorId: 'ventilation.branch-trend',
    inputs: ['ventilationNetwork', 'airflowState'],
    result: 'branchAirflowTrend'
  },
  contributions: [
    contribution('branch-airflow-trend-chart', 'bottom-panel', 'chart', 'detail', 'airflowState'),
    contribution('branch-airflow-trend-controls', 'right-panel', 'control', 'control', 'airflowState'),
    contribution('branch-airflow-trend-detail', 'right-panel', 'panel', 'detail', 'airflowState'),
    contribution('branch-airflow-trend-legend', 'legend', 'legend', 'legend', 'airflowState', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction(
      'select-trend-branch',
      'Select the branch represented by the trend chart.',
      ['pointer'],
      ['selectedVentilationBranch', 'selection']
    ),
    interaction('scrub-trend-time', 'Scrub the airflow time series.', ['pointer'], ['timeCursor'])
  ]
});

const anomaly = operatorManifest({
  context: ventilationContext,
  processing: {
    processorId: 'ventilation.anomaly-inspection',
    inputs: ['ventilationNetwork', 'airflowState'],
    result: 'ventilationAnomalies'
  },
  contributions: [
    contribution('ventilation-anomaly-layer', 'main-3d-scene', 'layer', 'diagnostic', 'ventilationNetwork', {
      color: 'anomalySeverity',
      halo: 'anomalyState'
    }),
    contribution('ventilation-anomaly-list', 'right-panel', 'panel', 'detail', 'ventilationNetwork'),
    contribution('ventilation-anomaly-controls', 'right-panel', 'control', 'control', 'ventilationNetwork'),
    contribution('ventilation-anomaly-summary', 'bottom-panel', 'panel', 'detail', 'ventilationNetwork'),
    contribution('ventilation-anomaly-legend', 'legend', 'legend', 'legend', 'ventilationNetwork', {}, {
      mergePolicy: 'replace'
    })
  ],
  interactions: [
    interaction(
      'select-ventilation-anomaly',
      'Select an anomalous branch from the scene or list.',
      ['pointer'],
      ['selectedVentilationBranch', 'selection']
    )
  ]
});

export const VentilationOperatorManifests = new Map([
  ['VentilationNetworkOverviewOperator', overview],
  ['AirflowDistributionAnalysisOperator', distribution],
  ['BranchAirflowTrendInspectionOperator', trend],
  ['VentilationAnomalyInspectionOperator', anomaly]
]);
