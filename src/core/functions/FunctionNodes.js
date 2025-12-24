import {
  PickSensorOperator,
  FocusCameraOperator,
  QuerySeriesOperator,
  SampleSnapshotOperator,
  InterpolateOnRoadwayGraphOperator,
  MapFieldToMeshOperator,
  ColorEncodeMeshOperator
} from '../operators/Operators.js';

export const FunctionNodeDefinitions = [
  {
    typeId: 'SensorDetailFunction',
    label: 'Sensor Detail',
    kind: 'function',
    ports: [
      { id: 'roadwayMesh', name: 'roadway mesh', direction: 'in', type: 'RoadwayMeshParts' },
      { id: 'sensorRegistry', name: 'sensor registry', direction: 'in', type: 'SensorRegistry' },
      { id: 'tempReadings', name: 'readings', direction: 'in', type: 'SensorDataset' }
    ],
    createRuntime() {
      return {
        attach(sceneManager, chartManager, sensorList, dataset) {
          if (!dataset || !dataset.readings?.length) return;
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
          sensorList.onSelect = handleSelect;
          sceneManager.onSensorPick = handleSelect;
        }
      };
    }
  },
  {
    typeId: 'RoadwayTempSnapshotFunction',
    label: 'Roadway Temp Snapshot',
    kind: 'function',
    ports: [
      { id: 'roadwayTopo', name: 'topology', direction: 'in', type: 'RoadwayGraph' },
      { id: 'roadwayMesh', name: 'mesh', direction: 'in', type: 'RoadwayMeshParts' },
      { id: 'sensorRegistry', name: 'sensor registry', direction: 'in', type: 'SensorRegistry' },
      { id: 'tempReadings', name: 'readings', direction: 'in', type: 'SensorDataset' }
    ],
    createRuntime() {
      return {
        attach(sceneManager, legend, dataset, topo, registry) {
          const operators = {
            snapshot: new SampleSnapshotOperator(dataset),
            interpolate: new InterpolateOnRoadwayGraphOperator(topo),
            map: new MapFieldToMeshOperator(sceneManager),
            color: new ColorEncodeMeshOperator(sceneManager)
          };
          const applySnapshot = (time) => {
            const snap = operators.snapshot.run(time, 20);
            const obs = registry
              .map((s) => ({ nodeId: s.roadwayID, value: snap.get(s.sensorID) }))
              .filter((o) => o.value !== undefined && o.value !== null && !Number.isNaN(o.value));
            const interpolated = operators.interpolate.run(obs);
            operators.map.apply(interpolated.edgeValues);
            operators.color.run(interpolated.edgeValues);
            legend.update(operators.color.colormap, operators.color.min, operators.color.max);
          };
          return { applySnapshot, operators };
        }
      };
    }
  }
];
