import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions, seedDataNode } from './core/nodes/DataNodes.js';
import { FunctionNodeDefinitions } from './core/functions/FunctionNodes.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { GraphModel } from './core/graph/GraphModel.js';
import { NodeEditor } from './ui/NodeEditor.js';
import { Inspector } from './ui/Inspector.js';
import { ContractRegistry } from './core/contracts/ContractRegistry.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="layout" class="fill-layout">
    <header>
      <div>
        <h2>MineVis Editor</h2>
        <p class="small">Configure data contracts and function wiring, then open preview.</p>
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
[...DataNodeDefinitions, ...FunctionNodeDefinitions].forEach((d) => definitionRegistry.register(d));
const graph = new GraphModel(definitionRegistry);

function seedGraph() {
  const topo = graph.createNode('DataNode', { x: 80, y: 80 });
  topo.params = seedDataNode('RoadwayTopology', { path: '/data/roadwayTopo.json' });
  topo.runtime.updateFacets(topo);

  const registry = graph.createNode('DataNode', { x: 80, y: 260 });
  registry.params = seedDataNode('SensorStationRegistry', { path: '/data/tempSensors.csv' });
  registry.runtime.updateFacets(registry);

  const readings = graph.createNode('DataNode', { x: 360, y: 260 });
  readings.params = seedDataNode('SensorReadingTimeSeries', { path: '/data/tempReadings.csv' });
  readings.bindings = { sensor_id: registry.id };
  readings.runtime.updateFacets(readings);

  const fnDetail = graph.createNode('SensorDetailFunction', { x: 620, y: 180 });
  const fnSnapshot = graph.createNode('RoadwayTempSnapshotFunction', { x: 620, y: 340 });

  graph.connect({ nodeId: topo.id, portId: 'facet-graph' }, { nodeId: fnSnapshot.id, portId: 'roadwayTopo' });
  graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: fnDetail.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: fnSnapshot.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: readings.id, portId: 'facet-series' }, { nodeId: fnDetail.id, portId: 'tempReadings' });
  graph.connect({ nodeId: readings.id, portId: 'facet-snapshot' }, { nodeId: fnSnapshot.id, portId: 'tempReadings' });
}
seedGraph();

const editor = new NodeEditor(document.querySelector('#editor'), graph);
const inspector = new Inspector(document.querySelector('#inspector'));
editor.onSelect = (node) => inspector.showNode(node, ContractRegistry);
editor.onDelete = () => inspector.showNode(null);
editor.render();
window.minevisEditor = editor;

const palette = document.querySelector('#node-library');
const addButton = document.querySelector('#btn-add-node');
const grouped = {
  data: definitionRegistry.list().filter((d) => d.kind === 'data'),
  function: definitionRegistry.list().filter((d) => d.kind === 'function')
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
