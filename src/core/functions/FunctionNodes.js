import { PickSensorOperator, FocusCameraOperator, QuerySeriesOperator, SampleSnapshotOperator, HeatmapColorOperator } from '../operators/Operators.js';
import { buildHeatmapInput, diffuseNodeValues } from '../algorithms/FieldSolver.js';

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
          if (!dataset || !topo || !registry) return;
          const operators = {
            snapshot: new SampleSnapshotOperator(dataset),
            color: new HeatmapColorOperator(sceneManager)
          };
          const applySnapshot = (time) => {
            const snap = operators.snapshot.run(time, 20);
            const { nodes, connections, sensors } = buildHeatmapInput(topo, registry, snap);
            const { nodeVals } = diffuseNodeValues(nodes, connections, sensors, operators.color.min);
            operators.color.apply(connections, nodeVals, sensors);
            legend.update(operators.color.colormap, operators.color.min, operators.color.max);
          };
          return { applySnapshot, operators };
        }
      };
    }
  }
];
