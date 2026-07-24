const TOOL_DOCKS = Object.freeze(['left', 'right', 'top', 'bottom', 'center', 'floating']);
const VIEW_DOCKS = Object.freeze(['left', 'right', 'top', 'bottom', 'center', 'floating']);

const CONTENT_DEFAULTS = Object.freeze({
  control: { profile: 'form', padding: 'compact', overflow: 'auto' },
  detail: { profile: 'table', padding: 'compact', overflow: 'auto' },
  legend: { profile: 'table', padding: 'compact', overflow: 'auto' },
  'primary-view': { profile: 'canvas', padding: 'none', overflow: 'hidden' },
  manager: { profile: 'form', padding: 'compact', overflow: 'auto' },
  layer: { profile: 'scene', padding: 'none', overflow: 'hidden' }
});

const ROLE_DEFAULTS = Object.freeze({
  control: {
    zone: 'tool',
    preferredRegion: 'right',
    preferredSize: { width: 288, height: 380 },
    minSize: { width: 244, height: 150 },
    maxViewportRatio: { width: 0.32, height: 0.82 },
    tabGroup: 'right-controls',
    allowedDock: TOOL_DOCKS
  },
  detail: {
    zone: 'tool',
    preferredRegion: 'right',
    preferredSize: { width: 276, height: 260 },
    minSize: { width: 230, height: 120 },
    maxViewportRatio: { width: 0.32, height: 0.76 },
    tabGroup: 'right-inspectors',
    allowedDock: TOOL_DOCKS
  },
  legend: {
    zone: 'tool',
    preferredRegion: 'right',
    preferredSize: { width: 276, height: 210 },
    minSize: { width: 220, height: 110 },
    maxViewportRatio: { width: 0.32, height: 0.68 },
    tabGroup: 'right-inspectors',
    allowedDock: TOOL_DOCKS
  },
  'primary-view': {
    zone: 'document',
    preferredRegion: 'bottom',
    preferredSize: { width: 720, height: 250 },
    minSize: { width: 320, height: 160 },
    maxViewportRatio: { width: 1, height: 0.38 },
    tabGroup: 'bottom-views',
    allowedDock: VIEW_DOCKS
  },
  manager: {
    zone: 'system',
    preferredRegion: 'floating',
    preferredSize: { width: 260, height: 340 },
    minSize: { width: 230, height: 170 },
    maxViewportRatio: { width: 0.34, height: 0.72 },
    tabGroup: null,
    allowedDock: [],
    dockable: false,
    floatable: false,
    autoHide: false
  },
  layer: {
    zone: 'scene',
    preferredRegion: 'scene',
    preferredSize: null,
    minSize: null,
    maxViewportRatio: null,
    tabGroup: null,
    allowedDock: [],
    dockable: false,
    floatable: false,
    resizable: false,
    closable: false,
    maximizable: false
  }
});

function inferLayoutRole(contribution = {}) {
  const kind = String(contribution.contributionKind || contribution.type || '').toLowerCase();
  const role = String(contribution.semanticRole || '').toLowerCase();
  const host = String(contribution.host || '').toLowerCase();
  if (host === 'main-3d-scene' || kind === 'layer' || kind === 'scene-layer') return 'layer';
  if (role === 'control' || kind === 'control' || host === 'control') return 'control';
  if (role === 'legend' || kind === 'legend' || host === 'legend') return 'legend';
  if (
    kind === 'chart' ||
    kind === 'topology-view' ||
    kind === 'drawing' ||
    host === 'bottom-panel' ||
    host === 'topology-view' ||
    host === 'timeline'
  ) return 'primary-view';
  if (role === 'manager') return 'manager';
  return 'detail';
}

export function normalizeContributionLayout(contribution = {}) {
  const descriptorLayout = contribution.descriptor?.layout || {};
  const explicitLayout = contribution.layout || {};
  const role = explicitLayout.role || descriptorLayout.role || inferLayoutRole(contribution);
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.detail;
  const defaultContent = CONTENT_DEFAULTS[role] || CONTENT_DEFAULTS.detail;
  const descriptorContent = descriptorLayout.content || {};
  const explicitContent = explicitLayout.content || {};
  return {
    role,
    zone: role === 'primary-view' ? 'document' : 'tool',
    preferredRegion: 'right',
    preferredSize: { width: 320, height: 280 },
    minSize: { width: 240, height: 140 },
    maxViewportRatio: { width: 0.32, height: 0.82 },
    tabGroup: null,
    allowedDock: role === 'primary-view' ? VIEW_DOCKS : TOOL_DOCKS,
    priority: Number(contribution.priority ?? 0),
    dockable: true,
    floatable: true,
    resizable: true,
    closable: true,
    maximizable: true,
    autoHide: false,
    documentRoot: false,
    ...defaults,
    ...descriptorLayout,
    ...explicitLayout,
    role,
    content: {
      ...defaultContent,
      ...descriptorContent,
      ...explicitContent
    }
  };
}

export function normalizeContributionRelations(contribution = {}) {
  return {
    controlsFor: [],
    legendFor: [],
    detailsFor: [],
    coordinatesWith: [],
    contextKeys: [],
    ...(contribution.descriptor?.relations || {}),
    ...(contribution.relations || {})
  };
}

export function layoutRoleForElement(element, fallback = 'detail') {
  if (!element) return fallback;
  const text = `${element.dataset?.workspacePanelTitle || ''} ${element.className || ''}`.toLowerCase();
  if (/control|filter|parameter/.test(text)) return 'control';
  if (/legend/.test(text)) return 'legend';
  if (/chart|histogram|topology|map|section-view|profile|correlation|timeline|drawing/.test(text)) return 'primary-view';
  if (/manager|contribution/.test(text)) return 'manager';
  return fallback;
}

export const ContributionLayoutDefaults = ROLE_DEFAULTS;
