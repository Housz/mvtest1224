import { QuerySeriesOperator } from './Operators.js';
import { SampleSnapshotOperator } from './Operators.js';
import { HeatmapColorOperator } from './Operators.js';
import { buildHeatmapInput, diffuseNodeValues } from '../algorithms/FieldSolver.js';
import { SensorList } from '../../ui/SensorList.js';
import { ChartManager } from '../../ui/ChartManager.js';
import { ColorLegend } from '../../ui/ColorLegend.js';
import { getDefaultStops } from '../../utils/colors.js';

export const OperatorNodeDefinitions = [
  {
    typeId: 'SensorDetailOperator',
    label: 'Sensor Detail',
    kind: 'operator',
    ports: [
      { id: 'sensorRegistry', name: 'sensor registry', direction: 'in', type: 'SensorRegistry' },
      { id: 'tempReadings', name: 'readings', direction: 'in', type: 'SensorDataset' },
      { id: 'operator', name: 'operator', direction: 'out', type: 'OperatorRef' }
    ],
    defaultParams: { chartMode: 'overlay' },
    paramSchema: [
      {
        key: 'chartMode',
        label: 'Chart mode',
        type: 'select',
        options: [
          { value: 'overlay', label: 'Overlay' },
          { value: 'billboard', label: 'Billboard' }
        ]
      }
    ],
    createRuntime() {
      return {
        createOperator(nodeModel, inputs) {
          const registry = inputs.sensorRegistry;
          const dataset = inputs.tempReadings;
          if (!registry || !dataset) return null;
          const seriesOp = new QuerySeriesOperator(dataset);
          let selection = null;
          let lastSeries = null;
          let chartManager = null;
          let sensorList = null;
          let selectionUnsub = null;
          let currentView = null;
          let sensorsVisible = true;

          const applySelection = (sensorID, sceneManager) => {
            if (!sensorID) return;
            selection = sensorID;
            if (sensorsVisible) {
              const obj = sceneManager.getSensorObject(sensorID);
              if (obj) {
                sceneManager.highlightSensor(obj);
                sceneManager.focusOn(obj);
              }
            }
            lastSeries = seriesOp.run(sensorID);
            if (chartManager && lastSeries) {
              chartManager.updateSeries(sensorID, lastSeries);
            }
          };
          return {
            id: nodeModel.id,
            typeId: nodeModel.typeId,
            label: nodeModel.label,
            outputs: {},
            attach({ sceneManager, context, viewRegistry }) {
              sceneManager.addSensors(registry);
              const view = viewRegistry.register({
                id: `${nodeModel.id}-sensors`,
                label: 'Sensors',
                ownerId: nodeModel.id,
                type: 'scene',
                show: () => {
                  sensorsVisible = true;
                  sceneManager.setSensorsVisible(true);
                },
                hide: () => {
                  sensorsVisible = false;
                  sceneManager.setSensorsVisible(false);
                  sceneManager.clearSensorHighlight();
                }
              });
              currentView = view;

              sceneManager.onSensorPick = (sensorID) => {
                context.set({ selection: sensorID });
              };

              selectionUnsub = context.subscribe((state) => {
                if (state.selection == null || state.selection === selection) return;
                applySelection(state.selection, sceneManager);
              });

              if (context.state.selection != null) {
                applySelection(context.state.selection, sceneManager);
              }

              return {
                views: [view],
                cleanup: () => {
                  if (currentView) viewRegistry.unregister(currentView.id);
                  currentView = null;
                  if (selectionUnsub) selectionUnsub();
                  sceneManager.onSensorPick = null;
                  sceneManager.clearSensorHighlight();
                }
              };
            },
            renderControls(container, env) {
              container.innerHTML = `
                <div class="control-section">
                  <h4>Sensor Detail</h4>
                  <label>Chart mode
                    <select data-role="chart-mode">
                      <option value="overlay">Overlay</option>
                      <option value="billboard">Billboard</option>
                    </select>
                  </label>
                </div>
                <div class="control-section">
                  <h5>Sensors</h5>
                  <div class="scroll-list" data-role="sensor-list"></div>
                </div>
                <div class="control-section">
                  <h5>Trend</h5>
                  <div class="chart-host" data-role="chart"></div>
                </div>
              `;
              const chartHost = container.querySelector('[data-role="chart"]');
              const listHost = container.querySelector('[data-role="sensor-list"]');
              const chartMode = container.querySelector('[data-role="chart-mode"]');

              if (chartHost) {
                chartManager = new ChartManager(chartHost, env.sceneManager);
                chartManager.setVisible(true);
                chartManager.setMode(nodeModel.params.chartMode || 'overlay');
                if (selection && lastSeries) chartManager.updateSeries(selection, lastSeries);
              }

              if (listHost) {
                sensorList = new SensorList(listHost);
                sensorList.setSensors(registry);
                sensorList.onSelect = (sensorID) => env.context.set({ selection: sensorID });
                if (env.context.state.selection == null) sensorList.selectFirst();
              }

              if (chartMode) {
                chartMode.value = nodeModel.params.chartMode || 'overlay';
                chartMode.onchange = (e) => {
                  nodeModel.params.chartMode = e.target.value;
                  if (chartManager) chartManager.setMode(nodeModel.params.chartMode);
                };
              }

              return () => {
                if (chartManager) chartManager.setVisible(false);
                container.innerHTML = '';
              };
            }
          };
        }
      };
    }
  },
  {
    typeId: 'RoadwaySnapshotOperator',
    label: 'Roadway Temp Snapshot',
    kind: 'operator',
    ports: [
      { id: 'roadwayTopo', name: 'topology', direction: 'in', type: 'RoadwayGraph' },
      { id: 'roadwayMesh', name: 'mesh', direction: 'in', type: 'RoadwayMeshParts' },
      { id: 'sensorRegistry', name: 'sensor registry', direction: 'in', type: 'SensorRegistry' },
      { id: 'tempReadings', name: 'readings', direction: 'in', type: 'SensorDataset' },
      { id: 'operator', name: 'operator', direction: 'out', type: 'OperatorRef' }
    ],
    defaultParams: { toleranceMinutes: 20, min: 18, max: 38, colormap: 'rainbow' },
    paramSchema: [
      { key: 'toleranceMinutes', label: 'Tolerance (min)', type: 'number', step: 1, min: 0 },
      { key: 'min', label: 'Min', type: 'number', step: 0.5 },
      { key: 'max', label: 'Max', type: 'number', step: 0.5 },
      {
        key: 'colormap',
        label: 'Color map',
        type: 'select',
        options: [
          { value: 'rainbow', label: 'Rainbow' },
          { value: 'viridis', label: 'Viridis' },
          { value: 'heat', label: 'Heat' }
        ]
      }
    ],
    createRuntime() {
      return {
        createOperator(nodeModel, inputs) {
          const topo = inputs.roadwayTopo;
          const registry = inputs.sensorRegistry;
          const dataset = inputs.tempReadings;
          if (!topo || !registry || !dataset) return null;
          const snapshotOp = new SampleSnapshotOperator(dataset);
          const colorOp = new HeatmapColorOperator();
          colorOp.setRange(nodeModel.params.min ?? 18, nodeModel.params.max ?? 38);
          colorOp.setMap(nodeModel.params.colormap || 'rainbow');
          let viewHandle = null;
          let timeUnsub = null;
          let isVisible = true;
          return {
            id: nodeModel.id,
            typeId: nodeModel.typeId,
            label: nodeModel.label,
            outputs: {},
            attach({ sceneManager, legend, context, viewRegistry }) {
              colorOp.sceneManager = sceneManager;

              const applySnapshot = (time) => {
                if (time == null) return;
                const snap = snapshotOp.run(time, nodeModel.params.toleranceMinutes ?? 20);
                const { nodes, connections, sensors } = buildHeatmapInput(topo, registry, snap);
                const { nodeVals } = diffuseNodeValues(nodes, connections, sensors, colorOp.min);
                colorOp.apply(connections, nodeVals, sensors);
                legend.update(colorOp.colormap, colorOp.min, colorOp.max);
              };

              viewHandle = viewRegistry.register({
                id: `${nodeModel.id}-heatmap`,
                label: 'Roadway Heatmap',
                ownerId: nodeModel.id,
                type: 'scene',
                show: () => {
                  isVisible = true;
                  applySnapshot(context.state.time);
                },
                hide: () => {
                  isVisible = false;
                  viewRegistry.resetScene();
                }
              });

              timeUnsub = context.subscribe((ctx) => {
                if (ctx.time != null && isVisible) applySnapshot(ctx.time);
              });

              if (context.state.time != null && isVisible) applySnapshot(context.state.time);

              return {
                views: [viewHandle],
                cleanup: () => {
                  if (viewHandle) viewRegistry.unregister(viewHandle.id);
                  viewHandle = null;
                  if (timeUnsub) timeUnsub();
                }
              };
            },
            renderControls(container, env) {
              const params = nodeModel.params;
              container.innerHTML = `
                <div class="control-section">
                  <h4>Snapshot Controls</h4>
                  <label>Time <input type="range" data-role="time" min="0" max="1" value="0" /></label>
                  <label>Color map
                    <select data-role="colormap">
                      <option value="rainbow">Rainbow</option>
                      <option value="viridis">Viridis</option>
                      <option value="heat">Heat</option>
                    </select>
                  </label>
                  <div class="color-pickers">
                    <label>Start <input type="color" data-role="color-start" value="#2c7bb6" /></label>
                    <label>End <input type="color" data-role="color-end" value="#f9d057" /></label>
                  </div>
                  <label>Min <input type="number" data-role="min" step="0.5" value="${params.min ?? 18}" /></label>
                  <label>Max <input type="number" data-role="max" step="0.5" value="${params.max ?? 38}" /></label>
                  <div class="legend">
                    <div class="bar"></div>
                    <div class="small">min <span class="min">0</span> / max <span class="max">1</span></div>
                  </div>
                </div>
              `;
              const timeSlider = container.querySelector('[data-role="time"]');
              const colormap = container.querySelector('[data-role="colormap"]');
              const colorStart = container.querySelector('[data-role="color-start"]');
              const colorEnd = container.querySelector('[data-role="color-end"]');
              const minInput = container.querySelector('[data-role="min"]');
              const maxInput = container.querySelector('[data-role="max"]');
              const legendHost = container.querySelector('.legend');
              if (env.legend && legendHost) {
                env.legend.instance = new ColorLegend(legendHost);
                env.legend.update = (...args) => env.legend.instance.update(...args);
              }

              const times = dataset.readings?.map((r) => r.time) || [];
              const minTime = times.length ? Math.min(...times) : 0;
              const maxTime = times.length ? Math.max(...times) : 1;
              timeSlider.min = minTime;
              timeSlider.max = maxTime;
              timeSlider.value = env.context.state.time ?? minTime;
              if (env.context.state.time == null) env.context.set({ time: minTime });

              colormap.value = params.colormap || 'rainbow';
              const applyDefaults = () => {
                const defaults = getDefaultStops(colormap.value);
                if (defaults?.length >= 2) {
                  colorStart.value = defaults[0].color;
                  colorEnd.value = defaults[defaults.length - 1].color;
                }
              };
              const updateRange = () => {
                params.min = Number(minInput.value);
                params.max = Number(maxInput.value);
                colorOp.setRange(params.min, params.max);
                env.context.set({ time: Number(timeSlider.value) });
              };
              const updateMap = () => {
                params.colormap = colormap.value;
                colorOp.setMap(params.colormap);
                colorOp.setCustomForCurrent([
                  { stop: 0, color: colorStart.value },
                  { stop: 1, color: colorEnd.value }
                ]);
                env.context.set({ time: Number(timeSlider.value) });
              };
              timeSlider.oninput = (e) => env.context.set({ time: Number(e.target.value) });
              colormap.onchange = () => {
                applyDefaults();
                updateMap();
              };
              colorStart.onchange = updateMap;
              colorEnd.onchange = updateMap;
              minInput.onchange = updateRange;
              maxInput.onchange = updateRange;
              applyDefaults();
              updateMap();
              updateRange();

              return () => {
                container.innerHTML = '';
              };
            }
          };
        }
      };
    }
  }
];
