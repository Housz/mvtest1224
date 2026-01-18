import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions } from './core/nodes/DataNodes.js';
import { FunctionNodeDefinitions } from './core/functions/FunctionNodes.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { GraphModel } from './core/graph/GraphModel.js';
import { SceneManager } from './scene/SceneManager.js';
import { SensorList } from './ui/SensorList.js';
import { ChartManager } from './ui/ChartManager.js';
import { ColorLegend } from './ui/ColorLegend.js';
import { getDefaultStops } from './utils/colors.js';

const root = document.getElementById('preview-root');
root.innerHTML = `
  <div class="preview-root">
    <div id="scene-canvas" class="scene-full"></div>

    <div class="overlay nav-panel">
      <div class="panel-header">
        <div>
          <h3>MineVis Preview</h3>
          <div class="small">Business & Functions</div>
        </div>
        <button id="btn-reload">Reload</button>
      </div>
      <div class="nav-section">
        <div class="nav-title">Business</div>
        <ul id="biz-menu"><li class="active">Environment</li></ul>
      </div>
      <div class="nav-section">
        <div class="nav-title">Functions</div>
        <ul id="func-menu"></ul>
      </div>
    </div>

    <div class="function-ui hidden" data-func="SensorDetailFunction">
      <div id="chart-overlay" class="floating chart-box"></div>
      <div id="sensor-panel" class="floating side scrollable">
        <h4>Sensors</h4>
        <div id="sensor-list"></div>
        <label>Chart mode <select id="chart-mode"><option value="overlay">Overlay</option><option value="billboard">Billboard</option></select></label>
      </div>
    </div>

    <div class="function-ui hidden" data-func="RoadwayTempSnapshotFunction">
      <div id="controls-overlay" class="floating controls">
        <h4>Snapshot Controls</h4>
        <label>Time t0 <input type="range" id="time-slider" min="0" max="100" value="0" /></label>
        <label>Color map <select id="colormap"><option value="rainbow">Rainbow</option><option value="viridis">Viridis</option><option value="heat">Heat</option></select></label>
        <div class="color-pickers">
          <label>Start <input type="color" id="color-start" value="#2c7bb6" /></label>
          <label>End <input type="color" id="color-end" value="#f9d057" /></label>
        </div>
        <label>Min<input id="min" type="number" value="18" step="0.5" /></label>
        <label>Max<input id="max" type="number" value="38" step="0.5" /></label>
        <div class="legend"><div class="bar"></div><div class="small">min <span class="min">0</span> / max <span class="max">1</span></div></div>
      </div>
    </div>
  </div>
`;

const definitionRegistry = new NodeDefinitionRegistry();
[...DataNodeDefinitions, ...FunctionNodeDefinitions].forEach((d) => definitionRegistry.register(d));
const dataRegistry = new DataRegistry();

function loadGraph(graphJson) {
  const graph = new GraphModel(definitionRegistry);
  if (graphJson) graph.load(graphJson);
  else {
    const topo = graph.createNode('DataNode', { x: 80, y: 80 });
    topo.params.contractId = 'RoadwayTopology';
    topo.params.source.path = '/data/roadwayTopo.json';
    topo.runtime.updateFacets(topo);
    const registry = graph.createNode('DataNode', { x: 80, y: 240 });
    registry.params.contractId = 'SensorStationRegistry';
    registry.params.source.path = '/data/tempSensors.csv';
    registry.runtime.updateFacets(registry);
    const readings = graph.createNode('DataNode', { x: 320, y: 240 });
    readings.params.contractId = 'SensorReadingTimeSeries';
    readings.params.source.path = '/data/tempReadings.csv';
    readings.bindings = { sensor_id: registry.id };
    readings.runtime.updateFacets(readings);
    const fnDetail = graph.createNode('SensorDetailFunction', { x: 520, y: 150 });
    const fnSnapshot = graph.createNode('RoadwayTempSnapshotFunction', { x: 520, y: 320 });
    graph.connect({ nodeId: topo.id, portId: 'facet-graph' }, { nodeId: fnSnapshot.id, portId: 'roadwayTopo' });
    graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: fnDetail.id, portId: 'sensorRegistry' });
    graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: fnSnapshot.id, portId: 'sensorRegistry' });
    graph.connect({ nodeId: readings.id, portId: 'facet-series' }, { nodeId: fnDetail.id, portId: 'tempReadings' });
    graph.connect({ nodeId: readings.id, portId: 'facet-snapshot' }, { nodeId: fnSnapshot.id, portId: 'tempReadings' });
  }
  return graph;
}

