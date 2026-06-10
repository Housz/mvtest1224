import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions } from './core/nodes/DataNodes.js';
import { OperatorNodeDefinitions } from './core/operators/OperatorNodes.js';
import { ModuleNodeDefinitions } from './core/modules/ModuleNodes.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { GraphModel } from './core/graph/GraphModel.js';
import { NodeEditor } from './ui/NodeEditor.js';
import { Inspector } from './ui/Inspector.js';
import { appPagePath } from './utils/appPath.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="layout" class="fill-layout">
    <header>
      <div>
        <h2>MineVis Editor</h2>
      </div>
      <div class="actions">
        <div class="quick-add">
          <label>Data
            <select id="add-data-node"></select>
          </label>
          <label>Operator
            <select id="add-operator-node"></select>
          </label>
          <button id="btn-add-module-node">Add module</button>
          <button id="btn-collapse-nodes" title="Collapse all nodes">Collapse nodes</button>
        </div>
        <button id="btn-save">Save graph.json</button>
        <button id="btn-load">Load graph.json</button>
        <input id="graph-file-input" type="file" accept=".json,application/json" hidden />
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

const DataCategories = [
  'Roadways & Infrastructure',
  'Geology & Resources',
  'Monitoring & Sensing',
  'Production & Operations',
  'Ventilation & Utility Network',
  'People & Vehicles',
  'Robots & Equipment',
  'Safety & Emergency'
];

const OperatorCategories = ['Spatial', 'Topological', 'Temporal', 'Simulation'];

const definitionRegistry = new NodeDefinitionRegistry();
[...DataNodeDefinitions, ...OperatorNodeDefinitions, ...ModuleNodeDefinitions].forEach((definition) =>
  definitionRegistry.register(definition)
);
const graph = new GraphModel(definitionRegistry);

function seedGraph() {
  const roadway = graph.createNode('RoadwayDataNode', { x: 70, y: 90 });
  const sensorRegistry = graph.createNode('SensorRegistryDataNode', { x: 70, y: 300 });
  const sensorReadings = graph.createNode('SensorReadingsDataNode', { x: 70, y: 510 });
  const operator = graph.createNode('RoadwayTemperatureAnalysisOperator', { x: 680, y: 280 });
  const moduleNode = graph.createNode('ModuleNode', { x: 1260, y: 310 });
  moduleNode.params.workspaceName = 'Monitoring Workspace';
  moduleNode.label = 'Monitoring Workspace';

  graph.connect({ nodeId: roadway.id, portId: 'dataset' }, { nodeId: operator.id, portId: 'roadway' });
  graph.connect({ nodeId: sensorRegistry.id, portId: 'dataset' }, { nodeId: operator.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: sensorReadings.id, portId: 'dataset' }, { nodeId: operator.id, portId: 'sensorReadings' });
  graph.connect({ nodeId: operator.id, portId: 'operator' }, { nodeId: moduleNode.id, portId: 'function-1' });
}

seedGraph();

const editor = new NodeEditor(document.querySelector('#editor'), graph);
const inspector = new Inspector(document.querySelector('#inspector'));
editor.onSelect = (node) => inspector.showNode(node);
editor.onDelete = () => inspector.showNode(null);
editor.onNodeChange = (node, options = {}) => {
  if (!node) return;
  if (options.refreshInspector !== false && inspector.currentNode?.id === node.id) {
    inspector.showNode(node);
  }
};
inspector.onNodeChange = (node, options = {}) => {
  editor.render();
  if (options.refreshInspector && node && inspector.currentNode?.id === node.id) {
    inspector.showNode(node);
  }
};
let graphRefreshQueued = false;
graph.subscribe(() => {
  if (graphRefreshQueued) return;
  graphRefreshQueued = true;
  queueMicrotask(() => {
    graphRefreshQueued = false;
    editor.render();
    const selected = graph.nodes.find((node) => node.id === editor.selectedNodeId);
    if (selected && inspector.currentNode?.id === selected.id) inspector.showNode(selected);
    if (!selected && inspector.currentNode) inspector.showNode(null);
  });
});
editor.render();

const definitions = definitionRegistry.list();
const dataDefinitions = definitions.filter((definition) => definition.kind === 'data');
const operatorDefinitions = definitions.filter((definition) => definition.kind === 'operator');
const moduleDefinition = definitions.find((definition) => definition.kind === 'module');

function definitionCategory(definition) {
  if (definition.kind === 'data') return definition.libraryCategory || 'Monitoring & Sensing';
  if (definition.kind === 'operator') return definition.libraryCategory || definition.taxonomy?.primaryClass || 'Spatial';
  return 'Module';
}

function editorCenterWorld() {
  const rect = document.querySelector('#editor').getBoundingClientRect();
  return editor.screenToWorld({ x: rect.width / 2, y: rect.height / 2 });
}

function addNode(typeId, position = editorCenterWorld()) {
  const node = graph.createNode(typeId, position);
  editor.selectedNodeId = node.id;
  editor.render();
  inspector.showNode(node);
  return node;
}

function populateSelect(select, defs, categories, placeholder) {
  select.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  select.appendChild(first);
  categories.forEach((category) => {
    const groupDefs = defs.filter((definition) => definitionCategory(definition) === category);
    if (!groupDefs.length) return;
    const optGroup = document.createElement('optgroup');
    optGroup.label = category;
    groupDefs.forEach((definition) => {
      const option = document.createElement('option');
      option.value = definition.typeId;
      option.textContent = definition.label;
      optGroup.appendChild(option);
    });
    select.appendChild(optGroup);
  });
}

