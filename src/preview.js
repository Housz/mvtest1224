import { GraphModel } from './core/graph/GraphModel.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions } from './core/nodes/DataNodes.js';
import { OperatorNodeDefinitions } from './core/operators/OperatorNodes.js';
import { ModuleNodeDefinitions } from './core/modules/ModuleNodes.js';
import { SceneManager } from './scene/SceneManager.js';

class ContextStore {
  constructor(initial = {}) {
    this.state = new Map(Object.entries(initial));
    this.listeners = new Map();
  }

  get(key) {
    return this.state.get(key);
  }

  set(key, value) {
    this.state.set(key, value);
    (this.listeners.get(key) || []).forEach((listener) => listener(value));
  }

  subscribe(key, listener) {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    return () => this.listeners.get(key)?.delete(listener);
  }
}

function textKey(value = '') {
  return String(value).toLowerCase();
}

function inferHost(type = '', label = '') {
  const key = textKey(`${type} ${label}`);
  if (key.includes('scene') || key.includes('3d') || key.includes('roadway')) return 'main-3d-scene';
  if (key.includes('topology') || key.includes('drawing') || key.includes('network state')) return 'topology-view';
  if (key.includes('legend')) return 'legend';
  if (key.includes('control')) return 'control';
  if (key.includes('timeline')) return 'timeline';
  if (key.includes('chart')) return 'bottom-panel';
  return 'right-panel';
}

function inferContributionKind(type = '') {
  if (type === 'scene-layer') return 'layer';
  if (type === 'topology-view') return 'panel';
  if (type === 'legend') return 'legend';
  if (type === 'control') return 'control';
  if (type === 'chart') return 'chart';
  return type || 'panel';
}

function inferSemanticRole(type = '', label = '') {
  const key = textKey(`${type} ${label}`);
  if (key.includes('roadway 3d model') || key.includes('base')) return 'base';
  if (key.includes('anomaly') || key.includes('diagnostic')) return 'diagnostic';
  if (key.includes('airflow') || key.includes('temperature') || key.includes('overlay') || key.includes('state')) return 'state';
  if (key.includes('ventilation network') || key.includes('structure') || key.includes('topology') || key.includes('drawing')) return 'structure';
  if (key.includes('legend')) return 'legend';
  if (key.includes('control') || key.includes('filter') || key.includes('selector')) return 'control';
  if (key.includes('chart') || key.includes('detail') || key.includes('summary') || key.includes('statistics')) return 'detail';
  if (type === 'scene-layer') return 'state';
  if (type === 'chart' || type === 'panel') return 'detail';
  return 'detail';
}

function inferObjectSystem(label = '') {
  const key = textKey(label);
  if (key.includes('sensor')) return 'sensor';
  if (key.includes('airflow') || key.includes('ventilation') || key.includes('branch') || key.includes('anomaly')) return 'ventilationBranch';
  if (key.includes('roadway')) return 'roadway';
  return 'workspace';
}

function inferVisualChannels(label = '', semanticRole = '') {
  const key = textKey(label);
  if (key.includes('airflow')) return { color: 'activeAirflowVariable', width: 'airQuantity', arrow: 'direction' };
  if (key.includes('anomaly')) return { halo: 'anomalyType' };
  if (key.includes('temperature')) return { color: 'temperature' };
  if (semanticRole === 'structure') return { color: 'type', arrow: 'direction' };
  return {};
}

function inferMergePolicy(type, label, host, semanticRole) {
  const key = textKey(label);
  if (key.includes('roadway 3d model') || key.includes('ventilation network overlay')) return 'reuse';
  if (host === 'legend') return 'replace';
  if (semanticRole === 'diagnostic' || type === 'scene-layer') return 'compose';
  return 'compose';
}

function inferFocusBehavior(type, label, host, semanticRole) {
  const key = textKey(label);
  if (semanticRole === 'base') return 'context';
  if (semanticRole === 'diagnostic') return 'annotation';
  if (semanticRole === 'structure') return 'context';
  if (host === 'legend' || semanticRole === 'legend') return 'primary-when-focused';
  if (['control', 'detail'].includes(semanticRole) || ['chart', 'panel', 'control'].includes(type)) return 'panel-only';
  if (semanticRole === 'state') return 'primary-when-focused';
  return 'context';
}

function inferDefaultOpacity(type, semanticRole) {
  if (semanticRole === 'base') return 0.5;
  if (semanticRole === 'structure') return 0.45;
  if (semanticRole === 'diagnostic') return 0.9;
  if (type === 'scene-layer') return 0.85;
  return 1;
}

function inferPriority(semanticRole, type) {
  const order = { base: 10, structure: 30, state: 60, diagnostic: 70, selection: 90, legend: 50, control: 50, detail: 40 };
  return order[semanticRole] ?? (type === 'scene-layer' ? 50 : 30);
}

function inferSharedKey(label, host, semanticRole, objectSystem) {
  const key = textKey(label);
  if (key.includes('roadway 3d model')) return 'roadway-base-layer';
  if (key.includes('3d ventilation network overlay')) return 'ventilation-structure-layer';
  return `${host}:${semanticRole}:${objectSystem}:${key}`;
}

