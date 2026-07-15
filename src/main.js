import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions } from './core/nodes/DataNodes.js';
import { OperatorNodeDefinitions } from './core/operators/OperatorNodes.js';
import { ModuleNodeDefinitions } from './core/modules/ModuleNodes.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { GraphModel } from './core/graph/GraphModel.js';
import { NodeEditor } from './ui/NodeEditor.js';
import { Inspector } from './ui/Inspector.js';
import { appPagePath } from './utils/appPath.js';
import mineVisLogoUrl from './assets/MineVisLogo.png';
import {
  Box,
  ChevronsDown,
  ChevronsUp,
  ExternalLink,
  FolderOpen,
  Save,
  createIcons
} from 'lucide';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="layout" class="fill-layout">
    <header class="editor-toolbar">
      <div class="editor-toolbar-start">
        <div class="editor-brand">
          <img class="editor-logo" src="${mineVisLogoUrl}" alt="" aria-hidden="true" />
          <span>MineVis Editor</span>
        </div>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="toolbar-group toolbar-create-group" aria-label="Create nodes">
          <label class="toolbar-select">Data
            <select id="add-data-node"></select>
          </label>
          <label class="toolbar-select">Operator
            <select id="add-operator-node"></select>
          </label>
          <button id="btn-add-module-node" class="toolbar-button" type="button">
            <i data-lucide="box" aria-hidden="true"></i>
            <span>Add module</span>
          </button>
        </div>
      </div>
      <div class="editor-toolbar-actions">
        <div class="toolbar-group toolbar-file-group" aria-label="Graph file actions">
          <button id="btn-save" class="toolbar-button" type="button">
            <i data-lucide="save" aria-hidden="true"></i>
            <span>Save graph</span>
          </button>
          <button id="btn-load" class="toolbar-button" type="button">
            <i data-lucide="folder-open" aria-hidden="true"></i>
            <span>Load graph</span>
          </button>
          <input id="graph-file-input" type="file" accept=".json,application/json" hidden />
        </div>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button id="btn-open-preview" class="toolbar-button toolbar-preview-button" type="button">
          <i data-lucide="external-link" aria-hidden="true"></i>
          <span>Open Preview</span>
        </button>
      </div>
    </header>
    <main>
      <section id="editor" class="panel fill">
        <button
          id="btn-collapse-nodes"
          class="editor-canvas-tool"
          type="button"
          title="Collapse all nodes"
          aria-label="Collapse all nodes"
          aria-pressed="false"
        >
          <i class="collapse-action collapse-action-collapse" data-lucide="chevrons-up" aria-hidden="true"></i>
          <i class="collapse-action collapse-action-expand" data-lucide="chevrons-down" aria-hidden="true" hidden></i>
        </button>
      </section>
      <section id="inspector" class="panel inspector-panel">
        <h3>Inspector</h3>
        <div class="node-config"></div>
      </section>
    </main>
  </div>
