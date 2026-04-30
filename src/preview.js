import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions } from './core/nodes/DataNodes.js';
import { OperatorNodeDefinitions } from './core/operators/OperatorNodes.js';
import { ModuleNodeDefinitions } from './core/modules/ModuleNodes.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { GraphModel } from './core/graph/GraphModel.js';
import { SceneManager } from './scene/SceneManager.js';
import { resetHeatmapColors } from './core/algorithms/FieldSolver.js';

const root = document.getElementById('preview-root');
root.innerHTML = `
  <div class="preview-root">
    <div id="scene-canvas" class="scene-full"></div>

    <div class="overlay module-panel">
      <div class="panel-header">
        <div>
          <h3>MineVis</h3>
          <div class="small">Module Workspace</div>
        </div>
        <button id="btn-reload">Reload</button>
      </div>
      <div class="panel-section">
        <div class="panel-title">Modules</div>
        <ul id="module-menu"></ul>
      </div>
      <div class="panel-section">
        <div class="panel-title">Functions</div>
        <ul id="function-menu"></ul>
      </div>
    </div>

    <div class="overlay view-panel">
      <div class="panel-header">
        <h4>Views</h4>
      </div>
      <div id="view-list"></div>
    </div>

    <div class="overlay control-panel">
      <div class="panel-header">
        <h4 id="active-title">No active function</h4>
      </div>
      <div id="control-body"></div>
    </div>
  </div>
`;

const definitionRegistry = new NodeDefinitionRegistry();
[...DataNodeDefinitions, ...OperatorNodeDefinitions, ...ModuleNodeDefinitions].forEach((d) => definitionRegistry.register(d));
const dataRegistry = new DataRegistry();

function loadGraph(graphJson) {
  const graph = new GraphModel(definitionRegistry);
  if (graphJson) {
    graph.load(graphJson);
    return graph;
  }

  const topo = graph.createNode('DataNode', { x: 60, y: 60 });
  topo.params.contractId = 'RoadwayTopology';
  topo.params.source.path = '/data/roadway_topo.json';
  topo.runtime.updateFacets(topo);

  const geometry = graph.createNode('DataNode', { x: 60, y: 220 });
  geometry.params.contractId = 'RoadwayGeometry';
  geometry.params.source.path = '/data/roadway_model.obj';
  geometry.bindings = { topo_ref_id: topo.id };
  geometry.runtime.updateFacets(geometry);

  const registry = graph.createNode('DataNode', { x: 60, y: 380 });
  registry.params.contractId = 'SensorStationRegistry';
  registry.params.source.path = '/data/temperature_sensors.csv';
  registry.runtime.updateFacets(registry);

  const readings = graph.createNode('DataNode', { x: 360, y: 380 });
  readings.params.contractId = 'SensorReadingTimeSeries';
  readings.params.source.path = '/data/Temperature_timeseries_20steps.csv';
  readings.bindings = { sensor_id: registry.id };
  readings.runtime.updateFacets(readings);

  const opDetail = graph.createNode('SensorDetailOperator', { x: 660, y: 220 });
  const opSnapshot = graph.createNode('RoadwaySnapshotOperator', { x: 660, y: 380 });
  const moduleNode = graph.createNode('ModuleNode', { x: 980, y: 300 });

  graph.connect({ nodeId: topo.id, portId: 'facet-graph' }, { nodeId: opSnapshot.id, portId: 'roadwayTopo' });
  graph.connect({ nodeId: geometry.id, portId: 'facet-meshParts' }, { nodeId: opSnapshot.id, portId: 'roadwayMesh' });
  graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: opDetail.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: registry.id, portId: 'facet-registry' }, { nodeId: opSnapshot.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: readings.id, portId: 'facet-series' }, { nodeId: opDetail.id, portId: 'tempReadings' });
  graph.connect({ nodeId: readings.id, portId: 'facet-snapshot' }, { nodeId: opSnapshot.id, portId: 'tempReadings' });

  const modulePorts = moduleNode.ports.map((p) => p.id);
  graph.connect({ nodeId: opDetail.id, portId: 'operator' }, { nodeId: moduleNode.id, portId: modulePorts[0] });
  graph.connect({ nodeId: opSnapshot.id, portId: 'operator' }, { nodeId: moduleNode.id, portId: modulePorts[1] });

  return graph;
}

