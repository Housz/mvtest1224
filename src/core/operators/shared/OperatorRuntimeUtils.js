import * as THREE from 'three';
import {
  installRoadwayHazardViewSelection,
  renderRoadwayHazardViewPair
} from '../../../ui/RoadwayHazardViews.js';
import { sampleColor } from '../../../utils/colors.js';
import { SemanticContractRegistry } from '../../semantics/SemanticContractRegistry.js';
import { materializeDataset } from '../../semantics/DatasetMaterializers.js';

export const formatTime = (value) => {
  if (value == null) return '-';
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
};

export const buildContinuousTimeScale = (times = [], { subdivisions = 8, maxSteps = 720 } = {}) => {
  const values = [...new Set(times.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!values.length) {
    return {
      min: 0,
      max: 0,
      steps: 0,
      stepMs: 1,
      times: [],
      timeAt: () => 0,
      indexFor: () => 0,
      isSampleTime: () => false
    };
  }
  if (values.length === 1 || values[0] === values[values.length - 1]) {
    const only = values[0];
    return {
      min: only,
      max: only,
      steps: 0,
      stepMs: 1,
      times: values,
      timeAt: () => only,
      indexFor: () => 0,
      isSampleTime: (time) => Math.abs(Number(time) - only) < 1
    };
  }
  const intervals = [];
  for (let i = 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) intervals.push(delta);
  }
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)] || values[values.length - 1] - values[0];
  const min = values[0];
  const max = values[values.length - 1];
  const range = max - min;
  const targetStep = Math.max(medianInterval / subdivisions, range / maxSteps, 1);
  const steps = Math.max(1, Math.min(maxSteps, Math.ceil(range / targetStep)));
  const stepMs = range / steps;
  return {
    min,
    max,
    steps,
    stepMs,
    times: values,
    timeAt: (index) => min + Math.max(0, Math.min(steps, Number(index) || 0)) * stepMs,
    indexFor: (time) => Math.max(0, Math.min(steps, Math.round((Number(time) - min) / stepMs))),
    isSampleTime: (time) => values.some((sample) => Math.abs(sample - Number(time)) <= Math.max(1, stepMs * 0.04))
  };
};

export const getSelectionSensorID = (selection) => {
  if (!selection) return null;
  if (typeof selection === 'string') return selection;
  if (selection.type === 'sensor') return selection.id ?? selection.sensorID;
  return selection.id ?? selection.sensorID ?? null;
};

export const getSelectionBranchID = (selection) =>
  selection?.type === 'ventilationBranch' ? selection.id ?? selection.branchId : null;

export const getSelectionFacilityID = (selection) =>
  selection?.type === 'ventilationFacility' ? selection.id ?? selection.facilityId : null;

export const pointOf = (value = {}) => {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
};

export const formatScalar = (value, digits = 2) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits).replace(/\.?0+$/, '') : '-';
};


export function createRoadwayHazardDataset(rows, metadata = {}) {
  const contract = SemanticContractRegistry.get('RoadwayHazardStateContract');
  const dataset = materializeDataset({
    datasetType: 'RoadwayHazardState',
    contract,
    adaptorResults: { state: { rows } },
    roleMapping: {
      time: 'time',
      roadwayEdgeId: 'roadwayEdgeId',
      roadwayNodeId: 'roadwayNodeId',
      hazardType: 'hazardType',
      hazardValue: 'hazardValue',
      severity: 'severity',
      passability: 'passability',
      arrivalTime: 'arrivalTime',
      scenarioId: 'scenarioId'
    },
    sources: { state: { path: metadata.sourcePath || '' } }
  });
  dataset.metadata = { generatedAt: new Date().toISOString(), ...metadata };
  return dataset;
}

export function edgeLength(roadway, edge) {
  return roadway?.edgeLength?.(edge) || Math.max(1, (edge?.path || edge?.verts || []).length - 1 || 1);
}