const dataSelect = document.querySelector('#add-data-node');
const operatorSelect = document.querySelector('#add-operator-node');
populateSelect(dataSelect, dataDefinitions, DataCategories, 'Add data...');
populateSelect(operatorSelect, operatorDefinitions, OperatorCategories, 'Add operator...');

dataSelect.addEventListener('change', () => {
  if (!dataSelect.value) return;
  addNode(dataSelect.value);
  dataSelect.value = '';
});

operatorSelect.addEventListener('change', () => {
  if (!operatorSelect.value) return;
  addNode(operatorSelect.value);
  operatorSelect.value = '';
});

document.querySelector('#btn-add-module-node').addEventListener('click', () => {
  if (moduleDefinition) addNode(moduleDefinition.typeId);
});

let nodesCollapsed = false;
document.querySelector('#btn-collapse-nodes').addEventListener('click', () => {
  nodesCollapsed = !nodesCollapsed;
  editor.setAllCollapsed(nodesCollapsed);
  document.querySelector('#btn-collapse-nodes').textContent = nodesCollapsed ? 'Expand nodes' : 'Collapse nodes';
});

function groupedDefinitionsForMenu(defs, categories) {
  return categories
    .map((category) => ({
      category,
      items: defs.filter((definition) => definitionCategory(definition) === category)
    }))
    .filter((group) => group.items.length);
}

const contextMenu = document.createElement('div');
contextMenu.id = 'node-context-menu';
contextMenu.className = 'node-context-menu hidden';
document.body.appendChild(contextMenu);
let contextMenuWorld = null;

function closeContextMenu() {
  contextMenu.classList.add('hidden');
  contextMenuWorld = null;
}

function renderContextMenu(filter = '') {
  const query = filter.trim().toLowerCase();
  contextMenu.innerHTML = '';
  const search = document.createElement('input');
  search.className = 'node-search';
  search.placeholder = 'Search nodes...';
  search.value = filter;
  contextMenu.appendChild(search);

  const content = document.createElement('div');
  content.className = 'node-menu-content';
  contextMenu.appendChild(content);

  const addSection = (title, groups) => {
    const matchedGroups = groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !query || item.label.toLowerCase().includes(query) || group.category.toLowerCase().includes(query))
      }))
      .filter((group) => group.items.length);
    if (!matchedGroups.length) return;
    const section = document.createElement('section');
    section.className = `node-menu-section ${title.toLowerCase()}`;
    const heading = document.createElement('div');
    heading.className = 'node-menu-title';
    heading.textContent = title;
    section.appendChild(heading);
    matchedGroups.forEach((group) => {
      const category = document.createElement('div');
      category.className = 'node-menu-category';
      category.textContent = group.category;
      section.appendChild(category);
      group.items.forEach((definition) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `node-menu-item kind-${definition.kind}`;
        button.textContent = definition.label;
        button.addEventListener('click', () => {
          addNode(definition.typeId, contextMenuWorld || editorCenterWorld());
          closeContextMenu();
        });
        section.appendChild(button);
      });
    });
    content.appendChild(section);
  };

  addSection('Data', groupedDefinitionsForMenu(dataDefinitions, DataCategories));
  addSection('Operator', groupedDefinitionsForMenu(operatorDefinitions, OperatorCategories));
  if (!query || 'module workspace'.includes(query)) {
    addSection('Module', [{ category: 'Workspace', items: moduleDefinition ? [moduleDefinition] : [] }]);
  }

  if (!content.children.length) {
    const empty = document.createElement('div');
    empty.className = 'node-menu-empty';
    empty.textContent = 'No matching nodes.';
    content.appendChild(empty);
  }

  search.addEventListener('input', () => {
    const value = search.value;
    renderContextMenu(value);
    contextMenu.querySelector('.node-search')?.focus();
    const input = contextMenu.querySelector('.node-search');
    input?.setSelectionRange(value.length, value.length);
  });
}

function openContextMenu(event) {
  contextMenuWorld = event.world;
  renderContextMenu('');
  const margin = 12;
  const width = 340;
  const height = 460;
  const left = Math.min(event.clientX, window.innerWidth - width - margin);
  const top = Math.min(event.clientY, window.innerHeight - height - margin);
  contextMenu.style.left = `${Math.max(margin, left)}px`;
  contextMenu.style.top = `${Math.max(margin, top)}px`;
  contextMenu.classList.remove('hidden');
  contextMenu.querySelector('.node-search')?.focus();
}

editor.onCanvasContextMenu = openContextMenu;
document.addEventListener('pointerdown', (event) => {
  if (!contextMenu.classList.contains('hidden') && !contextMenu.contains(event.target)) closeContextMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeContextMenu();
});

document.querySelector('#btn-save').addEventListener('click', () => {
  const json = graph.serialize();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'graph.json';
  anchor.click();
  URL.revokeObjectURL(url);
});

const graphFileInput = document.querySelector('#graph-file-input');
document.querySelector('#btn-load').addEventListener('click', () => {
  graphFileInput.value = '';
  graphFileInput.click();
});

graphFileInput.addEventListener('change', async () => {
  const file = graphFileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      throw new Error('The selected file is not a MineVis graph export.');
    }
    graph.load(parsed);
    editor.selectedNodeId = null;
    inspector.showNode(null);
    editor.render();
    localStorage.setItem('minevis.graph', graph.serialize());
  } catch (error) {
    console.error('Failed to load graph.json:', error);
    alert(`Failed to load graph.json: ${error.message}`);
  }
});

document.querySelector('#btn-open-preview').addEventListener('click', () => {
  const json = graph.serialize();
  localStorage.setItem('minevis.graph', json);
  window.open(appPagePath('preview.html'), 'minevis-preview');
});

window.minevisGraph = graph;
window.minevisEditor = editor;
window.minevisRegistry = new DataRegistry();