function createContextStore(initial) {
  const listeners = new Set();
  const store = {
    state: { ...(initial || {}) },
    set(patch) {
      store.state = { ...store.state, ...patch };
      listeners.forEach((fn) => fn(store.state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
  return store;
}

class ViewRegistry {
  constructor(container, sceneManager) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.views = new Map();
  }

  register(view) {
    const entry = {
      id: view.id,
      label: view.label || view.id,
      ownerId: view.ownerId,
      type: view.type || 'view',
      visible: view.visible !== false,
      pinned: false,
      slot: 'Main',
      show: view.show || (() => {}),
      hide: view.hide || (() => {})
    };
    this.views.set(entry.id, entry);
    if (entry.visible) entry.show();
    this.render();
    return entry;
  }

  unregister(viewId) {
    const view = this.views.get(viewId);
    if (!view) return;
    if (view.visible) view.hide();
    this.views.delete(viewId);
    this.render();
  }

  hasPinnedByOwner(ownerId) {
    for (const view of this.views.values()) {
      if (view.ownerId === ownerId && view.pinned) return true;
    }
    return false;
  }

  resetScene() {
    resetHeatmapColors(this.sceneManager.scene);
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    if (!this.views.size) {
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.textContent = 'No view contributions yet.';
      this.container.appendChild(empty);
      return;
    }
    for (const view of this.views.values()) {
      const row = document.createElement('div');
      row.className = `view-row ${view.visible ? 'active' : ''} ${view.pinned ? 'pinned' : ''}`;

      const visLabel = document.createElement('label');
      visLabel.className = 'view-toggle';
      const vis = document.createElement('input');
      vis.type = 'checkbox';
      vis.checked = view.visible;
      vis.onchange = () => {
        view.visible = vis.checked;
        if (view.visible) view.show();
        else view.hide();
        this.render();
      };
      const name = document.createElement('span');
      name.textContent = view.label;
      visLabel.appendChild(vis);
      visLabel.appendChild(name);

      const pin = document.createElement('button');
      pin.className = 'pin-btn';
      pin.textContent = view.pinned ? 'Pinned' : 'Pin';
      pin.onclick = () => {
        view.pinned = !view.pinned;
        this.render();
      };

      const slot = document.createElement('select');
      ['Main', 'Left', 'Right'].forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        slot.appendChild(option);
      });
      slot.value = view.slot || 'Main';
      slot.onchange = (e) => {
        view.slot = e.target.value;
      };

      row.appendChild(visLabel);
      row.appendChild(pin);
      row.appendChild(slot);
      this.container.appendChild(row);
    }
  }
}

async function executeDataNodes(graph) {
  const results = {};
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
  return results;
}

function buildOperatorInstances(graph, dataResults) {
  const operators = new Map();
  const resolve = (nodeId, portId) => {
    const edge = graph.edges.find((e) => e.to.nodeId === nodeId && e.to.portId === portId);
    if (!edge) return null;
    const fromNode = graph.nodes.find((n) => n.id === edge.from.nodeId);
    const fromPort = fromNode?.ports.find((p) => p.id === edge.from.portId);
    const source = dataResults[edge.from.nodeId];
    if (source?.resolveFacet && fromPort?.facetType) {
      return source.resolveFacet(fromPort.id.replace('facet-', ''));
    }
    return source;
  };
  graph.nodes
    .filter((n) => n.kind === 'operator')
    .forEach((node) => {
      const inputs = {};
      node.ports
        .filter((p) => p.direction === 'in')
        .forEach((p) => {
          inputs[p.id] = resolve(node.id, p.id);
        });
      const instance = node.runtime.createOperator(node, inputs);
      if (instance) {
        operators.set(node.id, instance);
      }
    });
  return { operators };
}

function createModuleRuntime(node, graph, operators, sceneManager) {
  const context = createContextStore({ time: null, selection: null });
  const legend = { update: () => {}, instance: null };
  const viewRegistry = new ViewRegistry(document.getElementById('view-list'), sceneManager);
  const functions = node.ports.map((port) => {
    const edge = graph.edges.find((e) => e.to.nodeId === node.id && e.to.portId === port.id);
    const opNodeId = edge?.from.nodeId;
    return {
      id: `${node.id}:${port.id}`,
      label: port.name,
      operatorId: opNodeId,
      operator: opNodeId ? operators.get(opNodeId) : null
    };
  });

  const sessions = new Map();
  let activeFunctionId = null;
  let controlCleanup = null;

  const enableFunction = (fnId) => {
    const fn = functions.find((f) => f.id === fnId);
    if (!fn || !fn.operator || sessions.has(fnId)) return;
    const session = fn.operator.attach({
      sceneManager,
      context,
      viewRegistry,
      legend
    });
    sessions.set(fnId, session || { views: [], cleanup: () => {} });
  };

  const disableFunction = (fnId) => {
    const fn = functions.find((f) => f.id === fnId);
    if (!fn || !fn.operator) return;
    if (viewRegistry.hasPinnedByOwner(fn.operator.id)) return;
    const session = sessions.get(fnId);
    if (!session) return;
    session.cleanup?.();
    sessions.delete(fnId);
  };

  const setActiveFunction = (fnId) => {
    if (activeFunctionId === fnId) return;
    if (controlCleanup) {
      controlCleanup();
      controlCleanup = null;
    }
    activeFunctionId = fnId;
    const fn = functions.find((f) => f.id === fnId);
    const title = document.getElementById('active-title');
    if (!fn || !fn.operator) {
      if (title) title.textContent = 'No active function';
      document.getElementById('control-body').innerHTML = '';
      return;
    }
    enableFunction(fnId);
    if (title) title.textContent = fn.label || 'Active function';
    const controlBody = document.getElementById('control-body');
    controlCleanup = fn.operator.renderControls?.(controlBody, {
      sceneManager,
      context,
      viewRegistry,
      legend
    });
  };

  const renderFunctionMenu = () => {
    const menu = document.getElementById('function-menu');
    menu.innerHTML = '';
    functions.forEach((fn) => {
      const li = document.createElement('li');
      li.className = `function-item ${fn.id === activeFunctionId ? 'active' : ''}`;
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = sessions.has(fn.id);
      toggle.disabled = !fn.operator;
      toggle.onchange = () => {
        if (toggle.checked) {
          enableFunction(fn.id);
        } else {
          disableFunction(fn.id);
          if (fn.id === activeFunctionId) setActiveFunction(null);
        }
        renderFunctionMenu();
      };
      const label = document.createElement('span');
      label.textContent = fn.label;
      label.onclick = () => {
        if (!fn.operator) return;
        enableFunction(fn.id);
        setActiveFunction(fn.id);
        renderFunctionMenu();
      };
      li.appendChild(toggle);
      li.appendChild(label);
      menu.appendChild(li);
    });
  };

  return {
    id: node.params.moduleId || node.id,
    label: node.params.title || node.label,
    functions,
    renderFunctionMenu,
    renderViews: () => viewRegistry.render(),
    setActiveFunction,
    enableFunction,
    disableFunction,
    deactivate: () => {
      functions.forEach((fn) => disableFunction(fn.id));
      if (controlCleanup) {
        controlCleanup();
        controlCleanup = null;
      }
      activeFunctionId = null;
      const title = document.getElementById('active-title');
      if (title) title.textContent = 'No active function';
      document.getElementById('control-body').innerHTML = '';
      viewRegistry.render();
    }
  };
}

async function bootstrap(graphJson) {
  const graph = loadGraph(graphJson);
  const dataResults = await executeDataNodes(graph);

  const topoNode = graph.nodes.find((n) => n.params?.contractId === 'RoadwayTopology');
  const geometryNode = graph.nodes.find((n) => n.params?.contractId === 'RoadwayGeometry');
  const topoRes = topoNode ? dataResults[topoNode.id] : null;
  const geometryRes = geometryNode ? dataResults[geometryNode.id] : null;
  const topo = topoRes?.resolveFacet ? topoRes.resolveFacet('graph') : topoRes;
  const meshPartsMapping = geometryRes?.resolveFacet ? geometryRes.resolveFacet('meshParts') : [];

  const sceneContainer = document.querySelector('#scene-canvas');
  sceneContainer.innerHTML = '';
  const sceneManager = new SceneManager(sceneContainer);
  sceneManager.addLights();

  if (geometryRes && (geometryRes.source?.path || geometryRes.objText)) {
    await sceneManager.loadRoadwayModel(geometryRes.source.path, geometryRes.objText, meshPartsMapping, topo);
  } else if (topo) {
    sceneManager.buildRoadway(topo);
  }

  const { operators } = buildOperatorInstances(graph, dataResults);
  const moduleNodes = graph.nodes.filter((n) => n.kind === 'module');
  const modules = moduleNodes.map((node) => createModuleRuntime(node, graph, operators, sceneManager));

  const moduleMenu = document.getElementById('module-menu');
  moduleMenu.innerHTML = '';
  let activeModule = null;
  modules.forEach((mod) => {
    const li = document.createElement('li');
    li.textContent = mod.label;
    li.onclick = () => {
      moduleMenu.querySelectorAll('li').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      if (activeModule && activeModule !== mod) activeModule.deactivate();
      activeModule = mod;
      mod.renderFunctionMenu();
      mod.renderViews();
      const firstAvailable = mod.functions.find((fn) => fn.operator);
      if (firstAvailable) {
        mod.setActiveFunction(firstAvailable.id);
        mod.renderFunctionMenu();
      }
    };
    moduleMenu.appendChild(li);
  });

  if (modules.length) {
    moduleMenu.firstChild?.dispatchEvent(new Event('click'));
  } else {
    document.getElementById('function-menu').innerHTML = '<li class="small">No module configured.</li>';
  }
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