class VisualContributionRegistry {
  constructor(onChange) {
    this.items = new Map();
    this.onChange = onChange;
    this.focusedFunctionId = null;
    this.functionLabels = new Map();
  }

  register(contribution) {
    const item = this.normalizeContribution(contribution);
    this.items.set(item.id, item);
    this.applyComposition();
    this.notify();
    return item;
  }

  normalizeContribution(contribution) {
    const type = contribution.type || contribution.contributionKind || 'panel';
    const label = contribution.label || contribution.id || 'Visual Contribution';
    const host = contribution.host || inferHost(type, label);
    const contributionKind = contribution.contributionKind || inferContributionKind(type);
    const semanticRole = contribution.semanticRole || inferSemanticRole(type, label);
    const objectSystem = contribution.objectSystem || inferObjectSystem(label);
    const ownerFunctionId = contribution.ownerFunctionId || contribution.functionId || contribution.ownerId;
    const composition = {
      mergePolicy: inferMergePolicy(type, label, host, semanticRole),
      focusBehavior: inferFocusBehavior(type, label, host, semanticRole),
      canPin: true,
      defaultVisibility: true,
      defaultOpacity: contribution.opacity ?? inferDefaultOpacity(type, semanticRole),
      ...(contribution.composition || {})
    };
    const visualChannels = contribution.visualChannels || inferVisualChannels(label, semanticRole);
    return {
      visible: contribution.state?.visible ?? contribution.visible ?? composition.defaultVisibility,
      pinned: contribution.state?.pinned ?? contribution.pinned ?? false,
      opacity: contribution.state?.opacity ?? contribution.opacity ?? composition.defaultOpacity,
      host,
      contributionKind,
      semanticRole,
      objectSystem,
      visualChannels,
      priority: contribution.priority ?? inferPriority(semanticRole, type),
      composition,
      ownerFunctionId,
      ownerOperatorId: contribution.ownerOperatorId || contribution.ownerId,
      sharedKey: contribution.sharedKey || inferSharedKey(label, host, semanticRole, objectSystem),
      effectiveVisible: true,
      muted: false,
      ...contribution
    };
  }

  get(id) {
    return this.items.get(id);
  }

  list() {
    return [...this.items.values()];
  }

  childrenOf(parentId) {
    return this.list().filter((item) => item.parentId === parentId);
  }

  setVisible(id, visible) {
    const item = this.items.get(id);
    if (!item) return;
    item.visible = visible;
    if (item.collection) {
      this.childrenOf(id).forEach((child) => {
        child.visible = visible;
      });
    }
    this.applyComposition();
    this.notify();
  }

  setOpacity(id, opacity) {
    const item = this.items.get(id);
    if (!item) return;
    item.opacity = Number(opacity);
    this.applyComposition();
    this.notify();
  }

  togglePinned(id) {
    const item = this.items.get(id);
    if (!item) return;
    item.pinned = !item.pinned;
    this.applyComposition();
    this.notify();
  }

  setFunctionLabels(functions = []) {
    this.functionLabels = new Map(functions.map((fn) => [fn.id, fn.label]));
    this.notify();
  }

  setFocusedFunction(functionId) {
    this.focusedFunctionId = functionId || null;
    this.applyComposition();
    this.notify();
  }

  ownerLabel(item) {
    return this.functionLabels.get(item.ownerFunctionId) || this.functionLabels.get(item.functionId) || item.ownerLabel || '';
  }

  focusOwner(functionId) {
    if (!functionId) return;
    this.onFocusFunction?.(functionId);
  }

  applyComposition() {
    const items = this.list();
    const focusedId = this.focusedFunctionId;
    const focusedLegends = new Set();
    items.forEach((item) => {
      item.focused = Boolean(focusedId && item.ownerFunctionId === focusedId);
      item.muted = false;
      let effectiveVisible = Boolean(item.visible);
      let opacityFactor = 1;
      if (!item.pinned && focusedId && item.ownerFunctionId && item.ownerFunctionId !== focusedId) {
        const behavior = item.composition?.focusBehavior || 'context';
        if (item.host === 'legend' || item.semanticRole === 'legend' || behavior === 'primary-when-focused') {
          effectiveVisible = false;
        } else if (['panel-only', 'control'].includes(behavior) || ['panel', 'control', 'chart', 'timeline', 'topology-view'].includes(item.contributionKind)) {
          effectiveVisible = false;
        } else if (item.semanticRole === 'diagnostic' || behavior === 'annotation') {
          opacityFactor = 0.68;
          item.muted = true;
        } else if (item.semanticRole === 'structure' || behavior === 'context') {
          opacityFactor = 0.42;
          item.muted = true;
        } else if (item.semanticRole === 'state') {
          opacityFactor = 0.32;
          item.muted = true;
        }
      }
      if (item.host === 'legend' && item.focused) focusedLegends.add(item.id);
      item.effectiveVisible = effectiveVisible;
      item.effectiveOpacity = Math.max(0, Math.min(1, Number(item.opacity ?? 1) * opacityFactor));
      this.applyContributionState(item);
    });
    if (focusedLegends.size > 1) {
      let kept = false;
      items
        .filter((item) => focusedLegends.has(item.id))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .forEach((item) => {
          if (!kept) {
            kept = true;
            return;
          }
          if (!item.pinned) {
            item.effectiveVisible = false;
            this.applyContributionState(item);
          }
        });
    }
  }

