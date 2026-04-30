import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions, seedDataNode } from './core/nodes/DataNodes.js';
import { OperatorNodeDefinitions } from './core/operators/OperatorNodes.js';
import { ModuleNodeDefinitions } from './core/modules/ModuleNodes.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { GraphModel } from './core/graph/GraphModel.js';
import { NodeEditor } from './ui/NodeEditor.js';
import { Inspector } from './ui/Inspector.js';
import { ContractRegistry } from './core/contracts/ContractRegistry.js';
import { getDefaultStops } from './utils/colors.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="layout" class="fill-layout">
    <header>
      <div>
        <h2>MineVis Editor</h2>
        <p class="small">Configure data contracts, operators, and modules, then open preview.</p>
      </div>
      <div class="actions">
        <div class="palette">
          <label>Add node
            <select id="node-library"></select>
          </label>
          <button id="btn-add-node">Add</button>
        </div>
        <button id="btn-save">Save graph.json</button>
        <button id="btn-open-preview">Open Preview Window</button>
      </div>
    </header>
    <main>
      <section id="editor" class="panel fill"></section>
      <section id="inspector" class="panel inspector-panel">
        <h3>Inspector</h3>
        <div class="node-config"></div>
      </section>
    </main>
  </div>
`;

const definitionRegistry = new NodeDefinitionRegistry();
[...DataNodeDefinitions, ...OperatorNodeDefinitions, ...ModuleNodeDefinitions].forEach((d) => definitionRegistry.register(d));
const graph = new GraphModel(definitionRegistry);

function seedGraph() {
  // Topology
  const topo = graph.createNode('DataNode', { x: 60, y: 60 });
  topo.params = seedDataNode('RoadwayTopology', { path: '/data/roadway_topo.json' });
  topo.runtime.updateFacets(topo);

  // Geometry (OBJ)
  const geometry = graph.createNode('DataNode', { x: 60, y: 220 });
  geometry.params = seedDataNode('RoadwayGeometry', { path: '/data/roadway_model.obj' });
  geometry.bindings = { topo_ref_id: topo.id };
  geometry.runtime.updateFacets(geometry);

  // Sensor registry (edge sensors with ratio)
  const registry = graph.createNode('DataNode', { x: 60, y: 380 });
  registry.params = seedDataNode('SensorStationRegistry', { path: '/data/temperature_sensors.csv' });
  registry.runtime.updateFacets(registry);

  // Sensor readings
  const readings = graph.createNode('DataNode', { x: 360, y: 380 });
  readings.params = seedDataNode('SensorReadingTimeSeries', { path: '/data/Temperature_timeseries_20steps.csv' });
  readings.bindings = { sensor_id: registry.id };
  readings.runtime.updateFacets(readings);

  // Operators
  const opDetail = graph.createNode('SensorDetailOperator', { x: 660, y: 220 });
  const opSnapshot = graph.createNode('RoadwaySnapshotOperator', { x: 660, y: 380 });

  // Module
  const moduleNode = graph.createNode('ModuleNode', { x: 980, y: 300 });

  // Wiring
  graph.connect({ nodeId: topo.id, portId: 'facet-graph' }, { nodeId: opSnapshot.id, portId: 'roadwayTopo' });
  graph.connect({ nodeId: geometry.id, portId: 'facet-meshParts' }, { nodeId: opSnapshot.id, portId: 'roadwayMesh' });
  graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: opDetail.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: opSnapshot.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: readings.id, portId: 'facet-series' }, { nodeId: opDetail.id, portId: 'tempReadings' });
  graph.connect({ nodeId: readings.id, portId: 'facet-snapshot' }, { nodeId: opSnapshot.id, portId: 'tempReadings' });

  const modulePorts = moduleNode.ports.map((p) => p.id);
  graph.connect({ nodeId: opDetail.id, portId: 'operator' }, { nodeId: moduleNode.id, portId: modulePorts[0] });
  graph.connect({ nodeId: opSnapshot.id, portId: 'operator' }, { nodeId: moduleNode.id, portId: modulePorts[1] });
}
seedGraph();

const editor = new NodeEditor(document.querySelector('#editor'), graph);
const inspector = new Inspector(document.querySelector('#inspector'));
editor.onSelect = (node) => inspector.showNode(node);
editor.onDelete = () => inspector.showNode(null);
editor.render();
window.minevisEditor = editor;
window.minevisDefaultStops = getDefaultStops;

const palette = document.querySelector('#node-library');
const addButton = document.querySelector('#btn-add-node');
const grouped = {
  data: definitionRegistry.list().filter((d) => d.kind === 'data'),
  operator: definitionRegistry.list().filter((d) => d.kind === 'operator'),
  module: definitionRegistry.list().filter((d) => d.kind === 'module')
};
palette.innerHTML = '';
for (const key of Object.keys(grouped)) {
  if (!grouped[key].length) continue;
  const optGroup = document.createElement('optgroup');
  optGroup.label = key.toUpperCase();
  grouped[key].forEach((def) => {
    const opt = document.createElement('option');
    opt.value = def.typeId;
    opt.textContent = def.label;
    optGroup.appendChild(opt);
  });
  palette.appendChild(optGroup);
}
addButton.addEventListener('click', () => {
  const typeId = palette.value;
  if (!typeId) return;
  const rect = document.querySelector('#editor').getBoundingClientRect();
  const world = editor.screenToWorld({ x: rect.width / 2, y: rect.height / 2 });
  const node = graph.createNode(typeId, { x: world.x, y: world.y });
  if (typeId === 'DataNode') node.runtime.updateFacets(node);
  editor.render();
});

document.querySelector('#btn-save').addEventListener('click', () => {
  const json = graph.serialize();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'graph.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.querySelector('#btn-open-preview').addEventListener('click', () => {
  const json = graph.serialize();
  const win = window.open('/preview.html', 'minevis-preview');
  const send = () => {
    try {
      win?.postMessage({ type: 'minevis-graph', payload: json }, window.location.origin);
    } catch (err) {
      console.warn('Failed to post graph to preview', err);
    }
  };
  if (win) {
    win.onload = send;
    setTimeout(send, 500);
  }
});

// expose for debugging
window.minevisGraph = graph;
window.minevisRegistry = new DataRegistry();