`;

createIcons({
  icons: { Box, ChevronsDown, ChevronsUp, ExternalLink, FolderOpen, Save }
});

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
  updateCollapseNodesButton();
  if (options.refreshInspector !== false && inspector.currentNode?.id === node.id) {
    inspector.showNode(node);
  }
};
inspector.onNodeChange = (node, options = {}) => {
  if (!node) return;
  editor.updateNodeView(node.id);
  updateCollapseNodesButton();
  if (options.refreshInspector && inspector.currentNode?.id === node.id) {
    inspector.showNode(node);
  }
};
graph.subscribe((change) => {
  editor.applyGraphChange(change);
  updateCollapseNodesButton();
  const selected = graph.getNode(editor.selectedNodeId);
  if (selected && inspector.currentNode?.id === selected.id) inspector.showNode(selected);
  if (!selected && inspector.currentNode) inspector.showNode(null);
});
editor.render();
editor.refreshDataStatuses();

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
  editor.setSelectedNode(node.id, { notify: false });
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

const collapseNodesButton = document.querySelector('#btn-collapse-nodes');

function allNodesCollapsed() {
  return graph.nodes.length > 0 && graph.nodes.every((node) => node.params?.uiCollapsed === true);
}

function updateCollapseNodesButton() {
  const collapsed = allNodesCollapsed();
  const action = collapsed ? 'Expand all nodes' : 'Collapse all nodes';
  collapseNodesButton.disabled = graph.nodes.length === 0;
  collapseNodesButton.title = action;
  collapseNodesButton.setAttribute('aria-label', action);
  collapseNodesButton.setAttribute('aria-pressed', String(collapsed));
  collapseNodesButton.querySelector('.collapse-action-collapse')?.toggleAttribute('hidden', collapsed);
  collapseNodesButton.querySelector('.collapse-action-expand')?.toggleAttribute('hidden', !collapsed);
}

['pointerdown', 'pointerup', 'wheel', 'contextmenu'].forEach((eventName) => {
  collapseNodesButton.addEventListener(eventName, (event) => event.stopPropagation());
});

collapseNodesButton.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  editor.setAllCollapsed(!allNodesCollapsed());
  updateCollapseNodesButton();
});

updateCollapseNodesButton();

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
contextMenu.setAttribute('aria-label', 'Add node');
contextMenu.setAttribute('aria-hidden', 'true');

const contextMenuSearch = document.createElement('input');
contextMenuSearch.className = 'node-search';
contextMenuSearch.type = 'search';
contextMenuSearch.placeholder = 'Search nodes...';
contextMenuSearch.setAttribute('aria-label', 'Search nodes');

const contextMenuContent = document.createElement('div');
contextMenuContent.className = 'node-menu-content';
contextMenuContent.setAttribute('role', 'menu');
contextMenuContent.setAttribute('aria-label', 'Available nodes');

contextMenu.append(contextMenuSearch, contextMenuContent);
document.body.appendChild(contextMenu);

let contextMenuWorld = null;
let contextMenuActiveIndex = -1;

function contextMenuItems() {
  return [...contextMenuContent.querySelectorAll('.node-menu-item')];
}

function setContextMenuActive(index, { focus = false } = {}) {
  const items = contextMenuItems();
  if (!items.length) {
    contextMenuActiveIndex = -1;
    contextMenuSearch.removeAttribute('aria-activedescendant');
    return;
  }
  contextMenuActiveIndex = Math.max(0, Math.min(index, items.length - 1));
  items.forEach((item, itemIndex) => {
    const active = itemIndex === contextMenuActiveIndex;
    item.classList.toggle('keyboard-active', active);
    item.setAttribute('aria-current', active ? 'true' : 'false');
  });
  const activeItem = items[contextMenuActiveIndex];
  contextMenuSearch.setAttribute('aria-activedescendant', activeItem.id);
  activeItem.scrollIntoView({ block: 'nearest' });
  if (focus) activeItem.focus();
}

function closeContextMenu() {
  contextMenu.classList.add('hidden');
  contextMenu.setAttribute('aria-hidden', 'true');
  contextMenu.style.visibility = '';
  contextMenuWorld = null;
  contextMenuActiveIndex = -1;
}

function renderContextMenu(filter = contextMenuSearch.value) {
  const query = filter.trim().toLowerCase();
  contextMenuContent.innerHTML = '';
  contextMenuActiveIndex = -1;
  let itemSequence = 0;

  const addSection = (title, groups) => {
    const matchedGroups = groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          !query ||
          item.label.toLowerCase().includes(query) ||
          group.category.toLowerCase().includes(query)
        )
      }))
      .filter((group) => group.items.length);
    if (!matchedGroups.length) return;

    const section = document.createElement('section');
    section.className = 'node-menu-section ' + title.toLowerCase();
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', title);

    const heading = document.createElement('div');
    heading.className = 'node-menu-title';
    heading.textContent = title;
    section.appendChild(heading);

    matchedGroups.forEach((group) => {
      const category = document.createElement('div');
      category.className = 'node-menu-category';
      category.textContent = group.category;
      category.setAttribute('role', 'presentation');
      section.appendChild(category);

      group.items.forEach((definition) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'node-menu-item-' + itemSequence;
        button.className = 'node-menu-item kind-' + definition.kind;
        button.textContent = definition.label;
        button.title = definition.label;
        button.setAttribute('role', 'menuitem');
        button.setAttribute('aria-current', 'false');
        button.addEventListener('pointerenter', () => {
          const index = contextMenuItems().indexOf(button);
          if (index >= 0) setContextMenuActive(index);
        });
        button.addEventListener('click', () => {
          addNode(definition.typeId, contextMenuWorld || editorCenterWorld());
          closeContextMenu();
        });
        itemSequence += 1;
        section.appendChild(button);
      });
    });
    contextMenuContent.appendChild(section);
  };

  addSection('Data', groupedDefinitionsForMenu(dataDefinitions, DataCategories));
  addSection('Operator', groupedDefinitionsForMenu(operatorDefinitions, OperatorCategories));
  if (!query || 'module workspace'.includes(query)) {
    addSection('Module', [{ category: 'Workspace', items: moduleDefinition ? [moduleDefinition] : [] }]);
  }

  if (!contextMenuContent.children.length) {
    const empty = document.createElement('div');
    empty.className = 'node-menu-empty';
    empty.textContent = 'No matching nodes.';
    contextMenuContent.appendChild(empty);
    contextMenuSearch.removeAttribute('aria-activedescendant');
    return;
  }
  setContextMenuActive(0);
}

contextMenuSearch.addEventListener('input', () => {
  renderContextMenu(contextMenuSearch.value);
});

contextMenu.addEventListener('keydown', (event) => {
  const items = contextMenuItems();
  if (event.key === 'Escape') {
    event.preventDefault();
    closeContextMenu();
    return;
  }
  if (!items.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setContextMenuActive(contextMenuActiveIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setContextMenuActive(contextMenuActiveIndex <= 0 ? items.length - 1 : contextMenuActiveIndex - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    setContextMenuActive(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    setContextMenuActive(items.length - 1);
  } else if (event.key === 'Enter' && contextMenuActiveIndex >= 0) {
    event.preventDefault();
    items[contextMenuActiveIndex].click();
  }
});

function openContextMenu(event) {
  contextMenuWorld = event.world;
  contextMenuSearch.value = '';
  renderContextMenu('');
  contextMenu.style.left = '0px';
  contextMenu.style.top = '0px';
  contextMenu.style.visibility = 'hidden';
  contextMenu.classList.remove('hidden');
  contextMenu.setAttribute('aria-hidden', 'false');

  const margin = 6;
  const rect = contextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - margin);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - margin);
  contextMenu.style.left = Math.max(margin, left) + 'px';
  contextMenu.style.top = Math.max(margin, top) + 'px';
  contextMenu.style.visibility = '';
  contextMenuSearch.focus();
  contextMenuSearch.select();
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
    editor.setSelectedNode(null, { notify: false });
    graph.load(parsed);
    inspector.showNode(null);
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