export function edgeEndpoints(edge) {
  return [edge?.from ?? edge?.source ?? edge?.j1, edge?.to ?? edge?.target ?? edge?.j2].filter(Boolean).map(String);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function roadwayEdgePath(roadway, edge) {
  const raw = edge?.path?.length ? edge.path : edge?.verts?.length ? edge.verts : [];
  if (raw.length >= 2) return raw.map(pointOf);
  const [from, to] = edgeEndpoints(edge);
  return [roadway?.getNodePosition?.(from), roadway?.getNodePosition?.(to)].filter(Boolean).map(pointOf);
}

export function projectRoadwayPoints(points, width = 520, height = 320, padding = 22) {
  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const minX = Math.min(...valid.map((point) => point.x));
  const maxX = Math.max(...valid.map((point) => point.x));
  const minY = Math.min(...valid.map((point) => point.y));
  const maxY = Math.max(...valid.map((point) => point.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) * 0.5;
  const offsetY = (height - spanY * scale) * 0.5;
  return (point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: height - (offsetY + (point.y - minY) * scale)
  });
}

export function buildRoadwayTopologyLayout(roadway, sourceEdgeId, width = 520, height = 320) {
  const nodes = roadway?.getNodes?.() || [];
  const edges = roadway?.getEdges?.() || [];
  const nodeIds = nodes.map((node) => String(node.id));
  const adjacency = new Map(nodeIds.map((id) => [id, []]));
  edges.forEach((edge) => {
    const [from, to] = edgeEndpoints(edge);
    if (!from || !to) return;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push(to);
    adjacency.get(to).push(from);
  });
  const sourceEdge = edges.find((edge) => String(edge.id) === String(sourceEdgeId));
  const startIds = edgeEndpoints(sourceEdge || edges[0] || {});
  const distance = new Map();
  const queue = [];
  startIds.forEach((id) => {
    if (!id || distance.has(id)) return;
    distance.set(id, 0);
    queue.push(id);
  });
  while (queue.length) {
    const current = queue.shift();
    const nextDistance = distance.get(current) + 1;
    (adjacency.get(current) || []).forEach((next) => {
      if (distance.has(next)) return;
      distance.set(next, nextDistance);
      queue.push(next);
    });
  }
  const fallbackDistance = Math.max(1, ...[...distance.values(), 0]) + 1;
  nodeIds.forEach((id) => {
    if (!distance.has(id)) distance.set(id, fallbackDistance);
  });
  const layers = new Map();
  nodes.forEach((node) => {
    const layer = distance.get(String(node.id)) ?? fallbackDistance;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(node);
  });
  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  const positions = new Map();
  sortedLayers.forEach((layer, layerIndex) => {
    const layerNodes = layers
      .get(layer)
      .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
    const y = 24 + (height - 48) * (layerIndex / Math.max(1, sortedLayers.length - 1));
    layerNodes.forEach((node, index) => {
      const x = 30 + (width - 60) * ((index + 1) / (layerNodes.length + 1));
      positions.set(String(node.id), { x, y });
    });
  });
  return positions;
}

export function hazardViewState(state, style = 'water') {
  const ratio = Math.max(
    0,
    Math.min(
      1,
      Number(style === 'fire_smoke' ? state?.visualHazard ?? state?.hazardValue : state?.maxFillRatio ?? state?.hazardValue) || 0
    )
  );
  const passability = state?.passability || 'passable';
  const affected = ratio > 0.01 || Number(state?.hazardValue) > 0;
  const color =
    style === 'fire_smoke'
      ? passability === 'blocked'
        ? '#ff2f1f'
        : passability === 'risky'
          ? '#ff8a2a'
          : affected
            ? '#6f7682'
            : 'rgba(170, 181, 196, 0.34)'
      : passability === 'blocked'
        ? '#0b5dff'
        : passability === 'risky'
          ? '#1597ff'
          : affected
            ? '#58d7ff'
            : 'rgba(170, 181, 196, 0.34)';
  return {
    affected,
    passability,
    ratio,
    color,
    width: affected ? Math.max(2.6, 2.2 + ratio * 7) : 1.45
  };
}

export function selectedRoadwayEdgeId(context) {
  const hazard = context?.get?.('selectedHazardSegment');
  if (typeof hazard === 'string') return hazard;
  if (hazard?.id || hazard?.edgeId) return String(hazard.id ?? hazard.edgeId);
  const roadway = context?.get?.('selectedRoadwaySegment');
  if (typeof roadway === 'string') return roadway;
  if (roadway?.type === 'edge' && (roadway.id || roadway.edgeId)) return String(roadway.id ?? roadway.edgeId);
  const selection = context?.get?.('selection');
  if (selection?.type === 'roadwayHazardSegment' || selection?.type === 'roadwaySegment' || selection?.type === 'roadwayEdge') {
    return String(selection.id ?? selection.edgeId);
  }
  return null;
}

export function renderHazardRoadwayViews({ roadway, states = [], mapPanel, topologyPanel, selectedEdgeId, sourceEdgeId, sourceRatio = 0.5, style = 'water' }) {
  return renderRoadwayHazardViewPair({
    roadway,
    states,
    mapPanel,
    topologyPanel,
    selectedEdgeId,
    sourceEdgeId,
    sourceRatio,
    style,
    mapTitle: style === 'fire_smoke' ? 'Fire / Smoke 2D Map' : 'Water Inrush 2D Map',
    topologyTitle: style === 'fire_smoke' ? 'Fire / Smoke Topology' : 'Water Inrush Topology'
  });
  const width = 520;
  const height = 320;
  const edges = roadway?.getEdges?.() || [];
  const nodes = roadway?.getNodes?.() || [];
  const stateMap = new Map(states.filter((state) => state?.roadwayEdgeId).map((state) => [String(state.roadwayEdgeId), state]));
  const allPathPoints = edges.flatMap((edge) => roadwayEdgePath(roadway, edge));
  const project = allPathPoints.length ? projectRoadwayPoints(allPathPoints, width, height) : (point) => ({ x: point.x, y: point.y });
  const sourceStateClass = style === 'fire_smoke' ? 'fire-source' : 'water-source';

  const mapEdges = edges
    .map((edge) => {
      const edgeId = String(edge.id);
      const points = roadwayEdgePath(roadway, edge);
      if (points.length < 2) return '';
      const screen = points.map(project);
      const d = screen.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
      const visual = hazardViewState(stateMap.get(edgeId), style);
      const selected = selectedEdgeId && edgeId === String(selectedEdgeId);
      const source = sourceEdgeId && edgeId === String(sourceEdgeId);
      return `<path class="hazard-view-edge ${visual.affected ? 'affected' : ''} ${visual.passability} ${selected ? 'selected' : ''} ${source ? 'source' : ''}" data-edge-id="${escapeHtml(edgeId)}" d="${d}" style="--edge-color:${visual.color};--edge-width:${visual.width}px;"><title>${escapeHtml(edgeId)} - ${visual.passability}</title></path>`;
    })
    .join('');

  const mapNodes = nodes
    .map((node) => {
      const point = project(pointOf(node.position ?? node));
      return `<circle class="hazard-view-node" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.2"><title>${escapeHtml(node.id)}</title></circle>`;
    })
    .join('');

  const sourceEdge = edges.find((edge) => String(edge.id) === String(sourceEdgeId));
  const sourcePath = sourceEdge ? roadwayEdgePath(roadway, sourceEdge).map(project) : [];
  let sourceMarker = '';
  if (sourcePath.length >= 2) {
    const total = sourcePath.slice(1).reduce((sum, point, index) => {
      const prev = sourcePath[index];
      return sum + Math.hypot(point.x - prev.x, point.y - prev.y);
    }, 0);
    const target = Math.max(0, Math.min(1, Number(sourceRatio) || 0.5)) * total;
    let traveled = 0;
    let sourcePoint = sourcePath[0];
    for (let i = 1; i < sourcePath.length; i += 1) {
      const a = sourcePath[i - 1];
      const b = sourcePath[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (traveled + length >= target) {
        const local = length ? (target - traveled) / length : 0;
        sourcePoint = { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
        break;
      }
      traveled += length;
      sourcePoint = b;
    }
    sourceMarker = `<circle class="hazard-source-marker ${sourceStateClass}" cx="${sourcePoint.x.toFixed(1)}" cy="${sourcePoint.y.toFixed(1)}" r="5.5"><title>Source ${escapeHtml(sourceEdgeId)}</title></circle>`;
  }

  const writeSvg = (panel, className, body) => {
    const svg = panel?.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = `<g class="${className}">${body}</g>`;
  };

  writeSvg(mapPanel, 'hazard-2d-layer', `${mapEdges}${mapNodes}${sourceMarker}`);

  const layout = buildRoadwayTopologyLayout(roadway, sourceEdgeId, width, height);
  const topoEdges = edges
    .map((edge) => {
      const edgeId = String(edge.id);
      const [from, to] = edgeEndpoints(edge);
      const a = layout.get(from);
      const b = layout.get(to);
      if (!a || !b) return '';
      const sameLayer = Math.abs(a.y - b.y) < 1;
      const curve = sameLayer ? Math.max(24, Math.abs(a.x - b.x) * 0.22) : 0;
      const c1 = sameLayer ? `${a.x.toFixed(1)} ${(a.y - curve).toFixed(1)}` : `${a.x.toFixed(1)} ${((a.y + b.y) * 0.5).toFixed(1)}`;
      const c2 = sameLayer ? `${b.x.toFixed(1)} ${(b.y - curve).toFixed(1)}` : `${b.x.toFixed(1)} ${((a.y + b.y) * 0.5).toFixed(1)}`;
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${c1} ${c2} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      const visual = hazardViewState(stateMap.get(edgeId), style);
      const selected = selectedEdgeId && edgeId === String(selectedEdgeId);
      const source = sourceEdgeId && edgeId === String(sourceEdgeId);
      return `<path class="hazard-view-edge topology ${visual.affected ? 'affected' : ''} ${visual.passability} ${selected ? 'selected' : ''} ${source ? 'source' : ''}" data-edge-id="${escapeHtml(edgeId)}" d="${d}" style="--edge-color:${visual.color};--edge-width:${Math.max(1.8, visual.width * 0.72)}px;"><title>${escapeHtml(edgeId)} - ${visual.passability}</title></path>`;
    })
    .join('');
  const topoNodes = nodes
    .map((node) => {
      const point = layout.get(String(node.id));
      if (!point) return '';
      return `<circle class="hazard-topology-node" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.4"><title>${escapeHtml(node.id)}</title></circle>`;
    })
    .join('');
  writeSvg(topologyPanel, 'hazard-topology-layer', `${topoEdges}${topoNodes}`);
}

export function selectHazardRoadwayEdge(runtime, edgeId) {
  const id = edgeId == null ? null : String(edgeId);
  if (!id) {
    runtime.context?.set?.('selectedRoadwaySegment', null);
    runtime.context?.set?.('selectedHazardSegment', null);
    runtime.context?.set?.('selection', null);
    runtime.sceneManager?.highlightRoadwayEdges?.([]);
    runtime.updateHazardRoadwayViews?.();
    return;
  }
  runtime.context?.set?.('selectedRoadwaySegment', { type: 'edge', id });
  runtime.context?.set?.('selectedHazardSegment', id);
  runtime.context?.set?.('selection', { type: 'roadwayHazardSegment', id });
  runtime.sceneManager?.highlightRoadwayEdges?.([id]);
  runtime.updateHazardRoadwayViews?.();
}

export function installHazardRoadwayViewHandlers(runtime) {
  const dispose = installRoadwayHazardViewSelection([runtime.mapPanel, runtime.topologyPanel], (edgeId) =>
    selectHazardRoadwayEdge(runtime, edgeId)
  );
  runtime.disposers?.push?.(dispose);
}

export function updateHazardRoadwayViews(runtime, states = null, style = 'water') {
  renderHazardRoadwayViews({
    roadway: runtime.inputs.roadway,
    states: states ?? runtime.currentStates?.() ?? [],
    mapPanel: runtime.mapPanel,
    topologyPanel: runtime.topologyPanel,
    selectedEdgeId: selectedRoadwayEdgeId(runtime.context),
    sourceEdgeId: runtime.params.sourceEdgeId,
    sourceRatio: runtime.params.sourceRatio,
    style
  });
}

export function downloadDataset(dataset, format, filename) {
  if (!dataset) return;
  if (format === 'json') dataset.downloadJSON?.(filename);
  else dataset.downloadCSV?.(filename);
}

export const GEOLOGY_PALETTE = [
  '#6aa6ff',
  '#f4c95d',
  '#6fcf97',
  '#eb5757',
  '#bb6bd9',
  '#56ccf2',
  '#f2994a',
  '#9bdb7d',
  '#d299c2',
  '#a0aec0'
];

export const GEOLOGY_LITHOLOGY_COLORS = {
  coal: '#111111',
  mud: '#696969',
  mudstone: '#696969',
  roofmud: '#696969',
  seatearth: '#696969',
  floodplainmud: '#696969',
  sandstone: '#d2b48c',
  sand: '#d2b48c',
  sand_c: '#d2b48c',
  coarsesand: '#d2b48c',
  coarse_sand: '#d2b48c',
  sand_f: '#e6ccb3',
  finesand: '#e6ccb3',
  fine_sand: '#e6ccb3',
  silt: '#a9a9a9',
  siltstone: '#a9a9a9',
  shale: '#6b8f3a',
  lime: '#c0c0c0',
  limestone: '#c0c0c0',
  overburden: '#8b4513',
  ore: '#d66b44',
  fault: '#ff6f61',
  fault_zone: '#ff7043'
};

export function geologyColorForKey(key, index = 0) {
  const normalized = String(key ?? '').toLowerCase();
  const direct = GEOLOGY_LITHOLOGY_COLORS[normalized];
  if (direct) return direct;
  const match = Object.entries(GEOLOGY_LITHOLOGY_COLORS).find(([name]) => normalized.includes(name));
  if (match) return match[1];
  return GEOLOGY_PALETTE[Math.abs(index) % GEOLOGY_PALETTE.length];
}

export function geologyPoint(value = {}) {
  if (Array.isArray(value)) return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  return new THREE.Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

export function disposeThreeObject(object) {
  object?.traverse?.((child) => {
    if (child.geometry) child.geometry.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
    materials.forEach((material) => {
      Object.values(material?.uniforms || {}).forEach((uniform) => {
        if (uniform?.value?.isTexture) uniform.value.dispose?.();
      });
      material?.dispose?.();
    });
  });
}

export function setGroupOpacity(group, opacity) {
  group?.traverse?.((child) => {
    const numericOpacity = Number(opacity);
    const opacityOrder = child.userData?.opacityRenderOrder;
    if (opacityOrder) {
      child.renderOrder = numericOpacity >= 0.98 ? opacityOrder.opaque : opacityOrder.transparent;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
    materials.forEach((material) => {
      if (material.uniforms?.opacity) material.uniforms.opacity.value = numericOpacity * Number(material.userData?.volumeOpacity ?? 1);
      material.opacity = numericOpacity;
      material.transparent = !!material.isRawShaderMaterial || !!material.userData?.alwaysTransparent || numericOpacity < 0.98;
      material.depthWrite = 'keepDepthWrite' in (material.userData || {}) ? !!material.userData.keepDepthWrite : numericOpacity >= 0.98;
      material.needsUpdate = true;
    });
  });
}

export function geometryObjectNames(mesh) {
  const names = [];
  let current = mesh;
  while (current) {
    if (current.name) names.push(String(current.name));
    current = current.parent;
  }
  return [...new Set(names)];
}

export function geologyNumericRange(values) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const value of values || []) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    if (numeric < min) min = numeric;
    if (numeric > max) max = numeric;
    count += 1;
  }
  if (!count) return { min: 0, max: 1 };
  return { min, max: max === min ? min + 1 : max };
}

export function geologyPointKey(point, precision = 3) {
  const scale = 10 ** precision;
  return [point.x, point.y, point.z].map((value) => String(Math.round(Number(value) * scale) / scale)).join('|');
}

export function geologyHorizontalKey(point, precision = 3) {
  const scale = 10 ** precision;
  return [point.x, point.z].map((value) => String(Math.round(Number(value) * scale) / scale)).join('|');
}

export function geometryUniqueVertices(geometry, matrix = null) {
  const position = geometry?.attributes?.position;
  if (!position) return [];
  const map = new Map();
  for (let i = 0; i < position.count; i += 1) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    if (matrix) point.applyMatrix4(matrix);
    const key = geologyPointKey(point);
    if (!map.has(key)) map.set(key, point);
  }
  return [...map.values()];
}

export function geometryBoundaryEdges(geometry, matrix = null) {
  const position = geometry?.attributes?.position;
  if (!position) return [];
  const indices = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, index) => index);
  const vertices = new Map();
  const vertexForIndex = (index) => {
    const point = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
    if (matrix) point.applyMatrix4(matrix);
    const key = geologyPointKey(point);
    if (!vertices.has(key)) vertices.set(key, { key, point });
    return vertices.get(key);
  };
  const edges = new Map();
  const addEdge = (a, b) => {
    if (!a || !b || a.key === b.key) return;
    const edgeKey = [a.key, b.key].sort().join('~');
    const entry = edges.get(edgeKey);
    if (entry) entry.count += 1;
    else edges.set(edgeKey, { a, b, count: 1 });
  };
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = vertexForIndex(indices[i]);
    const b = vertexForIndex(indices[i + 1]);
    const c = vertexForIndex(indices[i + 2]);
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return [...edges.values()].filter((edge) => edge.count === 1);
}