  applyContributionState(item) {
    const nextVisible = Boolean(item.effectiveVisible);
    const nextOpacity = Math.max(0, Math.min(1, Number(item.effectiveOpacity ?? item.opacity ?? 1)));
    const nextFocused = Boolean(item.focused);
    const nextMuted = Boolean(item.muted);

    if (item._appliedVisible !== nextVisible) {
      if (nextVisible) item.show?.();
      else item.hide?.();
      item._appliedVisible = nextVisible;
    }

    if (
      nextVisible &&
      item.setOpacity &&
      (item._appliedOpacity == null || Math.abs(Number(item._appliedOpacity) - nextOpacity) > 0.001)
    ) {
      item.setOpacity(nextOpacity);
      item._appliedOpacity = nextOpacity;
    }

    item._appliedFocused = nextFocused;

    if (item._appliedMuted !== nextMuted) {
      if (nextMuted) item.mute?.();
      else item.unmute?.();
      item._appliedMuted = nextMuted;
    }
  }

  unregisterOwner(ownerId, { keepPinned = true } = {}) {
    const hasPinnedDescendant = (itemId) =>
      this.list().some((item) => item.parentId === itemId && (item.pinned || hasPinnedDescendant(item.id)));
    const ownerHasPinnedItem = this.list().some((item) => item.ownerId === ownerId && item.pinned);
    for (const [id, item] of this.items) {
      if (item.ownerId !== ownerId) continue;
      if (keepPinned && (item.pinned || hasPinnedDescendant(id) || (item.keepWithPinnedOwner && ownerHasPinnedItem))) continue;
      item.cleanup?.();
      this.items.delete(id);
    }
    this.items.forEach((item) => {
      item._appliedVisible = undefined;
      item._appliedOpacity = undefined;
      item._appliedMuted = undefined;
    });
    this.applyComposition();
    this.notify();
  }

  notify() {
    this.onChange?.(this.list());
  }
}

function buildDefinitionRegistry() {
  const registry = new NodeDefinitionRegistry();
  [...DataNodeDefinitions, ...OperatorNodeDefinitions, ...ModuleNodeDefinitions].forEach((definition) =>
    registry.register(definition)
  );
  return registry;
}

function createSeedGraph(definitionRegistry) {
  const graph = new GraphModel(definitionRegistry);
  const roadway = graph.createNode('RoadwayDataNode', { x: 80, y: 90 });
  const sensorRegistry = graph.createNode('SensorRegistryDataNode', { x: 80, y: 300 });
  const sensorReadings = graph.createNode('SensorReadingsDataNode', { x: 80, y: 510 });
  const operator = graph.createNode('RoadwayTemperatureAnalysisOperator', { x: 650, y: 260 });
  const module = graph.createNode('ModuleNode', { x: 1220, y: 300 });
  module.params.workspaceName = 'Monitoring Workspace';
  module.label = 'Monitoring Workspace';

  graph.connect({ nodeId: roadway.id, portId: 'dataset' }, { nodeId: operator.id, portId: 'roadway' });
  graph.connect({ nodeId: sensorRegistry.id, portId: 'dataset' }, { nodeId: operator.id, portId: 'sensorRegistry' });
  graph.connect({ nodeId: sensorReadings.id, portId: 'dataset' }, { nodeId: operator.id, portId: 'sensorReadings' });
  graph.connect({ nodeId: operator.id, portId: 'operator' }, { nodeId: module.id, portId: 'function-1' });
  return graph;
}

function loadGraph(definitionRegistry) {
  const graph = new GraphModel(definitionRegistry);
  const serialized = localStorage.getItem('minevis.graph');
  if (serialized) {
    try {
      graph.load(serialized);
      if (graph.nodes.length && graph.nodes.some((node) => node.kind === 'module')) return graph;
    } catch (error) {
      console.warn('Failed to load editor graph, using seed graph.', error);
    }
  }
  return createSeedGraph(definitionRegistry);
}

async function executeDataNodes(graph) {
  const dataRegistry = new DataRegistry();
  const outputs = new Map();
  for (const node of graph.nodes.filter((item) => item.kind === 'data')) {
    const result = await node.runtime.execute(dataRegistry, node);
    outputs.set(node.id, result);
    dataRegistry.register(node.id, result.dataset);
  }
  return { dataRegistry, outputs };
}

