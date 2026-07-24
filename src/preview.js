import { GraphModel } from './core/graph/GraphModel.js';
import { NodeDefinitionRegistry } from './core/graph/NodeDefinitionRegistry.js';
import { DataRegistry } from './core/datasets/DataRegistry.js';
import { DataNodeDefinitions } from './core/nodes/DataNodes.js';
import { OperatorNodeDefinitions } from './core/operators/OperatorNodes.js';
import { ModuleNodeDefinitions } from './core/modules/ModuleNodes.js';
import { SceneManager } from './scene/SceneManager.js';
import { WorkspaceCompiler } from './core/modules/WorkspaceCompiler.js';
import { WorkspaceRuntime } from './core/modules/WorkspaceRuntime.js';
import { VisualContributionManager } from './core/modules/VisualContributionManager.js';
import { WorkspaceHostRegistry } from './core/modules/WorkspaceHostRegistry.js';
import { WorkspaceLayoutService } from './core/modules/WorkspaceLayoutServiceV6.js';
import { LayoutStateStore, graphLayoutIdentity, previewViewportClass } from './core/modules/LayoutStateStore.js';
import { SceneViewportInsets } from './core/modules/SceneViewportInsets.js';
import { mapWithConcurrency, nowMs, yieldToMainThread } from './core/runtime/CooperativeTaskScheduler.js';
import { SystemChromeService } from './core/modules/SystemChromeService.js';
import { renderLucideIcons } from './ui/LucideIcons.js';
import 'dockview/dist/styles/dockview.css';
import './ui/preview-tokens.css';
import './ui/preview-shell.css';
import './ui/preview-workspace.css';
import './ui/preview-components.css';
import './ui/preview-operators.css';
import './ui/preview-chart-presentations.css';

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

