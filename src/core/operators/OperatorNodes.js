import {
  QuerySeriesOperator,
  SampleSnapshotOperator,
  InterpolateOnRoadwayGraphOperator,
  PickSensorOperator,
  FocusCameraOperator
} from './Operators.js';

export const OperatorNodeDefinitions = [
  {
    typeId: 'SnapshotOperator',
    label: 'Snapshot (time → values)',
    kind: 'operator',
    defaultParams: { toleranceMinutes: 10, time: 0 },
    ports: [
      { id: 'series', name: 'time series', direction: 'in', type: 'SensorDataset' },
      { id: 'snapshot', name: 'snapshot', direction: 'out', type: 'SensorDataset' }
    ],
    createRuntime() {
      return {
        async execute(_registry, nodeModel, context) {
          const dataset = context.series;
          if (!dataset) return null;
          const op = new SampleSnapshotOperator(dataset);
          return op.run(nodeModel.params.time ?? Date.now(), nodeModel.params.toleranceMinutes ?? 10);
        }
      };
    }
  },
  {
    typeId: 'QuerySeriesOperator',
    label: 'Query Series',
    kind: 'operator',
    defaultParams: { sensorID: '' },
    ports: [
      { id: 'series', name: 'time series', direction: 'in', type: 'SensorDataset' },
      { id: 'sensorSeries', name: 'series out', direction: 'out', type: 'SensorSeries' }
    ],
    createRuntime() {
      return {
        async execute(_registry, nodeModel, context) {
          const dataset = context.series;
          if (!dataset) return null;
          const op = new QuerySeriesOperator(dataset);
          return op.run(nodeModel.params.sensorID || '', [-Infinity, Infinity]);
        }
      };
    }
  },
  {
    typeId: 'InterpolateFieldOperator',
    label: 'Interpolate Field',
    kind: 'operator',
    ports: [
      { id: 'topo', name: 'roadway topo', direction: 'in', type: 'RoadwayGraph' },
      { id: 'registry', name: 'sensor registry', direction: 'in', type: 'SensorRegistry' },
      { id: 'snapshot', name: 'snapshot', direction: 'in', type: 'SensorDataset' },
      { id: 'field', name: 'field', direction: 'out', type: 'RoadwayField' }
    ],
    createRuntime() {
      return {
        async execute(_registry, _nodeModel, context) {
          const topo = context.topo;
          const registry = context.registry;
          const snap = context.snapshot;
          if (!topo || !registry || !snap) return null;
          const op = new InterpolateOnRoadwayGraphOperator(topo);
          const obs = registry
            .map((s) => ({ nodeId: s.roadwayID, value: snap.get(s.sensorID) }))
            .filter((o) => o.value !== undefined && o.value !== null && !Number.isNaN(o.value));
          return op.run(obs);
        }
      };
    }
  },
  {
    typeId: 'SensorDetailOperator',
    label: 'Sensor Detail (op)',
    kind: 'operator',
    ports: [
      { id: 'roadwayMesh', name: 'roadway mesh', direction: 'in', type: 'RoadwayMeshParts' },
      { id: 'sensorRegistry', name: 'sensor registry', direction: 'in', type: 'SensorRegistry' },
      { id: 'tempReadings', name: 'readings', direction: 'in', type: 'SensorDataset' },
      { id: 'detail', name: 'detail', direction: 'out', type: 'SensorDetailHandle' }
    ],
    createRuntime() {
      return {
        async execute(_registry, nodeModel, context) {
          const dataset = context.tempReadings;
          const registry = context.sensorRegistry;
          if (!dataset || !registry) return null;
          return {
            attach(sceneManager, chartManager, sensorList) {
              const operators = {
                pick: new PickSensorOperator(sceneManager),
                focus: new FocusCameraOperator(sceneManager),
                series: new QuerySeriesOperator(dataset)
              };
              const handleSelect = (sensorID) => {
                const obj = operators.pick.pickById(sensorID);
                if (obj) operators.focus.focusOn(obj);
                const series = operators.series.run(sensorID);
                chartManager.updateSeries(sensorID, series);
              };
              sensorList.setSensors(registry);
              sensorList.onSelect = handleSelect;
              sceneManager.onSensorPick = handleSelect;
              sensorList.selectFirst();
              return true;
            }
          };
        }
      };
    }
  }
];