function buildOperatorInstances(graph, nodeOutputs) {
  const operators = new Map();
  const creating = new Set();
  const makeOperatorDatasetOutput = (operator, port) => ({
    __operatorDatasetOutput: true,
    portId: port.id,
    type: port.type,
    operator,
    getDataset: () => operator.getOutputDataset?.(port.id) ?? operator.outputs?.[port.id] ?? null,
    subscribe: (callback) => operator.subscribeOutput?.(port.id, callback) ?? (() => {})
  });
  const ensureOperator = (node) => {
    if (operators.has(node.id)) return operators.get(node.id);
    if (creating.has(node.id)) throw new Error(`Operator cycle detected at ${node.label || node.id}`);
    creating.add(node.id);
    const inputs = {};
    const inbound = graph.edges.filter((edge) => edge.to.nodeId === node.id);
    inbound.forEach((edge) => {
      const fromNode = graph.nodes.find((item) => item.id === edge.from.nodeId);
      if (fromNode?.kind === 'operator') ensureOperator(fromNode);
      const upstream = nodeOutputs.get(edge.from.nodeId);
      if (upstream) inputs[edge.to.portId] = upstream[edge.from.portId];
    });
    const operator = node.runtime.createOperator(node, inputs);
    operators.set(node.id, operator);
    const outputs = { operator };
    (node.ports || [])
      .filter((port) => port.direction === 'out' && port.id !== 'operator')
      .forEach((port) => {
        outputs[port.id] = makeOperatorDatasetOutput(operator, port);
      });
    nodeOutputs.set(node.id, outputs);
    creating.delete(node.id);
    return operator;
  };
  for (const node of graph.nodes.filter((item) => item.kind === 'operator')) {
    ensureOperator(node);
  }
  return operators;
}

function buildWorkspaces(graph, operators) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const collectDependencies = (rootOperatorId) => {
    const visited = new Set();
    const dependencies = [];
    const visit = (nodeId) => {
      graph.edges
        .filter((edge) => edge.to.nodeId === nodeId)
        .forEach((edge) => {
          const fromNode = nodeById.get(edge.from.nodeId);
          if (fromNode?.kind !== 'operator' || visited.has(fromNode.id)) return;
          visited.add(fromNode.id);
          visit(fromNode.id);
          const dependency = operators.get(fromNode.id);
          if (dependency) dependencies.push(dependency);
        });
    };
    visit(rootOperatorId);
    return dependencies;
  };
  return graph.nodes
    .filter((node) => node.kind === 'module')
    .map((moduleNode) => {
      const inbound = graph.edges.filter((edge) => edge.to.nodeId === moduleNode.id);
      const inboundByPort = new Map(inbound.map((edge) => [edge.to.portId, edge]));
      const functionSlots = (moduleNode.params?.functions || [])
        .filter((slot) => !slot.placeholder)
        .map((slot) => {
          const edge = inboundByPort.get(slot.id);
          const operator = edge ? operators.get(edge.from.nodeId) : null;
          return operator ? { slot, operator } : null;
        })
        .filter(Boolean);
      const rootOperators = functionSlots.map((item) => item.operator);
      const workspace = moduleNode.runtime.createWorkspace(moduleNode, rootOperators);
      workspace.context = new ContextStore();
      workspace.functions = functionSlots.map(({ slot, operator }) => ({
        id: `${moduleNode.id}:${slot.id}:${operator.id}`,
        slotId: slot.id,
        label: slot.label || operator.label,
        operator,
        dependencies: collectDependencies(operator.id),
        enabled: false,
        rememberedEnabled: false,
        session: null
      }));
      workspace.focusedFunctionId = null;
      return workspace;
    });
}

function pinIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.7 3.3 20.7 9.3 18.6 11.4 16.9 9.8 13.1 13.6 13.6 18.4 12.2 19.8 9.2 16.8 4.6 21.4 3.6 20.4 8.2 15.8 5.2 12.8 6.6 11.4 11.4 11.9 15.2 8.1 13.6 6.4 14.7 3.3Z" />
    </svg>
  `;
}

function focusIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6Zm0 2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z" />
      <path d="M11.1 2h1.8v3.1h-1.8V2Zm0 16.9h1.8V22h-1.8v-3.1ZM2 11.1h3.1v1.8H2v-1.8Zm16.9 0H22v1.8h-3.1v-1.8Z" />
      <circle cx="12" cy="12" r="1.7" />
    </svg>
  `;
}

function attrText(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function closeContributionMenu() {
  document.querySelector('.vc-action-menu')?.remove();
}

function showContributionMenu(event, item, registry) {
  if (!item.setOpacity) return;
  event.preventDefault();
  event.stopPropagation();
  closeContributionMenu();

  const menu = document.createElement('div');
  menu.className = 'vc-action-menu';
  const opacity = Number(item.opacity ?? 1);
  menu.innerHTML = `
    <div class="vc-menu-title">${item.label}</div>
    <label class="vc-menu-opacity">
      <span>Opacity</span>
      <input class="vc-menu-range" type="range" min="0" max="1" step="0.05" value="${opacity}" />
      <input class="vc-menu-number" type="number" min="0" max="100" step="5" value="${Math.round(opacity * 100)}" />
    </label>
  `;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 10);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 10);
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;

  const range = menu.querySelector('.vc-menu-range');
  const number = menu.querySelector('.vc-menu-number');
  const apply = (value) => {
    const normalized = Math.max(0, Math.min(1, Number(value)));
    range.value = String(normalized);
    number.value = String(Math.round(normalized * 100));
    registry.setOpacity(item.id, normalized);
  };
  range.addEventListener('input', () => apply(range.value));
  number.addEventListener('input', () => apply(Number(number.value) / 100));

  setTimeout(() => {
    const close = (closeEvent) => {
      if (!menu.contains(closeEvent.target)) {
        closeContributionMenu();
        document.removeEventListener('pointerdown', close);
      }
    };
    document.addEventListener('pointerdown', close);
  }, 0);
}