async function executeDataNodes(graph, { onProgress = null, concurrency = 3 } = {}) {
  const dataRegistry = new DataRegistry();
  const outputs = new Map();
  const dataNodes = graph.nodes.filter((item) => item.kind === 'data');
  await mapWithConcurrency(dataNodes, async (node) => {
    const result = await node.runtime.execute(dataRegistry, node);
    outputs.set(node.id, result);
    dataRegistry.register(node.id, result.dataset);
    return result;
  }, {
    concurrency,
    onProgress: (progress) => onProgress?.({
      ...progress,
      nodeId: progress.item?.id,
      label: progress.item?.label || progress.item?.definition?.label || 'Data Node'
    })
  });
  return { dataRegistry, outputs };
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

function createIconButton(id, title, iconName, className = 'runtime-icon-button') {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = className;
  button.title = title;
  button.setAttribute('aria-label', title);
  const icon = document.createElement('i');
  icon.dataset.lucide = iconName;
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  return button;
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
  const layoutService = container._layoutService || null;
  if (!container._expandedVCIds) container._expandedVCIds = new Set();
  const collapsed = container.dataset.collapsed === 'true';
  container.classList.toggle('collapsed', collapsed);
  container.innerHTML = `
    <div class="vc-panel-head">
      <div class="panel-title">Visual Contributions</div>
      <span class="system-panel-badge">System</span>
      <div class="system-panel-actions">
        <button class="vc-collapse" title="${collapsed ? 'Expand list' : 'Collapse list'}">${collapsed ? '+' : '-'}</button>
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
    const managedPanel = layoutService?.isPanelRegistered?.(item.id) === true;
    const panelOpen = !managedPanel || layoutService?.isPanelOpen?.(item.id) === true;
    row.className = `vc-item ${depth ? 'vc-child' : ''} ${children.length ? 'has-children' : ''} ${item.focused ? 'focused' : ''} ${item.muted ? 'muted' : ''} ${item.effectiveVisible === false ? 'composition-hidden' : ''} ${panelOpen ? '' : 'layout-closed'}`;
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
          ${managedPanel && !panelOpen ? '<button class="vc-open-panel" title="Open panel" aria-label="Open panel">Open</button>' : ''}
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
      if (managedPanel) layoutService.activatePanel(item.id);
      else item.activate?.();
    });
    row.addEventListener('dblclick', (event) => {
      if (event.target.closest('button,input')) return;
      if (managedPanel) layoutService.activatePanel(item.id);
      else item.activate?.();
      item.focus?.();
    });
    row.querySelector('.vc-visible').addEventListener('change', (event) => {
      registry.setVisible(item.id, event.target.checked);
      if (event.target.checked && managedPanel) layoutService.activatePanel(item.id);
    });
    row.querySelector('.vc-open-panel')?.addEventListener('click', () => layoutService.activatePanel(item.id));
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
      <span class="system-panel-badge">System</span>
    </div>
    <div class="function-list"></div>
  `;
  const list = container.querySelector('.function-list');
  if (!workspace?.functions?.length) {
    list.innerHTML = '<div class="empty-state">No functions connected.</div>';
    return;
  }
  workspace.functions.forEach((fn) => {
    const loading = Boolean(fn.loading);
    const status = loading ? 'Loading' : fn.error ? 'Error' : fn.enabled ? 'Enabled' : 'Disabled';
    const row = document.createElement('div');
    row.className = `function-button ${fn.enabled ? 'enabled' : ''} ${loading ? 'loading' : ''} ${fn.error ? 'error' : ''} ${workspace.focusedFunctionId === fn.id ? 'focused' : ''}`;
    row.title = `${fn.label}\n${status}${fn.error ? `: ${fn.error}` : ''}${workspace.focusedFunctionId === fn.id ? '\nFocused' : ''}`;
    row.innerHTML = `
      <button class="function-main" ${loading ? 'disabled' : ''} title="${loading ? 'Loading' : fn.enabled ? 'Disable' : 'Enable'} ${attrText(fn.label)}">
        <span>${fn.label}</span>
        ${loading ? '<span class="function-busy" aria-label="Loading"></span>' : ''}
      </button>
      <button class="function-focus" ${loading || !fn.enabled ? 'disabled' : ''} title="Focus ${attrText(fn.label)}">${focusIconSvg()}</button>
    `;
    row.querySelector('.function-main').addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleFunction(workspace, fn);
    });
    const focus = () => {
      if (fn.enabled && !fn.loading) setActiveFunction(workspace, fn);
    };
    row.querySelector('.function-focus').addEventListener('click', focus);
    row.addEventListener('dblclick', async () => {
      if (fn.loading) return;
      if (!fn.enabled) await toggleFunction(workspace, fn);
      if (fn.enabled) setActiveFunction(workspace, fn);
    });
    list.appendChild(row);
  });
}