async function bootstrap(graphJson) {
  const graph = loadGraph(graphJson);
  const results = {};
  const findSource = (nodeId, portId) => {
    const edge = graph.edges.find((e) => e.to.nodeId === nodeId && e.to.portId === portId);
    if (!edge) return null;
    return results[edge.from.nodeId];
  };
  const resolvePortValue = (nodeId, portId) => {
    const edge = graph.edges.find((e) => e.to.nodeId === nodeId && e.to.portId === portId);
    if (!edge) return null;
    const fromNode = graph.nodes.find((n) => n.id === edge.from.nodeId);
    const fromPort = fromNode?.ports.find((p) => p.id === edge.from.portId);
    const source = results[edge.from.nodeId];
    if (source?.resolveFacet && fromPort?.facetType) {
      return source.resolveFacet(fromPort.id.replace('facet-', ''));
    }
    return source;
  };

  const pending = graph.nodes.filter((n) => n.kind === 'data');
  let guard = 0;
  while (pending.length && guard < 50) {
    const node = pending.shift();
    const incoming = graph.edges.filter((e) => e.to.nodeId === node.id);
    const bindingDeps = Object.values(node.bindings || {});
    const ready = incoming.every((e) => results[e.from.nodeId]) && bindingDeps.every((b) => !b || results[b]);
    if (!ready) {
      pending.push(node);
      guard++;
      continue;
    }
    const context = {};
    node.ports
      .filter((p) => p.direction === 'in')
      .forEach((p) => {
        const val = resolvePortValue(node.id, p.id);
        if (val !== undefined) context[p.id] = val;
      });
    const output = await node.runtime.execute(dataRegistry, node, context, (bindingNodeId) => results[bindingNodeId]);
    results[node.id] = output;
  }
  
  const topoNode = graph.nodes.find((n) => n.params?.contractId === 'RoadwayTopology');
  const registryNode = graph.nodes.find((n) => n.params?.contractId === 'SensorStationRegistry');
  const readingsNode = graph.nodes.find((n) => n.params?.contractId === 'SensorReadingTimeSeries');
  const geometryNode = graph.nodes.find((n) => n.params?.contractId === 'RoadwayGeometry');
  const topoRes = topoNode ? results[topoNode.id] : null;
  const registryRes = registryNode ? results[registryNode.id] : null;
  const readingsRes = readingsNode ? results[readingsNode.id] : null;
  const geometryRes = geometryNode ? results[geometryNode.id] : null;
  const fieldRes = null;

  const topo = topoRes?.resolveFacet ? topoRes.resolveFacet('graph') : topoRes;
  const registry = registryRes?.resolveFacet ? registryRes.resolveFacet('registry') : registryRes || [];
  const readingsDataset = readingsRes?.resolveFacet ? readingsRes.resolveFacet('series') : readingsRes;
  const meshPartsMapping = geometryRes?.resolveFacet ? geometryRes.resolveFacet('meshParts') : [];

  const sceneContainer = document.querySelector('#scene-canvas');
  sceneContainer.innerHTML = '';
  const sceneManager = new SceneManager(sceneContainer);
  sceneManager.addLights();

  // [New Logic] Priority: Loaded Geometry > Topology Fallback
  if (geometryRes && (geometryRes.source?.path || geometryRes.objText)) {
    console.log('Loading roadway model. Type:', geometryRes.source.type);
    await sceneManager.loadRoadwayModel(geometryRes.source.path, geometryRes.objText, meshPartsMapping, topo);
  } else if (topo) {
    console.log('Building roadway from topology (fallback)');
    sceneManager.buildRoadway(topo);
  }

  if (registry) sceneManager.addSensors(registry);

  const sensorList = new SensorList(document.querySelector('#sensor-list'));
  sensorList.setSensors(registry);
  const chartManager = new ChartManager(document.querySelector('#chart-overlay'), sceneManager);
  chartManager.setVisible(false);
  const legend = new ColorLegend(document.querySelector('.legend'));
  const functionUIs = Array.from(document.querySelectorAll('.function-ui'));
  const toggleFunctionUI = (typeId) => {
    functionUIs.forEach((ui) => {
      ui.classList.toggle('hidden', ui.dataset.func !== typeId);
    });
    chartManager.setVisible(typeId === 'SensorDetailFunction');
  };

  const functions = graph.nodes.filter((n) => n.kind === 'function');
  const funcMenu = document.querySelector('#func-menu');
  funcMenu.innerHTML = '';
  let snapshotAttached = false;
  const resolveInput = (fnNode, portId) => {
    const edge = graph.edges.find((e) => e.to.nodeId === fnNode.id && e.to.portId === portId);
    if (!edge) return null;
    const fromNode = graph.nodes.find((n) => n.id === edge.from.nodeId);
    const fromPort = fromNode?.ports.find((p) => p.id === edge.from.portId);
    const source = results[edge.from.nodeId];
    if (source?.resolveFacet && fromPort?.facetType) {
      return source.resolveFacet(fromPort.id.replace('facet-', ''));
    }
    return source;
  };

  const isSatisfied = (fnNode) =>
    fnNode.ports
      .filter((p) => p.direction === 'in')
      .every((p) => graph.edges.some((e) => e.to.nodeId === fnNode.id && e.to.portId === p.id));

  for (const fn of functions.filter(isSatisfied)) {
    const li = document.createElement('li');
    li.textContent = fn.label;
    li.addEventListener('click', () => {
      funcMenu.querySelectorAll('li').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      toggleFunctionUI(fn.typeId);
      const inputTopo = resolveInput(fn, 'roadwayTopo') || topo;
      const inputMesh = resolveInput(fn, 'roadwayMesh'); 
      const inputRegistry = resolveInput(fn, 'sensorRegistry') || registry;
      const inputReadings = resolveInput(fn, 'tempReadings') || readingsDataset;
      
      if (fn.typeId === 'SensorDetailFunction') {
        fn.runtime.attach(sceneManager, chartManager, sensorList, inputReadings, inputMesh);
        sensorList.selectFirst();
      }
      if (fn.typeId === 'RoadwayTempSnapshotFunction') {
        const snap = fn.runtime.attach(sceneManager, legend, inputReadings, inputTopo, inputRegistry, inputMesh);
        if (!snap || !inputReadings?.readings?.length) return;
        snapshotAttached = true;
        const times = inputReadings.readings.map((r) => r.time);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const timeSlider = document.querySelector('#time-slider');
        const colormapSel = document.querySelector('#colormap');
        const colorStart = document.querySelector('#color-start');
        const colorEnd = document.querySelector('#color-end');
        const minInput = document.querySelector('#min');
        const maxInput = document.querySelector('#max');
        const wiring = () => {
          const defaults = getDefaultStops(colormapSel.value);
          if (defaults?.length >= 2) {
            colorStart.value = defaults[0].color;
            colorEnd.value = defaults[defaults.length - 1].color;
            snap.operators.color.setCustomForCurrent([
              { stop: 0, color: colorStart.value },
              { stop: 1, color: colorEnd.value }
            ]);
          }
          timeSlider.min = minTime;
          timeSlider.max = maxTime;
          timeSlider.value = minTime;
          const apply = (v) => snap.applySnapshot(Number(v));
          timeSlider.oninput = (e) => apply(e.target.value);
          colormapSel.onchange = (e) => {
            snap.operators.color.setMap(e.target.value);
            const defaults = getDefaultStops(e.target.value);
            if (defaults?.length >= 2) {
              colorStart.value = defaults[0].color;
              colorEnd.value = defaults[defaults.length - 1].color;
            }
            snap.operators.color.setCustomForCurrent([
              { stop: 0, color: colorStart.value },
              { stop: 1, color: colorEnd.value }
            ]);
            apply(timeSlider.value);
          };
          const applyCustom = () => {
            snap.operators.color.setCustomForCurrent([
              { stop: 0, color: colorStart.value },
              { stop: 1, color: colorEnd.value }
            ]);
            apply(timeSlider.value);
          };
          colorStart.onchange = applyCustom;
          colorEnd.onchange = applyCustom;
          const updateRange = () => {
            snap.operators.color.setRange(Number(minInput.value), Number(maxInput.value));
            apply(timeSlider.value);
          };
          minInput.onchange = updateRange;
          maxInput.onchange = updateRange;
          apply(minTime);
        };
        wiring();
      }
    });
    funcMenu.appendChild(li);
  }
  const snapshotEntry = Array.from(funcMenu.children).find((li) => li.textContent === 'Roadway Temp Snapshot');
  const first = snapshotEntry || funcMenu.firstChild;
  if (first) first.dispatchEvent(new Event('click'));

  // No function fallback; require function nodes to drive UI/field coloring
}

let bootstrapped = false;
const start = (payload) => {
  if (bootstrapped) return;
  bootstrapped = true;
  bootstrap(payload);
};

window.addEventListener('message', (evt) => {
  if (evt.origin !== window.location.origin) return;
  if (evt.data?.type === 'minevis-graph') {
    start(evt.data.payload);
  }
});

setTimeout(() => start(null), 600);

document.getElementById('btn-reload').addEventListener('click', () => window.location.reload());