const VC_GROUPS = [
  { id: 'scene', label: 'Scene Layers', match: (item) => item.host === 'main-3d-scene' || item.type === 'scene-layer' },
  { id: 'views', label: 'Views', match: (item) => item.host === 'topology-view' || item.type === 'topology-view' },
  { id: 'charts', label: 'Charts & Timelines', match: (item) => item.type === 'chart' || item.host === 'timeline' || item.contributionKind === 'timeline' },
  { id: 'panels', label: 'Panels', match: (item) => item.type === 'panel' || item.host === 'right-panel' || item.host === 'bottom-panel' },
  { id: 'controls', label: 'Controls & Legends', match: (item) => item.type === 'control' || item.type === 'legend' || item.host === 'control' || item.host === 'legend' }
];

function visualContributionGroup(item) {
  return VC_GROUPS.find((group) => group.match(item)) || VC_GROUPS[3];
}

function renderVisualContributionManager(container, registry) {
  const items = registry.list();
  if (!container._expandedVCIds) container._expandedVCIds = new Set();
  const collapsed = container.dataset.collapsed === 'true';
  container.classList.toggle('collapsed', collapsed);
  container.innerHTML = `
    <div class="vc-panel-head">
      <div class="panel-title">Visual Contributions</div>
      <div class="system-panel-actions">
        <button class="vc-collapse" title="${collapsed ? 'Expand list' : 'Collapse list'}">${collapsed ? '+' : '-'}</button>
        <button class="system-panel-minimize" data-target="contributions" title="Hide Visual Contributions">›</button>
      </div>
    </div>
    <div class="vc-list"></div>
  `;
  container.querySelector('.vc-collapse').addEventListener('click', () => {
    container.dataset.collapsed = collapsed ? 'false' : 'true';
    renderVisualContributionManager(container, registry);
  });
  const list = container.querySelector('.vc-list');
  if (!items.length) {
    list.innerHTML = '<div class="empty-state">No active visual contributions.</div>';
    return;
  }
  const childrenByParent = new Map();
  items.forEach((item) => {
    if (!item.parentId) return;
    if (!childrenByParent.has(item.parentId)) childrenByParent.set(item.parentId, []);
    childrenByParent.get(item.parentId).push(item);
  });

  const renderItem = (item, depth = 0) => {
    const children = childrenByParent.get(item.id) || [];
    const expanded = container._expandedVCIds.has(item.id);
    const row = document.createElement('div');
    row.className = `vc-item ${depth ? 'vc-child' : ''} ${children.length ? 'has-children' : ''} ${item.focused ? 'focused' : ''} ${item.muted ? 'muted' : ''} ${item.effectiveVisible === false ? 'composition-hidden' : ''}`;
    row.style.setProperty('--vc-depth', depth);
    const owner = registry.ownerLabel(item);
    const opacityText = item.setOpacity ? `${Math.round((item.effectiveOpacity ?? item.opacity ?? 1) * 100)}%` : '';
    const tooltip = [
      item.label,
      item.semanticRole ? `Role: ${item.semanticRole}` : '',
      owner ? `Owner: ${owner}` : '',
      item.host ? `Host: ${item.host}` : '',
      opacityText ? `Opacity: ${opacityText}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    row.title = tooltip;
    row.innerHTML = `
      <div class="vc-head">
        <label class="vc-visible-label">
          <input type="checkbox" class="vc-visible" ${item.visible ? 'checked' : ''}/>
          <span>${item.label}</span>
        </label>
        <div class="vc-actions">
          ${
            children.length
              ? `<button class="vc-expand" title="${expanded ? 'Collapse children' : 'Expand children'}">${expanded ? '-' : '+'}</button>`
              : ''
          }
          ${item.ownerFunctionId ? `<button class="vc-focus-owner" title="Focus ${attrText(owner || 'owner function')}">${focusIconSvg()}</button>` : ''}
          <button class="vc-pin ${item.pinned ? 'active' : ''}" title="${item.pinned ? 'Unpin' : 'Pin'}">${pinIconSvg()}</button>
        </div>
      </div>
    `;
    row.addEventListener('contextmenu', (event) => showContributionMenu(event, item, registry));
    row.addEventListener('click', (event) => {
      if (event.target.closest('button,input')) return;
      item.activate?.();
    });
    row.addEventListener('dblclick', (event) => {
      if (event.target.closest('button,input')) return;
      item.activate?.();
      item.focus?.();
    });
    row.querySelector('.vc-visible').addEventListener('change', (event) => {
      registry.setVisible(item.id, event.target.checked);
    });
    row.querySelector('.vc-focus-owner')?.addEventListener('click', () => registry.focusOwner(item.ownerFunctionId));
    row.querySelector('.vc-pin').addEventListener('click', () => registry.togglePinned(item.id));
    row.querySelector('.vc-expand')?.addEventListener('click', () => {
      if (expanded) container._expandedVCIds.delete(item.id);
      else container._expandedVCIds.add(item.id);
      renderVisualContributionManager(container, registry);
    });
    list.appendChild(row);
    if (expanded) children.forEach((child) => renderItem(child, depth + 1));
  };

  const topLevelItems = items.filter((item) => !item.parentId);
  const grouped = new Map(VC_GROUPS.map((group) => [group.id, []]));
  topLevelItems.forEach((item) => grouped.get(visualContributionGroup(item).id)?.push(item));
  VC_GROUPS.forEach((group) => {
    const groupItems = grouped.get(group.id) || [];
    if (!groupItems.length) return;
    const section = document.createElement('section');
    section.className = 'vc-group';
    section.innerHTML = `<div class="vc-group-title">${group.label}</div>`;
    list.appendChild(section);
    groupItems
      .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.label).localeCompare(String(b.label)))
      .forEach((item) => {
      renderItem(item);
      });
  });
}

function renderModuleBar(container, workspaces, activeWorkspace, setActiveWorkspace) {
  container.innerHTML = workspaces
    .map(
      (workspace) =>
        `<button class="module-button ${workspace.id === activeWorkspace?.id ? 'active' : ''}" data-id="${workspace.id}">
          ${workspace.label}
        </button>`
    )
    .join('');
  container.querySelectorAll('.module-button').forEach((button) => {
    button.addEventListener('click', () => setActiveWorkspace(button.dataset.id));
  });
}

function renderFunctionBar(container, workspace, toggleFunction, setActiveFunction) {
  container.innerHTML = `
    <div class="sidebar-head">
      <div class="sidebar-title">Functions</div>
      <button class="system-panel-minimize" data-target="functions" title="Hide functions">‹</button>
    </div>
    <div class="function-list"></div>
  `;
  const list = container.querySelector('.function-list');
  if (!workspace?.functions?.length) {
    list.innerHTML = '<div class="empty-state">No functions connected.</div>';
    return;
  }
  workspace.functions.forEach((fn) => {
    const row = document.createElement('div');
    row.className = `function-button ${fn.enabled ? 'enabled' : ''} ${workspace.focusedFunctionId === fn.id ? 'focused' : ''}`;
    row.title = `${fn.label}\n${fn.enabled ? 'Enabled' : 'Disabled'}${workspace.focusedFunctionId === fn.id ? '\nFocused' : ''}`;
    row.innerHTML = `
      <button class="function-main" title="${fn.enabled ? 'Disable' : 'Enable'} ${attrText(fn.label)}">
        <span>${fn.label}</span>
      </button>
      <button class="function-focus" title="Focus ${attrText(fn.label)}">${focusIconSvg()}</button>
    `;
    row.querySelector('.function-main').addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleFunction(workspace, fn);
      if (fn.enabled) setActiveFunction(workspace, fn);
    });
    const focus = () => setActiveFunction(workspace, fn);
    row.querySelector('.function-focus').addEventListener('click', focus);
    row.addEventListener('dblclick', async () => {
      if (!fn.enabled) await toggleFunction(workspace, fn);
      setActiveFunction(workspace, fn);
    });
    list.appendChild(row);
  });
}

function installSystemPanelToggles(shell) {
  const classByTarget = {
    workspace: 'workspace-panel-hidden',
    functions: 'functions-panel-hidden',
    contributions: 'contributions-panel-hidden'
  };
  const setHidden = (target, hidden) => {
    const cls = classByTarget[target];
    if (!cls) return;
    shell.classList.toggle(cls, hidden);
  };
  shell.addEventListener('click', (event) => {
    const minimize = event.target.closest('.system-panel-minimize');
    if (minimize) {
      event.preventDefault();
      event.stopPropagation();
      setHidden(minimize.dataset.target, true);
      return;
    }
    const handle = event.target.closest('.system-panel-handle');
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      setHidden(handle.dataset.target, false);
    }
  });
}

function makeFloatingPanelDraggable(panel, handleSelector = '.panel-title') {
  let drag = null;
  panel.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest(handleSelector);
    if (!handle || !panel.contains(handle) || event.button !== 0) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    panel.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
  });
  panel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const maxLeft = window.innerWidth - panel.offsetWidth - 8;
    const maxTop = window.innerHeight - panel.offsetHeight - 8;
    const left = Math.max(8, Math.min(maxLeft, event.clientX - drag.offsetX));
    const top = Math.max(72, Math.min(maxTop, event.clientY - drag.offsetY));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    panel.releasePointerCapture(event.pointerId);
    drag = null;
    panel.classList.remove('dragging');
  };
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);
}

async function bootstrap() {
  const root = document.getElementById('preview-root');
  root.innerHTML = `
    <div class="runtime-shell">
      <header class="runtime-topbar">
        <div class="runtime-brand">Workspace</div>
        <nav class="module-buttons"></nav>
        <button class="system-panel-minimize" data-target="workspace" title="Hide workspace bar">⌃</button>
      </header>
      <button class="system-panel-handle workspace-handle" data-target="workspace" title="Show workspace bar">Workspace</button>
      <main class="runtime-scene" id="scene-container"></main>
      <aside class="function-sidebar"></aside>
      <button class="system-panel-handle functions-handle" data-target="functions" title="Show functions">Functions</button>
      <aside class="vc-manager"></aside>
      <button class="system-panel-handle contributions-handle" data-target="contributions" title="Show Visual Contributions">Visual Contributions</button>
      <section class="control-panel glass-panel"></section>
    </div>
  `;

  const definitionRegistry = buildDefinitionRegistry();
  const graph = loadGraph(definitionRegistry);
  const { outputs } = await executeDataNodes(graph);
  const operators = buildOperatorInstances(graph, outputs);
  const workspaces = buildWorkspaces(graph, operators);
  const sceneManager = new SceneManager(document.getElementById('scene-container'));
  sceneManager.addLights();

  const moduleButtons = root.querySelector('.module-buttons');
  const functionSidebar = root.querySelector('.function-sidebar');
  const contributionPanel = root.querySelector('.vc-manager');
  const controlPanel = root.querySelector('.control-panel');
  const contributionRegistry = new VisualContributionRegistry(() =>
    renderVisualContributionManager(contributionPanel, contributionRegistry)
  );
  contributionRegistry.onFocusFunction = (functionId) => {
    const fn = activeWorkspace?.functions?.find((item) => item.id === functionId);
    if (fn) setActiveFunction(activeWorkspace, fn);
  };
  installSystemPanelToggles(root.querySelector('.runtime-shell'));
  makeFloatingPanelDraggable(controlPanel);

  let activeWorkspace = workspaces[0];
  let activeFunction = null;
  const dependencyRefCounts = new Map();
  const rootOperatorSessions = new Map();

  function clearWorkspaceSelection(workspace = activeWorkspace) {
    if (!workspace?.context) return;
    [
      'selection',
      'selectedBranch',
      'selectedFacility',
      'selectedPerson',
      'selectedRoute',
      'selectedResource',
      'selectedHazardSegment',
      'selectedRoadwaySegment',
      'selectedGeologicalUnit',
      'selectedGeologicalBody',
      'selectedSurface',
      'selectedBorehole',
      'selectedStructure',
      'selectedBlock',
      'selectedAttributeElement',
      'selectedSectionElement',
      'selectedGeologicalRegion'
    ].forEach((key) => workspace.context.set(key, null));
    sceneManager.highlightRoadwayEdges?.([]);
    sceneManager.highlightVentilationBranch?.(null);
    sceneManager.highlightVentilationFacility?.(null);
    sceneManager.highlightAirflowBranch?.(null);
    sceneManager.highlightAnomalyBranch?.(null);
  }

  sceneManager.onBlankPick = () => clearWorkspaceSelection(activeWorkspace);

  function isInteractiveGenerativeDependency(operator) {
    return ['WaterInrushSimulationOperator', 'FireAndSmokeSimulationOperator'].includes(operator?.nodeModel?.typeId);
  }

  async function attachDependency(workspace, fn, operator) {
    const rootAttachment = rootOperatorSessions.get(operator.id);
    if (rootAttachment) {
      const record = dependencyRefCounts.get(operator.id) || {
        session: rootAttachment.session,
        refs: new Set(),
        externalRoot: true
      };
      record.refs.add(fn.id);
      dependencyRefCounts.set(operator.id, record);
      return rootAttachment.session;
    }
    const existing = dependencyRefCounts.get(operator.id);
    if (existing) {
      existing.refs.add(fn.id);
      return existing.session;
    }
    const session = await operator.attach({
      sceneManager,
      context: workspace.context,
      contributionRegistry,
      functionId: fn.id,
      mode: 'dependency',
      exposure: isInteractiveGenerativeDependency(operator) ? 'simulation-context' : 'none'
    });
    dependencyRefCounts.set(operator.id, { session, refs: new Set([fn.id]) });
    return session;
  }

  function releaseDependency(fn, operator, { keepPinned = true } = {}) {
    const record = dependencyRefCounts.get(operator.id);
    if (!record) return;
    record.refs.delete(fn.id);
    if (record.refs.size) return;
    if (record.externalRoot && rootOperatorSessions.has(operator.id)) {
      const rootAttachment = rootOperatorSessions.get(operator.id);
      if (rootAttachment?.rootClosed) {
        contributionRegistry.unregisterOwner(operator.id, { keepPinned });
        rootAttachment.session?.cleanup?.();
        rootOperatorSessions.delete(operator.id);
      }
      dependencyRefCounts.delete(operator.id);
      return;
    }
    contributionRegistry.unregisterOwner(operator.id, { keepPinned });
    record.session?.cleanup?.();
    dependencyRefCounts.delete(operator.id);
  }

  function renderFunctionControls(workspace, fn) {
    controlPanel.innerHTML = '';
    if (!fn?.enabled) {
      controlPanel.style.display = 'none';
      return;
    }
    const exposedDependencies = (fn.dependencies || []).filter(isInteractiveGenerativeDependency);
    exposedDependencies.forEach((operator) => {
      const section = document.createElement('section');
      section.className = 'dependency-control-section';
      section.dataset.dependencyOperator = operator.id;
      operator.renderControls?.(section);
      controlPanel.appendChild(section);
    });
    const rootSection = document.createElement('section');
    rootSection.className = 'root-control-section';
    if (typeof fn.operator.renderControls === 'function') {
      fn.operator.renderControls(rootSection);
    } else {
      rootSection.innerHTML = `<div class="panel-title">${fn.label || fn.operator?.label || 'Function'}</div><div class="muted-note">This function does not expose workspace controls.</div>`;
    }
    controlPanel.appendChild(rootSection);
    controlPanel.style.display = 'block';
  }

  async function attachFunction(workspace, fn) {
    if (fn.enabled) return;
    fn.dependencySessions = [];
    for (const dependency of fn.dependencies || []) {
      const session = await attachDependency(workspace, fn, dependency);
      fn.dependencySessions.push({ operator: dependency, session });
    }
    fn.session = await fn.operator.attach({
      sceneManager,
      context: workspace.context,
      contributionRegistry,
      functionId: fn.id,
      mode: 'root',
      exposure: 'full'
    });
    (fn.dependencies || []).forEach((dependency) => dependency.updateViews?.());
    fn.operator.recomputeRoutes?.();
    rootOperatorSessions.set(fn.operator.id, { session: fn.session, functionId: fn.id });
    fn.enabled = true;
    contributionRegistry.setFunctionLabels(workspace.functions);
  }

  function closeFunction(fn, { keepPinned = true, remember = true } = {}) {
    if (remember) fn.rememberedEnabled = fn.enabled;
    if (!fn.enabled) return;
    const dependencyRecord = dependencyRefCounts.get(fn.operator.id);
    const heldByDependency = dependencyRecord?.refs?.size > 0;
    if (!heldByDependency) {
      contributionRegistry.unregisterOwner(fn.operator.id, { keepPinned });
      fn.session?.cleanup?.();
      rootOperatorSessions.delete(fn.operator.id);
    } else {
      const rootAttachment = rootOperatorSessions.get(fn.operator.id);
      if (rootAttachment) rootAttachment.rootClosed = true;
    }
    (fn.dependencies || []).forEach((dependency) => releaseDependency(fn, dependency, { keepPinned }));
    fn.dependencySessions = [];
    fn.session = null;
    fn.enabled = false;
    if (activeWorkspace?.focusedFunctionId === fn.id) {
      const fallback = activeWorkspace.functions.find((item) => item.enabled && item.id !== fn.id) || null;
      if (fallback) setActiveFunction(activeWorkspace, fallback);
      else hideActiveControls();
    }
  }

  function hideActiveControls() {
    activeFunction = null;
    if (activeWorkspace) activeWorkspace.focusedFunctionId = null;
    contributionRegistry.setFocusedFunction(null);
    controlPanel.innerHTML = '';
    controlPanel.style.display = 'none';
  }

  function suspendWorkspace(workspace) {
    if (!workspace) return;
    workspace.functions.forEach((fn) => closeFunction(fn, { keepPinned: false, remember: true }));
    hideActiveControls();
  }

  async function restoreWorkspace(workspace) {
    if (!workspace) return;
    for (const fn of workspace.functions) {
      if (fn.rememberedEnabled) await attachFunction(workspace, fn);
    }
    const restoredActive = workspace.functions.find((fn) => fn.enabled) || null;
    if (restoredActive) setActiveFunction(workspace, restoredActive);
    else hideActiveControls();
  }

  const setActiveWorkspace = async (workspaceId) => {
    const nextWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? activeWorkspace;
    if (nextWorkspace?.id !== activeWorkspace?.id) {
      suspendWorkspace(activeWorkspace);
      activeWorkspace = nextWorkspace;
      await restoreWorkspace(activeWorkspace);
    } else {
      activeWorkspace = nextWorkspace;
    }
    contributionRegistry.setFunctionLabels(activeWorkspace?.functions || []);
    contributionRegistry.setFocusedFunction(activeWorkspace?.focusedFunctionId || null);
    renderModuleBar(moduleButtons, workspaces, activeWorkspace, setActiveWorkspace);
    renderFunctionBar(functionSidebar, activeWorkspace, toggleFunction, setActiveFunction);
  };

  const setActiveFunction = (workspace, fn) => {
    activeFunction = fn;
    if (workspace) workspace.focusedFunctionId = fn?.id || null;
    contributionRegistry.setFocusedFunction(fn?.id || null);
    renderFunctionControls(workspace, fn);
    renderFunctionBar(functionSidebar, workspace, toggleFunction, setActiveFunction);
  };

  async function toggleFunction(workspace, fn) {
    if (!fn.enabled) {
      await attachFunction(workspace, fn);
      fn.rememberedEnabled = true;
    } else {
      closeFunction(fn, { keepPinned: true, remember: false });
      fn.rememberedEnabled = false;
    }
    contributionRegistry.setFunctionLabels(workspace.functions);
    if (workspace === activeWorkspace) renderFunctionBar(functionSidebar, workspace, toggleFunction, setActiveFunction);
  }

  renderVisualContributionManager(contributionPanel, contributionRegistry);
  await setActiveWorkspace(activeWorkspace?.id);
  if (activeWorkspace?.functions?.[0]) {
    await toggleFunction(activeWorkspace, activeWorkspace.functions[0]);
    setActiveFunction(activeWorkspace, activeWorkspace.functions[0]);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  document.getElementById('preview-root').innerHTML = `<pre class="preview-error">${error.stack || error.message}</pre>`;
});