async function bootstrap() {
  const loadingMetrics = {
    startedAt: nowMs(),
    dataNodes: [],
    sourceStarts: new Map(),
    ready: false
  };
  window.minevisPreviewLoading = loadingMetrics;
  const root = document.getElementById('preview-root');
  root.innerHTML = `
    <div class="runtime-shell" tabindex="-1">
      <header class="runtime-topbar" aria-label="Workspace toolbar">
        <nav class="module-buttons" aria-label="Workspaces"></nav>
      </header>
      <div class="runtime-dock-overlay" aria-label="Dockable visual analysis workspace"></div>
      <aside id="system-functions-panel" class="function-sidebar system-chrome-panel" aria-label="Functions"></aside>
      <aside id="system-contributions-panel" class="vc-manager system-chrome-panel" aria-label="Visual Contributions"></aside>
      <div class="workspace-panel-staging" aria-hidden="true">
        <main class="runtime-scene" id="scene-container" aria-label="Main Scene"></main>
        <section class="control-panel glass-panel"></section>
      </div>
      <div class="preview-loading-overlay" role="status" aria-live="polite">
        <div class="preview-loading-card">
          <div class="preview-loading-title">Preparing MineVis workspace</div>
          <div class="preview-loading-message">Discovering data sources...</div>
          <div class="preview-loading-track"><span></span></div>
        </div>
      </div>
    </div>
  `;

  const definitionRegistry = buildDefinitionRegistry();
  const graph = loadGraph(definitionRegistry);
  const loadingOverlay = root.querySelector('.preview-loading-overlay');
  const loadingMessage = loadingOverlay.querySelector('.preview-loading-message');
  const loadingProgress = loadingOverlay.querySelector('.preview-loading-track span');
  const updateLoading = (message, fraction = null) => {
    loadingMessage.textContent = message;
    if (Number.isFinite(fraction)) loadingProgress.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  };
  await yieldToMainThread();
  const { outputs } = await executeDataNodes(graph, {
    concurrency: 3,
    onProgress: ({ phase, completed, total, label, nodeId, durationMs }) => {
      if (phase === 'start') {
        loadingMetrics.sourceStarts.set(nodeId, nowMs());
        updateLoading(`Loading ${label}...`, total ? completed / total : 0);
      }
      if (phase === 'complete') {
        const completedAt = nowMs();
        const startedAt = loadingMetrics.sourceStarts.get(nodeId) ?? completedAt - (Number(durationMs) || 0);
        loadingMetrics.dataNodes.push({ nodeId, label, durationMs, startedAt, completedAt });
        updateLoading(`Loaded ${label}`, total ? completed / total : 1);
      }
    }
  });
  loadingMetrics.dataReadyAt = nowMs();
  loadingMetrics.dataDurationMs = loadingMetrics.dataReadyAt - loadingMetrics.startedAt;
  updateLoading('Compiling workspace...', 1);
  await yieldToMainThread();
  const compiler = new WorkspaceCompiler({ graph, definitionRegistry });
  const { workspaces, diagnostics: compilerDiagnostics } = compiler.compile(outputs);
  loadingMetrics.compiledAt = nowMs();
  loadingMetrics.compileDurationMs = loadingMetrics.compiledAt - loadingMetrics.dataReadyAt;
  if (compilerDiagnostics.some((item) => item.severity === 'error')) {
    console.warn('[MineVis workspace compiler]', compilerDiagnostics);
  }
  const moduleButtons = root.querySelector('.module-buttons');
  const functionSidebar = root.querySelector('.function-sidebar');
  const contributionPanel = root.querySelector('.vc-manager');
  const controlPanel = root.querySelector('.control-panel');
  const sceneContainer = root.querySelector('#scene-container');
  const shell = root.querySelector('.runtime-shell');
  const topbar = root.querySelector('.runtime-topbar');
  const dockOverlay = root.querySelector('.runtime-dock-overlay');
  const stagingElement = root.querySelector('.workspace-panel-staging');
  stagingElement.inert = true;

  const functionsToggle = createIconButton(
    'workspace-functions-toggle',
    'Hide Functions',
    'panel-left',
    'runtime-icon-button system-panel-toggle system-panel-toggle-functions'
  );
  functionsToggle.dataset.systemPanelToggle = 'functions';
  functionsToggle.setAttribute('aria-controls', 'system-functions-panel');
  topbar.prepend(functionsToggle);

  const toolbarActions = document.createElement('div');
  toolbarActions.className = 'runtime-workspace-actions';
  const resetLayoutButton = createIconButton('workspace-reset-layout', 'Reset Layout', 'rotate-ccw');
  const contributionsToggle = createIconButton(
    'workspace-contributions-toggle',
    'Show Visual Contributions',
    'panel-right',
    'runtime-icon-button system-panel-toggle system-panel-toggle-contributions'
  );
  contributionsToggle.dataset.systemPanelToggle = 'contributions';
  contributionsToggle.setAttribute('aria-controls', 'system-contributions-panel');
  toolbarActions.append(resetLayoutButton, contributionsToggle);
  topbar.appendChild(toolbarActions);
  renderLucideIcons(shell);

  let activeWorkspace = workspaces[0];
  let activeFunction = null;
  const contributionRegistry = new VisualContributionManager(() =>
    renderVisualContributionManager(contributionPanel, contributionRegistry)
  );
  loadingMetrics.servicesStartedAt = nowMs();
  const sceneManager = new SceneManager(sceneContainer);
  sceneManager.addLights();
  loadingMetrics.sceneManagerReadyAt = nowMs();
  const layoutService = new WorkspaceLayoutService({
    container: dockOverlay,
    stagingElement,
    contributionManager: contributionRegistry,
    stateStore: new LayoutStateStore('minevis.preview.layout.v6'),
    scope: {
      graphId: graphLayoutIdentity(graph),
      workspaceId: activeWorkspace?.id || 'workspace',
      viewportClass: previewViewportClass()
    }
  });
  contributionPanel._layoutService = layoutService;
  loadingMetrics.layoutServiceReadyAt = nowMs();
  const layoutUiDispose = layoutService.subscribeLayout(() => {
    renderVisualContributionManager(contributionPanel, contributionRegistry);
  });
  contributionRegistry.register({
    id: 'minevis:main-scene',
    label: 'Main Scene',
    type: 'panel',
    contributionKind: 'panel',
    semanticRole: 'detail',
    host: 'workspace',
    element: sceneContainer,
    resize: (size) => sceneManager.onResize(size),
    layout: {
      role: 'primary-view',
      preferredRegion: 'center',
      preferredSize: { width: 760, height: 520 },
      minSize: { width: 180, height: 120 },
      tabGroup: 'main-views',
      content: { profile: 'scene', padding: 'none', overflow: 'hidden' }
    }
  });
  layoutService.flushContributionSync();

  let fallbackControlsContributionId = null;
  const systemChrome = new SystemChromeService({
    shell,
    toolbar: topbar,
    panels: {
      functions: functionSidebar,
      contributions: contributionPanel
    },
    toggles: {
      functions: functionsToggle,
      contributions: contributionsToggle
    },
    scope: {
      graphId: graphLayoutIdentity(graph),
      workspaceId: activeWorkspace?.id || 'workspace',
      viewportClass: previewViewportClass()
    }
  });
  layoutService.setSystemChromeService(systemChrome);
  const sceneInsets = new SceneViewportInsets({
    workspaceElement: sceneContainer,
    sceneManager,
    layoutService,
    systemChromeService: systemChrome,
    toolbarElement: null
  });
  const hostRegistry = new WorkspaceHostRegistry().registerDefaults({
    scene: sceneManager,
    rightPanel: controlPanel
  });
  contributionRegistry.onFocusFunction = (functionId) => {
    const fn = activeWorkspace?.functions?.find((item) => item.id === functionId);
    if (fn) setActiveFunction(activeWorkspace, fn);
  };
  const updateWorkspaceChrome = () => {};
  resetLayoutButton.addEventListener('click', () => {
    layoutService.resetLayout();
    systemChrome.reset();
    updateWorkspaceChrome();
  });
  updateWorkspaceChrome();
  let currentViewportClass = previewViewportClass();
  let viewportClassFrame = 0;
  const handleViewportClassChange = () => {
    if (viewportClassFrame) return;
    viewportClassFrame = requestAnimationFrame(() => {
      viewportClassFrame = 0;
      const nextViewportClass = previewViewportClass();
      if (nextViewportClass === currentViewportClass) return;
      currentViewportClass = nextViewportClass;
      layoutService.setScope({
        graphId: graphLayoutIdentity(graph),
        workspaceId: activeWorkspace?.id || 'workspace',
        viewportClass: currentViewportClass
      });
      systemChrome.setScope({
        graphId: graphLayoutIdentity(graph),
        workspaceId: activeWorkspace?.id || 'workspace',
        viewportClass: currentViewportClass
      });
      layoutService.restoreSavedLayout();
      updateWorkspaceChrome();
    });
  };
  window.addEventListener('resize', handleViewportClassChange);
  const workspaceRuntimes = new Map(
    workspaces.map((workspace) => [workspace.id, new WorkspaceRuntime({
      workspace,
      sceneManager,
      contributionManager: contributionRegistry,
      hostRegistry,
      onFunctionStateChange: () => {
        if (workspace === activeWorkspace) {
          renderFunctionBar(functionSidebar, workspace, toggleFunction, setActiveFunction);
        }
      }
    })])
  );

  function runtimeFor(workspace) {
    return workspace ? workspaceRuntimes.get(workspace.id) : null;
  }

  function clearWorkspaceSelection(workspace = activeWorkspace) {
    runtimeFor(workspace)?.clearSelection();
    sceneManager.highlightRoadwayEdges?.([]);
    sceneManager.highlightVentilationBranch?.(null);
    sceneManager.highlightVentilationFacility?.(null);
    sceneManager.highlightAirflowBranch?.(null);
    sceneManager.highlightAnomalyBranch?.(null);
  }

  sceneManager.onBlankPick = () => clearWorkspaceSelection(activeWorkspace);

  function unregisterFallbackControls() {
    if (!fallbackControlsContributionId) return;
    contributionRegistry.unregister(fallbackControlsContributionId, { cleanup: false });
    fallbackControlsContributionId = null;
    layoutService.flushContributionSync();
  }

  function hideActiveControls() {
    activeFunction = null;
    runtimeFor(activeWorkspace)?.focusFunction(null);
    unregisterFallbackControls();
    controlPanel.innerHTML = '';
  }

  function renderFunctionControls(workspace, fn) {
    layoutService.flushContributionSync();
    if (layoutService.hasExplicitControl(fn?.id)) {
      unregisterFallbackControls();
      controlPanel.innerHTML = '';
      return;
    }
    const contributionId = `workspace:${workspace?.id || 'workspace'}:function-controls:${fn?.id || 'function'}`;
    if (fallbackControlsContributionId && fallbackControlsContributionId !== contributionId) {
      unregisterFallbackControls();
    }
    runtimeFor(workspace)?.renderControls(fn, controlPanel);
    controlPanel.classList.add('workspace-fallback-controls-content');
    contributionRegistry.register({
      id: contributionId,
      label: (fn?.label || 'Function') + ' Controls',
      type: 'control',
      contributionKind: 'control',
      semanticRole: 'control',
      host: 'right-panel',
      ownerId: fn?.id,
      ownerFunctionId: fn?.id,
      element: controlPanel,
      visible: true,
      layout: {
        role: 'control',
        preferredRegion: 'right',
        tabGroup: 'right-tools',
        priority: 90
      }
    });
    fallbackControlsContributionId = contributionId;
    layoutService.flushContributionSync();
    layoutService.activatePanel(contributionId);
  }

  async function attachFunction(workspace, fn) {
    await runtimeFor(workspace)?.attachFunction(fn);
    layoutService.flushContributionSync();
  }

  function closeFunction(workspace, fn, options = {}) {
    runtimeFor(workspace)?.closeFunction(fn, options);
    if (activeFunction?.id === fn.id) {
      const fallback = workspace.functions.find((item) => item.enabled && item.id !== fn.id) || null;
      if (fallback) setActiveFunction(workspace, fallback);
      else hideActiveControls();
    }
  }

  function suspendWorkspace(workspace) {
    runtimeFor(workspace)?.suspend();
    hideActiveControls();
  }

  async function restoreWorkspace(workspace) {
    const restored = await runtimeFor(workspace)?.restore();
    if (restored) setActiveFunction(workspace, restored);
    else hideActiveControls();
  }

  const setActiveWorkspace = async (workspaceId) => {
    const nextWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? activeWorkspace;
    if (nextWorkspace?.id !== activeWorkspace?.id) {
      suspendWorkspace(activeWorkspace);
      activeWorkspace = nextWorkspace;
      layoutService.setScope({
        graphId: graphLayoutIdentity(graph),
        workspaceId: activeWorkspace?.id || 'workspace',
        viewportClass: previewViewportClass()
      });
      systemChrome.setScope({
        graphId: graphLayoutIdentity(graph),
        workspaceId: activeWorkspace?.id || 'workspace',
        viewportClass: previewViewportClass()
      });
      await restoreWorkspace(activeWorkspace);
      layoutService.restoreSavedLayout();
    } else {
      activeWorkspace = nextWorkspace;
    }
    contributionRegistry.setFunctionLabels(activeWorkspace?.functions || []);
    contributionRegistry.setFocusedFunction(activeWorkspace?.focusedFunctionId || null);
    renderModuleBar(moduleButtons, workspaces, activeWorkspace, setActiveWorkspace);
    renderFunctionBar(functionSidebar, activeWorkspace, toggleFunction, setActiveFunction);
  };

  const setActiveFunction = (workspace, fn) => {
    if (!fn) {
      hideActiveControls();
      return;
    }
    activeFunction = fn;
    runtimeFor(workspace)?.focusFunction(fn);
    renderFunctionControls(workspace, fn);
    layoutService.focusFunction(fn.id);
    renderFunctionBar(functionSidebar, workspace, toggleFunction, setActiveFunction);
  };

  async function toggleFunction(workspace, fn) {
    if (fn.loading) return fn.enabled;
    const runtime = runtimeFor(workspace);
    try {
      await runtime?.toggleFunction(fn);
      contributionRegistry.setFunctionLabels(workspace.functions);
      if (fn.enabled) setActiveFunction(workspace, fn);
      else if (activeFunction?.id === fn.id) {
        const fallback = workspace.functions.find((item) => item.enabled) || null;
        if (fallback) setActiveFunction(workspace, fallback);
        else hideActiveControls();
      }
    } catch (error) {
      console.error(`[MineVis] Failed to ${fn.enabled ? 'disable' : 'enable'} ${fn.label}:`, error);
      fn.error = error?.message || String(error);
    } finally {
      if (workspace === activeWorkspace) {
        renderFunctionBar(functionSidebar, workspace, toggleFunction, setActiveFunction);
      }
    }
    return fn.enabled;
  }

  renderVisualContributionManager(contributionPanel, contributionRegistry);
  await setActiveWorkspace(activeWorkspace?.id);
  if (activeWorkspace?.functions?.[0]) {
    updateLoading(`Starting ${activeWorkspace.functions[0].label}...`, 1);
    loadingMetrics.initialFunctionStartedAt = nowMs();
    await toggleFunction(activeWorkspace, activeWorkspace.functions[0]);
    loadingMetrics.initialFunctionReadyAt = nowMs();
    loadingMetrics.initialFunctionDurationMs = loadingMetrics.initialFunctionReadyAt - loadingMetrics.initialFunctionStartedAt;
  }
  loadingMetrics.readyAt = nowMs();
  loadingMetrics.totalDurationMs = loadingMetrics.readyAt - loadingMetrics.startedAt;
  loadingMetrics.ready = true;
  loadingMetrics.sourceStarts.clear();
  layoutService.restoreSavedLayout();
  updateWorkspaceChrome();
  loadingOverlay.remove();

  if (import.meta.env.DEV) {
    window.minevisPreviewDebug = {
      graph,
      dataOutputs: outputs,
      sceneManager,
      contributionRegistry,
      layoutService,
      systemChrome,
      loadingMetrics,
      get activeWorkspace() {
        return activeWorkspace;
      },
      get activeFunction() {
        return activeFunction;
      },
      async toggleFunction(functionId) {
        const fn = activeWorkspace?.functions?.find((item) => item.id === functionId);
        if (!fn) return false;
        await toggleFunction(activeWorkspace, fn);
        return fn.enabled;
      },
      focusFunction(functionId) {
        const fn = activeWorkspace?.functions?.find((item) => item.id === functionId);
        if (!fn) return false;
        setActiveFunction(activeWorkspace, fn);
        return true;
      },
      diagnostics() {
        return {
          contributions: contributionRegistry.getDiagnostics(),
          layout: layoutService.getDiagnostics()
        };
      }
    };
  }

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('resize', handleViewportClassChange);
    if (viewportClassFrame) cancelAnimationFrame(viewportClassFrame);
    sceneInsets.dispose();
    layoutUiDispose();
    systemChrome.dispose();
    sceneManager.dispose();
    layoutService.dispose();
    delete window.minevisPreviewDebug;
    delete window.minevisPreviewLoading;
  }, { once: true });
}

bootstrap().catch((error) => {
  console.error(error);
  document.getElementById('preview-root').innerHTML = `<pre class="preview-error">${error.stack || error.message}</pre>`;
});
