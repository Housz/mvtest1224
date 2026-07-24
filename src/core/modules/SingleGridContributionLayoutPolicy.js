const ROLE_DEFAULTS = Object.freeze({
  control: {
    preferredRegion: 'right',
    preferredSize: { width: 288, height: 320 },
    tabGroup: 'right-tools',
    content: { profile: 'form', padding: 'compact', overflow: 'auto' }
  },
  detail: {
    preferredRegion: 'right',
    preferredSize: { width: 288, height: 260 },
    tabGroup: 'right-tools',
    content: { profile: 'table', padding: 'compact', overflow: 'auto' }
  },
  legend: {
    preferredRegion: 'right',
    preferredSize: { width: 288, height: 220 },
    tabGroup: 'right-tools',
    content: { profile: 'table', padding: 'compact', overflow: 'auto' }
  },
  'primary-view': {
    preferredRegion: 'bottom',
    preferredSize: { width: 720, height: 250 },
    tabGroup: 'bottom-views',
    content: { profile: 'canvas', padding: 'none', overflow: 'hidden' }
  },
  manager: {
    preferredRegion: 'right',
    preferredSize: { width: 288, height: 320 },
    tabGroup: 'right-tools',
    content: { profile: 'form', padding: 'compact', overflow: 'auto' }
  },
  layer: {
    preferredRegion: 'center',
    preferredSize: { width: 760, height: 520 },
    tabGroup: 'main-views',
    content: { profile: 'scene', padding: 'none', overflow: 'hidden' }
  }
});

function inferRole(contribution = {}) {
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

function inferContentProfile(contribution = {}, role = 'detail') {
  const kind = String(contribution.contributionKind || contribution.type || '').toLowerCase();
  const host = String(contribution.host || '').toLowerCase();
  const element = contribution.element;
  const classes = String(element?.className || '').toLowerCase();

  if (host === 'main-3d-scene' || kind === 'layer' || kind === 'scene-layer') return 'scene';
  if (
    kind === 'chart' ||
    kind === 'histogram' ||
    /(^|\s)(chart|histogram)(-|\s|$)/.test(classes) ||
    element?.querySelector?.('.chart-panel, .chart-host, .echarts-container')
  ) return 'chart';
  if (
    kind === 'topology-view' ||
    kind === 'drawing' ||
    role === 'primary-view' ||
    element?.querySelector?.('canvas, svg')
  ) return 'canvas';
  if (role === 'legend' || role === 'detail') return 'table';
  return 'form';
}

export function normalizeSingleGridLayout(contribution = {}) {
  const descriptor = contribution.descriptor?.layout || {};
  const explicit = contribution.layout || {};
  const role = explicit.role || descriptor.role || inferRole(contribution);
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.detail;
  const preferredRegion = explicit.preferredRegion || descriptor.preferredRegion || defaults.preferredRegion;
  const inferredProfile = inferContentProfile(contribution, role);
  const canonicalGroup = preferredRegion === 'center'
    ? 'main-views'
    : preferredRegion === 'bottom' || preferredRegion === 'top'
      ? 'bottom-views'
      : 'right-tools';
  const normalized = {
    role,
    preferredRegion,
    preferredSize: { ...defaults.preferredSize },
    minSize: { width: 180, height: 120 },
    tabGroup: canonicalGroup,
    priority: Number(contribution.priority ?? 0),
    ...descriptor,
    ...explicit,
    role,
    preferredRegion,
    minSize: { width: 180, height: 120 },
    tabGroup: canonicalGroup,
    dockable: true,
    floatable: true,
    resizable: true,
    closable: true,
    content: {
      ...defaults.content,
      profile: inferredProfile,
      padding: ['scene', 'canvas', 'chart'].includes(inferredProfile) ? 'none' : 'compact',
      overflow: ['scene', 'canvas', 'chart'].includes(inferredProfile) ? 'hidden' : 'auto',
      ...(descriptor.content || {}),
      ...(explicit.content || {})
    }
  };
  // Legacy descriptors can still contain fields from the former document/tool,
  // edge-group and auto-hide models. They are intentionally not part of the
  // single-grid Panel contract and must not leak into runtime policy decisions.
  delete normalized.zone;
  delete normalized.documentRoot;
  delete normalized.allowedDock;
  delete normalized.autoHide;
  delete normalized.pinnable;
  delete normalized.maximizable;
  return normalized;
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
export function roleForPanelElement(element, fallback = 'detail') {
  const text = `${element?.dataset?.workspacePanelTitle || ''} ${element?.className || ''}`.toLowerCase();
  if (/control|filter|parameter/.test(text)) return 'control';
  if (/legend/.test(text)) return 'legend';
  if (/chart|histogram|topology|map|section|profile|correlation|timeline|drawing/.test(text)) {
    return 'primary-view';
  }
  return fallback;
}

export { ROLE_DEFAULTS as SingleGridLayoutDefaults };