export function pathDepthRange(points = []) {
  const depths = points.map((point) => Number(point.depth)).filter(Number.isFinite);
  if (depths.length >= 2) return { min: Math.min(...depths), max: Math.max(...depths), hasDepth: true };
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += geologyPoint(points[i - 1]).distanceTo(geologyPoint(points[i]));
  return { min: 0, max: length, hasDepth: false };
}

export function pointAtBoreholeMeasure(points = [], measure = 0, range = pathDepthRange(points)) {
  if (!points.length) return null;
  if (points.length === 1) return geologyPoint(points[0]);
  const target = Number(measure);
  if (range.hasDepth) {
    const ordered = [...points].sort((a, b) => Number(a.depth) - Number(b.depth));
    if (target <= Number(ordered[0].depth)) return geologyPoint(ordered[0]);
    if (target >= Number(ordered[ordered.length - 1].depth)) return geologyPoint(ordered[ordered.length - 1]);
    for (let i = 1; i < ordered.length; i += 1) {
      const a = ordered[i - 1];
      const b = ordered[i];
      const da = Number(a.depth);
      const db = Number(b.depth);
      if (target < da || target > db) continue;
      const local = db !== da ? (target - da) / (db - da) : 0;
      return geologyPoint(a).lerp(geologyPoint(b), local);
    }
    return geologyPoint(ordered[ordered.length - 1]);
  }
  let traveled = 0;
  const clamped = Math.max(0, Math.min(range.max, target));
  for (let i = 1; i < points.length; i += 1) {
    const a = geologyPoint(points[i - 1]);
    const b = geologyPoint(points[i]);
    const segment = a.distanceTo(b);
    if (traveled + segment >= clamped) {
      const local = segment > 0 ? (clamped - traveled) / segment : 0;
      return a.lerp(b, local);
    }
    traveled += segment;
  }
  return geologyPoint(points[points.length - 1]);
}

export function sliceBoreholePathByMeasure(points = [], from = 0, to = 0) {
  if (points.length < 2) return [];
  const range = pathDepthRange(points);
  const start = Math.max(range.min, Math.min(range.max, Math.min(Number(from), Number(to))));
  const end = Math.max(range.min, Math.min(range.max, Math.max(Number(from), Number(to))));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const result = [pointAtBoreholeMeasure(points, start, range)];
  if (range.hasDepth) {
    [...points]
      .sort((a, b) => Number(a.depth) - Number(b.depth))
      .forEach((point) => {
        const depth = Number(point.depth);
        if (depth > start && depth < end) result.push(geologyPoint(point));
      });
  } else {
    let traveled = 0;
    for (let i = 1; i < points.length; i += 1) {
      const segment = geologyPoint(points[i - 1]).distanceTo(geologyPoint(points[i]));
      const next = traveled + segment;
      if (next > start && next < end) result.push(geologyPoint(points[i]));
      traveled = next;
    }
  }
  result.push(pointAtBoreholeMeasure(points, end, range));
  return result.filter(Boolean);
}


export function pointToCanvasSegmentDistance(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const denom = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / denom));
  return Math.hypot(point.x - (a.x + vx * t), point.y - (a.y + vy * t));
}
