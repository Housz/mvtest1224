import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { SampleSnapshotKernel, HeatmapColorKernel } from './OperatorKernels.js';
import { buildHeatmapInput, diffuseNodeValues, resetHeatmapColors } from '../algorithms/FieldSolver.js';
import { RoadwayScalarAnalysisPresets } from '../environmental/EnvironmentalPresets.js';
import { ChartManager } from '../../ui/ChartManager.js';
import { ColorLegend } from '../../ui/ColorLegend.js';
import { installRoadwayHazardViewSelection, installRoadwayResponseViewSelection, renderRoadwayHazardViewPair } from '../../ui/RoadwayHazardViews.js';
import { generateCssGradient, getDefaultStops, sampleColor, setCustomColorMap } from '../../utils/colors.js';
import { SemanticContractRegistry } from '../semantics/SemanticContractRegistry.js';
import { materializeDataset } from '../semantics/DatasetMaterializers.js';
import { WaterInrushHydraulic1DSolver, projectRoadwayEdgeRatio } from '../simulation/WaterInrushHydraulic1DSolver.js';
import { FireSmoke1DSolver } from '../simulation/FireSmoke1DSolver.js';
import { createSectionFrame } from '../geometry/SectionFrame.js';
import { buildGeologicalSectionResult } from '../geology/GeologicalSectionBuilder.js';
import { buildRoadwayGeologyRelationResult } from '../geology/RoadwayGeologyRelationBuilder.js';

const RoadwayScalarStateAnalysisInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  sensorRegistry: {
    class: 'SensorRegistry',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    requiredRoles: ['sensorIdentity', 'sensorPosition', 'roadwayMountRelation']
  },
  sensorReadings: {
    class: 'EnvironmentalSensorReadings',
    acceptedClasses: ['EnvironmentalSensorReadings', 'SensorReadings'],
    requiredTemplates: ['State', 'Relation'],
    requiredRoles: ['observedEntity', 'timestamp', 'measuredValue']
  }
};

const VentilationNetworkOverviewInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  }
};

const AirflowDistributionInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  },
  airflowState: {
    class: 'AirflowState',
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['branchState', 'airflowField', 'branchStateRelation']
  }
};

const BranchAirflowTrendInputRequirements = {
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  },
  airflowState: {
    class: 'AirflowState',
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['branchState', 'airflowField', 'branchStateRelation']
  }
};

const VentilationAnomalyInputRequirements = AirflowDistributionInputRequirements;

const WaterInrushSimulationInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  }
};

const SafeRouteAnalysisInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  people: {
    class: 'People',
    requiredTemplates: ['Registry', 'Geometry', 'State', 'Relation'],
    requiredRoles: ['personIdentity', 'personPosition', 'personCurrentState', 'personRoadwayAnchor']
  },
  emergencyResources: {
    class: 'EmergencyResources',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    requiredRoles: ['resourceIdentity', 'resourcePosition', 'resourceRoadwayAnchor']
  },
  hazardState: {
    class: 'RoadwayHazardState',
    optional: true,
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['roadwayHazardTimeState', 'roadwayHazardField', 'hazardRoadwaySupport']
  }
};

const AIRFLOW_VARIABLES = {
  airQuantity: {
    label: 'Air Quantity',
    unit: 'm3/s',
    valueKey: 'airQuantity',
    colormap: 'viridis'
  },
  velocity: {
    label: 'Velocity',
    unit: 'm/s',
    valueKey: 'velocity',
    colormap: 'rainbow'
  },
  pressureDrop: {
    label: 'Pressure Drop',
    unit: 'Pa',
    valueKey: 'pressureDrop',
    colormap: 'heat'
  }
};

const typeIdsByPreset = {
  temperature: 'RoadwayTemperatureAnalysisOperator',
  CO: 'RoadwayCOConcentrationAnalysisOperator',
  humidity: 'RoadwayHumidityAnalysisOperator',
  CH4: 'RoadwayCH4ConcentrationAnalysisOperator',
  scalar: 'RoadwayScalarStateAnalysisOperator'
};

const formatTime = (value) => {
  if (value == null) return '-';
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
};

const buildContinuousTimeScale = (times = [], { subdivisions = 8, maxSteps = 720 } = {}) => {
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

const getSelectionSensorID = (selection) => {
  if (!selection) return null;
  if (typeof selection === 'string') return selection;
  if (selection.type === 'sensor') return selection.id ?? selection.sensorID;
  return selection.id ?? selection.sensorID ?? null;
};

const getSelectionBranchID = (selection) =>
  selection?.type === 'ventilationBranch' ? selection.id ?? selection.branchId : null;

const getSelectionFacilityID = (selection) =>
  selection?.type === 'ventilationFacility' ? selection.id ?? selection.facilityId : null;

const pointOf = (value = {}) => {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
};

const formatScalar = (value, digits = 2) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits).replace(/\.?0+$/, '') : '-';
};

function presetForNode(nodeModel) {
  const presetId =
    nodeModel.params?.presetId ||
    Object.entries(typeIdsByPreset).find(([, typeId]) => typeId === nodeModel.typeId)?.[0] ||
    'scalar';
  return RoadwayScalarAnalysisPresets[presetId] || RoadwayScalarAnalysisPresets.scalar;
}

function defaultParamsFromPreset(preset) {
  return {
    presetId: preset.id,
    variable: preset.variable,
    unit: preset.unit,
    legendLabel: preset.legendLabel,
    minValue: preset.range.min,
    maxValue: preset.range.max,
    colormap: preset.colormap,
    toleranceMinutes: 60,
    showSensors: true,
    chartMode: 'overlay',
    ...(preset.warningThreshold != null ? { warningThreshold: preset.warningThreshold } : {})
  };
}

function createRoadwayHazardDataset(rows, metadata = {}) {
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

function edgeLength(roadway, edge) {
  return roadway?.edgeLength?.(edge) || Math.max(1, (edge?.path || edge?.verts || []).length - 1 || 1);
}

function edgeEndpoints(edge) {
  return [edge?.from ?? edge?.source ?? edge?.j1, edge?.to ?? edge?.target ?? edge?.j2].filter(Boolean).map(String);
}

function createWorkspacePanel(title, className, body = '') {
  const host = document.querySelector('.runtime-shell') || document.body;
  const panel = document.createElement('section');
  panel.className = `glass-panel ventilation-panel ${className}`;
  panel.innerHTML = `<div class="panel-title"><span>${title}</span><button class="panel-collapse-toggle" type="button">-</button></div>${body}`;
  host.appendChild(panel);
  const button = panel.querySelector('.panel-collapse-toggle');
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const collapsed = panel.classList.toggle('panel-collapsed');
    button.textContent = collapsed ? '+' : '-';
  });
  let drag = null;
  panel.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.panel-title') || event.target.closest('button,input,select') || event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    panel.setPointerCapture(event.pointerId);
    panel.classList.add('dragging');
  });
  panel.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - drag.offsetX))}px`;
    panel.style.top = `${Math.max(72, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - drag.offsetY))}px`;
  });
  const stopDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    panel.releasePointerCapture(event.pointerId);
    panel.classList.remove('dragging');
    drag = null;
  };
  panel.addEventListener('pointerup', stopDrag);
  panel.addEventListener('pointercancel', stopDrag);
  return panel;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roadwayEdgePath(roadway, edge) {
  const raw = edge?.path?.length ? edge.path : edge?.verts?.length ? edge.verts : [];
  if (raw.length >= 2) return raw.map(pointOf);
  const [from, to] = edgeEndpoints(edge);
  return [roadway?.getNodePosition?.(from), roadway?.getNodePosition?.(to)].filter(Boolean).map(pointOf);
}

function projectRoadwayPoints(points, width = 520, height = 320, padding = 22) {
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

function buildRoadwayTopologyLayout(roadway, sourceEdgeId, width = 520, height = 320) {
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

function hazardViewState(state, style = 'water') {
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

function selectedRoadwayEdgeId(context) {
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

function renderHazardRoadwayViews({ roadway, states = [], mapPanel, topologyPanel, selectedEdgeId, sourceEdgeId, sourceRatio = 0.5, style = 'water' }) {
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

function selectHazardRoadwayEdge(runtime, edgeId) {
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

function installHazardRoadwayViewHandlers(runtime) {
  const dispose = installRoadwayHazardViewSelection([runtime.mapPanel, runtime.topologyPanel], (edgeId) =>
    selectHazardRoadwayEdge(runtime, edgeId)
  );
  runtime.disposers?.push?.(dispose);
}

function updateHazardRoadwayViews(runtime, states = null, style = 'water') {
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

function downloadDataset(dataset, format, filename) {
  if (!dataset) return;
  if (format === 'json') dataset.downloadJSON?.(filename);
  else dataset.downloadCSV?.(filename);
}

class WaterInrushSimulationRuntime {
  constructor(nodeModel, inputs) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.label = nodeModel.label || 'Water Inrush Simulation';
    this.inputRequirements = WaterInrushSimulationInputRequirements;
    this.params = {
      sourceMode: nodeModel.params?.sourceMode || 'pick',
      sourceEdgeId: nodeModel.params?.sourceEdgeId || null,
      sourceNodeId: nodeModel.params?.sourceNodeId || null,
      sourceRatio: Number(nodeModel.params?.sourceRatio ?? 0.5),
      startTime: Number(nodeModel.params?.startTime ?? 0),
      duration: Number(nodeModel.params?.duration ?? 20),
      inflowMode: nodeModel.params?.inflowMode === 'timed' ? 'timed' : 'continuous',
      timeSteps: Number(nodeModel.params?.timeSteps ?? 30),
      timeInterval: Number(nodeModel.params?.timeInterval ?? 1),
      intensity: Number(nodeModel.params?.intensity ?? 1),
      inflowRate: Number(nodeModel.params?.inflowRate ?? ((Number(nodeModel.params?.intensity ?? 1) || 1) * 8)),
      propagationSpeed: Number(nodeModel.params?.propagationSpeed ?? 1),
      depthGrowthRate: Number(nodeModel.params?.depthGrowthRate ?? 1),
      decay: Number(nodeModel.params?.decay ?? 0.15),
      cellLength: Number(nodeModel.params?.cellLength ?? 10),
      roadwayWidth: Number(nodeModel.params?.roadwayWidth ?? 4),
      roadwayHeight: Number(nodeModel.params?.roadwayHeight ?? 3),
      conductanceScale: Number(nodeModel.params?.conductanceScale ?? 1.2),
      leakageRate: Number(nodeModel.params?.leakageRate ?? 0),
      riskyDepthThreshold: Number(nodeModel.params?.riskyDepthThreshold ?? 0.3),
      blockedDepthThreshold: Number(nodeModel.params?.blockedDepthThreshold ?? 0.8),
      fullFlowRatio: Number(nodeModel.params?.fullFlowRatio ?? 0.95),
      playbackSpeed: Number(nodeModel.params?.playbackSpeed ?? 1),
      scenarioId: nodeModel.params?.scenarioId || 'water_inrush_demo',
      autoRun: nodeModel.params?.autoRun !== false
    };
    this.outputs = {};
    this.outputListeners = new Map();
    this.disposers = [];
    this.generatedSteps = Math.max(1, Math.floor(this.params.timeSteps));
    this.simulationStatus = 'ready';
    this.simulationTimer = null;
    this.baseSimulationTickMs = 650;
    this.suppressAutoOutput = false;
    this.awaitingSourcePick = false;
  }

  getOutputDataset(portId) {
    if (portId === 'hazardState' && !this.outputs.hazardState && !this.suppressAutoOutput) this.generateHazardState();
    return this.outputs[portId] ?? null;
  }

  subscribeOutput(portId, callback) {
    if (!this.outputListeners.has(portId)) this.outputListeners.set(portId, new Set());
    this.outputListeners.get(portId).add(callback);
    return () => this.outputListeners.get(portId)?.delete(callback);
  }

  emitOutput(portId, dataset) {
    (this.outputListeners.get(portId) || []).forEach((callback) => callback(dataset));
  }

  validateSemanticInputs() {
    const roadway = this.inputs.roadway;
    if (!roadway) throw new Error('Missing semantic dataset input: roadway');
    const actualClass = roadway.contract?.class || roadway.semanticClass;
    if (actualClass !== 'Roadway') throw new Error(`Input roadway expects Roadway, got ${actualClass}.`);
    if (roadway.validation?.errors?.length) throw new Error(`Roadway input has validation errors: ${roadway.validation.errors.join('; ')}`);
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.createPanels();
    this.registerVisualContributions();
    this.installHandlers();
    this.generateHazardState({ steps: this.generatedSteps });
    if (this.context.get('time') == null) this.context.set('time', this.params.startTime);
    this.updateViews();
    return { cleanup: () => this.cleanup() };
  }

  async initializeRoadway() {
    const roadway = this.inputs.roadway;
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping(), roadway);
    else this.sceneManager.buildRoadway(roadway);
    this.sceneManager.setRoadwayVisible(true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacity(0.82);
  }

  createPanels() {
    this.summaryPanel = createWorkspacePanel('Affected Roadway Summary', 'emergency-summary-panel', '<div class="emergency-summary-content"></div>');
    this.legendPanel = createWorkspacePanel(
      'Hazard Legend',
      'emergency-legend-panel',
      '<div class="route-legend-list"><div><span class="legend-dot water-low"></span>Open / low depth</div><div><span class="legend-dot water-risky"></span>Risky depth</div><div><span class="legend-dot water-blocked"></span>Full / blocked</div></div>'
    );
    this.mapPanel = createWorkspacePanel('Water Inrush 2D Map', 'hazard-roadway-map-panel water-hazard-map-panel', '<canvas class="hazard-roadway-view"></canvas>');
    this.topologyPanel = createWorkspacePanel('Water Inrush Topology', 'hazard-topology-panel water-hazard-topology-panel', '<canvas class="hazard-roadway-view"></canvas>');
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      semanticRole: 'base',
      objectSystem: 'roadway',
      visible: true,
      opacity: 0.82,
      show: () => this.sceneManager.setRoadwayVisible(true),
      hide: () => this.sceneManager.setRoadwayVisible(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value),
      focus: () => this.sceneManager.focusOnRoadway()
    });
    this.contributionRegistry.register({
      id: `${this.id}:hazard-overlay`,
      label: 'Water Inrush Hazard Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      semanticRole: 'state',
      objectSystem: 'roadway',
      visualChannels: { color: 'hazardSeverity', opacity: 'hazardValue' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: 0.65 },
      visible: true,
      opacity: 0.65,
      show: () => this.sceneManager.setHazardOverlayVisible(true),
      hide: () => this.sceneManager.setHazardOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setHazardOverlayOpacity(value),
      cleanup: () => this.sceneManager.clearHazardOverlay()
    });
    [
      ['summary', 'Affected Roadway Summary', this.summaryPanel, 'panel'],
      ['legend', 'Hazard Legend', this.legendPanel, 'legend'],
      ['map', 'Water Inrush 2D Map', this.mapPanel, 'topology-view'],
      ['topology', 'Water Inrush Topology', this.topologyPanel, 'topology-view']
    ].forEach(([suffix, label, panel, type]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateViews()));
    this.disposers.push(this.context.subscribe('selectedRoadwaySegment', () => {
      this.applyHazardSelection();
      this.updateHazardRoadwayViews();
    }));
    this.disposers.push(this.context.subscribe('selectedHazardSegment', () => {
      this.applyHazardSelection();
      this.updateHazardRoadwayViews();
    }));
    installHazardRoadwayViewHandlers(this);
    const previousPick = this.sceneManager.onRoadwayPick;
    this.sceneManager.onRoadwayPick = (entity) => {
      if (!this.awaitingSourcePick) {
        if (entity.type === 'edge') selectHazardRoadwayEdge(this, entity.edgeId);
        return previousPick?.(entity);
      }
      if (entity.type !== 'edge') return previousPick?.(entity);
      this.params.sourceEdgeId = entity.edgeId;
      this.params.sourceNodeId = null;
      this.params.sourceRatio = projectRoadwayEdgeRatio(this.inputs.roadway, entity.edgeId, entity.point);
      this.awaitingSourcePick = false;
      selectHazardRoadwayEdge(this, entity.edgeId);
      this.syncControlValues?.();
      this.syncSourcePickState?.();
      if (this.params.autoRun) {
        this.generatedSteps = this.outputs.hazardState
          ? Math.max(1, this.generatedSteps)
          : Math.max(1, Math.floor(this.params.timeSteps));
        this.generateHazardState({ steps: this.generatedSteps });
      }
    };
    this.disposers.push(() => {
      this.sceneManager.onRoadwayPick = previousPick;
    });
  }

  applyHazardSelection() {
    const selected = selectedRoadwayEdgeId(this.context);
    this.sceneManager?.highlightRoadwayEdges?.(selected ? [selected] : []);
  }

  updateHazardRoadwayViews(states = null) {
    updateHazardRoadwayViews(this, states, 'water');
  }

  generateHazardState({ steps = this.generatedSteps, adjustTime = true } = {}) {
    this.suppressAutoOutput = false;
    const roadway = this.inputs.roadway;
    const edges = roadway.getEdges();
    if (!this.params.sourceEdgeId && edges[0]) this.params.sourceEdgeId = edges[0].id;
    const effectiveSteps = Math.max(1, Math.floor(Number(steps) || this.params.timeSteps || 1));
    this.generatedSteps = effectiveSteps;
    const result = new WaterInrushHydraulic1DSolver({
      roadway,
      params: { ...this.params, timeSteps: effectiveSteps }
    }).run();
    const rows = result.rows || [];
    this.simulationSummary = result.summary || {};
    this.outputs.hazardState = createRoadwayHazardDataset(rows, {
      generatedBy: 'Water Inrush Simulation',
      scenarioId: this.params.scenarioId,
      source: { edgeId: this.params.sourceEdgeId, nodeId: this.params.sourceNodeId, ratio: this.params.sourceRatio },
      parameters: { ...this.params },
      solver: this.simulationSummary
    });
    this.context?.set?.('activeRoadwayHazardState', this.outputs.hazardState);
    if (adjustTime) this.ensureVisibleSimulationTime();
    this.emitOutput('hazardState', this.outputs.hazardState);
    this.updateViews();
    return this.outputs.hazardState;
  }

  currentGeneratedMaxTime() {
    return this.params.startTime + Math.max(0, this.generatedSteps - 1) * this.params.timeInterval;
  }

  startSimulation() {
    this.suppressAutoOutput = false;
    if (this.simulationTimer) return;
    this.simulationStatus = 'running';
    if (!this.outputs.hazardState) this.generatedSteps = Math.max(1, Math.floor(this.params.timeSteps));
    this.tickSimulation();
    this.restartSimulationTimer();
    this.syncSimulationButtons?.();
  }

  restartSimulationTimer() {
    if (this.simulationTimer) window.clearInterval(this.simulationTimer);
    if (this.simulationStatus !== 'running') {
      this.simulationTimer = null;
      return;
    }
    const speed = Math.max(0.1, Number(this.params.playbackSpeed) || 1);
    const interval = Math.max(40, this.baseSimulationTickMs / speed);
    this.simulationTimer = window.setInterval(() => this.tickSimulation(), interval);
  }

  tickSimulation() {
    this.generatedSteps = Math.max(1, this.generatedSteps + 1);
    const targetTime = this.currentGeneratedMaxTime();
    this.generateHazardState({ steps: this.generatedSteps, adjustTime: false });
    this.context?.set?.('time', targetTime);
    this.syncTimeSlider?.();
  }

  pauseSimulation() {
    if (this.simulationTimer) {
      window.clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    this.simulationStatus = 'paused';
    this.syncSimulationButtons?.();
  }

  stopSimulation() {
    if (this.simulationTimer) {
      window.clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    this.simulationStatus = 'stopped';
    this.syncSimulationButtons?.();
  }

  resetSimulation() {
    this.stopSimulation();
    this.simulationStatus = 'ready';
    this.generatedSteps = Math.max(1, Math.floor(this.params.timeSteps));
    this.outputs.hazardState = null;
    this.suppressAutoOutput = true;
    this.simulationSummary = null;
    this.context?.set?.('activeRoadwayHazardState', null);
    this.context?.set?.('time', this.params.startTime);
    this.sceneManager?.clearHazardOverlay?.();
    this.sceneManager?.highlightRoadwayEdges?.([]);
    this.updateHazardRoadwayViews([]);
    this.emitOutput('hazardState', null);
    this.renderEmptySummary();
    this.syncTimeSlider?.();
    this.syncSimulationButtons?.();
  }

  ensureVisibleSimulationTime() {
    if (!this.context || !this.outputs.hazardState) return;
    const current = Number(this.context.get('time'));
    const range = this.outputs.hazardState.getTimeRange?.();
    const min = Number(range?.min ?? this.params.startTime);
    const max = Number(range?.max ?? this.params.startTime);
    const hasCurrentInRange = Number.isFinite(current) && current >= min && current <= max;
    const currentAffectedCount = hasCurrentInRange
      ? [...this.outputs.hazardState.getSnapshot(current, Infinity).values()].filter((row) => Number(row.hazardValue) > 0).length
      : 0;
    if (currentAffectedCount > 1) return;
    const times = [...(range?.times || [])];
    const firstPropagated = times.find((time) =>
      [...this.outputs.hazardState.getSnapshot(time, Infinity).values()].filter((row) => Number(row.hazardValue) > 0).length > 1
    );
    const firstVisible = times.find((time) =>
      [...this.outputs.hazardState.getSnapshot(time, Infinity).values()].some((row) => Number(row.hazardValue) > 0)
    );
    const nextTime = firstPropagated ?? firstVisible;
    if (nextTime != null) this.context.set('time', nextTime);
  }

  currentStates() {
    const dataset = this.outputs.hazardState || this.getOutputDataset('hazardState');
    const time = this.context?.get?.('time') ?? this.params.startTime;
    return [...(dataset?.getSnapshot?.(time, Infinity)?.values?.() || [])];
  }

  updateViews() {
    if (!this.sceneManager || !this.outputs.hazardState) return;
    const states = this.currentStates();
    this.sceneManager.addHazardEdges(this.inputs.roadway, states, {
      opacity: 0.65,
      sourceEdgeId: this.params.sourceEdgeId,
      sourceRatio: this.params.sourceRatio
    });
    if (this.contributionRegistry?.get(`${this.id}:hazard-overlay`)?.visible === false) this.sceneManager.setHazardOverlayVisible(false);
    this.applyHazardSelection();
    this.updateHazardRoadwayViews(states);
    const affected = states.filter((state) => Number(state.hazardValue) > 0);
    const risky = affected.filter((state) => state.passability === 'risky');
    const blocked = affected.filter((state) => state.passability === 'blocked');
    const maxDepth = Math.max(0, ...affected.map((state) => Number(state.maxDepth ?? state.hazardValue) || 0));
    const stored = Number(this.simulationSummary?.totalWaterStored ?? 0);
    const content = this.summaryPanel?.querySelector('.emergency-summary-content');
    if (content) {
      content.innerHTML = `
        <div class="detail-row"><span>Time</span><strong>${formatScalar(this.context.get('time'), 2)}</strong></div>
        <div class="detail-row"><span>Source</span><strong>${this.params.sourceEdgeId || '-'}</strong></div>
        <div class="detail-row"><span>Affected</span><strong>${affected.length}</strong></div>
        <div class="detail-row"><span>Risky</span><strong>${risky.length}</strong></div>
        <div class="detail-row"><span>Blocked</span><strong>${blocked.length}</strong></div>
        <div class="detail-row"><span>Max depth</span><strong>${formatScalar(maxDepth, 2)} m</strong></div>
        <div class="detail-row"><span>Stored volume</span><strong>${formatScalar(stored, 1)} m3</strong></div>`;
    }
    this.syncTimeSlider?.();
    this.syncSimulationButtons?.();
  }

  renderEmptySummary() {
    const content = this.summaryPanel?.querySelector('.emergency-summary-content');
    if (!content) return;
    content.innerHTML = `
      <div class="detail-row"><span>Status</span><strong>${this.simulationStatus}</strong></div>
      <div class="detail-row"><span>Time</span><strong>${formatScalar(this.context?.get?.('time') ?? this.params.startTime, 2)}</strong></div>
      <div class="detail-row"><span>Source</span><strong>${this.params.sourceEdgeId || '-'}</strong></div>
      <div class="detail-row"><span>Affected</span><strong>0</strong></div>
      <div class="detail-row"><span>Blocked</span><strong>0</strong></div>`;
  }

  renderControls(container) {
    this.controlContainer = container;
    const options = this.inputs.roadway.getEdges().map((edge) => `<option value="${edge.id}">${edge.id}</option>`).join('');
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="water-source-picker">
        <button class="water-pick-source" type="button">Set source in 3D</button>
        <span class="water-source-summary">Source: ${this.params.sourceEdgeId || '-'}</span>
      </div>
      <div class="control-grid water-control-grid">
        <label class="field-row">Source edge<select class="water-source">${options}</select></label>
        <label class="field-row">Inflow rate (m3/s)<input class="water-inflow" type="number" step="0.5" /></label>
        <label class="field-row">Intensity<input class="water-intensity" type="number" step="0.1" /></label>
        <label class="field-row">Inflow mode<select class="water-inflow-mode">
          <option value="continuous">Continuous</option>
          <option value="timed">Timed</option>
        </select></label>
        <label class="field-row">Inflow duration (s)<input class="water-duration" type="number" step="1" /></label>
        <label class="field-row">Time steps (frames)<input class="water-steps" type="number" step="1" /></label>
        <label class="field-row">Cell length (m)<input class="water-cell-length" type="number" step="1" /></label>
        <label class="field-row">Roadway width (m)<input class="water-width" type="number" step="0.5" /></label>
        <label class="field-row">Roadway height (m)<input class="water-height" type="number" step="0.5" /></label>
        <label class="field-row">Conductance<input class="water-conductance" type="number" step="0.1" /></label>
        <label class="field-row">Leakage (1/s)<input class="water-leakage" type="number" step="0.001" /></label>
        <label class="field-row">Risky depth (m)<input class="water-risky" type="number" step="0.1" /></label>
        <label class="field-row">Blocked depth (m)<input class="water-blocked" type="number" step="0.1" /></label>
        <label class="field-row">Full flow ratio<input class="water-full-flow" type="number" min="0" max="1" step="0.01" /></label>
        <label class="field-row">Playback speed (x)<select class="water-speed">
          <option value="0.25">0.25x</option>
          <option value="0.5">0.5x</option>
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="4">4x</option>
          <option value="8">8x</option>
        </select></label>
        <label class="checkbox-row"><span>Auto run</span><input class="water-auto" type="checkbox" /></label>
      </div>
      <label class="field-row water-time-row">Time (s) <span class="water-time-label">-</span><input class="water-time" type="range" min="0" max="0" step="1" /></label>
      <div class="water-sim-status">Ready</div>
      <div class="button-row compact">
        <button class="water-run">Run</button>
        <button class="water-pause">Pause</button>
        <button class="water-stop">Stop</button>
        <button class="water-reset">Reset</button>
        <button class="water-json">Export JSON</button>
        <button class="water-csv">Export CSV</button>
      </div>
      <div class="muted-note">Use Set source in 3D, then click a roadway segment to place the inrush source.</div>`;
    const q = (selector) => container.querySelector(selector);
    const source = q('.water-source');
    const pickSourceButton = q('.water-pick-source');
    const sourceSummary = q('.water-source-summary');
    const inflow = q('.water-inflow');
    const intensity = q('.water-intensity');
    const inflowMode = q('.water-inflow-mode');
    const duration = q('.water-duration');
    const steps = q('.water-steps');
    const cellLength = q('.water-cell-length');
    const width = q('.water-width');
    const height = q('.water-height');
    const conductance = q('.water-conductance');
    const leakage = q('.water-leakage');
    const risky = q('.water-risky');
    const blocked = q('.water-blocked');
    const fullFlow = q('.water-full-flow');
    const playbackSpeed = q('.water-speed');
    const auto = q('.water-auto');
    const time = q('.water-time');
    const timeLabel = q('.water-time-label');
    const status = q('.water-sim-status');
    const runButton = q('.water-run');
    const pauseButton = q('.water-pause');
    const stopButton = q('.water-stop');
    const resetButton = q('.water-reset');
    this.syncSourcePickState = () => {
      pickSourceButton.classList.toggle('active', this.awaitingSourcePick);
      pickSourceButton.textContent = this.awaitingSourcePick ? 'Pick a roadway...' : 'Set source in 3D';
      sourceSummary.textContent = `Source: ${this.params.sourceEdgeId || '-'}`;
    };
    this.syncControlValues = () => {
      source.value = this.params.sourceEdgeId || this.inputs.roadway.getEdges()[0]?.id || '';
      inflow.value = this.params.inflowRate;
      intensity.value = this.params.intensity;
      inflowMode.value = this.params.inflowMode || 'continuous';
      duration.value = this.params.duration;
      steps.value = this.params.timeSteps;
      cellLength.value = this.params.cellLength;
      width.value = this.params.roadwayWidth;
      height.value = this.params.roadwayHeight;
      conductance.value = this.params.conductanceScale;
      leakage.value = this.params.leakageRate;
      risky.value = this.params.riskyDepthThreshold;
      blocked.value = this.params.blockedDepthThreshold;
      fullFlow.value = this.params.fullFlowRatio;
      playbackSpeed.value = String(this.params.playbackSpeed || 1);
      auto.checked = this.params.autoRun;
      this.syncSourcePickState?.();
      this.syncTimeSlider?.();
    };
    this.syncSimulationButtons = () => {
      const maxTime = this.outputs.hazardState ? this.currentGeneratedMaxTime() : this.params.startTime;
      status.textContent = `Status: ${this.simulationStatus} - computed to ${formatScalar(maxTime, 2)} s - ${formatScalar(this.params.playbackSpeed, 2)}x`;
      runButton.disabled = this.simulationStatus === 'running';
      pauseButton.disabled = this.simulationStatus !== 'running';
      stopButton.disabled = this.simulationStatus === 'ready' && !this.outputs.hazardState;
    };
    this.syncTimeSlider = () => {
      const range = this.outputs.hazardState?.getTimeRange?.();
      if (!range?.times?.length) {
        time.min = '0';
        time.max = '0';
        time.value = '0';
        timeLabel.textContent = '-';
        return;
      }
      const current = Number(this.context?.get?.('time') ?? range.min);
      time.min = String(range.min);
      time.max = String(range.max);
      time.step = String(this.params.timeInterval || 1);
      time.value = String(Math.max(range.min, Math.min(range.max, current)));
      timeLabel.textContent = formatScalar(current, 2);
    };
    this.syncControlValues();
    const read = (run = this.params.autoRun) => {
      this.params.sourceEdgeId = source.value;
      this.params.inflowRate = Number(inflow.value);
      this.params.intensity = Number(intensity.value);
      this.params.inflowMode = inflowMode.value === 'timed' ? 'timed' : 'continuous';
      this.params.duration = Number(duration.value);
      this.params.timeSteps = Number(steps.value);
      this.params.cellLength = Number(cellLength.value);
      this.params.roadwayWidth = Number(width.value);
      this.params.roadwayHeight = Number(height.value);
      this.params.conductanceScale = Number(conductance.value);
      this.params.leakageRate = Number(leakage.value);
      this.params.riskyDepthThreshold = Number(risky.value);
      this.params.blockedDepthThreshold = Number(blocked.value);
      this.params.fullFlowRatio = Math.max(0, Math.min(1, Number(fullFlow.value)));
      this.params.playbackSpeed = Number(playbackSpeed.value) || 1;
      this.params.autoRun = auto.checked;
      if (run) {
        this.generatedSteps = this.outputs.hazardState
          ? Math.max(1, this.generatedSteps)
          : Math.max(1, Math.floor(this.params.timeSteps));
        this.generateHazardState({ steps: this.generatedSteps });
      }
      this.syncSimulationButtons?.();
    };
    source.addEventListener('change', () => {
      this.params.sourceRatio = 0.5;
      read();
    });
    [inflow, intensity, inflowMode, duration, cellLength, width, height, conductance, leakage, risky, blocked, fullFlow, auto].forEach((element) =>
      element.addEventListener('change', () => read())
    );
    pickSourceButton.addEventListener('click', () => {
      this.awaitingSourcePick = !this.awaitingSourcePick;
      this.syncSourcePickState?.();
    });
    steps.addEventListener('change', () => {
      read(false);
      this.generatedSteps = Math.max(1, Math.floor(this.params.timeSteps));
      if (this.params.autoRun) this.generateHazardState({ steps: this.generatedSteps });
      this.syncSimulationButtons?.();
    });
    playbackSpeed.addEventListener('change', () => {
      this.params.playbackSpeed = Number(playbackSpeed.value) || 1;
      this.restartSimulationTimer();
      this.syncSimulationButtons?.();
    });
    time.addEventListener('input', () => this.context?.set?.('time', Number(time.value)));
    runButton.addEventListener('click', () => {
      read(false);
      this.startSimulation();
    });
    pauseButton.addEventListener('click', () => this.pauseSimulation());
    stopButton.addEventListener('click', () => this.stopSimulation());
    resetButton.addEventListener('click', () => this.resetSimulation());
    q('.water-json').addEventListener('click', () => downloadDataset(this.outputs.hazardState, 'json', `${this.params.scenarioId}.json`));
    q('.water-csv').addEventListener('click', () => downloadDataset(this.outputs.hazardState, 'csv', `${this.params.scenarioId}.csv`));
    this.syncSimulationButtons();
  }

  cleanup() {
    if (this.simulationTimer) {
      window.clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearHazardOverlay?.();
    this.sceneManager?.highlightRoadwayEdges?.([]);
    this.sceneManager?.setRoadwayBaseColor?.('#3a4a7a');
    this.summaryPanel?.remove();
    this.legendPanel?.remove();
    this.mapPanel?.remove();
    this.topologyPanel?.remove();
  }
}

class FireAndSmokeSimulationRuntime {
  constructor(nodeModel, inputs) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.label = nodeModel.label || 'Fire and Smoke Simulation';
    this.inputRequirements = FireAndSmokeSimulationInputRequirements;
    this.params = {
      sourceEdgeId: nodeModel.params?.sourceEdgeId || null,
      sourceRatio: Number(nodeModel.params?.sourceRatio ?? 0.5),
      ignitionTime: Number(nodeModel.params?.ignitionTime ?? 0),
      simulationDuration: Number(nodeModel.params?.simulationDuration ?? 1800),
      timeSteps: Number(nodeModel.params?.timeSteps ?? 60),
      timeInterval: Number(nodeModel.params?.timeInterval ?? 30),
      cellLength: Number(nodeModel.params?.cellLength ?? 10),
      roadwayWidth: Number(nodeModel.params?.roadwayWidth ?? 4),
      roadwayHeight: Number(nodeModel.params?.roadwayHeight ?? 3),
      initialHeatRelease: Number(nodeModel.params?.initialHeatRelease ?? 1),
      burnRate: Number(nodeModel.params?.burnRate ?? 0.03),
      fuelLoad: Number(nodeModel.params?.fuelLoad ?? 4),
      heatYield: Number(nodeModel.params?.heatYield ?? 1),
      heatLossRate: Number(nodeModel.params?.heatLossRate ?? 0.006),
      ignitionThreshold: Number(nodeModel.params?.ignitionThreshold ?? 1),
      smokeYield: Number(nodeModel.params?.smokeYield ?? 1),
      coYield: Number(nodeModel.params?.coYield ?? 0.1),
      smokeDiffusion: Number(nodeModel.params?.smokeDiffusion ?? 0.05),
      ventilationAdvectionScale: Number(nodeModel.params?.ventilationAdvectionScale ?? 1),
      ventilationDilutionScale: Number(nodeModel.params?.ventilationDilutionScale ?? 0.2),
      airflowFireBoost: Number(nodeModel.params?.airflowFireBoost ?? 0.5),
      riskyTempThreshold: Number(nodeModel.params?.riskyTempThreshold ?? 60),
      blockedTempThreshold: Number(nodeModel.params?.blockedTempThreshold ?? 120),
      riskySmokeThreshold: Number(nodeModel.params?.riskySmokeThreshold ?? 0.25),
      blockedSmokeThreshold: Number(nodeModel.params?.blockedSmokeThreshold ?? 0.6),
      riskyVisibilityThreshold: Number(nodeModel.params?.riskyVisibilityThreshold ?? 20),
      blockedVisibilityThreshold: Number(nodeModel.params?.blockedVisibilityThreshold ?? 5),
      riskyCOThreshold: Number(nodeModel.params?.riskyCOThreshold ?? 50),
      blockedCOThreshold: Number(nodeModel.params?.blockedCOThreshold ?? 150),
      useVentilation: nodeModel.params?.useVentilation !== false,
      showFireLayer: nodeModel.params?.showFireLayer !== false,
      showSmokeLayer: nodeModel.params?.showSmokeLayer !== false,
      showRiskLayer: nodeModel.params?.showRiskLayer !== false,
      showSourceMarker: nodeModel.params?.showSourceMarker !== false,
      scenarioId: nodeModel.params?.scenarioId || 'fire_smoke_demo',
      autoRun: nodeModel.params?.autoRun !== false
    };
    this.outputs = {};
    this.outputListeners = new Map();
    this.disposers = [];
    this.awaitingSourcePick = false;
  }

  resolveInputDataset(input) {
    if (!input) return null;
    if (input.__operatorDatasetOutput) return input.getDataset?.() ?? null;
    return input;
  }

  getOutputDataset(portId) {
    if (portId === 'hazardState' && !this.outputs.hazardState) this.generateHazardState();
    return this.outputs[portId] ?? null;
  }

  subscribeOutput(portId, callback) {
    if (!this.outputListeners.has(portId)) this.outputListeners.set(portId, new Set());
    this.outputListeners.get(portId).add(callback);
    return () => this.outputListeners.get(portId)?.delete(callback);
  }

  emitOutput(portId, dataset) {
    (this.outputListeners.get(portId) || []).forEach((callback) => callback(dataset));
  }

  validateSemanticInputs() {
    const errors = [];
    Object.entries(this.inputRequirements).forEach(([key, req]) => {
      const dataset = this.resolveInputDataset(this.inputs[key]);
      if (!dataset) {
        if (!req.optional) errors.push(`Missing semantic dataset input: ${key}`);
        return;
      }
      const actualClass = dataset.contract?.class || dataset.semanticClass;
      if (actualClass !== req.class) errors.push(`Input ${key} expects ${req.class}, got ${actualClass}.`);
      if (dataset.validation?.errors?.length) errors.push(`Input ${key} has validation errors: ${dataset.validation.errors.join('; ')}`);
    });
    if (errors.length) throw new Error(errors.join('\n'));
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.createPanels();
    this.registerVisualContributions();
    this.installHandlers();
    this.generateHazardState();
    if (this.context.get('time') == null) this.context.set('time', this.params.ignitionTime);
    this.updateViews();
    return { cleanup: () => this.cleanup() };
  }

  async initializeRoadway() {
    const roadway = this.inputs.roadway;
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping(), roadway);
    else this.sceneManager.buildRoadway(roadway);
    this.sceneManager.setRoadwayVisible(true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacity(0.82);
  }

  createPanels() {
    this.summaryPanel = createWorkspacePanel('Fire / Smoke Summary', 'fire-smoke-summary-panel', '<div class="fire-smoke-summary-content"></div>');
    this.legendPanel = createWorkspacePanel(
      'Fire / Smoke Legend',
      'fire-smoke-legend-panel',
      '<div class="route-legend-list"><div><span class="legend-dot fire-source"></span>Ignition source</div><div><span class="legend-dot fire-heat"></span>Heat / flame</div><div><span class="legend-dot smoke"></span>Smoke / visibility loss</div><div><span class="legend-dot route-blocked"></span>Blocked roadway</div></div>'
    );
    this.mapPanel = createWorkspacePanel('Fire / Smoke 2D Map', 'hazard-roadway-map-panel fire-smoke-map-panel', '<canvas class="hazard-roadway-view"></canvas>');
    this.topologyPanel = createWorkspacePanel('Fire / Smoke Topology', 'hazard-topology-panel fire-smoke-topology-panel', '<canvas class="hazard-roadway-view"></canvas>');
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      semanticRole: 'base',
      objectSystem: 'roadway',
      visible: true,
      opacity: 0.82,
      show: () => this.sceneManager.setRoadwayVisible(true),
      hide: () => this.sceneManager.setRoadwayVisible(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value),
      focus: () => this.sceneManager.focusOnRoadway()
    });
    this.contributionRegistry.register({
      id: `${this.id}:hazard-overlay`,
      label: 'Fire / Smoke Hazard Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      contributionKind: 'layer',
      semanticRole: 'state',
      objectSystem: 'roadway',
      visualChannels: { color: 'smokeDensity', opacity: 'smokeDensity', halo: 'burningIntensity' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: 0.75, canPin: true },
      visible: true,
      opacity: 0.75,
      show: () => this.sceneManager.setHazardOverlayVisible(true),
      hide: () => this.sceneManager.setHazardOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setHazardOverlayOpacity(value),
      cleanup: () => this.sceneManager.clearHazardOverlay()
    });
    [
      ['summary', 'Fire / Smoke Summary', this.summaryPanel, 'panel'],
      ['legend', 'Fire / Smoke Legend', this.legendPanel, 'legend'],
      ['map', 'Fire / Smoke 2D Map', this.mapPanel, 'topology-view'],
      ['topology', 'Fire / Smoke Topology', this.topologyPanel, 'topology-view']
    ].forEach(([suffix, label, panel, type]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateViews()));
    this.disposers.push(this.context.subscribe('selectedRoadwaySegment', () => {
      this.applyHazardSelection();
      this.updateHazardRoadwayViews();
    }));
    this.disposers.push(this.context.subscribe('selectedHazardSegment', () => {
      this.applyHazardSelection();
      this.updateHazardRoadwayViews();
    }));
    installHazardRoadwayViewHandlers(this);
    const previousPick = this.sceneManager.onRoadwayPick;
    this.sceneManager.onRoadwayPick = (entity) => {
      if (!this.awaitingSourcePick) {
        if (entity.type === 'edge') selectHazardRoadwayEdge(this, entity.edgeId);
        return previousPick?.(entity);
      }
      if (entity.type !== 'edge') return previousPick?.(entity);
      this.params.sourceEdgeId = entity.edgeId;
      this.params.sourceRatio = projectRoadwayEdgeRatio(this.inputs.roadway, entity.edgeId, entity.point);
      this.awaitingSourcePick = false;
      selectHazardRoadwayEdge(this, entity.edgeId);
      this.syncControlValues?.();
      this.syncSourcePickState?.();
      if (this.params.autoRun) this.generateHazardState();
    };
    this.disposers.push(() => {
      this.sceneManager.onRoadwayPick = previousPick;
    });
  }

  applyHazardSelection() {
    const selected = selectedRoadwayEdgeId(this.context);
    this.sceneManager?.highlightRoadwayEdges?.(selected ? [selected] : []);
  }

  updateHazardRoadwayViews(states = null) {
    updateHazardRoadwayViews(this, states, 'fire_smoke');
  }

  generateHazardState() {
    const edges = this.inputs.roadway.getEdges();
    if (!this.params.sourceEdgeId && edges[0]) this.params.sourceEdgeId = edges[0].id;
    const result = new FireSmoke1DSolver({
      roadway: this.inputs.roadway,
      ventilationNetwork: this.resolveInputDataset(this.inputs.ventilationNetwork),
      airflowState: this.resolveInputDataset(this.inputs.airflowState),
      params: this.params
    }).run();
    this.simulationSummary = result.summary || {};
    this.outputs.hazardState = createRoadwayHazardDataset(result.rows || [], {
      generatedBy: 'Fire and Smoke Simulation',
      scenarioId: this.params.scenarioId,
      source: { edgeId: this.params.sourceEdgeId, ratio: this.params.sourceRatio },
      parameters: { ...this.params },
      solver: this.simulationSummary
    });
    this.context?.set?.('activeRoadwayHazardState', this.outputs.hazardState);
    this.ensureVisibleSimulationTime();
    this.emitOutput('hazardState', this.outputs.hazardState);
    this.updateViews();
    return this.outputs.hazardState;
  }

  ensureVisibleSimulationTime() {
    if (!this.context || !this.outputs.hazardState) return;
    const current = Number(this.context.get('time'));
    const range = this.outputs.hazardState.getTimeRange?.();
    const min = Number(range?.min ?? this.params.ignitionTime);
    const max = Number(range?.max ?? this.params.ignitionTime);
    if (!Number.isFinite(current) || current < min || current > max) this.context.set('time', min);
  }

  currentStates() {
    const dataset = this.outputs.hazardState || this.getOutputDataset('hazardState');
    const time = this.context?.get?.('time') ?? this.params.ignitionTime;
    return [...(dataset?.getSnapshot?.(time, Infinity)?.values?.() || [])];
  }

  updateViews() {
    if (!this.sceneManager || !this.outputs.hazardState) return;
    const states = this.currentStates();
    this.sceneManager.addHazardEdges(this.inputs.roadway, states, {
      opacity: 0.75,
      hazardStyle: 'fire_smoke',
      sourceEdgeId: this.params.sourceEdgeId,
      sourceRatio: this.params.sourceRatio,
      sourceColor: 0xff4d1a,
      sourceEmissive: 0xff6a00
    });
    if (this.contributionRegistry?.get(`${this.id}:hazard-overlay`)?.visible === false) this.sceneManager.setHazardOverlayVisible(false);
    this.applyHazardSelection();
    this.updateHazardRoadwayViews(states);
    const affected = states.filter((state) => Number(state.hazardValue) > 0);
    const blocked = affected.filter((state) => state.passability === 'blocked');
    const risky = affected.filter((state) => state.passability === 'risky');
    const burning = affected.filter((state) => Number(state.fireIntensity) > 0.1);
    const smoke = affected.filter((state) => Number(state.smokeDensity) > 0.01);
    const maxTemperature = Math.max(0, ...affected.map((state) => Number(state.temperature) || 0));
    const maxSmokeDensity = Math.max(0, ...affected.map((state) => Number(state.smokeDensity) || 0));
    const worstVisibility = Math.min(60, ...affected.map((state) => Number(state.visibility) || 60));
    const content = this.summaryPanel?.querySelector('.fire-smoke-summary-content');
    if (content) {
      const useVent = this.params.useVentilation && this.inputs.ventilationNetwork && this.inputs.airflowState;
      content.innerHTML = `
        <div class="detail-row"><span>Time</span><strong>${formatScalar(this.context.get('time'), 1)} s</strong></div>
        <div class="detail-row"><span>Source</span><strong>${this.params.sourceEdgeId || '-'}</strong></div>
        <div class="detail-row"><span>Affected</span><strong>${affected.length}</strong></div>
        <div class="detail-row"><span>Burning</span><strong>${burning.length}</strong></div>
        <div class="detail-row"><span>Smoke affected</span><strong>${smoke.length}</strong></div>
        <div class="detail-row"><span>Risky / blocked</span><strong>${risky.length} / ${blocked.length}</strong></div>
        <div class="detail-row"><span>Max temp</span><strong>${formatScalar(maxTemperature, 1)} C</strong></div>
        <div class="detail-row"><span>Max smoke</span><strong>${formatScalar(maxSmokeDensity, 3)}</strong></div>
        <div class="detail-row"><span>Worst visibility</span><strong>${formatScalar(worstVisibility, 1)} m</strong></div>
        <div class="detail-row"><span>Ventilation</span><strong>${useVent ? 'coupled' : 'fallback diffusion'}</strong></div>`;
    }
    this.syncTimeSlider?.();
  }

  renderControls(container) {
    this.controlContainer = container;
    const edgeOptions = this.inputs.roadway.getEdges().map((edge) => `<option value="${edge.id}">${edge.id}</option>`).join('');
    const ventilationNote = this.inputs.ventilationNetwork && this.inputs.airflowState
      ? 'Ventilation data connected. Smoke advection uses airflow state.'
      : 'No complete ventilation data connected. Smoke uses diffusion-only fallback.';
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="water-source-picker">
        <button class="fire-pick-source" type="button">Pick ignition source</button>
        <span class="fire-source-summary">Source: ${this.params.sourceEdgeId || '-'}</span>
      </div>
      <div class="control-grid water-control-grid">
        <label class="field-row">Source edge<select class="fire-source">${edgeOptions}</select></label>
        <label class="field-row">Ignition time (s)<input class="fire-ignition" type="number" step="1" /></label>
        <label class="field-row">Time steps<input class="fire-steps" type="number" step="1" /></label>
        <label class="field-row">Time interval (s)<input class="fire-interval" type="number" step="1" /></label>
        <label class="field-row">Fuel load<input class="fire-fuel" type="number" step="0.1" /></label>
        <label class="field-row">Burn rate<input class="fire-burn" type="number" step="0.005" /></label>
        <label class="field-row">Smoke yield<input class="fire-smoke-yield" type="number" step="0.1" /></label>
        <label class="field-row">CO yield<input class="fire-co-yield" type="number" step="0.01" /></label>
        <label class="field-row">Smoke diffusion<input class="fire-diffusion" type="number" step="0.01" /></label>
        <label class="field-row">Vent advection<input class="fire-advection" type="number" step="0.1" /></label>
        <label class="field-row">Risky temp (C)<input class="fire-risk-temp" type="number" step="5" /></label>
        <label class="field-row">Blocked visibility (m)<input class="fire-block-vis" type="number" step="1" /></label>
        <label class="checkbox-row"><span>Use ventilation</span><input class="fire-use-vent" type="checkbox" /></label>
        <label class="checkbox-row"><span>Auto run</span><input class="fire-auto" type="checkbox" /></label>
      </div>
      <label class="field-row water-time-row">Time (s) <span class="fire-time-label">-</span><input class="fire-time" type="range" min="0" max="0" step="1" /></label>
      <div class="button-row compact">
        <button class="fire-run">Run simulation</button>
        <button class="fire-reset">Reset</button>
        <button class="fire-json">Export JSON</button>
        <button class="fire-csv">Export CSV</button>
      </div>
      <div class="muted-note">${ventilationNote}</div>`;
    const q = (selector) => container.querySelector(selector);
    const source = q('.fire-source');
    const pickSourceButton = q('.fire-pick-source');
    const sourceSummary = q('.fire-source-summary');
    const ignition = q('.fire-ignition');
    const steps = q('.fire-steps');
    const interval = q('.fire-interval');
    const fuel = q('.fire-fuel');
    const burn = q('.fire-burn');
    const smokeYield = q('.fire-smoke-yield');
    const coYield = q('.fire-co-yield');
    const diffusion = q('.fire-diffusion');
    const advection = q('.fire-advection');
    const riskTemp = q('.fire-risk-temp');
    const blockVis = q('.fire-block-vis');
    const useVent = q('.fire-use-vent');
    const auto = q('.fire-auto');
    const time = q('.fire-time');
    const timeLabel = q('.fire-time-label');
    this.syncSourcePickState = () => {
      pickSourceButton.classList.toggle('active', this.awaitingSourcePick);
      pickSourceButton.textContent = this.awaitingSourcePick ? 'Pick a roadway...' : 'Pick ignition source';
      sourceSummary.textContent = `Source: ${this.params.sourceEdgeId || '-'}`;
    };
    this.syncControlValues = () => {
      source.value = this.params.sourceEdgeId || this.inputs.roadway.getEdges()[0]?.id || '';
      ignition.value = this.params.ignitionTime;
      steps.value = this.params.timeSteps;
      interval.value = this.params.timeInterval;
      fuel.value = this.params.fuelLoad;
      burn.value = this.params.burnRate;
      smokeYield.value = this.params.smokeYield;
      coYield.value = this.params.coYield;
      diffusion.value = this.params.smokeDiffusion;
      advection.value = this.params.ventilationAdvectionScale;
      riskTemp.value = this.params.riskyTempThreshold;
      blockVis.value = this.params.blockedVisibilityThreshold;
      useVent.checked = this.params.useVentilation;
      auto.checked = this.params.autoRun;
      this.syncSourcePickState?.();
      this.syncTimeSlider?.();
    };
    this.syncTimeSlider = () => {
      const range = this.outputs.hazardState?.getTimeRange?.();
      if (!range?.times?.length) return;
      const current = Number(this.context?.get?.('time') ?? range.min);
      time.min = String(range.min);
      time.max = String(range.max);
      time.step = String(this.params.timeInterval || 1);
      time.value = String(Math.max(range.min, Math.min(range.max, current)));
      timeLabel.textContent = formatScalar(current, 1);
    };
    const read = (run = this.params.autoRun) => {
      this.params.sourceEdgeId = source.value;
      this.params.ignitionTime = Number(ignition.value);
      this.params.timeSteps = Number(steps.value);
      this.params.timeInterval = Number(interval.value);
      this.params.fuelLoad = Number(fuel.value);
      this.params.burnRate = Number(burn.value);
      this.params.smokeYield = Number(smokeYield.value);
      this.params.coYield = Number(coYield.value);
      this.params.smokeDiffusion = Number(diffusion.value);
      this.params.ventilationAdvectionScale = Number(advection.value);
      this.params.riskyTempThreshold = Number(riskTemp.value);
      this.params.blockedVisibilityThreshold = Number(blockVis.value);
      this.params.useVentilation = useVent.checked;
      this.params.autoRun = auto.checked;
      if (run) this.generateHazardState();
    };
    this.syncControlValues();
    source.addEventListener('change', () => {
      this.params.sourceRatio = 0.5;
      read();
    });
    [ignition, steps, interval, fuel, burn, smokeYield, coYield, diffusion, advection, riskTemp, blockVis, useVent, auto].forEach((element) =>
      element.addEventListener('change', () => read())
    );
    pickSourceButton.addEventListener('click', () => {
      this.awaitingSourcePick = !this.awaitingSourcePick;
      this.syncSourcePickState?.();
    });
    time.addEventListener('input', () => this.context?.set?.('time', Number(time.value)));
    q('.fire-run').addEventListener('click', () => read(true));
    q('.fire-reset').addEventListener('click', () => {
      this.outputs.hazardState = null;
      this.context?.set?.('activeRoadwayHazardState', null);
      this.sceneManager?.clearHazardOverlay?.();
      this.sceneManager?.highlightRoadwayEdges?.([]);
      this.updateHazardRoadwayViews([]);
      this.emitOutput('hazardState', null);
    });
    q('.fire-json').addEventListener('click', () => downloadDataset(this.outputs.hazardState, 'json', `${this.params.scenarioId}.json`));
    q('.fire-csv').addEventListener('click', () => downloadDataset(this.outputs.hazardState, 'csv', `${this.params.scenarioId}.csv`));
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearHazardOverlay?.();
    this.sceneManager?.highlightRoadwayEdges?.([]);
    this.sceneManager?.setRoadwayBaseColor?.('#3a4a7a');
    this.summaryPanel?.remove();
    this.legendPanel?.remove();
    this.mapPanel?.remove();
    this.topologyPanel?.remove();
  }
}

class SafeRouteAnalysisRuntime {
  constructor(nodeModel, inputs) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.label = nodeModel.label || 'Safe Route Analysis';
    this.inputRequirements = SafeRouteAnalysisInputRequirements;
    this.params = {
      routeMode: nodeModel.params?.routeMode || 'nearest-safe',
      destinationMode: nodeModel.params?.destinationMode || 'nearest-resource',
      resourceTypes: nodeModel.params?.resourceTypes || ['refuge', 'exit'],
      selectedResourceId: nodeModel.params?.selectedResourceId || null,
      avoidRiskySegments: nodeModel.params?.avoidRiskySegments !== false,
      riskPenalty: Number(nodeModel.params?.riskPenalty ?? nodeModel.params?.riskWeight ?? 5),
      walkingSpeed: Number(nodeModel.params?.walkingSpeed ?? nodeModel.params?.travelSpeed ?? 1.2),
      showAllRoutes: nodeModel.params?.showAllRoutes !== false,
      showOnlyAtRiskPeople: nodeModel.params?.showOnlyAtRiskPeople === true,
      enableQuickHazardSketch: nodeModel.params?.enableQuickHazardSketch !== false,
      autoRecompute: nodeModel.params?.autoRecompute !== false,
      capacityAware: nodeModel.params?.capacityAware === true,
      manualMode: nodeModel.params?.manualMode === true,
      manualMarkMode: nodeModel.params?.manualMarkMode || 'blocked'
    };
    this.filters = { status: 'all', search: '', sort: 'risk' };
    this.manualConstraints = new Map();
    this.routes = [];
    this.selectedRouteId = null;
    this.selectedPersonId = null;
    this.selectedResourceId = this.params.selectedResourceId;
    this.focusSelectedRoute = false;
    this.disposers = [];
  }

  resolveInputDataset(input) {
    if (!input) return null;
    if (input.__operatorDatasetOutput) return input.getDataset?.() ?? null;
    return input;
  }

  hazardDataset() {
    return this.resolveInputDataset(this.inputs.hazardState) || this.context?.get?.('activeRoadwayHazardState') || null;
  }

  validateSemanticInputs() {
    const errors = [];
    Object.entries(this.inputRequirements).forEach(([key, req]) => {
      const dataset = this.resolveInputDataset(this.inputs[key]);
      if (!dataset) {
        if (!req.optional) errors.push(`Missing semantic dataset input: ${key}`);
        return;
      }
      const actualClass = dataset.contract?.class || dataset.semanticClass;
      if (actualClass !== req.class) errors.push(`Input ${key} expects ${req.class}, got ${actualClass}.`);
      if (dataset.validation?.errors?.length) errors.push(`Input ${key} has validation errors: ${dataset.validation.errors.join('; ')}`);
    });
    if (errors.length) throw new Error(errors.join('\n'));
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.createPanels();
    this.registerVisualContributions();
    this.installHandlers();
    this.recomputeRoutes();
    return { cleanup: () => this.cleanup() };
  }

  async initializeRoadway() {
    const roadway = this.inputs.roadway;
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping(), roadway);
    else this.sceneManager.buildRoadway(roadway);
    this.sceneManager.setRoadwayVisible(true);
    this.sceneManager.setRoadwayOpacity(0.5);
  }

  createPanels() {
    this.summaryPanel = createWorkspacePanel('Emergency Response Summary', 'emergency-response-summary-panel', '<div class="emergency-response-summary"></div>');
    this.mapPanel = createWorkspacePanel('2D Emergency Response Map', 'emergency-response-map-panel hazard-roadway-map-panel', '<canvas class="hazard-roadway-view emergency-response-map"></canvas>');
    this.listPanel = createWorkspacePanel(
      'Personnel Risk & Route List',
      'safe-route-list-panel',
      '<div class="safe-route-mode"></div><div class="personnel-list-tools"></div><div class="safe-route-list"></div>'
    );
    this.resourcePanel = createWorkspacePanel('Emergency Resource Panel', 'emergency-resource-panel', '<div class="emergency-resource-content"></div>');
    this.detailPanel = createWorkspacePanel('Route Detail', 'safe-route-detail-panel', '<div class="safe-route-detail"></div>');
    this.manualPanel = createWorkspacePanel(
      'Quick Hazard Sketch',
      'safe-route-manual-panel',
      `<label class="checkbox-row"><span>Enable quick sketch</span><input class="manual-enable" type="checkbox" /></label>
       <label class="field-row">Mark mode<select class="manual-mode"><option value="blocked">Blocked</option><option value="risky">Risky</option><option value="clear">Clear</option></select></label>
       <div class="button-row compact"><button class="manual-clear">Clear all</button><button class="manual-json">Export JSON</button><button class="manual-csv">Export CSV</button></div>
       <div class="manual-constraint-list"></div>`
    );
    this.legendPanel = createWorkspacePanel(
      'Emergency Response Legend',
      'route-legend-panel',
      '<div class="route-legend-list"><div><span class="legend-dot route-safe"></span>Safe person / route</div><div><span class="legend-dot route-risky"></span>At risk / risky route</div><div><span class="legend-dot route-blocked"></span>No route / trapped</div><div><span class="legend-dot exit"></span>Emergency resource</div></div>'
    );
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      semanticRole: 'base',
      visible: true,
      opacity: 0.5,
      show: () => this.sceneManager.setRoadwayVisible(true),
      hide: () => this.sceneManager.setRoadwayVisible(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value)
    });
    this.contributionRegistry.register({
      id: `${this.id}:route-overlay`,
      label: '3D Emergency Response Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      semanticRole: 'response',
      objectSystem: 'personnelEmergencyResponse',
      visualChannels: { color: 'riskStatus', line: 'routeStatus', icon: 'entityType' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: 0.95 },
      visible: true,
      opacity: 0.95,
      show: () => this.sceneManager.setSafeRouteOverlayVisible(true),
      hide: () => this.sceneManager.setSafeRouteOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setSafeRouteOverlayOpacity(value),
      cleanup: () => this.sceneManager.clearSafeRouteOverlay()
    });
    [
      ['summary', 'Emergency Response Summary', this.summaryPanel, 'panel'],
      ['response-map', '2D Emergency Response Map', this.mapPanel, 'topology-view'],
      ['route-list', 'Personnel Risk & Route List', this.listPanel, 'panel'],
      ['resources', 'Emergency Resource Panel', this.resourcePanel, 'panel'],
      ['route-detail', 'Route Detail Panel', this.detailPanel, 'panel'],
      ['manual', 'Quick Hazard Sketch', this.manualPanel, 'panel'],
      ['legend', 'Emergency Response Legend', this.legendPanel, 'legend']
    ].forEach(([suffix, label, panel, type]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.recomputeRoutes()));
    this.disposers.push(this.context.subscribe('activeRoadwayHazardState', () => this.recomputeRoutes()));
    this.disposers.push(this.context.subscribe('selectedRoute', (routeId) => {
      this.selectedRouteId = routeId;
      const route = this.routes.find((item) => item.routeId === routeId);
      if (route) {
        this.selectedPersonId = route.personId;
        this.selectedResourceId = route.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
      }
      this.updateViews();
    }));
    this.disposers.push(this.context.subscribe('selectedPerson', (personId) => {
      if (!personId) {
        this.selectedPersonId = null;
        this.selectedRouteId = null;
        this.focusSelectedRoute = false;
        this.updateViews();
        return;
      }
      if (personId === this.selectedPersonId) return;
      this.selectedPersonId = personId;
      const route = this.routes.find((item) => item.personId === personId);
      if (route) {
        this.selectedRouteId = route.routeId;
        this.selectedResourceId = route.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
      }
      this.updateViews();
    }));
    this.disposers.push(this.context.subscribe('selectedResource', (resourceId) => {
      if (!resourceId) {
        this.selectedResourceId = null;
        this.updateViews();
        return;
      }
      if (resourceId === this.selectedResourceId) return;
      this.selectedResourceId = resourceId;
      this.updateViews();
    }));
    if (this.inputs.hazardState?.__operatorDatasetOutput) this.disposers.push(this.inputs.hazardState.subscribe(() => this.recomputeRoutes()));
    const previousPick = this.sceneManager.onRoadwayPick;
    const previousPersonPick = this.sceneManager.onPersonPick;
    const previousResourcePick = this.sceneManager.onEmergencyResourcePick;
    const previousRoutePick = this.sceneManager.onSafeRoutePick;
    this.sceneManager.onPersonPick = (personId) => {
      const route = this.routes.find((item) => item.personId === personId);
      this.selectedPersonId = personId;
      if (route) {
        this.selectedRouteId = route.routeId;
        this.selectedResourceId = route.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
      }
      this.context.set('selectedPerson', personId);
      this.context.set('selectedRoute', route?.routeId || null);
      this.context.set('selection', { type: 'person', id: personId });
      this.updateViews();
    };
    this.sceneManager.onEmergencyResourcePick = (resourceId) => {
      this.selectedResourceId = resourceId;
      this.context.set('selectedResource', resourceId);
      this.context.set('selection', { type: 'emergencyResource', id: resourceId });
      this.updateViews();
    };
    this.sceneManager.onSafeRoutePick = (routeId, personId) => {
      const route = this.routes.find((item) => item.routeId === routeId);
      this.selectedRouteId = routeId;
      this.selectedPersonId = route?.personId || personId || null;
      this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
      this.focusSelectedRoute = true;
      this.context.set('selectedRoute', routeId);
      this.context.set('selectedPerson', this.selectedPersonId);
      this.context.set('selection', { type: 'evacuationRoute', id: routeId, personId: this.selectedPersonId });
      this.updateViews();
    };
    this.sceneManager.onRoadwayPick = (entity) => {
      if (!this.params.manualMode || entity.type !== 'edge') return previousPick?.(entity);
      this.applyManualConstraint(entity.edgeId);
    };
    this.disposers.push(installRoadwayResponseViewSelection([this.mapPanel], {
      onPerson: (personId) => {
        const route = this.routes.find((item) => item.personId === personId);
        this.selectedPersonId = personId;
        this.selectedRouteId = route?.routeId || this.selectedRouteId;
        this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
        this.context.set('selectedPerson', personId);
        this.context.set('selectedRoute', route?.routeId || null);
        this.context.set('selection', { type: 'person', id: personId });
        this.updateViews();
      },
      onResource: (resourceId) => {
        this.selectedResourceId = resourceId;
        this.context.set('selectedResource', resourceId);
        this.context.set('selection', { type: 'emergencyResource', id: resourceId });
        this.updateViews();
      },
      onRoute: (routeId, personId, edgeId) => {
        if (this.params.manualMode && edgeId) {
          this.applyManualConstraint(edgeId);
          return;
        }
        const route = this.routes.find((item) => item.routeId === routeId);
        this.selectedRouteId = routeId;
        this.selectedPersonId = route?.personId || personId || this.selectedPersonId;
        this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
        this.context.set('selectedRoute', routeId);
        this.context.set('selectedPerson', this.selectedPersonId);
        this.context.set('selection', { type: 'evacuationRoute', id: routeId, personId: this.selectedPersonId });
        this.updateViews();
      },
      onEdge: (edgeId) => {
        if (this.params.manualMode) this.applyManualConstraint(edgeId);
        else {
          this.context.set('selectedRoadwaySegment', { type: 'edge', id: edgeId });
          this.context.set('selectedHazardSegment', edgeId);
          this.context.set('selection', { type: 'roadwayHazardSegment', id: edgeId });
          this.sceneManager?.highlightRoadwayEdges?.([edgeId]);
          this.updateViews();
        }
      },
      onBlank: () => {
        this.context.set('selectedPerson', null);
        this.context.set('selectedRoute', null);
        this.context.set('selectedResource', null);
        this.context.set('selectedRoadwaySegment', null);
        this.context.set('selectedHazardSegment', null);
        this.context.set('selection', null);
        this.sceneManager?.highlightRoadwayEdges?.([]);
        this.updateViews();
      }
    }));
    this.disposers.push(() => {
      this.sceneManager.onRoadwayPick = previousPick;
      this.sceneManager.onPersonPick = previousPersonPick;
      this.sceneManager.onEmergencyResourcePick = previousResourcePick;
      this.sceneManager.onSafeRoutePick = previousRoutePick;
    });
    const enable = this.manualPanel.querySelector('.manual-enable');
    const mode = this.manualPanel.querySelector('.manual-mode');
    enable.checked = this.params.manualMode;
    mode.value = this.params.manualMarkMode;
    enable.addEventListener('change', () => {
      this.params.manualMode = enable.checked;
      this.recomputeRoutes();
    });
    mode.addEventListener('change', () => (this.params.manualMarkMode = mode.value));
    this.manualPanel.querySelector('.manual-clear').addEventListener('click', () => {
      this.manualConstraints.clear();
      this.recomputeRoutes();
    });
    this.manualPanel.querySelector('.manual-json').addEventListener('click', () => downloadDataset(this.manualHazardDataset(), 'json', 'manual_roadway_hazard_state.json'));
    this.manualPanel.querySelector('.manual-csv').addEventListener('click', () => downloadDataset(this.manualHazardDataset(), 'csv', 'manual_roadway_hazard_state.csv'));
  }

  applyManualConstraint(edgeId) {
    if (!edgeId) return;
    if (this.params.manualMarkMode === 'clear') this.manualConstraints.delete(edgeId);
    else this.manualConstraints.set(String(edgeId), this.params.manualMarkMode);
    this.context.set('selectedRoadwaySegment', { type: 'edge', id: String(edgeId) });
    this.context.set('selectedHazardSegment', String(edgeId));
    this.context.set('selection', { type: 'roadwayHazardSegment', id: String(edgeId) });
    this.recomputeRoutes();
  }

  manualHazardDataset() {
    const time = this.context.get('time') ?? 0;
    const rows = [...this.manualConstraints.entries()].map(([edgeId, passability]) => ({
      time,
      timeValue: time,
      roadwayEdgeId: edgeId,
      roadwayNodeId: null,
      hazardType: 'manual_constraint',
      hazardValue: passability === 'blocked' ? 1 : passability === 'risky' ? 0.5 : 0,
      severity: passability === 'blocked' ? 'high' : passability === 'risky' ? 'medium' : 'none',
      passability: passability === 'clear' ? 'passable' : passability,
      arrivalTime: time,
      scenarioId: 'manual_constraints',
      sourceId: edgeId
    }));
    return createRoadwayHazardDataset(rows, { generatedBy: 'Safe Route Analysis', generationMode: 'manualConstraints' });
  }

  hazardForEdge(edgeId) {
    const time = this.context.get('time') ?? 0;
    const base = this.hazardDataset()?.getEdgeState?.(edgeId, time, Infinity) ?? null;
    const manual = this.manualConstraints.get(String(edgeId));
    if (!manual) return base;
    if (manual === 'blocked') return { ...base, roadwayEdgeId: edgeId, passability: 'blocked', severity: 'high', hazardValue: 1 };
    if (manual === 'risky') return { ...base, roadwayEdgeId: edgeId, passability: base?.passability === 'blocked' ? 'blocked' : 'risky', severity: base?.passability === 'blocked' ? 'high' : 'medium', hazardValue: Math.max(0.5, Number(base?.hazardValue) || 0) };
    return base;
  }

  edgeCost(edge) {
    const hazard = this.hazardForEdge(edge.id);
    const length = Math.max(1, edgeLength(this.inputs.roadway, edge));
    if (hazard?.passability === 'blocked') return Infinity;
    return hazard?.passability === 'risky' && this.params.avoidRiskySegments ? length * this.params.riskPenalty : length;
  }

  anchorRatio(anchor) {
    return Math.max(0, Math.min(1, Number(anchor?.ratio ?? anchor?.roadwayAnchor?.ratio ?? 0.5)));
  }

  edgeEndpointRatio(edge, nodeId) {
    const [from, to] = edgeEndpoints(edge);
    if (String(nodeId) === String(from)) return 0;
    if (String(nodeId) === String(to)) return 1;
    return null;
  }

  anchorEndpointOptions(anchor) {
    if (!anchor) return [];
    if (anchor.nodeId) return [{ nodeId: String(anchor.nodeId), cost: 0, length: 0, segments: [] }];
    const edgeId = anchor.edgeId ?? anchor.roadwayEdgeId;
    const edge = this.inputs.roadway.edgeMap.get(String(edgeId));
    if (!edge) return [];
    const [from, to] = edgeEndpoints(edge);
    const ratio = this.anchorRatio(anchor);
    const length = Math.max(1, edgeLength(this.inputs.roadway, edge));
    const weightedCost = this.edgeCost(edge);
    return [
      { nodeId: from, endpointRatio: 0 },
      { nodeId: to, endpointRatio: 1 }
    ]
      .filter((option) => option.nodeId != null)
      .map((option) => {
        const fraction = Math.abs(ratio - option.endpointRatio);
        return {
          nodeId: String(option.nodeId),
          cost: Number.isFinite(weightedCost) ? weightedCost * fraction : Infinity,
          length: length * fraction,
          segments:
            fraction > 0.001
              ? [{ edgeId: String(edge.id), startRatio: ratio, endRatio: option.endpointRatio, role: 'anchor-connector' }]
              : []
        };
      });
  }

  anchorToNode(anchor) {
    if (!anchor) return null;
    if (anchor.nodeId) return anchor.nodeId;
    const edge = this.inputs.roadway.edgeMap.get(String(anchor.edgeId ?? anchor.roadwayEdgeId));
    return edge?.from ?? edge?.source ?? edge?.j1 ?? null;
  }

  pathSegments(path) {
    return (path.edgePath || [])
      .map((edgeId, index) => {
        const edge = this.inputs.roadway.edgeMap.get(String(edgeId));
        if (!edge) return null;
        const fromNode = path.nodePath?.[index];
        const toNode = path.nodePath?.[index + 1];
        const startRatio = this.edgeEndpointRatio(edge, fromNode);
        const endRatio = this.edgeEndpointRatio(edge, toNode);
        if (startRatio == null || endRatio == null) return null;
        return { edgeId: String(edgeId), startRatio, endRatio, fromNodeId: String(fromNode), toNodeId: String(toNode), role: 'network-path' };
      })
      .filter(Boolean);
  }

  collapseEdgePath(segments = []) {
    return segments
      .map((segment) => String(segment.edgeId))
      .filter((edgeId, index, list) => edgeId && edgeId !== list[index - 1]);
  }

  directAnchorRoute(person, resource) {
    const start = person?.roadwayAnchor;
    const end = resource?.roadwayAnchor;
    const startEdgeId = start?.edgeId ?? start?.roadwayEdgeId;
    const endEdgeId = end?.edgeId ?? end?.roadwayEdgeId;
    if (!startEdgeId || !endEdgeId || String(startEdgeId) !== String(endEdgeId)) return null;
    const edge = this.inputs.roadway.edgeMap.get(String(startEdgeId));
    if (!edge) return null;
    const weightedCost = this.edgeCost(edge);
    if (!Number.isFinite(weightedCost)) return null;
    const startRatio = this.anchorRatio(start);
    const endRatio = this.anchorRatio(end);
    const fraction = Math.abs(endRatio - startRatio);
    const length = Math.max(1, edgeLength(this.inputs.roadway, edge)) * fraction;
    const segments = fraction > 0.001 ? [{ edgeId: String(edge.id), startRatio, endRatio, role: 'direct-anchor' }] : [];
    return {
      resource,
      destination: null,
      nodePath: [],
      edgePath: this.collapseEdgePath(segments),
      segments,
      distance: length,
      cost: weightedCost * fraction
    };
  }

  bestRouteForPerson(person, resources) {
    let best = null;
    for (const resource of resources) {
      const direct = this.directAnchorRoute(person, resource);
      if (direct && (!best || direct.cost < best.cost)) best = direct;
      const startOptions = this.anchorEndpointOptions(person.roadwayAnchor).filter((option) => Number.isFinite(option.cost));
      const endOptions = this.anchorEndpointOptions(resource.roadwayAnchor).filter((option) => Number.isFinite(option.cost));
      for (const start of startOptions) {
        for (const end of endOptions) {
          const path = this.shortestPath(start.nodeId, [end.nodeId]);
          if (!path) continue;
          const segments = [
            ...start.segments,
            ...this.pathSegments(path),
            ...end.segments.map((segment) => ({
              ...segment,
              startRatio: segment.endRatio,
              endRatio: segment.startRatio,
              role: 'destination-connector'
            }))
          ];
          const networkLength = path.edgePath.reduce(
            (sum, edgeId) => sum + edgeLength(this.inputs.roadway, this.inputs.roadway.edgeMap.get(String(edgeId))),
            0
          );
          const candidate = {
            resource,
            destination: path.destination,
            nodePath: path.nodePath,
            edgePath: this.collapseEdgePath(segments),
            segments,
            distance: start.length + networkLength + end.length,
            cost: start.cost + path.cost + end.cost
          };
          if (!best || candidate.cost < best.cost) best = candidate;
        }
      }
    }
    return best;
  }

  availableResources() {
    const allowed = new Set((this.params.resourceTypes || ['refuge', 'exit']).map((type) => String(type).toLowerCase()));
    let resources = this.inputs.emergencyResources
      .listResources()
      .filter((resource) => String(resource.status).toLowerCase() !== 'unavailable')
      .filter((resource) => !allowed.size || allowed.has(String(resource.resourceType).toLowerCase()));
    if (!resources.length) resources = this.inputs.emergencyResources.getExits().filter((resource) => String(resource.status).toLowerCase() !== 'unavailable');
    if (this.params.destinationMode === 'selected-resource' && this.selectedResourceId) {
      const selected = resources.find((resource) => resource.resourceId === this.selectedResourceId);
      if (selected) return [selected];
    }
    if (this.params.destinationMode === 'nearest-exit') return resources.filter((resource) => String(resource.resourceType).toLowerCase() === 'exit');
    if (this.params.destinationMode === 'nearest-refuge') return resources.filter((resource) => String(resource.resourceType).toLowerCase() === 'refuge');
    return resources;
  }

  edgeHazard(edgeId) {
    return edgeId ? this.hazardForEdge(edgeId) : null;
  }

  assessPersonRisk(person, path, riskyEdges = []) {
    const anchorEdge = person.roadwayAnchor?.edgeId;
    const startHazard = this.edgeHazard(anchorEdge);
    if (startHazard?.passability === 'blocked') return 'inside_hazard';
    if (!path) return 'no_route';
    if (startHazard?.passability === 'risky') return 'at_risk';
    if (riskyEdges.length) return 'route_affected';
    return 'safe';
  }

  routeStatusForRisk(riskStatus, riskyEdges = []) {
    if (riskStatus === 'inside_hazard' || riskStatus === 'no_route') return 'noRoute';
    if (riskStatus === 'at_risk' || riskStatus === 'route_affected' || riskyEdges.length) return 'risky';
    return 'safe';
  }

  buildAdjacency() {
    const adjacency = new Map(this.inputs.roadway.getNodes().map((node) => [String(node.id), []]));
    this.inputs.roadway.getEdges().forEach((edge) => {
      const [a, b] = edgeEndpoints(edge);
      if (!a || !b) return;
      const cost = this.edgeCost(edge);
      adjacency.get(a)?.push({ nodeId: b, edgeId: edge.id, cost });
      adjacency.get(b)?.push({ nodeId: a, edgeId: edge.id, cost });
    });
    return adjacency;
  }

  shortestPath(startNodeId, destinationNodeIds) {
    const destinations = new Set(destinationNodeIds.map(String));
    const adjacency = this.buildAdjacency();
    const dist = new Map([...adjacency.keys()].map((id) => [id, Infinity]));
    const prev = new Map();
    const open = new Set(adjacency.keys());
    dist.set(String(startNodeId), 0);
    while (open.size) {
      let current = null;
      let best = Infinity;
      open.forEach((id) => {
        if ((dist.get(id) ?? Infinity) < best) {
          best = dist.get(id);
          current = id;
        }
      });
      if (!current || !Number.isFinite(best)) break;
      if (destinations.has(current)) break;
      open.delete(current);
      for (const next of adjacency.get(current) || []) {
        if (!Number.isFinite(next.cost)) continue;
        const candidate = best + next.cost;
        if (candidate < (dist.get(next.nodeId) ?? Infinity)) {
          dist.set(next.nodeId, candidate);
          prev.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
        }
      }
    }
    const destination = [...destinations].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))[0];
    if (!destination || !Number.isFinite(dist.get(destination))) return null;
    const nodePath = [destination];
    const edgePath = [];
    let cursor = destination;
    while (cursor !== String(startNodeId)) {
      const p = prev.get(cursor);
      if (!p) break;
      edgePath.unshift(p.edgeId);
      nodePath.unshift(p.nodeId);
      cursor = p.nodeId;
    }
    return { destination, nodePath, edgePath, cost: dist.get(destination) };
  }

  routeMode() {
    const hasHazard = Boolean(this.hazardDataset());
    const hasManual = this.manualConstraints.size > 0;
    if (hasHazard && hasManual) return 'Derived Hazard + Manual Constraints';
    if (hasHazard) return this.inputs.hazardState?.__operatorDatasetOutput ? 'Derived Hazard' : 'Imported Hazard';
    if (hasManual) return 'Manual Constraints';
    return 'No Hazard State';
  }

  recomputeRoutes() {
    const resources = this.availableResources();
    this.routes = this.inputs.people.listPeople().map((person) => {
      const path = resources.length ? this.bestRouteForPerson(person, resources) : null;
      if (!path) {
        const riskStatus = this.assessPersonRisk(person, null, []);
        return {
          routeId: `route:${person.personId}`,
          personId: person.personId,
          person,
          destinationResourceId: null,
          riskStatus,
          status: 'noRoute',
          edgePath: [],
          nodePath: [],
          segments: [],
          distance: Infinity,
          riskCost: Infinity,
          estimatedTime: Infinity,
          riskyEdges: [],
          blockedEdges: person.roadwayAnchor?.edgeId ? [person.roadwayAnchor.edgeId].filter((edgeId) => this.edgeHazard(edgeId)?.passability === 'blocked') : [],
          mode: this.routeMode()
        };
      }
      const riskyEdges = path.edgePath.filter((edgeId) => this.hazardForEdge(edgeId)?.passability === 'risky');
      const destinationResource = path.resource;
      const riskStatus = this.assessPersonRisk(person, path, riskyEdges);
      return {
        routeId: `route:${person.personId}`,
        personId: person.personId,
        person,
        destinationResourceId: destinationResource?.resourceId ?? null,
        resourceType: destinationResource?.resourceType ?? null,
        riskStatus,
        status: this.routeStatusForRisk(riskStatus, riskyEdges),
        edgePath: path.edgePath,
        nodePath: path.nodePath,
        segments: path.segments,
        distance: path.distance,
        riskCost: path.cost,
        estimatedTime: path.distance / Math.max(0.1, this.params.walkingSpeed),
        riskyEdges,
        blockedEdges: [],
        mode: this.routeMode()
      };
    });
    if (!this.selectedRouteId && this.routes[0]) this.selectedRouteId = this.routes[0].routeId;
    this.updateViews();
  }

  visibleRoutes() {
    if (this.focusSelectedRoute && this.selectedRouteId) {
      return this.routes.filter((route) => route.routeId === this.selectedRouteId || route.personId === this.selectedPersonId);
    }
    return this.params.showAllRoutes
      ? this.routes
      : this.routes.filter((route) => route.routeId === this.selectedRouteId || route.personId === this.selectedPersonId);
  }

  updateViews() {
    if (!this.sceneManager) return;
    const visibleRoutes = this.visibleRoutes();
    const people = this.inputs.people.listPeople().map((person) => {
      const route = this.routes.find((item) => item.personId === person.personId);
      return { ...person, routeStatus: route?.status || 'safe', riskStatus: route?.riskStatus || 'safe' };
    });
    this.sceneManager.addSafeRoutes({
      roadway: this.inputs.roadway,
      routes: visibleRoutes,
      people: this.params.showOnlyAtRiskPeople ? people.filter((person) => person.riskStatus !== 'safe') : people,
      resources: this.availableResources(),
      selectedRouteId: this.selectedRouteId
    });
    if (this.contributionRegistry?.get(`${this.id}:route-overlay`)?.visible === false) this.sceneManager.setSafeRouteOverlayVisible(false);
    this.renderSummary();
    this.renderMap();
    this.renderRouteList();
    this.renderResourcePanel();
    this.renderRouteDetail();
    this.renderManualList();
  }

  responseSummary() {
    const total = this.routes.length;
    const safe = this.routes.filter((route) => route.riskStatus === 'safe').length;
    const atRisk = this.routes.filter((route) => ['at_risk', 'inside_hazard', 'route_affected'].includes(route.riskStatus)).length;
    const noRoute = this.routes.filter((route) => route.status === 'noRoute').length;
    const resources = this.availableResources();
    const affectedResources = resources.filter((resource) => this.edgeHazard(resource.roadwayAnchor?.edgeId)?.passability === 'blocked').length;
    const blockedEdges = this.inputs.roadway.getEdges().filter((edge) => this.edgeHazard(edge.id)?.passability === 'blocked');
    const blockedLength = blockedEdges.reduce((sum, edge) => sum + edgeLength(this.inputs.roadway, edge), 0);
    return { total, safe, atRisk, noRoute, resources: resources.length, affectedResources, blockedLength };
  }

  renderSummary() {
    const content = this.summaryPanel?.querySelector('.emergency-response-summary');
    if (!content) return;
    const summary = this.responseSummary();
    content.innerHTML = `
      <div class="summary-grid compact">
        <div><span>People</span><strong>${summary.total}</strong></div>
        <div><span>Safe</span><strong>${summary.safe}</strong></div>
        <div><span>At risk</span><strong>${summary.atRisk}</strong></div>
        <div><span>No route</span><strong>${summary.noRoute}</strong></div>
        <div><span>Resources</span><strong>${summary.resources}</strong></div>
        <div><span>Affected resources</span><strong>${summary.affectedResources}</strong></div>
      </div>
      <div class="detail-row"><span>Blocked roadway length</span><strong>${formatScalar(summary.blockedLength, 1)}</strong></div>
      <div class="detail-row"><span>Mode</span><strong>${this.routeMode()}</strong></div>`;
  }

  renderMap() {
    const visibleRoutes = this.visibleRoutes();
    const people = this.inputs.people.listPeople().map((person) => {
      const route = this.routes.find((item) => item.personId === person.personId);
      return { ...person, routeStatus: route?.status || 'safe', riskStatus: route?.riskStatus || 'safe' };
    });
    const states = this.inputs.roadway.getEdges().map((edge) => {
      const hazard = this.hazardForEdge(edge.id);
      return hazard
        ? { ...hazard, roadwayEdgeId: String(edge.id), visualHazard: hazard.passability === 'blocked' ? 1 : hazard.passability === 'risky' ? 0.62 : Number(hazard.hazardValue) || 0 }
        : { roadwayEdgeId: String(edge.id), hazardValue: 0, passability: 'passable', severity: 'none' };
    });
    renderRoadwayHazardViewPair({
      roadway: this.inputs.roadway,
      states,
      mapPanel: this.mapPanel,
      topologyPanel: null,
      selectedEdgeId: selectedRoadwayEdgeId(this.context),
      style: 'emergency',
      mapTitle: '2D Emergency Response Map',
      responseOverlay: {
        routes: visibleRoutes,
        people: this.params.showOnlyAtRiskPeople ? people.filter((person) => person.riskStatus !== 'safe') : people,
        resources: this.availableResources(),
        selectedRouteId: this.selectedRouteId,
        selectedPersonId: this.selectedPersonId,
        selectedResourceId: this.selectedResourceId
      }
    });
  }

  renderRouteList() {
    const mode = this.listPanel.querySelector('.safe-route-mode');
    const tools = this.listPanel.querySelector('.personnel-list-tools');
    const list = this.listPanel.querySelector('.safe-route-list');
    const noHazardText = this.routeMode() === 'No Hazard State'
      ? 'No hazard state is active. Routes are computed without hazard constraints. Enable Quick Hazard Sketch or connect a simulation output for hazard-aware analysis.'
      : `Route Mode: ${this.routeMode()}`;
    mode.textContent = noHazardText;
    tools.innerHTML = `
      <select class="personnel-filter-status">
        <option value="all">All statuses</option>
        <option value="safe">Safe</option>
        <option value="at_risk">At risk</option>
        <option value="route_affected">Route affected</option>
        <option value="inside_hazard">Inside hazard</option>
        <option value="no_route">No route</option>
      </select>
      <select class="personnel-sort">
        <option value="risk">Risk</option>
        <option value="distance">Distance</option>
        <option value="time">Travel time</option>
        <option value="person">Person ID</option>
      </select>
      <input class="personnel-search" placeholder="Search person..." value="${this.filters.search}" />
    `;
    const filtered = this.filteredRoutes();
    list.innerHTML = filtered.length
      ? filtered.map((route) => `<button class="route-item ${route.routeId === this.selectedRouteId ? 'selected' : ''}" data-route="${route.routeId}">
        <span><strong>${route.personId}</strong><em>${route.person?.team || ''}</em></span>
        <span class="route-status ${route.status}">${route.riskStatus.replace(/_/g, ' ')}</span>
        <span><strong>${route.destinationResourceId || '-'}</strong><em>${route.resourceType || ''}</em></span>
        <span>${Number.isFinite(route.distance) ? formatScalar(route.distance, 1) : '-'}</span>
      </button>`)
        .join('')
      : '<div class="empty-state">No personnel routes match the current filters.</div>';
    tools.querySelector('.personnel-filter-status').value = this.filters.status;
    tools.querySelector('.personnel-sort').value = this.filters.sort;
    tools.querySelector('.personnel-filter-status').addEventListener('change', (event) => {
      this.filters.status = event.target.value;
      this.renderRouteList();
    });
    tools.querySelector('.personnel-sort').addEventListener('change', (event) => {
      this.filters.sort = event.target.value;
      this.renderRouteList();
    });
    tools.querySelector('.personnel-search').addEventListener('input', (event) => {
      this.filters.search = event.target.value;
      this.renderRouteList();
    });
    list.querySelectorAll('.route-item').forEach((button) => {
      button.addEventListener('click', () => {
        const route = this.routes.find((item) => item.routeId === button.dataset.route);
        this.selectedRouteId = route?.routeId || null;
        this.selectedPersonId = route?.personId || null;
        this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
        this.context.set('selectedRoute', this.selectedRouteId);
        this.context.set('selectedPerson', route?.personId || null);
        this.context.set('selectedResource', route?.destinationResourceId || null);
        this.context.set('selection', { type: 'evacuationRoute', id: this.selectedRouteId, personId: route?.personId });
        this.updateViews();
      });
    });
  }

  filteredRoutes() {
    const riskRank = { inside_hazard: 0, no_route: 1, at_risk: 2, route_affected: 3, safe: 4 };
    const query = this.filters.search.trim().toLowerCase();
    const routes = this.routes.filter((route) => {
      if (this.filters.status !== 'all' && route.riskStatus !== this.filters.status && route.status !== this.filters.status) return false;
      if (query && !String(route.personId).toLowerCase().includes(query)) return false;
      return true;
    });
    const sorters = {
      risk: (a, b) => (riskRank[a.riskStatus] ?? 9) - (riskRank[b.riskStatus] ?? 9) || String(a.personId).localeCompare(String(b.personId)),
      distance: (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      time: (a, b) => (a.estimatedTime ?? Infinity) - (b.estimatedTime ?? Infinity),
      person: (a, b) => String(a.personId).localeCompare(String(b.personId))
    };
    return [...routes].sort(sorters[this.filters.sort] || sorters.risk);
  }

  renderResourcePanel() {
    const content = this.resourcePanel?.querySelector('.emergency-resource-content');
    if (!content) return;
    const assignedCounts = new Map();
    this.routes.forEach((route) => {
      if (!route.destinationResourceId) return;
      assignedCounts.set(route.destinationResourceId, (assignedCounts.get(route.destinationResourceId) || 0) + 1);
    });
    const resources = this.inputs.emergencyResources.listResources();
    if (!resources.length) {
      content.innerHTML = '<div class="empty-state">No emergency resources available.</div>';
      return;
    }
    content.innerHTML = resources
      .map((resource) => {
        const anchor = resource.roadwayAnchor || {};
        const hazard = this.edgeHazard(anchor.edgeId);
        const affected = hazard?.passability === 'blocked';
        const selected = resource.resourceId === this.selectedResourceId ? 'selected' : '';
        const status = affected ? 'affected' : resource.status || 'available';
        return `<button class="resource-item ${selected}" data-resource="${resource.resourceId}">
          <span><strong>${resource.resourceId}</strong><em>${resource.label || resource.resourceType || ''}</em></span>
          <span class="resource-type">${resource.resourceType || 'resource'}</span>
          <span class="route-status ${affected ? 'noRoute' : status === 'available' ? 'safe' : 'risky'}">${status}</span>
          <span>${assignedCounts.get(resource.resourceId) || 0} assigned</span>
        </button>`;
      })
      .join('');
    content.querySelectorAll('.resource-item').forEach((button) => {
      button.addEventListener('click', () => {
        const resourceId = button.dataset.resource;
        this.selectedResourceId = resourceId;
        this.context.set('selectedResource', resourceId);
        this.context.set('selection', { type: 'emergencyResource', id: resourceId });
        this.updateViews();
      });
    });
  }

  renderRouteDetail() {
    const content = this.detailPanel.querySelector('.safe-route-detail');
    const route = this.routes.find((item) => item.routeId === this.selectedRouteId) || this.routes[0];
    if (!route) {
      content.innerHTML = '<div class="empty-state">No routes available.</div>';
      return;
    }
    const resource = this.inputs.emergencyResources.getResource(route.destinationResourceId);
    const reason =
      route.status === 'noRoute'
        ? route.riskStatus === 'inside_hazard'
          ? 'The person is located on a blocked roadway segment.'
          : 'No reachable emergency resource under current hazard constraints.'
        : route.riskyEdges.length
          ? 'The route remains reachable but passes through risky roadway segments.'
          : 'The route avoids blocked and risky roadway segments at the current time.';
    content.innerHTML = `
      <div class="detail-row"><span>Person</span><strong>${route.personId}</strong></div>
      <div class="detail-row"><span>Team / type</span><strong>${route.person?.team || route.person?.personType || '-'}</strong></div>
      <div class="detail-row"><span>Risk status</span><strong>${route.riskStatus.replace(/_/g, ' ')}</strong></div>
      <div class="detail-row"><span>Destination</span><strong>${resource ? `${resource.resourceId} - ${resource.resourceType}` : '-'}</strong></div>
      <div class="detail-row"><span>Route status</span><strong>${route.status}</strong></div>
      <div class="detail-row"><span>Distance</span><strong>${Number.isFinite(route.distance) ? `${formatScalar(route.distance, 2)} m` : '-'}</strong></div>
      <div class="detail-row"><span>Travel time</span><strong>${Number.isFinite(route.estimatedTime) ? `${formatScalar(route.estimatedTime, 1)} s` : '-'}</strong></div>
      <div class="detail-row"><span>Risk cost</span><strong>${Number.isFinite(route.riskCost) ? formatScalar(route.riskCost, 2) : '-'}</strong></div>
      <div class="detail-row"><span>Risky edges</span><strong>${route.riskyEdges.join(', ') || '-'}</strong></div>
      <div class="detail-row"><span>Blocked edges</span><strong>${route.blockedEdges.join(', ') || '-'}</strong></div>
      <div class="detail-row stacked"><span>Path</span><strong>${route.edgePath.join(' -> ') || '-'}</strong></div>
      <div class="muted-note">${reason}</div>`;
  }

  renderManualList() {
    const list = this.manualPanel.querySelector('.manual-constraint-list');
    list.innerHTML = [...this.manualConstraints.entries()].map(([edgeId, state]) => `<div class="detail-row"><span>${edgeId}</span><strong>${state}</strong></div>`).join('') || '<div class="muted-note">No manual constraints.</div>';
  }

  renderControls(container) {
    const resourceOptions = this.inputs.emergencyResources
      .listResources()
      .map((resource) => `<option value="${resource.resourceId}">${resource.resourceId} - ${resource.resourceType || 'resource'}</option>`)
      .join('');
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="control-grid">
        <label class="field-row">Route mode<select class="route-route-mode"><option value="nearest-safe">Nearest safe</option><option value="shortest">Shortest</option><option value="lowest-risk">Lowest risk</option></select></label>
        <label class="field-row">Destination<select class="route-destination-mode"><option value="nearest-resource">Nearest resource</option><option value="selected-resource">Selected resource</option><option value="nearest-exit">Nearest exit</option><option value="nearest-refuge">Nearest refuge</option></select></label>
        <label class="field-row">Selected resource<select class="route-resource"><option value="">Auto</option>${resourceOptions}</select></label>
        <label class="field-row">Risk weight<input class="route-risk" type="number" step="0.5" /></label>
        <label class="field-row">Travel speed (m/s)<input class="route-speed" type="number" step="0.1" /></label>
        <label class="field-row">Sketch mark<select class="route-mode"><option value="blocked">Blocked</option><option value="risky">Risky</option><option value="clear">Clear</option></select></label>
      </div>
      <div class="control-grid control-grid-checks">
        <label class="checkbox-row"><span>Avoid risky segments</span><input class="route-avoid-risky" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show all routes</span><input class="route-show-all" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show only at-risk people</span><input class="route-only-risk" type="checkbox" /></label>
        <label class="checkbox-row"><span>Quick hazard sketch</span><input class="route-manual" type="checkbox" /></label>
      </div>
      <div class="button-row compact"><button class="route-refresh">Recompute routes</button></div>`;
    const routeMode = container.querySelector('.route-route-mode');
    const destinationMode = container.querySelector('.route-destination-mode');
    const selectedResource = container.querySelector('.route-resource');
    const risk = container.querySelector('.route-risk');
    const speed = container.querySelector('.route-speed');
    const avoidRisky = container.querySelector('.route-avoid-risky');
    const showAll = container.querySelector('.route-show-all');
    const showOnlyRisk = container.querySelector('.route-only-risk');
    const manual = container.querySelector('.route-manual');
    const mode = container.querySelector('.route-mode');
    routeMode.value = this.params.routeMode;
    destinationMode.value = this.params.destinationMode;
    selectedResource.value = this.selectedResourceId || '';
    risk.value = this.params.riskPenalty;
    speed.value = this.params.walkingSpeed;
    avoidRisky.checked = this.params.avoidRiskySegments;
    showAll.checked = this.params.showAllRoutes;
    showOnlyRisk.checked = this.params.showOnlyAtRiskPeople;
    manual.checked = this.params.manualMode;
    mode.value = this.params.manualMarkMode;
    const update = () => {
      this.params.routeMode = routeMode.value;
      this.params.destinationMode = destinationMode.value;
      this.selectedResourceId = selectedResource.value || null;
      this.params.selectedResourceId = this.selectedResourceId;
      this.params.riskPenalty = Number(risk.value);
      this.params.walkingSpeed = Number(speed.value);
      this.params.avoidRiskySegments = avoidRisky.checked;
      this.params.showAllRoutes = showAll.checked;
      if (this.params.showAllRoutes) this.focusSelectedRoute = false;
      this.params.showOnlyAtRiskPeople = showOnlyRisk.checked;
      this.params.manualMode = manual.checked;
      this.params.manualMarkMode = mode.value;
      this.manualPanel.querySelector('.manual-enable').checked = this.params.manualMode;
      this.manualPanel.querySelector('.manual-mode').value = this.params.manualMarkMode;
      this.recomputeRoutes();
    };
    [routeMode, destinationMode, selectedResource, risk, speed, avoidRisky, showAll, showOnlyRisk, manual, mode].forEach((element) =>
      element.addEventListener('change', update)
    );
    container.querySelector('.route-refresh').addEventListener('click', () => this.recomputeRoutes());
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearSafeRouteOverlay?.();
    this.summaryPanel?.remove();
    this.mapPanel?.remove();
    this.listPanel?.remove();
    this.resourcePanel?.remove();
    this.detailPanel?.remove();
    this.manualPanel?.remove();
    this.legendPanel?.remove();
  }
}

class RoadwayScalarStateAnalysisRuntime {
  constructor(nodeModel, inputs) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.preset = presetForNode(nodeModel);
    this.label = nodeModel.label || this.preset.label || 'Roadway Scalar State Analysis';
    this.metric = {
      variable: nodeModel.params?.variable ?? this.preset.variable,
      unit: nodeModel.params?.unit ?? this.preset.unit,
      legendLabel: nodeModel.params?.legendLabel ?? this.preset.legendLabel
    };
    this.params = {
      minValue: Number(nodeModel.params?.minValue ?? nodeModel.params?.minTemperature ?? this.preset.range.min),
      maxValue: Number(nodeModel.params?.maxValue ?? nodeModel.params?.maxTemperature ?? this.preset.range.max),
      colormap: nodeModel.params?.colormap ?? this.preset.colormap ?? 'rainbow',
      toleranceMinutes: Number(nodeModel.params?.toleranceMinutes ?? 60),
      showSensors: nodeModel.params?.showSensors !== false,
      chartMode: nodeModel.params?.chartMode ?? 'overlay',
      warningThreshold:
        nodeModel.params?.warningThreshold != null ? Number(nodeModel.params.warningThreshold) : this.preset.warningThreshold
    };
    this.disposers = [];
    this.chartManager = null;
    this.chartContainer = null;
    this.controlContainer = null;
    this.legend = null;
    this.lastSeriesSensorID = null;
    this.lastSeries = [];
    this.initialized = false;
    this.inputRequirements = RoadwayScalarStateAnalysisInputRequirements;
    this.controlDisposers = [];
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();

    this.sampleSnapshot = new SampleSnapshotKernel(this.inputs.sensorReadings);
    this.heatmap = new HeatmapColorKernel(sceneManager);
    this.heatmap.setRange(this.params.minValue, this.params.maxValue);
    this.heatmap.setMap(this.params.colormap);
    setCustomColorMap(this.params.colormap, getDefaultStops(this.params.colormap));

    this.registerVisualContributions();
    await this.initializeScene();
    this.installContextHandlers();
    this.ensureInitialContext();
    this.updateFromTime();
    this.updateFromSelection(true);

    return {
      cleanup: () => this.cleanup()
    };
  }

  validateSemanticInputs() {
    const warnings = [];
    const errors = [];
    Object.entries(this.inputRequirements).forEach(([inputName, requirement]) => {
      const dataset = this.inputs[inputName];
      if (!dataset) {
        if (requirement.optional) {
          warnings.push(`Optional semantic dataset input is not connected: ${inputName}`);
          return;
        }
        errors.push(`Missing semantic dataset input: ${inputName}`);
        return;
      }
      const actualClass = dataset.contract?.class || dataset.semanticClass;
      const acceptedClasses = requirement.acceptedClasses || [requirement.class];
      if (!acceptedClasses.includes(actualClass)) {
        errors.push(`Input ${inputName} expects ${acceptedClasses.join(' or ')}, got ${actualClass}.`);
      }
      const templateTypes = new Set(Object.values(dataset.templates || {}).map((template) => template.type));
      requirement.requiredTemplates.forEach((type) => {
        if (!templateTypes.has(type)) errors.push(`Input ${inputName} is missing ${type} template.`);
      });
      if (dataset.validation?.errors?.length) {
        errors.push(`Input ${inputName} has validation errors: ${dataset.validation.errors.join('; ')}`);
      }
      if (dataset.validation?.warnings?.length) {
        warnings.push(`Input ${inputName} warnings: ${dataset.validation.warnings.join('; ')}`);
      }
    });

    const registryIDs = new Set(this.inputs.sensorRegistry?.listSensorIDs?.() || []);
    const readingIDs = this.inputs.sensorReadings?.listSensorIDs?.() || [];
    const missingReadingSensors = readingIDs.filter((sensorID) => !registryIDs.has(sensorID));
    if (missingReadingSensors.length) {
      warnings.push(`${missingReadingSensors.length} reading series do not match SensorRegistry identities.`);
    }

    const roadwayEdgeIDs = new Set(this.inputs.roadway?.edges?.map((edge) => edge.id) || []);
    const roadwayNodeIDs = new Set(this.inputs.roadway?.nodes?.map((node) => node.id) || []);
    const missingAnchors =
      this.inputs.sensorRegistry
        ?.listSensors?.()
        .filter((sensor) => sensor.edgeId && !roadwayEdgeIDs.has(sensor.edgeId) && !roadwayNodeIDs.has(sensor.edgeId)) || [];
    if (missingAnchors.length) {
      warnings.push(`${missingAnchors.length} sensor roadway anchors do not match Roadway graph ids.`);
    }

    const readingVariable = this.inputs.sensorReadings?.variable;
    if (
      this.metric.variable &&
      readingVariable &&
      String(readingVariable).toLowerCase() !== String(this.metric.variable).toLowerCase()
    ) {
      warnings.push(`Operator variable ${this.metric.variable} is using readings variable ${readingVariable}.`);
    }

    if (warnings.length) console.warn('[MineVis semantic input warnings]', warnings);
    if (errors.length) {
      console.warn('[MineVis semantic input errors]', errors);
      throw new Error(errors.join('\n'));
    }
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 1,
      keepWithPinnedOwner: true,
      show: () => this.sceneManager.setRoadwayVisible(true),
      hide: () => this.sceneManager.setRoadwayVisible(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisible(false)
    });

    this.contributionRegistry.register({
      id: `${this.id}:roadway-scalar-overlay`,
      label: `Roadway ${this.metric.legendLabel} Overlay`,
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 1,
      show: () => {
        if (this.initialized) this.updateFromTime();
      },
      hide: () => {
        if (this.initialized) resetHeatmapColors(this.sceneManager.scene);
      },
      setOpacity: (value) => this.sceneManager.setHeatmapOpacity(value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => {
        if (this.initialized) resetHeatmapColors(this.sceneManager.scene);
      }
    });

    this.contributionRegistry.register({
      id: `${this.id}:sensor-markers`,
      label: 'Sensor Markers',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: this.params.showSensors,
      opacity: 1,
      collection: true,
      show: () => this.sceneManager.setSensorsVisible(true),
      hide: () => this.sceneManager.setSensorsVisible(false),
      setOpacity: (value) => this.sceneManager.setSensorOpacity(value),
      cleanup: () => this.sceneManager.setSensorsVisible(false)
    });

    this.inputs.sensorRegistry.listSensors().forEach((sensor) => {
      this.contributionRegistry.register({
        id: `${this.id}:sensor-marker:${sensor.sensorID}`,
        parentId: `${this.id}:sensor-markers`,
        label: `Sensor ${sensor.sensorID}`,
        ownerId: this.id,
        functionId: this.functionId,
        type: 'scene-layer',
        visible: this.params.showSensors,
        opacity: 1,
        show: () => this.sceneManager.setSensorVisible(sensor.sensorID, true),
        hide: () => this.sceneManager.setSensorVisible(sensor.sensorID, false),
        setOpacity: (value) => this.sceneManager.setSingleSensorOpacity(sensor.sensorID, value),
        activate: () => this.context.set('selection', { type: 'sensor', id: sensor.sensorID }),
        focus: () => {
          this.context.set('selection', { type: 'sensor', id: sensor.sensorID });
          this.sceneManager.focusOnSensor(sensor.sensorID);
        },
        cleanup: () => this.sceneManager.setSensorVisible(sensor.sensorID, false)
      });
    });

    this.contributionRegistry.register({
      id: `${this.id}:sensor-trend-chart`,
      label: 'Sensor Trend Chart',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'chart',
      visible: true,
      opacity: 1,
      show: () => this.chartManager?.setVisible(true),
      hide: () => this.chartManager?.setVisible(false),
      cleanup: () => this.chartManager?.setVisible(false)
    });

    this.contributionRegistry.register({
      id: `${this.id}:scalar-controls`,
      label: `${this.metric.legendLabel} Legend / Controls`,
      ownerId: this.id,
      functionId: this.functionId,
      type: 'control',
      visible: true,
      opacity: 1,
      show: () => {
        if (this.controlContainer) this.controlContainer.style.display = 'block';
      },
      hide: () => {
        if (this.controlContainer) this.controlContainer.style.display = 'none';
      },
      cleanup: () => {
        if (this.controlContainer) this.controlContainer.style.display = 'none';
      }
    });
  }

  async initializeScene() {
    if (this.initialized) return;
    const roadway = this.inputs.roadway;
    if (roadway?.objText) {
      await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping(), roadway);
    } else if (roadway?.modelPath) {
      await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping(), roadway);
    } else {
      this.sceneManager.buildRoadway(roadway);
    }
    this.sceneManager.setRoadwayOpacity(1);
    this.sceneManager.addSensors(this.inputs.sensorRegistry.listSensors());
    this.sceneManager.setSensorsVisible(this.params.showSensors);
    const previousPick = this.sceneManager.onSensorPick;
    this.sceneManager.onSensorPick = (sensorID) => {
      this.context.set('selection', { type: 'sensor', id: sensorID });
    };
    this.disposers.push(() => {
      this.sceneManager.onSensorPick = previousPick;
    });
    this.initialized = true;
  }

  installContextHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateFromTime()));
    this.disposers.push(this.context.subscribe('selection', () => this.updateFromSelection()));
  }

  ensureInitialContext() {
    const timeRange = this.inputs.sensorReadings.getTimeRange();
    if (this.context.get('time') == null) {
      this.context.set('time', timeRange.min);
    }
    if (!getSelectionSensorID(this.context.get('selection'))) {
      const firstSensor = this.inputs.sensorRegistry.listSensors()[0];
      if (firstSensor) this.context.set('selection', { type: 'sensor', id: firstSensor.sensorID });
    }
  }

  updateFromTime() {
    if (!this.sceneManager || !this.inputs?.sensorReadings) return;
    this.heatmap.setRange(this.params.minValue, this.params.maxValue);
    this.heatmap.setMap(this.params.colormap);
    const time = this.context.get('time');
    const overlay = this.contributionRegistry?.get(`${this.id}:roadway-scalar-overlay`);
    if (overlay?.visible !== false) {
      const toleranceMs = this.params.toleranceMinutes * 60 * 1000;
      const snapshot = this.sampleSnapshot.run(time, toleranceMs);
      const heatmapInput = buildHeatmapInput(
        this.inputs.roadway,
        this.inputs.sensorRegistry.listSensors(),
        snapshot
      );
      const { nodeVals } = diffuseNodeValues(
        heatmapInput.nodes,
        heatmapInput.connections,
        heatmapInput.sensors,
        this.params.minValue,
        10
      );
      this.heatmap.apply(heatmapInput.connections, nodeVals, heatmapInput.sensors);
    } else {
      resetHeatmapColors(this.sceneManager.scene);
    }
    this.legend?.update(this.params.colormap, this.params.minValue, this.params.maxValue, this.metric.unit);
    this.chartManager?.setCurrentTime(time);
  }

  updateFromSelection(focus = false) {
    const sensorID = getSelectionSensorID(this.context.get('selection'));
    if (!sensorID) return;
    const sensorObject = this.sceneManager.getSensorObject(sensorID);
    if (sensorObject) {
      this.sceneManager.highlightSensor(sensorObject);
      if (focus) this.sceneManager.focusOn(sensorObject);
    }
    this.lastSeriesSensorID = sensorID;
    this.lastSeries = this.inputs.sensorReadings.getSeries(sensorID);
    if (this.chartManager) {
      this.chartManager.updateSeries(sensorID, this.lastSeries, this.context.get('time'));
    }
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlContainer = container;
    const unitLabel = this.metric.unit ? ` (${this.metric.unit})` : '';
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <label class="field-row">
        <span>Time</span>
        <input class="operator-time" type="range" min="0" max="0" value="0" />
      </label>
      <div class="time-label"></div>
      <div class="control-grid">
        <label>Min${unitLabel} <input class="operator-min" type="number" step="0.1" /></label>
        <label>Max${unitLabel} <input class="operator-max" type="number" step="0.1" /></label>
        <label>Color map
          <select class="operator-colormap">
            <option value="rainbow">Rainbow</option>
            <option value="viridis">Viridis</option>
            <option value="heat">Heat</option>
          </select>
        </label>
        <label class="checkbox-row"><span>Show sensors</span><input class="operator-show-sensors" type="checkbox" /></label>
      </div>
      <div class="legend-block">
        <div class="bar"></div>
        <div class="legend-labels"><span class="min"></span><span class="max"></span></div>
      </div>
      <div class="chart-panel"></div>
    `;

    const timeRange = this.inputs.sensorReadings.getTimeRange();
    const timeScale = buildContinuousTimeScale(timeRange.times);
    const timeInput = container.querySelector('.operator-time');
    const timeLabel = container.querySelector('.time-label');
    const minInput = container.querySelector('.operator-min');
    const maxInput = container.querySelector('.operator-max');
    const mapSelect = container.querySelector('.operator-colormap');
    const sensorToggle = container.querySelector('.operator-show-sensors');
    this.chartContainer = container.querySelector('.chart-panel');
    this.legend = new ColorLegend(container.querySelector('.legend-block'));
    this.chartManager?.dispose?.();
    this.chartManager = new ChartManager(this.chartContainer, this.sceneManager);
    this.chartManager.setMetric({ label: this.metric.legendLabel, unit: this.metric.unit });
    this.chartManager.setMode(this.params.chartMode);
    this.chartManager.setTimeChangeHandler((time) => {
      const nextTime = Math.max(timeScale.min, Math.min(timeScale.max, Number(time)));
      this.context.set('time', Number.isFinite(nextTime) ? nextTime : timeScale.min);
    });

    minInput.value = this.params.minValue;
    maxInput.value = this.params.maxValue;
    mapSelect.value = this.params.colormap;
    sensorToggle.checked = this.params.showSensors;
    timeInput.min = '0';
    timeInput.max = String(timeScale.steps);
    timeInput.step = '1';
    timeInput.disabled = timeScale.steps === 0;
    const syncTimeControl = (timeValue) => {
      const numericTime = Number(timeValue);
      const currentIndex = timeScale.indexFor(numericTime);
      timeInput.value = String(currentIndex);
      const suffix = timeScale.isSampleTime(numericTime) ? 'sample' : 'interpolated';
      timeLabel.textContent = `${formatTime(numericTime)} - ${suffix}`;
    };
    syncTimeControl(this.context.get('time'));
    this.controlDisposers.push(this.context.subscribe('time', syncTimeControl));

    timeInput.addEventListener('input', () => {
      const time = timeScale.timeAt(Number(timeInput.value));
      const suffix = timeScale.isSampleTime(time) ? 'sample' : 'interpolated';
      timeLabel.textContent = `${formatTime(time)} - ${suffix}`;
      this.context.set('time', time);
    });
    minInput.addEventListener('change', () => {
      this.params.minValue = Number(minInput.value);
      this.updateFromTime();
    });
    maxInput.addEventListener('change', () => {
      this.params.maxValue = Number(maxInput.value);
      this.updateFromTime();
    });
    mapSelect.addEventListener('change', () => {
      this.params.colormap = mapSelect.value;
      setCustomColorMap(this.params.colormap, getDefaultStops(this.params.colormap));
      this.updateFromTime();
    });
    sensorToggle.addEventListener('change', () => {
      this.params.showSensors = sensorToggle.checked;
      this.sceneManager.setSensorsVisible(this.params.showSensors);
    });

    this.legend.update(this.params.colormap, this.params.minValue, this.params.maxValue, this.metric.unit);
    if (this.lastSeriesSensorID) {
      this.chartManager.updateSeries(this.lastSeriesSensorID, this.lastSeries, this.context.get('time'));
    } else {
      this.updateFromSelection();
    }
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
  }
}

class VentilationNetworkOverviewRuntime {
  constructor(nodeModel, inputs) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.label = nodeModel.label || 'Ventilation Network Overview';
    this.params = {
      showFacilities: nodeModel.params?.showFacilities !== false,
      showDirection: nodeModel.params?.showDirection !== false,
      showIntakeReturn: nodeModel.params?.showIntakeReturn !== false,
      branchColorMode: nodeModel.params?.branchColorMode || 'type',
      branchColormap: nodeModel.params?.branchColormap || 'viridis',
      branchValueMin: Number(nodeModel.params?.branchValueMin ?? 0),
      branchValueMax: Number(nodeModel.params?.branchValueMax ?? 1),
      autoFocusOnSelection: nodeModel.params?.autoFocusOnSelection !== false
    };
    this.inputRequirements = VentilationNetworkOverviewInputRequirements;
    this.disposers = [];
    this.controlDisposers = [];
    this.renderBranches = [];
    this.nodeById = new Map();
    this.selectedBranchId = null;
    this.selectedFacilityId = null;
    this.drawingView = { zoom: 1, panX: 0, panY: 0 };
    this.graphView = { zoom: 1, panX: 0, panY: 0 };
    this.topologyBranchSegments = [];
    this.graphBranchSegments = [];
    this.graphBranchHits = [];
    this.graphNodeHits = [];
    this.topologyFacilityHits = [];
    this.graphFacilityHits = [];
    this.graphLayout = null;
    this.ventilationTopologyLayout = null;
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.prepareVentilationGeometry();
    this.createPanels();
    this.registerVisualContributions();
    this.sceneManager.setRoadwayOpacity(0.5);
    this.installSceneHandlers();
    this.installContextHandlers();
    this.refreshOverlay();
    this.drawTopology();
    this.updateDetailPanel();
    this.ensureInitialSelection();
    return { cleanup: () => this.cleanup() };
  }

  validateSemanticInputs() {
    const warnings = [];
    const errors = [];
    Object.entries(this.inputRequirements).forEach(([inputName, requirement]) => {
      const dataset = this.inputs[inputName];
      if (!dataset) {
        errors.push(`Missing semantic dataset input: ${inputName}`);
        return;
      }
      const actualClass = dataset.contract?.class || dataset.semanticClass;
      const acceptedClasses = requirement.acceptedClasses || [requirement.class];
      if (!acceptedClasses.includes(actualClass)) {
        errors.push(`Input ${inputName} expects ${acceptedClasses.join(' or ')}, got ${actualClass}.`);
      }
      const templateTypes = new Set(Object.values(dataset.templates || {}).map((template) => template.type));
      requirement.requiredTemplates.forEach((type) => {
        if (!templateTypes.has(type)) errors.push(`Input ${inputName} is missing ${type} template.`);
      });
      if (dataset.validation?.errors?.length) {
        errors.push(`Input ${inputName} has validation errors: ${dataset.validation.errors.join('; ')}`);
      }
      if (dataset.validation?.warnings?.length) {
        warnings.push(`Input ${inputName} warnings: ${dataset.validation.warnings.join('; ')}`);
      }
    });
    if (this.inputs.roadway?.getEdges) {
      const roadwayEdgeIds = new Set(this.inputs.roadway.getEdges().map((edge) => String(edge.id)));
      const unmatchedBranches =
        this.inputs.ventilationNetwork
          ?.listBranches?.()
          .filter((branch) => branch.roadwayEdgeIds?.length && !branch.roadwayEdgeIds.some((edgeId) => roadwayEdgeIds.has(String(edgeId)))) || [];
      if (unmatchedBranches.length) warnings.push(`${unmatchedBranches.length} ventilation branches reference unknown roadway edges.`);
    }
    if (warnings.length) console.warn('[MineVis ventilation semantic input warnings]', warnings);
    if (errors.length) {
      console.warn('[MineVis ventilation semantic input errors]', errors);
      throw new Error(errors.join('\n'));
    }
  }

  async initializeRoadway() {
    const roadway = this.inputs.roadway;
    if (roadway?.objText) {
      await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping(), roadway);
    } else if (roadway?.modelPath) {
      await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping(), roadway);
    } else {
      this.sceneManager.buildRoadway(roadway);
    }
    this.sceneManager.setRoadwayVisible(true);
  }

  prepareVentilationGeometry() {
    const network = this.inputs.ventilationNetwork;
    this.nodeById = new Map(network.listNodes().map((node) => [node.id, node]));
    this.renderBranches = network.listBranches().map((branch) => {
      const path = this.resolveBranchPath(branch);
      const directedPath = branch.inferredDirection === 'to_from' ? [...path].reverse() : path;
      return { ...branch, path: directedPath, originalPath: path };
    });
    this.graphLayout = null;
    this.ventilationTopologyLayout = null;
    this.applyBranchColors();
    this.computeVentilationGraphLayout();
  }

  resolveBranchPath(branch) {
    if (branch.path?.length >= 2) return branch.path.map(pointOf);
    const points = [];
    const roadway = this.inputs.roadway;
    (branch.roadwayEdgeIds || []).forEach((edgeId) => {
      const edge = roadway?.edgeMap?.get?.(String(edgeId)) || roadway?.getEdges?.().find((item) => String(item.id) === String(edgeId));
      const edgePath = (edge?.path || edge?.verts || []).map(pointOf);
      edgePath.forEach((point, index) => {
        const previous = points[points.length - 1];
        if (index > 0 || !previous || Math.hypot(previous.x - point.x, previous.y - point.y, previous.z - point.z) > 0.001) {
          points.push(point);
        }
      });
    });
    if (points.length >= 2) return points;
    const from = this.nodeById.get(branch.from)?.position;
    const to = this.nodeById.get(branch.to)?.position;
    return [from, to].filter(Boolean).map(pointOf);
  }

  createPanels() {
    const host = document.querySelector('.runtime-shell') || document.body;
    this.topologyPanel = document.createElement('section');
    this.topologyPanel.className = 'glass-panel ventilation-panel ventilation-topology-panel ventilation-resizable-panel';
    this.topologyPanel.innerHTML = `
      <div class="panel-title">Ventilation 2D Drawing</div>
      <canvas class="ventilation-topology-canvas"></canvas>
    `;
    host.appendChild(this.topologyPanel);
    this.installPanelCollapse(this.topologyPanel);
    this.makeDraggable(this.topologyPanel);

    this.graphPanel = document.createElement('section');
    this.graphPanel.className = 'glass-panel ventilation-panel ventilation-graph-panel ventilation-resizable-panel';
    this.graphPanel.innerHTML = `
      <div class="panel-title">Ventilation Topology Graph</div>
      <canvas class="ventilation-graph-canvas"></canvas>
    `;
    host.appendChild(this.graphPanel);
    this.installPanelCollapse(this.graphPanel);
    this.makeDraggable(this.graphPanel);

    this.legendPanel = document.createElement('section');
    this.legendPanel.className = 'glass-panel ventilation-panel ventilation-legend-panel';
    this.legendPanel.innerHTML = `
      <div class="panel-title">Facility Legend</div>
      <div class="ventilation-legend-list">
        <div><span class="legend-dot intake"></span>Intake</div>
        <div><span class="legend-dot return"></span>Return</div>
        <div><span class="legend-dot fan"></span>Fan</div>
        <div><span class="legend-dot door"></span>Door</div>
        <div><span class="legend-dot regulator"></span>Regulator</div>
        <div><span class="legend-dot stopping"></span>Stopping</div>
      </div>
    `;
    host.appendChild(this.legendPanel);
    this.installPanelCollapse(this.legendPanel);
    this.makeDraggable(this.legendPanel);

    this.detailPanel = document.createElement('section');
    this.detailPanel.className = 'glass-panel ventilation-panel ventilation-detail-panel';
    this.detailPanel.innerHTML = `
      <div class="panel-title">Branch / Facility Detail</div>
      <div class="ventilation-detail-content"></div>
    `;
    host.appendChild(this.detailPanel);
    this.installPanelCollapse(this.detailPanel);
    this.makeDraggable(this.detailPanel);

    this.topologyCanvas = this.topologyPanel.querySelector('.ventilation-topology-canvas');
    this.graphCanvas = this.graphPanel.querySelector('.ventilation-graph-canvas');
    this.installCanvasNavigation(this.topologyCanvas, this.drawingView);
    this.installCanvasNavigation(this.graphCanvas, this.graphView);
    this.topologyCanvas.addEventListener('click', (event) => this.handleTopologyClick(event));
    this.graphCanvas.addEventListener('click', (event) => this.handleGraphClick(event));
  }

  installPanelCollapse(panel) {
    const title = panel.querySelector('.panel-title');
    if (!title || title.querySelector('.panel-collapse-toggle')) return;
    const label = title.textContent.trim();
    title.innerHTML = `<span>${label}</span><button class="panel-collapse-toggle" type="button" title="Collapse panel">-</button>`;
    const button = title.querySelector('.panel-collapse-toggle');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = panel.classList.toggle('panel-collapsed');
      button.textContent = collapsed ? '+' : '-';
      button.title = collapsed ? 'Expand panel' : 'Collapse panel';
      if (!collapsed) requestAnimationFrame(() => this.drawTopology());
    });
  }

  installCanvasNavigation(canvas, view) {
    let drag = null;
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      view.zoom = Math.max(0.35, Math.min(6, view.zoom * factor));
      this.drawTopology();
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (canvas === this.graphCanvas) {
        const nodeDrag = this.startGraphNodeDrag(event, canvas);
        if (nodeDrag) {
          drag = nodeDrag;
          canvas.setPointerCapture(event.pointerId);
          return;
        }
      }
      drag = {
        type: 'pan',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: view.panX,
        panY: view.panY,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.type === 'graph-node') {
        const rect = canvas.getBoundingClientRect();
        const model = this.graphCanvasToModel?.({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        const pos = this.ventilationTopologyLayout?.positions?.get(drag.nodeId);
        if (model && pos) {
          pos.x = model.x + drag.offsetX;
          pos.y = model.y + drag.offsetY;
          this.drawTopology();
        }
        return;
      }
      view.panX = drag.panX + dx;
      view.panY = drag.panY + dy;
      this.drawTopology();
    });
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      canvas.releasePointerCapture(event.pointerId);
      canvas.dataset.dragMoved = drag.moved ? 'true' : 'false';
      setTimeout(() => {
        canvas.dataset.dragMoved = 'false';
      }, 0);
      drag = null;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  startGraphNodeDrag(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const hit = this.graphNodeHits.find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= item.r);
    const model = this.graphCanvasToModel?.(point);
    const pos = hit ? this.ventilationTopologyLayout?.positions?.get(hit.nodeId) : null;
    if (!hit || !model || !pos) return null;
    event.preventDefault();
    event.stopPropagation();
    return {
      type: 'graph-node',
      nodeId: hit.nodeId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: pos.x - model.x,
      offsetY: pos.y - model.y,
      moved: false
    };
  }

  makeDraggable(panel) {
    let drag = null;
    panel.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('.panel-title');
      if (!handle || event.target.closest('.panel-collapse-toggle') || event.button !== 0) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      panel.setPointerCapture(event.pointerId);
      panel.classList.add('dragging');
    });
    panel.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, event.clientX - drag.offsetX));
      const top = Math.max(72, Math.min(window.innerHeight - panel.offsetHeight - 8, event.clientY - drag.offsetY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    const end = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      panel.releasePointerCapture(event.pointerId);
      drag = null;
      panel.classList.remove('dragging');
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:ventilation-2d-drawing`,
      label: 'Ventilation 2D Drawing',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'drawing',
      visible: true,
      show: () => {
        this.topologyPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.topologyPanel.style.display = 'none';
      },
      cleanup: () => this.topologyPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:ventilation-topology-graph`,
      label: 'Ventilation Topology Graph',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'topology-view',
      visible: true,
      show: () => {
        this.graphPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.graphPanel.style.display = 'none';
      },
      cleanup: () => this.graphPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 0.5,
      keepWithPinnedOwner: true,
      show: () => this.sceneManager.setRoadwayVisible(true),
      hide: () => this.sceneManager.setRoadwayVisible(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisible(false)
    });
    this.contributionRegistry.register({
      id: `${this.id}:ventilation-3d-overlay`,
      label: '3D Ventilation Network Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 1,
      show: () => this.sceneManager.setVentilationOverlayVisible(true),
      hide: () => this.sceneManager.setVentilationOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setVentilationOverlayOpacity(value),
      focus: () =>
        this.selectedBranchId ? this.sceneManager.focusVentilationBranch(this.selectedBranchId) : this.sceneManager.focusOnRoadway(),
      cleanup: () => {
        this.sceneManager.clearVentilationOverlay();
        this.sceneManager.highlightRoadwayEdges?.([]);
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:facility-legend`,
      label: 'Facility Legend',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'legend',
      visible: true,
      show: () => {
        this.legendPanel.style.display = 'block';
      },
      hide: () => {
        this.legendPanel.style.display = 'none';
      },
      cleanup: () => this.legendPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:branch-facility-detail`,
      label: 'Branch / Facility Detail Panel',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      visible: true,
      show: () => {
        this.detailPanel.style.display = 'block';
      },
      hide: () => {
        this.detailPanel.style.display = 'none';
      },
      cleanup: () => this.detailPanel.remove()
    });
  }

  installSceneHandlers() {
    const previousBranchPick = this.sceneManager.onVentilationBranchPick;
    const previousFacilityPick = this.sceneManager.onVentilationFacilityPick;
    this.sceneManager.onVentilationBranchPick = (branchId) => this.selectBranch(branchId, { focus: this.params.autoFocusOnSelection });
    this.sceneManager.onVentilationFacilityPick = (facilityId) => this.selectFacility(facilityId, { focus: this.params.autoFocusOnSelection });
    this.disposers.push(() => {
      this.sceneManager.onVentilationBranchPick = previousBranchPick;
      this.sceneManager.onVentilationFacilityPick = previousFacilityPick;
      this.sceneManager.clearVentilationPickingBranches?.(this.id);
    });
  }

  installContextHandlers() {
    this.disposers.push(
      this.context.subscribe('selectedBranch', (branchId) => {
        this.selectedBranchId = branchId || null;
        if (branchId) this.selectedFacilityId = null;
        this.updateSelectionViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('selectedFacility', (facilityId) => {
        this.selectedFacilityId = facilityId || null;
        if (facilityId) this.selectedBranchId = null;
        this.updateSelectionViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('selection', (selection) => {
        const branchId = getSelectionBranchID(selection);
        const facilityId = getSelectionFacilityID(selection);
        if (branchId && branchId !== this.context.get('selectedBranch')) this.context.set('selectedBranch', branchId);
        if (facilityId && facilityId !== this.context.get('selectedFacility')) this.context.set('selectedFacility', facilityId);
      })
    );
  }

  ensureInitialSelection() {
    const current = this.context.get('selectedBranch');
    if (!current) {
      const firstBranch = this.inputs.ventilationNetwork.listBranches()[0];
      if (firstBranch) this.selectBranch(firstBranch.id, { focus: false });
    }
  }

  selectBranch(branchId, { focus = false } = {}) {
    if (!branchId) return;
    this.context.set('selectedBranch', branchId);
    this.context.set('selectedFacility', null);
    this.context.set('selection', { type: 'ventilationBranch', id: branchId });
    if (focus) this.sceneManager.focusVentilationBranch(branchId);
  }

  selectFacility(facilityId, { focus = false } = {}) {
    if (!facilityId) return;
    const facility = this.inputs.ventilationNetwork.getFacility(facilityId);
    this.context.set('selectedFacility', facilityId);
    this.context.set('selectedBranch', null);
    this.context.set('selection', { type: 'ventilationFacility', id: facilityId, branchId: facility?.branchId });
    if (focus) this.sceneManager.focusVentilationFacility(facilityId);
  }

  clearSelection() {
    this.context.set('selectedBranch', null);
    this.context.set('selectedFacility', null);
    this.context.set('selection', null);
  }

  updateSelectionViews() {
    this.sceneManager.highlightVentilationBranch(this.selectedBranchId);
    this.sceneManager.highlightVentilationFacility(this.selectedFacilityId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
    this.drawTopology();
    this.updateDetailPanel();
  }

  refreshOverlay() {
    this.applyBranchColors();
    this.sceneManager.setVentilationPickingBranches?.(this.id, this.renderBranches);
    this.sceneManager.addVentilationBranches(this.renderBranches, {
      facilities: this.inputs.ventilationNetwork.listFacilities(),
      boundaryConditions: this.inputs.ventilationNetwork.getBoundaryConditions(),
      nodeById: this.nodeById,
      showFacilities: this.params.showFacilities,
      showDirection: this.params.showDirection,
      showIntakeReturn: this.params.showIntakeReturn,
      branchColorMode: this.params.branchColorMode
    });
    const overlay = this.contributionRegistry?.get(`${this.id}:ventilation-3d-overlay`);
    if (overlay?.visible === false) this.sceneManager.setVentilationOverlayVisible(false);
    this.sceneManager.highlightVentilationBranch(this.selectedBranchId);
    this.sceneManager.highlightVentilationFacility(this.selectedFacilityId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
  }

  getSelectedRoadwayEdgeIds() {
    const normalize = (value) => {
      if (!value) return [];
      if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
      return [String(value)];
    };
    if (this.selectedBranchId) {
      const branch = this.inputs.ventilationNetwork.getBranch(this.selectedBranchId);
      return normalize(branch?.roadwayEdgeIds || branch?.roadwayEdgeId || branch?.roadwayEdgeID);
    }
    if (this.selectedFacilityId) {
      const facility = this.inputs.ventilationNetwork.getFacility(this.selectedFacilityId);
      const branch = facility?.branchId ? this.inputs.ventilationNetwork.getBranch(facility.branchId) : null;
      return normalize(facility?.roadwayEdgeIds || facility?.roadwayEdgeId || branch?.roadwayEdgeIds || branch?.roadwayEdgeId);
    }
    return [];
  }

  branchMetricValue(branch) {
    switch (this.params.branchColorMode) {
      case 'designAirQuantity':
        return Number(branch.designAirQuantity);
      case 'resistance':
        return Number(branch.resistance);
      case 'area':
        return Number(branch.area);
      case 'pressureDrop': {
        const from = this.nodeById.get(branch.from)?.pressurePotential;
        const to = this.nodeById.get(branch.to)?.pressurePotential;
        return Math.abs(Number(from) - Number(to));
      }
      default:
        return null;
    }
  }

  branchMetricLabel() {
    const labels = {
      type: 'Branch type',
      designAirQuantity: 'Design air quantity',
      resistance: 'Resistance',
      area: 'Area',
      pressureDrop: 'Pressure potential drop'
    };
    return labels[this.params.branchColorMode] || 'Branch color';
  }

  autoBranchRange() {
    const values = this.renderBranches.map((branch) => this.branchMetricValue(branch)).filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 1 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? { min: min - 1, max: max + 1 } : { min, max };
  }

  applyBranchColors({ autoRange = false } = {}) {
    if (this.params.branchColorMode === 'type' || this.params.branchColorMode === 'uniform') {
      this.renderBranches = this.renderBranches.map((branch) => ({ ...branch, renderColor: null }));
      return;
    }
    if (autoRange || !Number.isFinite(this.params.branchValueMin) || !Number.isFinite(this.params.branchValueMax)) {
      const range = this.autoBranchRange();
      this.params.branchValueMin = range.min;
      this.params.branchValueMax = range.max;
    }
    const min = this.params.branchValueMin;
    const max = this.params.branchValueMax;
    this.renderBranches = this.renderBranches.map((branch) => {
      const value = this.branchMetricValue(branch);
      const t = Number.isFinite(value) ? (value - min) / (max - min || 1) : 0;
      return {
        ...branch,
        renderColor: sampleColor(this.params.branchColormap, t)
      };
    });
  }

  branchColor(branch) {
    if (branch.renderColor) return branch.renderColor;
    if (this.params.branchColorMode === 'uniform') return '#76d7c4';
    const type = String(branch.branchType || '').toLowerCase();
    if (type.includes('intake')) return '#42a5ff';
    if (type.includes('return')) return '#ff6b6b';
    if (type.includes('working')) return '#ffc857';
    if (type.includes('bypass')) return '#8bd3a7';
    return '#76d7c4';
  }

  drawTopology() {
    this.drawDrawingCanvas();
    this.drawGraphCanvas();
    this.updateBranchColorLegend();
  }

  setupCanvas(canvas) {
    const width = canvas.clientWidth || 460;
    const height = canvas.clientHeight || 300;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(0, 0, width, height);
    return { ctx, width, height };
  }

  makeProjector(allPoints, width, height, view) {
    const bounds = allPoints.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        maxX: Math.max(acc.maxX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxY: Math.max(acc.maxY, point.y)
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    const padding = 26;
    const sx = (width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX);
    const sy = (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY);
    const baseScale = Math.min(sx, sy);
    const contentWidth = (bounds.maxX - bounds.minX) * baseScale * view.zoom;
    const contentHeight = (bounds.maxY - bounds.minY) * baseScale * view.zoom;
    const offsetX = (width - contentWidth) / 2 + view.panX;
    const offsetY = (height + contentHeight) / 2 + view.panY;
    const project = (point) => ({
      x: offsetX + (point.x - bounds.minX) * baseScale * view.zoom,
      y: offsetY - (point.y - bounds.minY) * baseScale * view.zoom
    });
    project.scale = baseScale * view.zoom;
    return project;
  }

  canvasGlyphScale(view, width, height) {
    const panelScale = Math.min(width, height) / 320;
    return Math.max(0.16, Math.min(2.4, view.zoom * panelScale));
  }

  semanticZoom(view, width, height) {
    const raw = view.zoom * (Math.min(width, height) / 320);
    return {
      raw,
      glyphScale: Math.max(0.16, Math.min(2.4, raw)),
      showBoundaryLabels: raw > 0.3,
      showArrows: raw > 0.28,
      showFacilityGlyphs: raw > 0.22,
      showSelectedLabelsOnly: raw < 0.58,
      showOnlyImportantLabels: raw < 1.05,
      showAllLabels: raw > 1.55
    };
  }

  drawDrawingCanvas() {
    if (!this.topologyCanvas || this.topologyPanel.style.display === 'none') return;
    const { ctx, width, height } = this.setupCanvas(this.topologyCanvas);
    const allPoints = [
      ...this.renderBranches.flatMap((branch) => branch.path || []),
      ...this.inputs.ventilationNetwork.listNodes().map((node) => node.position).filter(Boolean)
    ].map(pointOf);
    if (!allPoints.length) return;
    const toCanvas = this.makeProjector(allPoints, width, height, this.drawingView);
    const semantic = this.semanticZoom(this.drawingView, width, height);
    const glyphScale = semantic.glyphScale;

    this.topologyBranchSegments = [];
    this.topologyFacilityHits = [];
    this.renderBranches.forEach((branch) => {
      const points = (branch.path || []).map((point) => toCanvas(pointOf(point)));
      if (points.length < 2) return;
      const selected = String(branch.id) === String(this.selectedBranchId);
      ctx.strokeStyle = selected ? '#ffffff' : this.branchColor(branch);
      ctx.lineWidth = this.branchStrokeWidth?.(branch, selected, glyphScale) ?? Math.max(0.45, (selected ? 2.6 : 1.2) * glyphScale);
      ctx.beginPath();
      points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.stroke();
      for (let i = 0; i < points.length - 1; i += 1) {
        this.topologyBranchSegments.push({ branchId: branch.id, a: points[i], b: points[i + 1] });
      }
      if (this.params.showDirection) {
        this.drawPolylineArrow(ctx, points, selected ? '#ffffff' : this.branchColor(branch), glyphScale * 0.55);
      }
    });

    const boundaryNodes = new Map();
    (this.inputs.ventilationNetwork.getBoundaryConditions().intakes || []).forEach((entry) => boundaryNodes.set(entry.nodeId, 'intake'));
    (this.inputs.ventilationNetwork.getBoundaryConditions().returns || []).forEach((entry) => boundaryNodes.set(entry.nodeId, 'return'));
    this.inputs.ventilationNetwork.listNodes().forEach((node) => {
      const point = toCanvas(pointOf(node.position));
      const kind = boundaryNodes.get(node.id) || node.type;
      ctx.fillStyle = kind === 'intake' ? '#42a5ff' : kind === 'return' ? '#ff6b6b' : '#9aa6b8';
      ctx.beginPath();
      ctx.arc(point.x, point.y, (kind === 'intake' || kind === 'return' ? 3.5 : 2) * glyphScale, 0, Math.PI * 2);
      ctx.fill();
    });

    if (this.params.showFacilities) {
      this.inputs.ventilationNetwork.listFacilities().forEach((facility) => {
        const branch = this.renderBranches.find((item) => item.id === facility.branchId);
        if (!branch?.path?.length) return;
        const position = this.interpolatePath2D(branch.path.map(pointOf), facility.ratio ?? 0.5);
        const point = toCanvas(position);
        const selected = String(facility.id) === String(this.selectedFacilityId);
        const size = Math.max(2, 4 * glyphScale);
        ctx.fillStyle = selected ? '#ffffff' : this.facilityColor(facility.type);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = Math.max(0.5, glyphScale);
        ctx.beginPath();
        ctx.rect(point.x - size, point.y - size, size * 2, size * 2);
        ctx.fill();
        ctx.stroke();
        this.topologyFacilityHits.push({ facilityId: facility.id, point });
      });
    }
  }

  branchPathLength(branch) {
    if (Number.isFinite(Number(branch.length))) return Number(branch.length);
    const path = branch.path || branch.originalPath || [];
    let length = 0;
    for (let i = 0; i < path.length - 1; i += 1) {
      length += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y, path[i + 1].z - path[i].z);
    }
    return length || 1;
  }

  shortestNodeDistances(sources, adjacency) {
    const distances = new Map();
    const unvisited = new Set(this.nodeById.keys());
    sources.forEach((id) => {
      if (unvisited.has(id)) distances.set(id, 0);
    });
    while (unvisited.size) {
      let current = null;
      let currentDistance = Infinity;
      unvisited.forEach((id) => {
        const distance = distances.get(id);
        if (distance !== undefined && distance < currentDistance) {
          current = id;
          currentDistance = distance;
        }
      });
      if (!current) break;
      unvisited.delete(current);
      (adjacency.get(current) || []).forEach((edge) => {
        if (!unvisited.has(edge.to)) return;
        const nextDistance = currentDistance + edge.weight;
        if (nextDistance < (distances.get(edge.to) ?? Infinity)) distances.set(edge.to, nextDistance);
      });
    }
    return distances;
  }

  computeVentilationGraphLayout() {
    const branches = this.renderBranches || [];
    const network = this.inputs.ventilationNetwork;
    if (!branches.length || !network) {
      this.graphLayout = { positions: new Map(), edges: [], flowEndpoints: new Map(), layers: new Map() };
      return this.graphLayout;
    }

    const boundary = network.getBoundaryConditions?.() || {};
    const intakeSet = new Set((boundary.intakes || []).map((entry) => String(entry.nodeId)));
    const returnSet = new Set((boundary.returns || []).map((entry) => String(entry.nodeId)));
    const adjacency = new Map();
    this.nodeById.forEach((_, id) => adjacency.set(String(id), []));
    branches.forEach((branch) => {
      const from = String(branch.from);
      const to = String(branch.to);
      const weight = Math.max(1, this.branchPathLength(branch));
      adjacency.get(from)?.push({ to, weight, branchId: String(branch.id) });
      adjacency.get(to)?.push({ to: from, weight, branchId: String(branch.id) });
    });

    const fallbackSource = branches[0]?.from ? [String(branches[0].from)] : [];
    const sourceNodes = intakeSet.size ? [...intakeSet] : fallbackSource;
    const sinkNodes = returnSet.size ? [...returnSet] : [String(branches[branches.length - 1]?.to || branches[0]?.to || '')].filter(Boolean);
    const distFromIntake = this.shortestNodeDistances(sourceNodes, adjacency);
    const distFromReturn = this.shortestNodeDistances(sinkNodes, adjacency);
    const nodePotential = new Map();
    this.nodeById.forEach((_, id) => {
      const key = String(id);
      const a = distFromIntake.get(key);
      const b = distFromReturn.get(key);
      let potential = 0.5;
      if (Number.isFinite(a) && Number.isFinite(b)) potential = a / (a + b || 1);
      else if (Number.isFinite(a)) potential = Math.min(1, a / Math.max(1, Math.max(...[...distFromIntake.values()])));
      else if (Number.isFinite(b)) potential = Math.max(0, 1 - b / Math.max(1, Math.max(...[...distFromReturn.values()])));
      if (intakeSet.has(key)) potential = 0;
      if (returnSet.has(key)) potential = 1;
      nodePotential.set(key, potential);
    });

    const flowEndpoints = new Map();
    branches.forEach((branch) => {
      const from = String(branch.from);
      const to = String(branch.to);
      const fromPotential = nodePotential.get(from) ?? 0.5;
      const toPotential = nodePotential.get(to) ?? 0.5;
      const diff = toPotential - fromPotential;
      const inferredToFrom = String(branch.inferredDirection || branch.nominalDirection || '').toLowerCase() === 'to_from';
      const flowFrom = Math.abs(diff) > 0.015 ? (diff >= 0 ? from : to) : inferredToFrom ? to : from;
      const flowTo = flowFrom === from ? to : from;
      flowEndpoints.set(String(branch.id), { from: flowFrom, to: flowTo, potential: (fromPotential + toPotential) / 2 });
    });

    const directedEdges = [];
    const addDirectedEdge = (from, to, viaNode) => {
      if (!from || !to || from === to) return;
      const key = `${from}->${to}`;
      if (directedEdges.some((edge) => edge.key === key)) return;
      directedEdges.push({ key, from, to, viaNode });
    };
    this.nodeById.forEach((_, nodeIdRaw) => {
      const nodeId = String(nodeIdRaw);
      const incoming = [];
      const outgoing = [];
      branches.forEach((branch) => {
        const id = String(branch.id);
        const endpoints = flowEndpoints.get(id);
        if (endpoints?.to === nodeId) incoming.push(id);
        if (endpoints?.from === nodeId) outgoing.push(id);
      });
      incoming.forEach((source) => outgoing.forEach((target) => addDirectedEdge(source, target, nodeId)));
    });
    this.nodeById.forEach((_, nodeIdRaw) => {
      const nodeId = String(nodeIdRaw);
      const touching = branches.filter((branch) => String(branch.from) === nodeId || String(branch.to) === nodeId);
      touching.sort((a, b) => (flowEndpoints.get(String(a.id))?.potential ?? 0.5) - (flowEndpoints.get(String(b.id))?.potential ?? 0.5));
      for (let i = 0; i < touching.length - 1; i += 1) addDirectedEdge(String(touching[i].id), String(touching[i + 1].id), nodeId);
    });

    const predecessors = new Map(branches.map((branch) => [String(branch.id), []]));
    const successors = new Map(branches.map((branch) => [String(branch.id), []]));
    directedEdges.forEach((edge) => {
      successors.get(edge.from)?.push(edge.to);
      predecessors.get(edge.to)?.push(edge.from);
    });
    const sourceBranchIds = branches
      .filter((branch) => intakeSet.has(flowEndpoints.get(String(branch.id))?.from) || !(predecessors.get(String(branch.id)) || []).length)
      .map((branch) => String(branch.id));
    const layerByBranch = new Map();
    const queue = [...sourceBranchIds];
    queue.forEach((id) => layerByBranch.set(id, 0));
    while (queue.length) {
      const id = queue.shift();
      const currentLayer = layerByBranch.get(id) || 0;
      (successors.get(id) || []).forEach((next) => {
        const nextLayer = Math.max(layerByBranch.get(next) ?? 0, currentLayer + 1);
        if (nextLayer !== layerByBranch.get(next)) {
          layerByBranch.set(next, nextLayer);
          queue.push(next);
        }
      });
    }
    const maxPotentialLayer = Math.max(2, Math.ceil(Math.sqrt(branches.length)) + 2);
    branches.forEach((branch) => {
      const id = String(branch.id);
      if (!layerByBranch.has(id)) {
        layerByBranch.set(id, Math.round((flowEndpoints.get(id)?.potential ?? 0.5) * maxPotentialLayer));
      }
    });
    const sortedLayerValues = [...new Set(layerByBranch.values())].sort((a, b) => a - b);
    const compactLayer = new Map(sortedLayerValues.map((layer, index) => [layer, index]));
    branches.forEach((branch) => layerByBranch.set(String(branch.id), compactLayer.get(layerByBranch.get(String(branch.id))) ?? 0));

    let maxLayer = Math.max(0, ...layerByBranch.values());
    branches.forEach((branch) => {
      const endpoints = flowEndpoints.get(String(branch.id));
      if (returnSet.has(endpoints?.to)) layerByBranch.set(String(branch.id), maxLayer);
      if (intakeSet.has(endpoints?.from)) layerByBranch.set(String(branch.id), 0);
    });
    maxLayer = Math.max(0, ...layerByBranch.values());

    const layers = new Map();
    branches.forEach((branch) => {
      const layer = layerByBranch.get(String(branch.id)) || 0;
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer).push(String(branch.id));
    });
    const branchById = new Map(branches.map((branch) => [String(branch.id), branch]));
    const orderIndex = (layer) => new Map((layers.get(layer) || []).map((id, index) => [id, index]));
    const sortByBarycenter = (ids, neighborMap, neighborLayerOrder) =>
      ids.sort((a, b) => {
        const avg = (id) => {
          const neighbors = (neighborMap.get(id) || []).map((item) => neighborLayerOrder.get(item)).filter(Number.isFinite);
          if (!neighbors.length) return Number.POSITIVE_INFINITY;
          return neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
        };
        const delta = avg(a) - avg(b);
        if (Number.isFinite(delta) && Math.abs(delta) > 0.001) return delta;
        return this.branchPathLength(branchById.get(b)) - this.branchPathLength(branchById.get(a));
      });

    for (let pass = 0; pass < 20; pass += 1) {
      for (let layer = 1; layer <= maxLayer; layer += 1) {
        sortByBarycenter(layers.get(layer) || [], predecessors, orderIndex(layer - 1));
      }
      for (let layer = maxLayer - 1; layer >= 0; layer -= 1) {
        sortByBarycenter(layers.get(layer) || [], successors, orderIndex(layer + 1));
      }
    }

    const flowKey = (source, target) => `${source}\u001f${target}`;
    const directedLayerEdges = directedEdges
      .map((edge, index) => ({ ...edge, index, key: flowKey(edge.from, edge.to) }))
      .filter((edge) => (layerByBranch.get(edge.from) ?? 0) < (layerByBranch.get(edge.to) ?? 0));
    const outgoingFlow = new Map(branches.map((branch) => [String(branch.id), []]));
    const incomingFlow = new Map(branches.map((branch) => [String(branch.id), []]));
    directedLayerEdges.forEach((edge) => {
      outgoingFlow.get(edge.from)?.push(edge);
      incomingFlow.get(edge.to)?.push(edge);
    });
    const branchByDescendingLayer = branches
      .map((branch) => String(branch.id))
      .sort((a, b) => (layerByBranch.get(b) ?? 0) - (layerByBranch.get(a) ?? 0));
    const usedPathEdges = new Set();
    const mainPaths = [];
    const maxMainPaths = Math.min(28, Math.max(8, Math.ceil(Math.sqrt(branches.length)) + 8));
    for (let attempt = 0; attempt < maxMainPaths; attempt += 1) {
      const bestScore = new Map(branches.map((branch) => [String(branch.id), 0]));
      const bestNext = new Map();
      branchByDescendingLayer.forEach((id) => {
        (outgoingFlow.get(id) || []).forEach((edge) => {
          const span = Math.max(1, (layerByBranch.get(edge.to) ?? 0) - (layerByBranch.get(edge.from) ?? 0));
          const unusedWeight = usedPathEdges.has(edge.index) ? 0.08 : 1.18;
          const score = unusedWeight + span * 0.18 + (bestScore.get(edge.to) || 0);
          if (score > (bestScore.get(id) || 0)) {
            bestScore.set(id, score);
            bestNext.set(id, edge);
          }
        });
      });
      let start = null;
      let score = 0;
      branches
        .map((branch) => String(branch.id))
        .filter((id) => (outgoingFlow.get(id) || []).length && (!(incomingFlow.get(id) || []).length || !(outgoingFlow.get(id) || []).every((edge) => usedPathEdges.has(edge.index))))
        .forEach((id) => {
          const endpoints = flowEndpoints.get(id);
          const sourceBonus = intakeSet.has(endpoints?.from) ? 0.28 : 0;
          const candidateScore = (bestScore.get(id) || 0) + sourceBonus;
          if (candidateScore > score) {
            score = candidateScore;
            start = id;
          }
        });
      if (!start || score < 1.15) break;
      const path = [start];
      const pathEdges = [];
      const seen = new Set([start]);
      let cursor = start;
      while (bestNext.has(cursor)) {
        const edge = bestNext.get(cursor);
        if (seen.has(edge.to)) break;
        pathEdges.push(edge);
        path.push(edge.to);
        seen.add(edge.to);
        cursor = edge.to;
      }
      const freshEdges = pathEdges.filter((edge) => !usedPathEdges.has(edge.index));
      if (path.length < 3 || !freshEdges.length) break;
      freshEdges.forEach((edge) => usedPathEdges.add(edge.index));
      mainPaths.push({ nodes: path, edges: pathEdges, score });
    }
    mainPaths.sort((a, b) => b.nodes.length - a.nodes.length || b.score - a.score);
    const nodeLane = new Map();
    const pathEdgeLane = new Map();
    mainPaths.forEach((path, pathIndex) => {
      const side = pathIndex % 2 === 0 ? -1 : 1;
      const depth = Math.floor(pathIndex / 2);
      const factor = Math.max(0.24, 0.96 - depth * 0.15);
      const lane = { side, factor, pathIndex };
      path.nodes.forEach((id) => {
        if (!nodeLane.has(id)) nodeLane.set(id, lane);
      });
      path.edges.forEach((edge) => {
        if (!pathEdgeLane.has(edge.key)) pathEdgeLane.set(edge.key, lane);
      });
    });

    const maxLength = Math.max(1, ...branches.map((branch) => this.branchPathLength(branch)));
    const positions = new Map();
    layers.forEach((ids, layer) => {
      const t = maxLayer ? layer / maxLayer : 0.5;
      const x = (t - 0.5) * Math.max(1250, maxLayer * 125);
      const radiusY = 58 + Math.pow(Math.sin(Math.PI * Math.max(0.03, Math.min(0.97, t))), 0.64) * 460;
      ids.forEach((id, index) => {
        const count = ids.length;
        const slot = count <= 1 ? 0 : (index - (count - 1) / 2) / Math.max(1, (count - 1) / 2);
        const lengthRank = this.branchPathLength(branchById.get(id)) / maxLength;
        const lane = nodeLane.get(id);
        const laneSlot = lane ? lane.side * lane.factor : slot;
        const side = lane ? lane.side : slot === 0 ? (index % 2 ? 1 : -1) : Math.sign(slot);
        const ySlot = Math.max(-1.12, Math.min(1.12, laneSlot + side * lengthRank * 0.12 * (1 - Math.min(0.9, Math.abs(laneSlot)))));
        positions.set(id, { x, y: ySlot * radiusY, layer, radiusY });
      });
    });

    const clampToLayer = (pos) => {
      const t = maxLayer ? pos.layer / maxLayer : 0.5;
      const radiusY = 58 + Math.pow(Math.sin(Math.PI * Math.max(0.03, Math.min(0.97, t))), 0.64) * 460;
      pos.y = Math.max(-radiusY * 1.08, Math.min(radiusY * 1.08, pos.y));
    };
    for (let iter = 0; iter < 70; iter += 1) {
      positions.forEach((pos, id) => {
        const neighbors = [...(predecessors.get(id) || []), ...(successors.get(id) || [])].map((neighbor) => positions.get(neighbor)).filter(Boolean);
        if (!neighbors.length) return;
        const avgY = neighbors.reduce((sum, point) => sum + point.y, 0) / neighbors.length;
        pos.y += (avgY - pos.y) * (nodeLane.has(id) ? 0.018 : 0.042);
        clampToLayer(pos);
      });
      layers.forEach((ids) => {
        ids.sort((a, b) => positions.get(a).y - positions.get(b).y);
        const minGap = 58;
        for (let i = 1; i < ids.length; i += 1) {
          const prev = positions.get(ids[i - 1]);
          const current = positions.get(ids[i]);
          if (current.y - prev.y < minGap) current.y = prev.y + minGap;
          clampToLayer(current);
        }
      });
    }

    this.graphLayout = { positions, edges: directedEdges, flowEndpoints, nodePotential, layers, layerByBranch, pathEdgeLane };
    return this.graphLayout;
  }

  computeVentilationTopologyLayout() {
    const network = this.inputs.ventilationNetwork;
    const nodes = network?.listNodes?.() || [];
    const branches = this.renderBranches || [];
    if (!nodes.length) return { positions: new Map(), edges: [], boundary: { intakes: new Set(), returns: new Set() } };

    const nodeIds = nodes.map((node) => String(node.id));
    const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
    const baseOrder = new Map(nodeIds.map((id, index) => [id, index]));
    const adjacency = new Map(nodeIds.map((id) => [id, new Set()]));
    const edgeList = [];
    branches.forEach((branch) => {
      const source = String(branch.from);
      const target = String(branch.to);
      if (!nodeById.has(source) || !nodeById.has(target)) return;
      edgeList.push({ id: String(branch.id), source, target, branch });
      adjacency.get(source).add(target);
      adjacency.get(target).add(source);
    });

    const boundary = network.getBoundaryConditions?.() || {};
    const intakeIds = new Set((boundary.intakes || []).map((entry) => String(entry.nodeId)).filter((id) => nodeById.has(id)));
    let returnIds = new Set((boundary.returns || []).map((entry) => String(entry.nodeId)).filter((id) => nodeById.has(id)));
    if (!intakeIds.size) intakeIds.add(nodeIds[0]);

    const bfs = (starts) => {
      const dist = new Map(nodeIds.map((id) => [id, Infinity]));
      const queue = [];
      starts.forEach((id) => {
        if (!nodeById.has(id) || dist.get(id) === 0) return;
        dist.set(id, 0);
        queue.push(id);
      });
      for (let head = 0; head < queue.length; head += 1) {
        const id = queue[head];
        const nextDepth = dist.get(id) + 1;
        adjacency.get(id).forEach((next) => {
          if (dist.get(next) <= nextDepth) return;
          dist.set(next, nextDepth);
          queue.push(next);
        });
      }
      return dist;
    };

    const distFromIntake = bfs([...intakeIds]);
    if (!returnIds.size && nodeIds.length > 1) {
      let fallback = null;
      let bestDist = -Infinity;
      nodeIds.forEach((id) => {
        if (intakeIds.has(id)) return;
        const score = Number.isFinite(distFromIntake.get(id)) ? distFromIntake.get(id) : -1;
        if (score > bestDist || (score === bestDist && (baseOrder.get(id) || 0) > (baseOrder.get(fallback) || -Infinity))) {
          fallback = id;
          bestDist = score;
        }
      });
      if (fallback) returnIds = new Set([fallback]);
    }
    const distToReturn = bfs([...returnIds]);
    const maxFiniteDistance = (distMap) => {
      let max = 1;
      distMap.forEach((value) => {
        if (Number.isFinite(value)) max = Math.max(max, value);
      });
      return max;
    };
    const maxInletDistance = maxFiniteDistance(distFromIntake);
    const maxReturnDistance = maxFiniteDistance(distToReturn);
    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    const potentialOf = new Map();
    nodeIds.forEach((id) => {
      const fromInlet = distFromIntake.get(id);
      const toReturn = distToReturn.get(id);
      let potential = 0.5;
      if (intakeIds.has(id)) potential = 0;
      else if (returnIds.has(id)) potential = 1;
      else if (Number.isFinite(fromInlet) && Number.isFinite(toReturn) && fromInlet + toReturn > 0) potential = fromInlet / (fromInlet + toReturn);
      else if (Number.isFinite(fromInlet)) potential = 0.08 + 0.84 * (fromInlet / maxInletDistance);
      else if (Number.isFinite(toReturn)) potential = 0.92 - 0.84 * (toReturn / maxReturnDistance);
      potentialOf.set(id, clamp01(potential));
    });

    const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    const compareFlow = (a, b) => {
      const potentialDiff = potentialOf.get(a) - potentialOf.get(b);
      if (Math.abs(potentialDiff) > 1e-9) return potentialDiff;
      const inletDiff = finiteOr(distFromIntake.get(a), Number.MAX_SAFE_INTEGER) - finiteOr(distFromIntake.get(b), Number.MAX_SAFE_INTEGER);
      if (inletDiff !== 0) return inletDiff;
      const returnDiff = finiteOr(distToReturn.get(b), -1) - finiteOr(distToReturn.get(a), -1);
      if (returnDiff !== 0) return returnDiff;
      return (baseOrder.get(a) || 0) - (baseOrder.get(b) || 0);
    };

    const flowEdges = edgeList
      .map((edge) => (compareFlow(edge.source, edge.target) <= 0 ? { ...edge, from: edge.source, to: edge.target } : { ...edge, from: edge.target, to: edge.source }))
      .sort((a, b) => compareFlow(a.from, b.from) || compareFlow(a.to, b.to));

    let layerOf = new Map(nodeIds.map((id) => [id, intakeIds.has(id) ? 0 : Math.max(0, Math.round((potentialOf.get(id) || 0) * 2))]));
    flowEdges.forEach((edge) => {
      const nextLayer = layerOf.get(edge.from) + 1;
      if (nextLayer > layerOf.get(edge.to)) layerOf.set(edge.to, nextLayer);
    });
    if (returnIds.size) {
      const sinkLayer = Math.max(1, ...layerOf.values());
      returnIds.forEach((id) => layerOf.set(id, sinkLayer));
    }
    const usedLayers = [...new Set(layerOf.values())].sort((a, b) => a - b);
    const compactLayerOf = new Map(usedLayers.map((layer, index) => [layer, index]));
    nodeIds.forEach((id) => layerOf.set(id, compactLayerOf.get(layerOf.get(id)) || 0));
    const maxLayer = Math.max(...layerOf.values());
    const layers = Array.from({ length: maxLayer + 1 }, () => []);
    nodeIds.forEach((id) => layers[layerOf.get(id)].push(id));

    const augmentedLayers = layers.map((layer) => [...layer]);
    const itemLayer = new Map();
    const itemInfo = new Map();
    const augmentedEdges = [];
    layers.forEach((layer, layerIndex) => {
      layer.forEach((id) => {
        itemLayer.set(id, layerIndex);
        itemInfo.set(id, { real: true, nodeId: id });
      });
    });
    flowEdges.forEach((edge, edgeIndex) => {
      let from = edge.from;
      const toLayer = layerOf.get(edge.to);
      if (layerOf.get(edge.from) >= toLayer) return;
      for (let layer = layerOf.get(edge.from) + 1; layer <= toLayer; layer += 1) {
        const to = layer === toLayer ? edge.to : `__dummy_${edgeIndex}_${layer}`;
        if (layer < toLayer) {
          augmentedLayers[layer].push(to);
          itemLayer.set(to, layer);
          itemInfo.set(to, { real: false, edgeIndex });
        }
        augmentedEdges.push({ source: from, target: to });
        from = to;
      }
    });
    const augmentedNeighbors = new Map();
    augmentedLayers.forEach((layer) => layer.forEach((id) => augmentedNeighbors.set(id, { left: [], right: [] })));
    augmentedEdges.forEach((edge) => {
      augmentedNeighbors.get(edge.source)?.right.push(edge.target);
      augmentedNeighbors.get(edge.target)?.left.push(edge.source);
    });
    let augmentedOrderIndex = new Map();
    const refreshAugmentedOrder = () => {
      augmentedOrderIndex = new Map();
      augmentedLayers.forEach((layer, layerIndex) => layer.forEach((id, index) => augmentedOrderIndex.set(id, { layer: layerIndex, index })));
    };
    const normalizedAugmentedOrder = (id) => {
      const info = augmentedOrderIndex.get(id);
      if (!info) return 0.5;
      const count = augmentedLayers[info.layer].length;
      return count <= 1 ? 0.5 : info.index / (count - 1);
    };
    const augmentedBarycenter = (id, side) => {
      const neighbors = augmentedNeighbors.get(id)?.[side] || [];
      if (!neighbors.length) return null;
      return neighbors.reduce((sum, next) => sum + normalizedAugmentedOrder(next), 0) / neighbors.length;
    };
    const augmentedTieBreak = (id) => {
      const info = itemInfo.get(id);
      return info?.real ? baseOrder.get(info.nodeId) : nodeIds.length + (info?.edgeIndex || 0);
    };
    const sortAugmentedLayer = (layerIndex, side) => {
      const layer = augmentedLayers[layerIndex];
      if (layer.length < 2) return;
      const previous = new Map(layer.map((id, index) => [id, index]));
      layer.sort((a, b) => {
        const denom = Math.max(1, layer.length - 1);
        const av = augmentedBarycenter(a, side) ?? previous.get(a) / denom;
        const bv = augmentedBarycenter(b, side) ?? previous.get(b) / denom;
        if (Math.abs(av - bv) > 1e-6) return av - bv;
        return previous.get(a) - previous.get(b) || augmentedTieBreak(a) - augmentedTieBreak(b);
      });
    };
    refreshAugmentedOrder();
    for (let pass = 0; pass < 34; pass += 1) {
      for (let layer = 1; layer <= maxLayer; layer += 1) {
        sortAugmentedLayer(layer, 'left');
        refreshAugmentedOrder();
      }
      for (let layer = maxLayer - 1; layer >= 0; layer -= 1) {
        sortAugmentedLayer(layer, 'right');
        refreshAugmentedOrder();
      }
    }
    layers.forEach((layer, layerIndex) => {
      layer.length = 0;
      augmentedLayers[layerIndex].forEach((id) => {
        const info = itemInfo.get(id);
        if (info?.real) layer.push(info.nodeId);
      });
    });

    const neighborBySide = new Map(nodeIds.map((id) => [id, { left: [], right: [], all: [] }]));
    edgeList.forEach((edge) => {
      const a = layerOf.get(edge.source);
      const b = layerOf.get(edge.target);
      if (a < b) {
        neighborBySide.get(edge.source).right.push(edge.target);
        neighborBySide.get(edge.target).left.push(edge.source);
      } else if (a > b) {
        neighborBySide.get(edge.source).left.push(edge.target);
        neighborBySide.get(edge.target).right.push(edge.source);
      }
      neighborBySide.get(edge.source).all.push(edge.target);
      neighborBySide.get(edge.target).all.push(edge.source);
    });

    const flowKey = (source, target) => `${source}\u001f${target}`;
    const directedFlowEdges = flowEdges.map((edge, index) => ({ ...edge, index, key: flowKey(edge.from, edge.to) })).filter((edge) => layerOf.get(edge.from) < layerOf.get(edge.to));
    const outgoingFlow = new Map(nodeIds.map((id) => [id, []]));
    const incomingFlow = new Map(nodeIds.map((id) => [id, []]));
    directedFlowEdges.forEach((edge) => {
      outgoingFlow.get(edge.from).push(edge);
      incomingFlow.get(edge.to).push(edge);
    });
    const nodeByDescendingLayer = [...nodeIds].sort((a, b) => layerOf.get(b) - layerOf.get(a) || baseOrder.get(a) - baseOrder.get(b));
    const usedPathEdges = new Set();
    const mainPaths = [];
    const maxMainPaths = Math.min(28, Math.max(8, Math.ceil(Math.sqrt(nodeIds.length)) + 8));
    for (let attempt = 0; attempt < maxMainPaths; attempt += 1) {
      const bestScore = new Map(nodeIds.map((id) => [id, 0]));
      const bestNext = new Map();
      nodeByDescendingLayer.forEach((id) => {
        outgoingFlow.get(id).forEach((edge) => {
          const span = Math.max(1, layerOf.get(edge.to) - layerOf.get(edge.from));
          const score = (usedPathEdges.has(edge.index) ? 0.08 : 1.18) + span * 0.18 + bestScore.get(edge.to);
          if (score > bestScore.get(id)) {
            bestScore.set(id, score);
            bestNext.set(id, edge);
          }
        });
      });
      let start = null;
      let score = 0;
      nodeIds
        .filter((id) => outgoingFlow.get(id).length && (intakeIds.has(id) || !incomingFlow.get(id).length || !outgoingFlow.get(id).every((edge) => usedPathEdges.has(edge.index))))
        .forEach((id) => {
          const candidateScore = bestScore.get(id) + (intakeIds.has(id) ? 0.28 : 0);
          if (candidateScore > score) {
            score = candidateScore;
            start = id;
          }
        });
      if (!start || score < 1.15) break;
      const path = [start];
      const pathEdges = [];
      const seen = new Set([start]);
      let cursor = start;
      while (bestNext.has(cursor)) {
        const edge = bestNext.get(cursor);
        if (seen.has(edge.to)) break;
        pathEdges.push(edge);
        path.push(edge.to);
        seen.add(edge.to);
        cursor = edge.to;
      }
      const freshEdges = pathEdges.filter((edge) => !usedPathEdges.has(edge.index));
      if (path.length < 3 || !freshEdges.length) break;
      freshEdges.forEach((edge) => usedPathEdges.add(edge.index));
      mainPaths.push({ nodes: path, edges: pathEdges, score });
    }
    mainPaths.sort((a, b) => b.nodes.length - a.nodes.length || b.score - a.score);
    const nodeLane = new Map();
    const pathEdgeLane = new Map();
    mainPaths.forEach((path, pathIndex) => {
      const side = pathIndex % 2 === 0 ? -1 : 1;
      const depth = Math.floor(pathIndex / 2);
      const factor = Math.max(0.24, 0.96 - depth * 0.15);
      const lane = { side, factor, pathIndex };
      path.nodes.forEach((id) => {
        if (!nodeLane.has(id)) nodeLane.set(id, lane);
      });
      path.edges.forEach((edge) => {
        if (!pathEdgeLane.has(edge.key)) pathEdgeLane.set(edge.key, lane);
      });
    });

    const maxLayerSize = Math.max(...layers.map((layer) => layer.length));
    const endLayerSize = Math.max(layers[0].length, layers[maxLayer].length);
    const nodeGap = Math.max(52, Math.min(78, 720 / Math.max(1, Math.sqrt(nodeIds.length))));
    const layerGap = Math.max(72, Math.min(118, 1040 / Math.max(1, maxLayer || 1)));
    const endSpread = Math.max(84, (endLayerSize - 1) * nodeGap + 42);
    const ellipseSpread = Math.min(760, Math.max(330, maxLayer * layerGap * 0.52));
    const middleSpread = Math.max(ellipseSpread, (maxLayerSize - 1) * nodeGap + 150, Math.sqrt(Math.max(edgeList.length, nodeIds.length)) * 42);
    const layerSpread = (layer, count) => {
      if (maxLayer <= 0) return middleSpread;
      const t = layer / maxLayer;
      const olive = endSpread + (middleSpread - endSpread) * Math.pow(Math.sin(Math.PI * t), 0.64);
      return Math.max(olive, (count - 1) * nodeGap + 42);
    };
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const xById = new Map();
    const slotXById = new Map();
    const layerOrderBeforeTracks = new Map();
    layers.forEach((layer) => layer.forEach((id, index) => layerOrderBeforeTracks.set(id, index)));
    const interiorSlotX = (index, count, spread) => {
      if (count <= 1) return 0;
      const centered = (index / (count - 1)) * 2 - 1;
      return Math.sign(centered) * Math.pow(Math.abs(centered), 0.9) * (spread * 0.34);
    };
    const trackSlotX = (id, layerIndex, count, spread) => {
      const lane = nodeLane.get(id);
      if (lane) {
        const t = maxLayer <= 0 ? 0.5 : layerIndex / maxLayer;
        const radius = (spread / 2) * Math.pow(Math.sin(Math.PI * t), 0.18);
        return lane.side * radius * lane.factor;
      }
      return interiorSlotX(layerOrderBeforeTracks.get(id) || 0, count, spread);
    };
    layers.forEach((layer, layerIndex) => {
      const spread = layerSpread(layerIndex, layer.length);
      layer.sort((a, b) => trackSlotX(a, layerIndex, layer.length, spread) - trackSlotX(b, layerIndex, layer.length, spread));
    });
    const resolveLayerX = (layerIndex, desired) => {
      const layer = layers[layerIndex];
      if (!layer.length) return;
      const spread = layerSpread(layerIndex, layer.length);
      const minX = -spread / 2;
      const maxX = spread / 2;
      if (layer.length === 1) {
        const id = layer[0];
        xById.set(id, clamp(desired.get(id) ?? xById.get(id) ?? slotXById.get(id) ?? 0, minX, maxX));
        return;
      }
      const xs = layer.map((id, index) => {
        const lower = minX + index * nodeGap;
        const upper = maxX - (layer.length - 1 - index) * nodeGap;
        const fallback = slotXById.get(id) ?? trackSlotX(id, layerIndex, layer.length, spread);
        return clamp(desired.get(id) ?? xById.get(id) ?? fallback, lower, upper);
      });
      for (let i = 1; i < xs.length; i += 1) xs[i] = Math.max(xs[i], xs[i - 1] + nodeGap);
      for (let i = xs.length - 2; i >= 0; i -= 1) xs[i] = Math.min(xs[i], xs[i + 1] - nodeGap);
      layer.forEach((id, index) => xById.set(id, xs[index]));
    };
    layers.forEach((layer, layerIndex) => {
      const desired = new Map();
      const spread = layerSpread(layerIndex, layer.length);
      layer.forEach((id, index) => {
        const x = trackSlotX(id, layerIndex, layer.length, spread);
        slotXById.set(id, x);
        desired.set(id, x);
      });
      resolveLayerX(layerIndex, desired);
    });
    const neighborAverageX = (id, side) => {
      const ownLayer = layerOf.get(id);
      const candidates = neighborBySide.get(id)[side].filter((next) => layerOf.get(next) !== ownLayer);
      if (!candidates.length) return null;
      let total = 0;
      let weight = 0;
      candidates.forEach((next) => {
        const w = 1 / Math.max(1, Math.abs(layerOf.get(next) - ownLayer));
        total += (xById.get(next) || 0) * w;
        weight += w;
      });
      return weight ? total / weight : null;
    };
    for (let pass = 0; pass < 12; pass += 1) {
      for (let layer = 1; layer <= maxLayer; layer += 1) {
        const desired = new Map();
        layers[layer].forEach((id) => {
          const avg = neighborAverageX(id, 'left');
          const slot = slotXById.get(id) ?? xById.get(id) ?? 0;
          const current = xById.get(id) ?? slot;
          const trackWeight = nodeLane.has(id) ? 0.58 : 0.38;
          desired.set(id, avg == null ? slot : avg * (0.88 - trackWeight) + slot * trackWeight + current * 0.12);
        });
        resolveLayerX(layer, desired);
      }
      for (let layer = maxLayer - 1; layer >= 0; layer -= 1) {
        const desired = new Map();
        layers[layer].forEach((id) => {
          const avg = neighborAverageX(id, 'right');
          const slot = slotXById.get(id) ?? xById.get(id) ?? 0;
          const current = xById.get(id) ?? slot;
          const trackWeight = nodeLane.has(id) ? 0.58 : 0.38;
          desired.set(id, avg == null ? slot : avg * (0.88 - trackWeight) + slot * trackWeight + current * 0.12);
        });
        resolveLayerX(layer, desired);
      }
    }
    const positions = new Map();
    nodeIds.forEach((id) => positions.set(id, { x: xById.get(id) || 0, y: (maxLayer / 2 - layerOf.get(id)) * layerGap }));

    const edgeHash = (value) => {
      let hash = 0;
      for (let i = 0; i < String(value).length; i += 1) hash = ((hash << 5) - hash + String(value).charCodeAt(i)) | 0;
      return Math.abs(hash);
    };
    const layoutEdges = edgeList.map((edge) => {
      const sourceLayer = layerOf.get(edge.source);
      const targetLayer = layerOf.get(edge.target);
      const span = Math.abs(targetLayer - sourceLayer);
      const sourceX = positions.get(edge.source)?.x || 0;
      const targetX = positions.get(edge.target)?.x || 0;
      const midX = (sourceX + targetX) / 2;
      const flowFrom = sourceLayer <= targetLayer ? edge.source : edge.target;
      const flowTo = sourceLayer <= targetLayer ? edge.target : edge.source;
      const lane = pathEdgeLane.get(flowKey(flowFrom, flowTo)) ?? nodeLane.get(flowFrom) ?? nodeLane.get(flowTo);
      const jitter = lane ? 0 : ((edgeHash(edge.id) % 7) - 3) * 2;
      let curveSide = lane?.side ?? Math.sign(midX);
      if (curveSide === 0) curveSide = edgeHash(edge.id) % 2 ? 1 : -1;
      const actualDirection = sourceLayer <= targetLayer ? 1 : -1;
      const curveBase = lane ? Math.min(42, 18 + span * 4) : span === 0 ? 74 : Math.min(116, 26 + span * 10 + Math.abs(targetX - sourceX) * 0.035);
      let curveDist = curveSide * actualDirection * curveBase + jitter;
      if (Math.abs(curveDist) < 16) curveDist = curveSide * actualDirection * 16;
      return { ...edge, flowFrom, flowTo, curveDist, sourceLayer, targetLayer };
    });

    this.ventilationTopologyLayout = {
      positions,
      edges: layoutEdges,
      boundary: { intakes: intakeIds, returns: returnIds },
      layers,
      layerOf,
      maxLayer
    };
    return this.ventilationTopologyLayout;
  }

  drawGraphCanvas() {
    if (!this.graphCanvas || this.graphPanel.style.display === 'none' || this.graphPanel.classList.contains('panel-collapsed')) return;
    const { ctx, width, height } = this.setupCanvas(this.graphCanvas);
    const layout = this.ventilationTopologyLayout || this.computeVentilationTopologyLayout();
    const points = [...layout.positions.values()];
    if (!points.length) return;

    this.graphBranchSegments = [];
    this.graphBranchHits = [];
    this.graphNodeHits = [];
    this.graphFacilityHits = [];
    const graphArrows = [];

    const padding = 52;
    const bounds = points.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        maxX: Math.max(acc.maxX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxY: Math.max(acc.maxY, point.y)
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    const baseScale = Math.min(
      (width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
      (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY)
    );
    const scale = baseScale * this.graphView.zoom;
    const contentWidth = (bounds.maxX - bounds.minX) * scale;
    const contentHeight = (bounds.maxY - bounds.minY) * scale;
    const offsetX = (width - contentWidth) / 2 + this.graphView.panX;
    const offsetY = (height - contentHeight) / 2 + this.graphView.panY;
    const toCanvas = (point) => ({
      x: offsetX + (point.x - bounds.minX) * scale,
      y: offsetY + (point.y - bounds.minY) * scale
    });
    const toModel = (point) => ({
      x: bounds.minX + (point.x - offsetX) / (scale || 1),
      y: bounds.minY + (point.y - offsetY) / (scale || 1)
    });
    this.graphCanvasToModel = toModel;

    const drawModelArrow = (from, to, color) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) return;
      const ux = dx / len;
      const uy = dy / len;
      const pixelScale = Math.max(0.001, scale || 1);
      const size = Math.max(4.5, 3.5 / pixelScale);
      const offset = Math.max(8, 6.5 / pixelScale);
      const base = { x: to.x - ux * offset, y: to.y - uy * offset };
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(base.x + ux * size, base.y + uy * size);
      ctx.lineTo(base.x - ux * size * 0.55 - uy * size * 0.55, base.y - uy * size * 0.55 + ux * size * 0.55);
      ctx.lineTo(base.x - ux * size * 0.55 + uy * size * 0.55, base.y - uy * size * 0.55 - ux * size * 0.55);
      ctx.closePath();
      ctx.fill();
    };
    const curvePoint = (a, c, b, t) => {
      const mt = 1 - t;
      return {
        x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
        y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y
      };
    };
    const curveControl = (a, b, curveDist) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: (a.x + b.x) / 2 + (-dy / len) * curveDist, y: (a.y + b.y) / 2 + (dx / len) * curveDist };
    };

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-bounds.minX, -bounds.minY);

    ctx.save();
    ctx.strokeStyle = 'rgba(118, 215, 196, 0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, Math.max(40, (bounds.maxX - bounds.minX) * 0.55), Math.max(40, (bounds.maxY - bounds.minY) * 0.55), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    layout.edges.forEach((edge) => {
      const a = layout.positions.get(edge.source);
      const b = layout.positions.get(edge.target);
      if (!a || !b) return;
      const control = curveControl(a, b, edge.curveDist);
      const selected = String(edge.id) === String(this.selectedBranchId);
      const edgeColor = this.branchColor(edge.branch);
      ctx.strokeStyle = selected ? '#ffffff' : edgeColor;
      ctx.globalAlpha = selected ? 1 : 0.78;
      ctx.lineWidth = this.graphBranchStrokeWidth?.(edge.branch, selected) ?? (selected ? 3 : 1.5);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(control.x, control.y, b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (this.params.showDirection) {
        const forward = edge.flowTo === edge.target;
        const arrowFrom = curvePoint(a, control, b, forward ? 0.46 : 0.54);
        const arrowTo = curvePoint(a, control, b, forward ? 0.61 : 0.39);
        graphArrows.push({
          from: toCanvas(arrowFrom),
          to: toCanvas(arrowTo),
          color: selected ? '#ffffff' : edgeColor,
          selected
        });
      }
      const samples = [];
      for (let i = 0; i <= 18; i += 1) samples.push(toCanvas(curvePoint(a, control, b, i / 18)));
      for (let i = 0; i < samples.length - 1; i += 1) this.graphBranchSegments.push({ branchId: edge.id, a: samples[i], b: samples[i + 1] });
    });

    layout.positions.forEach((pos, id) => {
      const kind = layout.boundary.intakes.has(id) ? 'intake' : layout.boundary.returns.has(id) ? 'return' : this.nodeById.get(id)?.type;
      const incidentEdges = layout.edges.filter((edge) => edge.source === id || edge.target === id);
      const selectedEdge = incidentEdges.find((edge) => String(edge.id) === String(this.selectedBranchId));
      const selected = Boolean(selectedEdge);
      const dominantEdge = selectedEdge || incidentEdges[0];
      const r = kind === 'intake' || kind === 'return' ? 12 : 9;
      const nodeColor = kind === 'intake' ? '#42a5ff' : kind === 'return' ? '#ff6b6b' : dominantEdge ? this.branchColor(dominantEdge.branch) : '#9aa6b8';
      ctx.fillStyle = nodeColor;
      ctx.globalAlpha = selected || kind === 'intake' || kind === 'return' ? 0.96 : 0.72;
      ctx.strokeStyle = selected ? '#ffffff' : nodeColor;
      ctx.lineWidth = selected ? 4 : 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
      const canvasPoint = toCanvas(pos);
      this.graphNodeHits.push({ nodeId: id, x: canvasPoint.x, y: canvasPoint.y, r: Math.max(10, r * scale) });
      if (this.graphView.zoom > 0.72 || kind === 'intake' || kind === 'return') {
        ctx.fillStyle = kind === 'intake' || kind === 'return' ? '#ffffff' : '#dce5f5';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(id), pos.x, pos.y + r + 4);
      }
    });

    if (this.params.showFacilities) {
      this.inputs.ventilationNetwork.listFacilities().forEach((facility) => {
        const edge = layout.edges.find((item) => String(item.id) === String(facility.branchId));
        if (!edge) return;
        const a = layout.positions.get(edge.source);
        const b = layout.positions.get(edge.target);
        if (!a || !b) return;
        const control = curveControl(a, b, edge.curveDist);
        const ratio = Math.max(0.05, Math.min(0.95, Number(facility.ratio ?? 0.5)));
        const point = curvePoint(a, control, b, ratio);
        const selectedFacility = String(facility.id) === String(this.selectedFacilityId);
        const size = 7;
        ctx.fillStyle = selectedFacility ? '#ffffff' : this.facilityColor(facility.type);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y - size);
        ctx.lineTo(point.x + size, point.y);
        ctx.lineTo(point.x, point.y + size);
        ctx.lineTo(point.x - size, point.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        this.graphFacilityHits.push({ facilityId: facility.id, point: toCanvas(point) });
      });
    }

    ctx.restore();

    graphArrows.forEach((arrow) => {
      this.drawArrow(ctx, arrow.from, arrow.to, arrow.color, arrow.selected ? 1.05 : 0.85);
    });

    ctx.save();
    ctx.fillStyle = 'rgba(213, 222, 237, 0.56)';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    const intakeNodes = [...layout.boundary.intakes].map((id) => layout.positions.get(id)).filter(Boolean);
    const returnNodes = [...layout.boundary.returns].map((id) => layout.positions.get(id)).filter(Boolean);
    if (returnNodes.length) {
      const top = toCanvas(returnNodes.reduce((best, point) => (point.y < best.y ? point : best), returnNodes[0]));
      ctx.fillText('Return side', top.x, Math.max(18, top.y - 18));
    }
    if (intakeNodes.length) {
      const bottom = toCanvas(intakeNodes.reduce((best, point) => (point.y > best.y ? point : best), intakeNodes[0]));
      ctx.fillText('Intake side', bottom.x, Math.min(height - 8, bottom.y + 28));
    }
    ctx.restore();
  }

  drawDeclutteredGraphLabels(ctx, candidates, width, height, semantic) {
    const boxes = [];
    const intersects = (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
    candidates
      .sort((a, b) => b.priority - a.priority)
      .forEach((candidate) => {
        if (candidate.x < 0 || candidate.x > width || candidate.y < 0 || candidate.y > height) return;
        const fontSize = Math.max(candidate.important ? 5.5 : 5, (candidate.selected ? 8.2 : 7.4) * candidate.scale);
        const textWidth = candidate.label.length * fontSize * 0.58;
        const box = {
          x1: candidate.x - 2,
          y1: candidate.y - fontSize * 0.65 - 2,
          x2: candidate.x + textWidth + 4,
          y2: candidate.y + fontSize * 0.65 + 2
        };
        if (!candidate.selected && boxes.some((existing) => intersects(box, existing))) return;
        boxes.push(box);
        ctx.save();
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        if (candidate.selected || candidate.important) {
          ctx.fillStyle = 'rgba(8, 13, 24, 0.62)';
          this.roundRect(ctx, box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1, 4);
          ctx.fill();
        }
        ctx.fillStyle = candidate.selected ? '#ffffff' : candidate.important ? 'rgba(235, 242, 255, 0.9)' : 'rgba(220,229,245,0.62)';
        ctx.fillText(candidate.label, candidate.x, candidate.y);
        ctx.restore();
      });
  }

  roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  drawArrow(ctx, a, b, color, scale = 1) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ux = dx / len;
    const uy = dy / len;
    const mid = { x: a.x + dx * 0.55, y: a.y + dy * 0.55 };
    const size = Math.max(4.2, 5.2 * scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(mid.x + ux * size, mid.y + uy * size);
    ctx.lineTo(mid.x - ux * size * 0.55 - uy * size * 0.55, mid.y - uy * size * 0.55 + ux * size * 0.55);
    ctx.lineTo(mid.x - ux * size * 0.55 + uy * size * 0.55, mid.y - uy * size * 0.55 - ux * size * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  drawPolylineArrow(ctx, points, color, scale = 1, ratio = 0.55) {
    if (!Array.isArray(points) || points.length < 2) return;
    const segments = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 0.001) continue;
      segments.push({ a, b, length, start: total });
      total += length;
    }
    if (!segments.length) return;
    const target = total * Math.max(0.05, Math.min(0.95, ratio));
    const segment = segments.find((item) => target <= item.start + item.length) || segments[segments.length - 1];
    const local = Math.max(0, Math.min(1, (target - segment.start) / segment.length));
    const span = Math.min(0.42, Math.max(0.16, 20 / segment.length));
    const t0 = Math.max(0, local - span / 2);
    const t1 = Math.min(1, local + span / 2);
    const from = {
      x: segment.a.x + (segment.b.x - segment.a.x) * t0,
      y: segment.a.y + (segment.b.y - segment.a.y) * t0
    };
    const to = {
      x: segment.a.x + (segment.b.x - segment.a.x) * t1,
      y: segment.a.y + (segment.b.y - segment.a.y) * t1
    };
    this.drawArrow(ctx, from, to, color, scale);
  }

  facilityColor(type) {
    const key = String(type || '').toLowerCase();
    if (key === 'fan') return '#66d9ef';
    if (key === 'door') return '#f7c948';
    if (key === 'regulator') return '#b28dff';
    if (key === 'stopping') return '#ff6b6b';
    return '#d8dee9';
  }

  interpolatePath2D(path, ratio) {
    if (!path.length) return { x: 0, y: 0, z: 0 };
    if (path.length === 1) return path[0];
    let total = 0;
    const lengths = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const length = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
      lengths.push(length);
      total += length;
    }
    const target = Math.max(0, Math.min(1, Number(ratio))) * total;
    let traveled = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      if (traveled + lengths[i] >= target) {
        const t = (target - traveled) / (lengths[i] || 1);
        return {
          x: path[i].x + (path[i + 1].x - path[i].x) * t,
          y: path[i].y + (path[i + 1].y - path[i].y) * t,
          z: path[i].z + (path[i + 1].z - path[i].z) * t
        };
      }
      traveled += lengths[i];
    }
    return path[path.length - 1];
  }

  handleTopologyClick(event) {
    if (this.topologyCanvas.dataset.dragMoved === 'true') return;
    const rect = this.topologyCanvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const facilityHit = this.topologyFacilityHits.find((hit) => Math.hypot(hit.point.x - point.x, hit.point.y - point.y) < 11);
    if (facilityHit) {
      this.selectFacility(facilityHit.facilityId, { focus: this.params.autoFocusOnSelection });
      return;
    }
    const branchHit = this.graphBranchHits.find((hit) => {
      if (Number.isFinite(hit.r)) return Math.hypot(hit.x - point.x, hit.y - point.y) <= hit.r;
      return point.x >= hit.x - 4 && point.x <= hit.x + hit.w + 4 && point.y >= hit.y - 4 && point.y <= hit.y + hit.h + 14;
    });
    if (branchHit) {
      this.selectBranch(branchHit.branchId, { focus: this.params.autoFocusOnSelection });
      return;
    }
    let best = null;
    this.topologyBranchSegments.forEach((segment) => {
      const distance = this.distanceToSegment(point, segment.a, segment.b);
      if (!best || distance < best.distance) best = { branchId: segment.branchId, distance };
    });
    if (best && best.distance < 10) this.selectBranch(best.branchId, { focus: this.params.autoFocusOnSelection });
    else this.clearSelection();
  }

  handleGraphClick(event) {
    if (this.graphCanvas.dataset.dragMoved === 'true') return;
    const rect = this.graphCanvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const facilityHit = this.graphFacilityHits.find((hit) => Math.hypot(hit.point.x - point.x, hit.point.y - point.y) < 11);
    if (facilityHit) {
      this.selectFacility(facilityHit.facilityId, { focus: this.params.autoFocusOnSelection });
      return;
    }
    let best = null;
    this.graphBranchSegments.forEach((segment) => {
      const distance = this.distanceToSegment(point, segment.a, segment.b);
      if (!best || distance < best.distance) best = { branchId: segment.branchId, distance };
    });
    if (best && best.distance < 10) this.selectBranch(best.branchId, { focus: this.params.autoFocusOnSelection });
    else this.clearSelection();
  }

  updateBranchColorLegend() {
    if (!this.branchColorLegend) return;
    const bar = this.branchColorLegend.querySelector('.bar');
    const metric = this.branchColorLegend.querySelector('.metric');
    const range = this.branchColorLegend.querySelector('.range');
    if (this.params.branchColorMode === 'type') {
      bar.style.background = 'linear-gradient(90deg, #42a5ff, #76d7c4, #ffc857, #ff6b6b)';
      metric.textContent = 'Branch type';
      range.textContent = 'intake / normal / working / return';
      return;
    }
    if (this.params.branchColorMode === 'uniform') {
      bar.style.background = '#76d7c4';
      metric.textContent = 'Uniform';
      range.textContent = '';
      return;
    }
    bar.style.background = generateCssGradient(this.params.branchColormap);
    metric.textContent = this.branchMetricLabel();
    range.textContent = `${formatScalar(this.params.branchValueMin, 3)} - ${formatScalar(this.params.branchValueMax, 3)}`;
  }

  distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    return Math.hypot(point.x - x, point.y - y);
  }

  updateDetailPanel() {
    const content = this.detailPanel?.querySelector('.ventilation-detail-content');
    if (!content) return;
    if (this.selectedFacilityId) {
      const facility = this.inputs.ventilationNetwork.getFacility(this.selectedFacilityId);
      content.innerHTML = facility
        ? `
          <div class="detail-row"><span>Facility</span><strong>${facility.id}</strong></div>
          <div class="detail-row"><span>Type</span><strong>${facility.type}</strong></div>
          <div class="detail-row"><span>Branch</span><strong>${facility.branchId}</strong></div>
          <div class="detail-row"><span>Ratio</span><strong>${formatScalar(facility.ratio, 3)}</strong></div>
          <div class="detail-row"><span>Status</span><strong>${facility.status || '-'}</strong></div>
        `
        : '<div class="empty-state">No facility selected.</div>';
      return;
    }
    const branch = this.selectedBranchId ? this.inputs.ventilationNetwork.getBranch(this.selectedBranchId) : null;
    content.innerHTML = branch
      ? `
        <div class="detail-row"><span>Branch</span><strong>${branch.id}</strong></div>
        <div class="detail-row"><span>Type</span><strong>${branch.branchType || '-'}</strong></div>
        <div class="detail-row"><span>From / To</span><strong>${branch.from} -> ${branch.to}</strong></div>
        <div class="detail-row"><span>Roadway edges</span><strong>${(branch.roadwayEdgeIds || []).join(', ') || '-'}</strong></div>
        <div class="detail-row"><span>Direction</span><strong>${branch.inferredDirection || branch.nominalDirection || '-'}</strong></div>
        <div class="detail-row"><span>Length</span><strong>${formatScalar(branch.length)} m</strong></div>
        <div class="detail-row"><span>Area</span><strong>${formatScalar(branch.area)} m2</strong></div>
        <div class="detail-row"><span>Resistance</span><strong>${formatScalar(branch.resistance, 4)}</strong></div>
        <div class="detail-row"><span>Design Q</span><strong>${formatScalar(branch.designAirQuantity)} m3/s</strong></div>
      `
      : '<div class="empty-state">Select a branch or facility.</div>';
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="ventilation-controls">
        <div class="control-grid control-grid-checks">
          <label class="checkbox-row"><span>Show direction</span><input class="vn-show-direction" type="checkbox" /></label>
          <label class="checkbox-row"><span>Show facilities</span><input class="vn-show-facilities" type="checkbox" /></label>
          <label class="checkbox-row"><span>Show intake / return</span><input class="vn-show-boundaries" type="checkbox" /></label>
          <label class="checkbox-row"><span>Focus on selection</span><input class="vn-auto-focus" type="checkbox" /></label>
        </div>
        <div class="control-grid">
          <label class="field-row">Branch color
            <select class="vn-branch-color">
              <option value="type">Branch type</option>
              <option value="designAirQuantity">Design air quantity</option>
              <option value="pressureDrop">Pressure potential drop</option>
              <option value="resistance">Resistance</option>
              <option value="area">Area</option>
              <option value="uniform">Uniform</option>
            </select>
          </label>
          <label class="field-row">Color map
            <select class="vn-colormap">
              <option value="viridis">Viridis</option>
              <option value="rainbow">Rainbow</option>
              <option value="heat">Heat</option>
            </select>
          </label>
        </div>
        <div class="branch-color-legend">
          <div class="bar"></div>
          <div class="legend-labels"><span class="metric">Branch color</span><span class="range"></span></div>
        </div>
      </div>
    `;
    const showDirection = container.querySelector('.vn-show-direction');
    const showFacilities = container.querySelector('.vn-show-facilities');
    const showBoundaries = container.querySelector('.vn-show-boundaries');
    const autoFocus = container.querySelector('.vn-auto-focus');
    const colorMode = container.querySelector('.vn-branch-color');
    const colormap = container.querySelector('.vn-colormap');
    this.branchColorLegend = container.querySelector('.branch-color-legend');
    showDirection.checked = this.params.showDirection;
    showFacilities.checked = this.params.showFacilities;
    showBoundaries.checked = this.params.showIntakeReturn;
    autoFocus.checked = this.params.autoFocusOnSelection;
    colorMode.value = this.params.branchColorMode;
    colormap.value = this.params.branchColormap;
    const refresh = () => {
      this.params.showDirection = showDirection.checked;
      this.params.showFacilities = showFacilities.checked;
      this.params.showIntakeReturn = showBoundaries.checked;
      this.params.autoFocusOnSelection = autoFocus.checked;
      const colorModeChanged = this.params.branchColorMode !== colorMode.value;
      this.params.branchColorMode = colorMode.value;
      this.params.branchColormap = colormap.value;
      this.applyBranchColors({ autoRange: colorModeChanged });
      this.refreshOverlay();
      this.drawTopology();
    };
    [showDirection, showFacilities, showBoundaries, autoFocus, colorMode, colormap].forEach((element) =>
      element.addEventListener('change', refresh)
    );
    this.updateBranchColorLegend();
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager.highlightRoadwayEdges?.([]);
  }
}

class AirflowDistributionAnalysisRuntime extends VentilationNetworkOverviewRuntime {
  constructor(nodeModel, inputs) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Airflow Distribution Analysis';
    this.params = {
      defaultVariable: nodeModel.params?.defaultVariable || 'velocity',
      displayMode: nodeModel.params?.displayMode || 'balanced',
      showDirection: nodeModel.params?.showDirection !== false,
      showAnomalyHighlight: nodeModel.params?.showAnomalyHighlight !== false,
      showPressureMarkers: nodeModel.params?.showPressureMarkers === true,
      showTopologyStateView: nodeModel.params?.showTopologyStateView !== false,
      showBranchSummary: nodeModel.params?.showBranchSummary !== false,
      colormap: nodeModel.params?.colormap || null,
      minValue: Number.isFinite(Number(nodeModel.params?.minValue)) ? Number(nodeModel.params.minValue) : null,
      maxValue: Number.isFinite(Number(nodeModel.params?.maxValue)) ? Number(nodeModel.params.maxValue) : null,
      opacity: Number.isFinite(Number(nodeModel.params?.opacity)) ? Number(nodeModel.params.opacity) : 0.85,
      timeToleranceMinutes: Number(nodeModel.params?.timeToleranceMinutes ?? 60)
    };
    this.inputRequirements = AirflowDistributionInputRequirements;
    this.currentSnapshot = new Map();
    this.currentVariable = this.params.defaultVariable;
    this.currentRange = { min: 0, max: 1 };
    this.stateByBranch = new Map();
    this.summaryChartManager = null;
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.prepareVentilationGeometry();
    this.createPanels();
    this.registerVisualContributions();
    this.sceneManager.setRoadwayOpacity(0.5);
    this.installSceneHandlers();
    this.installContextHandlers();
    this.ensureInitialContext();
    this.updateAirflowState({ autoRange: true });
    this.ensureInitialSelection();
    return { cleanup: () => this.cleanup() };
  }

  createPanels() {
    const host = document.querySelector('.runtime-shell') || document.body;
    this.graphPanel = document.createElement('section');
    this.graphPanel.className = 'glass-panel ventilation-panel airflow-state-panel ventilation-resizable-panel';
    Object.assign(this.graphPanel.style, { left: '34vw', top: '118px', right: 'auto', bottom: 'auto' });
    this.graphPanel.innerHTML = `
      <div class="panel-title">Airflow Network State View</div>
      <canvas class="ventilation-graph-canvas"></canvas>
    `;
    host.appendChild(this.graphPanel);
    this.installPanelCollapse(this.graphPanel);
    this.makeDraggable(this.graphPanel);

    this.summaryPanel = document.createElement('section');
    this.summaryPanel.className = 'glass-panel ventilation-panel airflow-summary-panel';
    Object.assign(this.summaryPanel.style, { left: '38vw', top: '470px', right: 'auto', bottom: 'auto' });
    this.summaryPanel.innerHTML = `
      <div class="panel-title">Selected Branch Airflow Summary</div>
      <div class="airflow-summary-content"></div>
      <div class="airflow-trend-chart chart-panel"></div>
    `;
    host.appendChild(this.summaryPanel);
    this.installPanelCollapse(this.summaryPanel);
    this.makeDraggable(this.summaryPanel);

    this.graphCanvas = this.graphPanel.querySelector('.ventilation-graph-canvas');
    this.installCanvasNavigation(this.graphCanvas, this.graphView);
    this.graphCanvas.addEventListener('click', (event) => this.handleGraphClick(event));
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 0.5,
      keepWithPinnedOwner: true,
      show: () => this.sceneManager.setRoadwayVisible(true),
      hide: () => this.sceneManager.setRoadwayVisible(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisible(false)
    });
    this.contributionRegistry.register({
      id: `${this.id}:airflow-3d-overlay`,
      label: '3D Airflow Distribution Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: this.params.opacity,
      show: () => this.sceneManager.setAirflowOverlayVisible(true),
      hide: () => this.sceneManager.setAirflowOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setAirflowOverlayOpacity(value),
      focus: () =>
        this.selectedBranchId ? this.sceneManager.focusAirflowBranch(this.selectedBranchId) : this.sceneManager.focusOnRoadway(),
      cleanup: () => {
        this.sceneManager.clearAirflowOverlay();
        this.sceneManager.highlightRoadwayEdges?.([]);
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:airflow-network-state-view`,
      label: 'Airflow Network State View',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'topology-view',
      visible: true,
      show: () => {
        this.graphPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.graphPanel.style.display = 'none';
      },
      cleanup: () => this.graphPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:airflow-controls`,
      label: 'Airflow Legend / Variable Control',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'control',
      visible: true,
      show: () => {
        if (this.controlContainer) this.controlContainer.style.display = 'block';
      },
      hide: () => {
        if (this.controlContainer) this.controlContainer.style.display = 'none';
      },
      cleanup: () => {
        if (this.controlContainer) this.controlContainer.style.display = 'none';
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:airflow-summary`,
      label: 'Selected Branch Airflow Summary',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      visible: true,
      show: () => {
        this.summaryPanel.style.display = 'block';
        if (!this.summaryChartManager?.isDisposed?.()) this.summaryChartManager?.chart?.resize?.();
      },
      hide: () => {
        this.summaryPanel.style.display = 'none';
      },
      cleanup: () => {
        this.disposeSummaryChart();
        this.summaryPanel.remove();
      }
    });
  }

  installSceneHandlers() {
    const previousBranchPick = this.sceneManager.onVentilationBranchPick;
    this.sceneManager.onVentilationBranchPick = (branchId) => this.selectBranch(branchId, { focus: false });
    this.disposers.push(() => {
      this.sceneManager.onVentilationBranchPick = previousBranchPick;
      this.sceneManager.clearVentilationPickingBranches?.(this.id);
    });
  }

  installContextHandlers() {
    this.disposers.push(
      this.context.subscribe('time', () => this.updateAirflowState({ autoRange: false }))
    );
    this.disposers.push(
      this.context.subscribe('selectedBranch', (branchId) => {
        this.selectedBranchId = branchId || null;
        this.updateSelectionViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('selection', (selection) => {
        const branchId = getSelectionBranchID(selection);
        if (branchId && branchId !== this.context.get('selectedBranch')) this.context.set('selectedBranch', branchId);
      })
    );
    this.disposers.push(
      this.context.subscribe('activeAirflowVariable', (variable) => {
        if (AIRFLOW_VARIABLES[variable]) {
          this.currentVariable = variable;
          this.params.defaultVariable = variable;
          this.updateAirflowState({ autoRange: true });
        }
      })
    );
  }

  ensureInitialContext() {
    const range = this.inputs.airflowState.getTimeRange();
    if (this.context.get('time') == null) this.context.set('time', range.min);
    if (!AIRFLOW_VARIABLES[this.context.get('activeAirflowVariable')]) {
      this.context.set('activeAirflowVariable', this.params.defaultVariable);
    } else {
      this.currentVariable = this.context.get('activeAirflowVariable');
    }
  }

  selectBranch(branchId, { focus = false } = {}) {
    if (!branchId) return;
    this.context.set('selectedBranch', branchId);
    this.context.set('selection', { type: 'ventilationBranch', id: branchId });
    if (focus) this.sceneManager.focusAirflowBranch(branchId);
  }

  getVariableMeta() {
    return AIRFLOW_VARIABLES[this.currentVariable] || AIRFLOW_VARIABLES.velocity;
  }

  getState(branchId) {
    return this.currentSnapshot.get(String(branchId)) || null;
  }

  stateValue(branchId, variable = this.currentVariable) {
    const state = this.currentSnapshot.get(String(branchId));
    const meta = AIRFLOW_VARIABLES[variable] || AIRFLOW_VARIABLES.velocity;
    const value = Number(state?.[meta.valueKey]);
    return Number.isFinite(value) ? Math.abs(value) : null;
  }

  variableRange(variable = this.currentVariable) {
    const meta = AIRFLOW_VARIABLES[variable] || AIRFLOW_VARIABLES.velocity;
    if (Number.isFinite(this.params.minValue) && Number.isFinite(this.params.maxValue) && this.params.minValue !== this.params.maxValue) {
      return { min: this.params.minValue, max: this.params.maxValue };
    }
    const values = this.inputs.airflowState
      .listBranchIDs()
      .flatMap((branchId) => this.inputs.airflowState.getSeries(branchId, meta.valueKey))
      .map((point) => Math.abs(Number(point.value)))
      .filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 1 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? { min: min - 1, max: max + 1 } : { min, max };
  }

  quantityRange() {
    const values = this.inputs.airflowState
      .listBranchIDs()
      .flatMap((branchId) => this.inputs.airflowState.getSeries(branchId, 'airQuantity'))
      .map((point) => Math.abs(Number(point.value)))
      .filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 1 };
    return { min: Math.min(...values), max: Math.max(...values) || 1 };
  }

  updateAirflowState({ autoRange = false } = {}) {
    if (!this.inputs?.airflowState || !this.sceneManager) return;
    const time = this.context.get('time');
    const tolerance = this.params.timeToleranceMinutes * 60 * 1000;
    this.currentSnapshot = this.inputs.airflowState.getSnapshot(time, tolerance);
    this.currentVariable = this.context.get('activeAirflowVariable') || this.params.defaultVariable;
    if (autoRange || !Number.isFinite(this.currentRange.min) || !Number.isFinite(this.currentRange.max)) {
      this.currentRange = this.variableRange(this.currentVariable);
    } else {
      this.currentRange = this.variableRange(this.currentVariable);
    }
    this.applyAirflowEncoding();
    this.refreshOverlay();
    this.drawTopology();
    this.updateControlsView();
    this.updateDetailPanel();
  }

  applyAirflowEncoding() {
    const meta = this.getVariableMeta();
    const colorMap = this.params.colormap || meta.colormap || 'rainbow';
    const { min, max } = this.currentRange;
    const qRange = this.quantityRange();
    this.stateByBranch = new Map();
    this.renderBranches = this.renderBranches.map((branch) => {
      const state = this.getState(branch.id);
      this.stateByBranch.set(String(branch.id), state);
      const value = Math.abs(Number(state?.[meta.valueKey]));
      const t = Number.isFinite(value) ? (value - min) / (max - min || 1) : 0;
      const airQuantity = Math.abs(Number(state?.airQuantity));
      const q = Number.isFinite(airQuantity) ? (airQuantity - qRange.min) / (qRange.max - qRange.min || 1) : 0.25;
      const direction = state?.direction || branch.inferredDirection || branch.nominalDirection || 'from_to';
      const basePath = branch.originalPath || branch.path || [];
      const renderPath = direction === 'to_from' ? [...basePath].reverse() : basePath;
      const anomalyType = String(state?.anomalyType || 'normal');
      const isAnomaly = anomalyType && anomalyType !== 'normal';
      return {
        ...branch,
        renderPath,
        path: renderPath,
        airflowState: state,
        renderColor: isAnomaly && this.params.showAnomalyHighlight ? sampleColor(colorMap, t) : sampleColor(colorMap, t),
        renderRadius: 0.28 + q * 0.72,
        renderWidth: 1.1 + q * 4.2,
        isAnomaly
      };
    });
  }

  refreshOverlay() {
    this.sceneManager.setVentilationPickingBranches?.(this.id, this.renderBranches);
    this.sceneManager.addAirflowBranches(this.renderBranches, {
      opacity: this.params.opacity,
      showDirection: this.params.showDirection,
      showAnomalyHighlight: this.params.showAnomalyHighlight
    });
    const overlay = this.contributionRegistry?.get(`${this.id}:airflow-3d-overlay`);
    if (overlay?.visible === false) this.sceneManager.setAirflowOverlayVisible(false);
    this.sceneManager.highlightAirflowBranch(this.selectedBranchId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
  }

  branchColor(branch) {
    if (branch.renderColor) return branch.renderColor;
    return '#62d7ff';
  }

  branchStrokeWidth(branch, selected, glyphScale) {
    return Math.max(0.55, ((selected ? 2.2 : 0.75) + (branch.renderWidth || 1.6)) * glyphScale * 0.55);
  }

  graphBranchStrokeWidth(branch, selected) {
    return selected ? Math.max(3.2, (branch.renderWidth || 2) + 1.5) : Math.max(1.4, branch.renderWidth || 2);
  }

  drawTopology() {
    this.drawGraphCanvas();
    this.updateControlsView();
  }

  updateSelectionViews() {
    this.sceneManager.highlightAirflowBranch(this.selectedBranchId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
    this.drawTopology();
    this.updateDetailPanel();
  }

  updateDetailPanel() {
    const content = this.summaryPanel?.querySelector('.airflow-summary-content');
    if (!content) return;
    const branch = this.selectedBranchId ? this.inputs.ventilationNetwork.getBranch(this.selectedBranchId) : null;
    const state = branch ? this.getState(branch.id) : null;
    const meta = this.getVariableMeta();
    content.innerHTML = branch
      ? `
        <div class="detail-row"><span>Branch</span><strong>${branch.id}</strong></div>
        <div class="detail-row"><span>Type</span><strong>${branch.branchType || '-'}</strong></div>
        <div class="detail-row"><span>Current ${meta.label}</span><strong>${formatScalar(Math.abs(Number(state?.[meta.valueKey])), 3)} ${meta.unit}</strong></div>
        <div class="detail-row"><span>Air quantity</span><strong>${formatScalar(state?.airQuantity, 3)} m3/s</strong></div>
        <div class="detail-row"><span>Velocity</span><strong>${formatScalar(state?.velocity, 3)} m/s</strong></div>
        <div class="detail-row"><span>Pressure drop</span><strong>${formatScalar(state?.pressureDrop, 3)} Pa</strong></div>
        <div class="detail-row"><span>Pressure from / to</span><strong>${formatScalar(state?.pressureFrom, 2)} / ${formatScalar(state?.pressureTo, 2)} Pa</strong></div>
        <div class="detail-row"><span>Direction</span><strong>${state?.direction || '-'}</strong></div>
        <div class="detail-row"><span>Anomaly</span><strong>${state?.anomalyType || 'normal'}</strong></div>
      `
      : '<div class="empty-state">Select a branch.</div>';
    this.updateSummaryChart(branch?.id);
  }

  updateSummaryChart(branchId = this.selectedBranchId) {
    const chartHost = this.summaryPanel?.querySelector('.airflow-trend-chart');
    if (!chartHost || !branchId) return;
    if (this.summaryChartManager?.isDisposed?.()) this.summaryChartManager = null;
    if (!this.summaryChartManager) {
      this.summaryChartManager = new ChartManager(chartHost, this.sceneManager);
      this.summaryChartManager.setTitlePrefix('Branch');
      this.summaryChartManager.setTimeChangeHandler((time) => this.context.set('time', time));
    }
    const meta = this.getVariableMeta();
    this.summaryChartManager.setMetric({ label: meta.label, unit: meta.unit });
    this.summaryChartManager.updateSeries(branchId, this.inputs.airflowState.getSeries(branchId, meta.valueKey), this.context.get('time'));
  }

  disposeSummaryChart() {
    this.summaryChartManager?.dispose?.();
    this.summaryChartManager = null;
  }

  updateControlsView() {
    if (!this.controlContainer) return;
    const meta = this.getVariableMeta();
    const time = this.context.get('time');
    const label = this.controlContainer.querySelector('.airflow-time-label');
    const range = this.controlContainer.querySelector('.airflow-range-label');
    const bar = this.controlContainer.querySelector('.airflow-legend-bar');
    const variable = this.controlContainer.querySelector('.airflow-variable');
    const colormap = this.controlContainer.querySelector('.airflow-colormap');
    const timeScale = buildContinuousTimeScale(this.inputs.airflowState.getTimeRange().times);
    if (label) label.textContent = `${formatTime(time)} - ${timeScale.isSampleTime(time) ? 'sample' : 'interpolated'}`;
    if (range) range.textContent = `${meta.label}: ${formatScalar(this.currentRange.min, 3)} - ${formatScalar(this.currentRange.max, 3)} ${meta.unit}`;
    if (bar) bar.style.background = generateCssGradient(this.params.colormap || meta.colormap || 'rainbow');
    if (variable && variable.value !== this.currentVariable) variable.value = this.currentVariable;
    if (colormap && colormap.value !== (this.params.colormap || meta.colormap)) colormap.value = this.params.colormap || meta.colormap;
    const timeInput = this.controlContainer.querySelector('.airflow-time');
    if (timeInput) {
      timeInput.value = String(timeScale.indexFor(time));
    }
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlContainer = container;
    const timeScale = buildContinuousTimeScale(this.inputs.airflowState.getTimeRange().times);
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <label class="field-row">Time
        <input class="airflow-time" type="range" min="0" max="${timeScale.steps}" step="1" value="${timeScale.indexFor(this.context.get('time') ?? timeScale.min)}" />
      </label>
      <div class="time-label airflow-time-label"></div>
      <div class="control-grid">
        <label class="field-row">Variable
          <select class="airflow-variable">
            <option value="airQuantity">Air Quantity</option>
            <option value="velocity">Velocity</option>
            <option value="pressureDrop">Pressure Drop</option>
          </select>
        </label>
        <label class="field-row">Color map
          <select class="airflow-colormap">
            <option value="rainbow">Rainbow</option>
            <option value="viridis">Viridis</option>
            <option value="heat">Heat</option>
          </select>
        </label>
      </div>
      <div class="control-grid">
        <label class="checkbox-row"><span>Show direction</span><input class="airflow-show-direction" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show anomaly</span><input class="airflow-show-anomaly" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show pressure markers</span><input class="airflow-show-pressure" type="checkbox" /></label>
      </div>
      <div class="branch-color-legend">
        <div class="bar airflow-legend-bar"></div>
        <div class="legend-labels"><span class="airflow-range-label"></span></div>
      </div>
    `;
    const timeInput = container.querySelector('.airflow-time');
    const variable = container.querySelector('.airflow-variable');
    const colormap = container.querySelector('.airflow-colormap');
    const showDirection = container.querySelector('.airflow-show-direction');
    const showAnomaly = container.querySelector('.airflow-show-anomaly');
    const showPressure = container.querySelector('.airflow-show-pressure');
    variable.value = this.currentVariable;
    colormap.value = this.params.colormap || this.getVariableMeta().colormap;
    showDirection.checked = this.params.showDirection;
    showAnomaly.checked = this.params.showAnomalyHighlight;
    showPressure.checked = this.params.showPressureMarkers;
    timeInput.disabled = timeScale.steps === 0;
    timeInput.addEventListener('input', () => {
      const time = timeScale.timeAt(Number(timeInput.value));
      this.context.set('time', time);
    });
    variable.addEventListener('change', () => {
      this.context.set('activeAirflowVariable', variable.value);
    });
    const refresh = ({ autoRange = false } = {}) => {
      this.params.colormap = colormap.value;
      this.params.showDirection = showDirection.checked;
      this.params.showAnomalyHighlight = showAnomaly.checked;
      this.params.showPressureMarkers = showPressure.checked;
      this.updateAirflowState({ autoRange });
    };
    colormap.addEventListener('change', () => refresh({ autoRange: false }));
    [showDirection, showAnomaly, showPressure].forEach((element) => element.addEventListener('change', () => refresh({ autoRange: false })));
    this.updateControlsView();
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.disposeSummaryChart();
    this.sceneManager.clearAirflowOverlay?.();
    this.sceneManager.highlightRoadwayEdges?.([]);
  }
}

class BranchAirflowTrendInspectionRuntime extends VentilationNetworkOverviewRuntime {
  constructor(nodeModel, inputs) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Branch Airflow Trend Inspection';
    this.params = {
      defaultVariable: nodeModel.params?.defaultVariable || 'airQuantity',
      availableVariables: nodeModel.params?.availableVariables || ['airQuantity', 'velocity', 'pressureDrop'],
      timeWindowMode: nodeModel.params?.timeWindowMode || 'all',
      showStatistics: nodeModel.params?.showStatistics !== false,
      showAnomalyMarkers: nodeModel.params?.showAnomalyMarkers !== false,
      allowBranchSelector: nodeModel.params?.allowBranchSelector !== false,
      syncWithWorkspaceTime: nodeModel.params?.syncWithWorkspaceTime !== false,
      showDirection: nodeModel.params?.showDirection !== false,
      showIntakeReturn: nodeModel.params?.showIntakeReturn !== false,
      showFacilities: nodeModel.params?.showFacilities === true,
      branchColorMode: 'type',
      autoFocusOnSelection: nodeModel.params?.autoFocusOnSelection !== false
    };
    this.inputRequirements = BranchAirflowTrendInputRequirements;
    this.currentVariable = this.params.defaultVariable;
    this.trendChartManager = null;
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    if (this.inputs.roadway) {
      await this.initializeRoadway();
      this.sceneManager.setRoadwayOpacity(0.5);
    }
    this.prepareVentilationGeometry();
    this.createPanels();
    this.registerVisualContributions();
    this.installSceneHandlers();
    this.installContextHandlers();
    this.refreshOverlay();
    this.drawTopology();
    this.ensureInitialContext();
    this.updateViews();
    return { cleanup: () => this.cleanup() };
  }

  createPanels() {
    const host = document.querySelector('.runtime-shell') || document.body;
    this.topologyPanel = document.createElement('section');
    this.topologyPanel.className = 'glass-panel ventilation-panel branch-trend-drawing-panel ventilation-resizable-panel';
    this.topologyPanel.innerHTML = `
      <div class="panel-title">Ventilation 2D Drawing</div>
      <canvas class="ventilation-topology-canvas"></canvas>
    `;
    host.appendChild(this.topologyPanel);
    this.installPanelCollapse(this.topologyPanel);
    this.makeDraggable(this.topologyPanel);

    this.graphPanel = document.createElement('section');
    this.graphPanel.className = 'glass-panel ventilation-panel branch-trend-graph-panel ventilation-resizable-panel';
    this.graphPanel.innerHTML = `
      <div class="panel-title">Ventilation Topology Graph</div>
      <canvas class="ventilation-graph-canvas"></canvas>
    `;
    host.appendChild(this.graphPanel);
    this.installPanelCollapse(this.graphPanel);
    this.makeDraggable(this.graphPanel);

    this.trendPanel = document.createElement('section');
    this.trendPanel.className = 'glass-panel ventilation-panel branch-trend-panel';
    this.trendPanel.innerHTML = `
      <div class="panel-title">Branch Airflow Trend Chart</div>
      <div class="branch-trend-chart chart-panel"></div>
    `;
    host.appendChild(this.trendPanel);
    this.installPanelCollapse(this.trendPanel);
    this.makeDraggable(this.trendPanel);

    this.selectorPanel = document.createElement('section');
    this.selectorPanel.className = 'glass-panel ventilation-panel branch-selector-panel';
    this.selectorPanel.innerHTML = `
      <div class="panel-title">Branch Selector / Context</div>
      <div class="branch-selector-content"></div>
    `;
    host.appendChild(this.selectorPanel);
    this.installPanelCollapse(this.selectorPanel);
    this.makeDraggable(this.selectorPanel);

    this.statisticsPanel = document.createElement('section');
    this.statisticsPanel.className = 'glass-panel ventilation-panel branch-statistics-panel';
    this.statisticsPanel.innerHTML = `
      <div class="panel-title">Branch Airflow Statistics</div>
      <div class="branch-statistics-content"></div>
    `;
    host.appendChild(this.statisticsPanel);
    this.installPanelCollapse(this.statisticsPanel);
    this.makeDraggable(this.statisticsPanel);

    this.topologyCanvas = this.topologyPanel.querySelector('.ventilation-topology-canvas');
    this.graphCanvas = this.graphPanel.querySelector('.ventilation-graph-canvas');
    this.installCanvasNavigation(this.topologyCanvas, this.drawingView);
    this.installCanvasNavigation(this.graphCanvas, this.graphView);
    this.topologyCanvas.addEventListener('click', (event) => this.handleTopologyClick(event));
    this.graphCanvas.addEventListener('click', (event) => this.handleGraphClick(event));
  }

  registerVisualContributions() {
    if (this.inputs.roadway) {
      this.contributionRegistry.register({
        id: `${this.id}:roadway-model`,
        label: 'Roadway 3D Model',
        ownerId: this.id,
        functionId: this.functionId,
        type: 'scene-layer',
        visible: true,
        opacity: 0.5,
        keepWithPinnedOwner: true,
        show: () => this.sceneManager.setRoadwayVisible(true),
        hide: () => this.sceneManager.setRoadwayVisible(false),
        setOpacity: (value) => this.sceneManager.setRoadwayOpacity(value),
        focus: () => this.sceneManager.focusOnRoadway(),
        cleanup: () => this.sceneManager.setRoadwayVisible(false)
      });
    }
    this.contributionRegistry.register({
      id: `${this.id}:trend-ventilation-2d-drawing`,
      label: 'Ventilation 2D Drawing',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'drawing',
      visible: true,
      show: () => {
        this.topologyPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.topologyPanel.style.display = 'none';
      },
      cleanup: () => this.topologyPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:trend-ventilation-topology-graph`,
      label: 'Ventilation Topology Graph',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'topology-view',
      visible: true,
      show: () => {
        this.graphPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.graphPanel.style.display = 'none';
      },
      cleanup: () => this.graphPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:trend-ventilation-3d-overlay`,
      label: '3D Ventilation Network Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 1,
      show: () => this.sceneManager.setVentilationOverlayVisible(true),
      hide: () => this.sceneManager.setVentilationOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setVentilationOverlayOpacity(value),
      focus: () =>
        this.selectedBranchId ? this.sceneManager.focusVentilationBranch(this.selectedBranchId) : this.sceneManager.focusOnRoadway(),
      cleanup: () => {
        this.sceneManager.clearVentilationOverlay();
        this.sceneManager.highlightRoadwayEdges?.([]);
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:branch-airflow-trend-chart`,
      label: 'Branch Airflow Trend Chart',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'chart',
      visible: true,
      show: () => {
        this.trendPanel.style.display = 'block';
        if (!this.trendChartManager?.isDisposed?.()) this.trendChartManager?.chart?.resize?.();
      },
      hide: () => {
        this.trendPanel.style.display = 'none';
      },
      cleanup: () => {
        this.disposeTrendChart();
        this.trendPanel.remove();
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:branch-selector-context`,
      label: 'Branch Selector / Context Panel',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'control',
      visible: true,
      show: () => {
        this.selectorPanel.style.display = 'block';
      },
      hide: () => {
        this.selectorPanel.style.display = 'none';
      },
      cleanup: () => this.selectorPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:branch-airflow-statistics`,
      label: 'Branch Airflow Statistics Panel',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      visible: true,
      show: () => {
        this.statisticsPanel.style.display = 'block';
      },
      hide: () => {
        this.statisticsPanel.style.display = 'none';
      },
      cleanup: () => this.statisticsPanel.remove()
    });
  }

  installSceneHandlers() {
    const previousBranchPick = this.sceneManager.onVentilationBranchPick;
    this.sceneManager.onVentilationBranchPick = (branchId) => this.selectBranch(branchId, { focus: false });
    this.disposers.push(() => {
      this.sceneManager.onVentilationBranchPick = previousBranchPick;
      this.sceneManager.clearVentilationPickingBranches?.(this.id);
    });
  }

  installContextHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateViews()));
    this.disposers.push(
      this.context.subscribe('selectedBranch', (branchId) => {
        this.selectedBranchId = branchId || null;
        this.updateViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('selection', (selection) => {
        const branchId = getSelectionBranchID(selection);
        if (branchId && branchId !== this.context.get('selectedBranch')) this.context.set('selectedBranch', branchId);
      })
    );
    this.disposers.push(
      this.context.subscribe('activeAirflowVariable', (variable) => {
        if (AIRFLOW_VARIABLES[variable]) {
          this.currentVariable = variable;
          this.updateViews();
        }
      })
    );
  }

  ensureInitialContext() {
    const branches = this.inputs.ventilationNetwork.listBranches();
    const range = this.inputs.airflowState.getTimeRange();
    if (this.context.get('time') == null) this.context.set('time', range.min);
    if (!AIRFLOW_VARIABLES[this.context.get('activeAirflowVariable')]) {
      this.context.set('activeAirflowVariable', this.params.defaultVariable);
    } else {
      this.currentVariable = this.context.get('activeAirflowVariable');
    }
    if (!this.context.get('selectedBranch') && branches[0]) {
      this.context.set('selectedBranch', branches[0].id);
      this.context.set('selection', { type: 'ventilationBranch', id: branches[0].id });
    } else {
      this.selectedBranchId = this.context.get('selectedBranch');
    }
  }

  selectBranch(branchId, { focus = false } = {}) {
    if (!branchId) return;
    this.context.set('selectedBranch', branchId);
    this.context.set('selection', { type: 'ventilationBranch', id: branchId });
    if (focus) this.sceneManager.focusVentilationBranch(branchId);
  }

  getVariableMeta() {
    return AIRFLOW_VARIABLES[this.currentVariable] || AIRFLOW_VARIABLES.airQuantity;
  }

  updateViews() {
    this.currentVariable = this.context.get('activeAirflowVariable') || this.params.defaultVariable;
    this.selectedBranchId = this.context.get('selectedBranch') || this.selectedBranchId;
    this.sceneManager.highlightVentilationBranch(this.selectedBranchId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
    this.drawTopology();
    this.renderSelectorPanel();
    this.updateTrendChart();
    this.updateStatisticsPanel();
  }

  refreshOverlay() {
    this.sceneManager.setVentilationPickingBranches?.(this.id, this.renderBranches);
    this.sceneManager.addVentilationBranches(this.renderBranches, {
      facilities: this.params.showFacilities ? this.inputs.ventilationNetwork.listFacilities() : [],
      boundaryConditions: this.inputs.ventilationNetwork.getBoundaryConditions(),
      nodeById: this.nodeById,
      showFacilities: this.params.showFacilities,
      showDirection: this.params.showDirection,
      showIntakeReturn: this.params.showIntakeReturn,
      branchColorMode: 'type'
    });
    const overlay = this.contributionRegistry?.get(`${this.id}:trend-ventilation-3d-overlay`);
    if (overlay?.visible === false) this.sceneManager.setVentilationOverlayVisible(false);
    this.sceneManager.highlightVentilationBranch(this.selectedBranchId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
  }

  renderSelectorPanel() {
    const content = this.selectorPanel?.querySelector('.branch-selector-content');
    if (!content) return;
    const branches = this.inputs.ventilationNetwork.listBranches();
    const branch = this.selectedBranchId ? this.inputs.ventilationNetwork.getBranch(this.selectedBranchId) : null;
    content.innerHTML = `
      <label class="field-row">Branch
        <select class="branch-trend-branch"${this.params.allowBranchSelector ? '' : ' disabled'}>
          ${branches.map((item) => `<option value="${item.id}">${item.id} ${item.branchType ? `(${item.branchType})` : ''}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Variable
        <select class="branch-trend-variable">
          ${this.params.availableVariables.map((key) => `<option value="${key}">${AIRFLOW_VARIABLES[key]?.label || key}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Window
        <select class="branch-trend-window">
          <option value="all">All</option>
          <option value="recent" disabled>Recent</option>
          <option value="custom" disabled>Custom</option>
        </select>
      </label>
      <div class="detail-row"><span>Type</span><strong>${branch?.branchType || '-'}</strong></div>
      <div class="detail-row"><span>From / To</span><strong>${branch ? `${branch.from} -> ${branch.to}` : '-'}</strong></div>
    `;
    const branchSelect = content.querySelector('.branch-trend-branch');
    const variableSelect = content.querySelector('.branch-trend-variable');
    const windowSelect = content.querySelector('.branch-trend-window');
    if (branchSelect) {
      branchSelect.value = this.selectedBranchId || branches[0]?.id || '';
      branchSelect.addEventListener('change', () => this.selectBranch(branchSelect.value));
    }
    if (variableSelect) {
      variableSelect.value = this.currentVariable;
      variableSelect.addEventListener('change', () => this.context.set('activeAirflowVariable', variableSelect.value));
    }
    if (windowSelect) windowSelect.value = this.params.timeWindowMode;
  }

  updateTrendChart() {
    const host = this.trendPanel?.querySelector('.branch-trend-chart');
    if (!host || !this.selectedBranchId) return;
    if (this.trendChartManager?.isDisposed?.()) this.trendChartManager = null;
    if (!this.trendChartManager) {
      this.trendChartManager = new ChartManager(host, this.sceneManager);
      this.trendChartManager.setTitlePrefix('Branch');
      this.trendChartManager.setTimeChangeHandler((time) => {
        if (this.params.syncWithWorkspaceTime) this.context.set('time', time);
      });
    }
    const meta = this.getVariableMeta();
    this.trendChartManager.setMetric({ label: meta.label, unit: meta.unit });
    this.trendChartManager.updateSeries(
      this.selectedBranchId,
      this.inputs.airflowState.getSeries(this.selectedBranchId, meta.valueKey),
      this.context.get('time')
    );
  }

  updateStatisticsPanel() {
    const content = this.statisticsPanel?.querySelector('.branch-statistics-content');
    if (!content) return;
    const branch = this.selectedBranchId ? this.inputs.ventilationNetwork.getBranch(this.selectedBranchId) : null;
    if (!branch) {
      content.innerHTML = '<div class="empty-state">Select a branch.</div>';
      return;
    }
    const meta = this.getVariableMeta();
    const series = this.inputs.airflowState.getSeries(branch.id, meta.valueKey);
    const values = series.map((item) => Math.abs(Number(item.value))).filter(Number.isFinite);
    const current = this.inputs.airflowState.getBranchState(branch.id, this.context.get('time'), Infinity);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
    const minValue = values.length ? Math.min(...values) : NaN;
    const maxValue = values.length ? Math.max(...values) : NaN;
    const anomalyCount = series.filter((item) => item.anomalyType && item.anomalyType !== 'normal').length;
    const reverseCount = series.filter((item) => Number(item.directionSign) < 0 || item.direction === 'to_from').length;
    const lowCount = Number.isFinite(Number(branch.designAirQuantity))
      ? series.filter((item) => Math.abs(Number(item.airQuantity)) < Math.abs(Number(branch.designAirQuantity)) * 0.6).length
      : 0;
    content.innerHTML = `
      <div class="detail-row"><span>Branch</span><strong>${branch.id}</strong></div>
      <div class="detail-row"><span>Current</span><strong>${formatScalar(Math.abs(Number(current?.[meta.valueKey])), 3)} ${meta.unit}</strong></div>
      <div class="detail-row"><span>Min / Max</span><strong>${formatScalar(minValue, 3)} / ${formatScalar(maxValue, 3)} ${meta.unit}</strong></div>
      <div class="detail-row"><span>Mean</span><strong>${formatScalar(mean, 3)} ${meta.unit}</strong></div>
      <div class="detail-row"><span>Anomalies</span><strong>${anomalyCount}</strong></div>
      <div class="detail-row"><span>Reverse flow</span><strong>${reverseCount}</strong></div>
      <div class="detail-row"><span>Low airflow</span><strong>${lowCount}</strong></div>
    `;
  }

  disposeTrendChart() {
    this.trendChartManager?.dispose?.();
    this.trendChartManager = null;
  }

  renderControls(container) {
    this.controlContainer = container;
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="control-grid">
        <label class="field-row">Variable
          <select class="branch-trend-control-variable">
            ${this.params.availableVariables.map((key) => `<option value="${key}">${AIRFLOW_VARIABLES[key]?.label || key}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="control-grid control-grid-checks">
        <label class="checkbox-row"><span>Show direction</span><input class="branch-trend-show-direction" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show intake / return</span><input class="branch-trend-show-boundary" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show statistics</span><input class="branch-trend-show-stats" type="checkbox" /></label>
        <label class="checkbox-row"><span>Sync with workspace time</span><input class="branch-trend-sync-time" type="checkbox" /></label>
      </div>
    `;
    const variable = container.querySelector('.branch-trend-control-variable');
    const showDirection = container.querySelector('.branch-trend-show-direction');
    const showBoundary = container.querySelector('.branch-trend-show-boundary');
    const showStats = container.querySelector('.branch-trend-show-stats');
    const syncTime = container.querySelector('.branch-trend-sync-time');
    variable.value = this.currentVariable;
    showDirection.checked = this.params.showDirection;
    showBoundary.checked = this.params.showIntakeReturn;
    showStats.checked = this.params.showStatistics;
    syncTime.checked = this.params.syncWithWorkspaceTime;
    variable.addEventListener('change', () => this.context.set('activeAirflowVariable', variable.value));
    showDirection.addEventListener('change', () => {
      this.params.showDirection = showDirection.checked;
      this.refreshOverlay();
      this.drawTopology();
    });
    showBoundary.addEventListener('change', () => {
      this.params.showIntakeReturn = showBoundary.checked;
      this.refreshOverlay();
      this.drawTopology();
    });
    showStats.addEventListener('change', () => {
      this.params.showStatistics = showStats.checked;
      this.statisticsPanel.style.display = showStats.checked ? 'block' : 'none';
    });
    syncTime.addEventListener('change', () => {
      this.params.syncWithWorkspaceTime = syncTime.checked;
    });
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.disposeTrendChart();
    this.sceneManager.clearVentilationOverlay?.();
    this.sceneManager.highlightRoadwayEdges?.([]);
  }
}

class VentilationAnomalyInspectionRuntime extends VentilationNetworkOverviewRuntime {
  constructor(nodeModel, inputs) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Ventilation Anomaly Inspection';
    this.params = {
      lowAirQuantityThreshold: Number.isFinite(Number(nodeModel.params?.lowAirQuantityThreshold)) ? Number(nodeModel.params.lowAirQuantityThreshold) : null,
      highVelocityThreshold: Number.isFinite(Number(nodeModel.params?.highVelocityThreshold)) ? Number(nodeModel.params.highVelocityThreshold) : null,
      highPressureDropThreshold: Number.isFinite(Number(nodeModel.params?.highPressureDropThreshold)) ? Number(nodeModel.params.highPressureDropThreshold) : null,
      lowAirQuantityRatio: Number.isFinite(Number(nodeModel.params?.lowAirQuantityRatio)) ? Number(nodeModel.params.lowAirQuantityRatio) : 0.6,
      detectReverseFlow: nodeModel.params?.detectReverseFlow !== false,
      detectMissingData: nodeModel.params?.detectMissingData !== false,
      mode: nodeModel.params?.mode || 'currentTime',
      defaultSort: nodeModel.params?.defaultSort || 'severity',
      showTimeline: nodeModel.params?.showTimeline !== false,
      timeToleranceMinutes: Number(nodeModel.params?.timeToleranceMinutes ?? 60),
      show3DHighlight: nodeModel.params?.show3DHighlight !== false,
      showTopologyHighlight: nodeModel.params?.showTopologyHighlight !== false,
      showDirection: true,
      showFacilities: false,
      showIntakeReturn: true,
      autoFocusOnSelection: false
    };
    this.inputRequirements = VentilationAnomalyInputRequirements;
    this.currentSnapshot = new Map();
    this.anomalies = [];
    this.anomalyByBranch = new Map();
    this.filteredAnomalies = [];
    this.filteredAnomalyByBranch = new Map();
    this.filters = {
      type: 'all',
      severity: 'all',
      branchType: 'all',
      search: '',
      sort: this.params.defaultSort
    };
    this.timelineCounts = [];
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.prepareVentilationGeometry();
    this.createPanels();
    if (!this.params.showTimeline) this.timelinePanel.style.display = 'none';
    this.registerVisualContributions();
    this.sceneManager.setRoadwayOpacity(0.5);
    this.installSceneHandlers();
    this.installContextHandlers();
    this.ensureInitialContext();
    this.updateAnomalies();
    return { cleanup: () => this.cleanup() };
  }

  createPanels() {
    const host = document.querySelector('.runtime-shell') || document.body;
    this.listPanel = document.createElement('section');
    this.listPanel.className = 'glass-panel ventilation-panel anomaly-list-panel';
    this.listPanel.innerHTML = `
      <div class="panel-title">Ventilation Anomaly List</div>
      <div class="anomaly-list-content"></div>
    `;
    host.appendChild(this.listPanel);
    this.installPanelCollapse(this.listPanel);
    this.makeDraggable(this.listPanel);

    this.timelinePanel = document.createElement('section');
    this.timelinePanel.className = 'glass-panel ventilation-panel anomaly-timeline-panel';
    this.timelinePanel.innerHTML = `
      <div class="panel-title">Anomaly Timeline</div>
      <div class="anomaly-timeline-content"></div>
    `;
    host.appendChild(this.timelinePanel);
    this.installPanelCollapse(this.timelinePanel);
    this.makeDraggable(this.timelinePanel);

    this.graphPanel = document.createElement('section');
    this.graphPanel.className = 'glass-panel ventilation-panel anomaly-topology-panel ventilation-resizable-panel';
    this.graphPanel.innerHTML = `
      <div class="panel-title">Topology Anomaly Highlight View</div>
      <canvas class="ventilation-graph-canvas"></canvas>
    `;
    host.appendChild(this.graphPanel);
    this.installPanelCollapse(this.graphPanel);
    this.makeDraggable(this.graphPanel);

    this.detailPanel = document.createElement('section');
    this.detailPanel.className = 'glass-panel ventilation-panel anomaly-detail-panel';
    this.detailPanel.innerHTML = `
      <div class="panel-title">Anomaly Detail</div>
      <div class="anomaly-detail-content"></div>
    `;
    host.appendChild(this.detailPanel);
    this.installPanelCollapse(this.detailPanel);
    this.makeDraggable(this.detailPanel);

    this.graphCanvas = this.graphPanel.querySelector('.ventilation-graph-canvas');
    this.installCanvasNavigation(this.graphCanvas, this.graphView);
    this.graphCanvas.addEventListener('click', (event) => this.handleGraphClick(event));
    this.graphCanvas.addEventListener('pointermove', (event) => this.handleAnomalyGraphHover(event));
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:anomaly-list`,
      label: 'Ventilation Anomaly List',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      visible: true,
      show: () => {
        this.listPanel.style.display = 'block';
      },
      hide: () => {
        this.listPanel.style.display = 'none';
      },
      cleanup: () => this.listPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:anomaly-3d-overlay`,
      label: '3D Anomaly Highlight Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 0.9,
      show: () => this.sceneManager.setAnomalyOverlayVisible(true),
      hide: () => this.sceneManager.setAnomalyOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setAnomalyOverlayOpacity(value),
      focus: () =>
        this.selectedBranchId ? this.sceneManager.focusAnomalyBranch(this.selectedBranchId) : this.sceneManager.focusOnRoadway(),
      cleanup: () => {
        this.sceneManager.clearAnomalyOverlay();
        this.sceneManager.highlightRoadwayEdges?.([]);
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:anomaly-timeline`,
      label: 'Anomaly Timeline',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      visible: true,
      show: () => {
        this.timelinePanel.style.display = 'block';
        this.updateTimelinePanel();
      },
      hide: () => {
        this.timelinePanel.style.display = 'none';
      },
      cleanup: () => this.timelinePanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:anomaly-topology-view`,
      label: 'Topology Anomaly Highlight View',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'topology-view',
      visible: true,
      show: () => {
        this.graphPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.graphPanel.style.display = 'none';
      },
      cleanup: () => this.graphPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:anomaly-detail`,
      label: 'Anomaly Detail Panel',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      visible: true,
      show: () => {
        this.detailPanel.style.display = 'block';
      },
      hide: () => {
        this.detailPanel.style.display = 'none';
      },
      cleanup: () => this.detailPanel.remove()
    });
  }

  installSceneHandlers() {
    const previousBranchPick = this.sceneManager.onVentilationBranchPick;
    this.sceneManager.onVentilationBranchPick = (branchId) => this.selectBranch(branchId, { focus: false });
    this.disposers.push(() => {
      this.sceneManager.onVentilationBranchPick = previousBranchPick;
      this.sceneManager.clearVentilationPickingBranches?.(this.id);
    });
  }

  installContextHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateAnomalies()));
    this.disposers.push(
      this.context.subscribe('selectedBranch', (branchId) => {
        this.selectedBranchId = branchId || null;
        this.updateSelectionViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('selection', (selection) => {
        const branchId = getSelectionBranchID(selection);
        if (branchId && branchId !== this.context.get('selectedBranch')) this.context.set('selectedBranch', branchId);
      })
    );
  }

  ensureInitialContext() {
    const range = this.inputs.airflowState.getTimeRange();
    if (this.context.get('time') == null) this.context.set('time', range.min);
  }

  selectBranch(branchId, { focus = false } = {}) {
    if (!branchId) return;
    this.context.set('selectedBranch', branchId);
    this.context.set('selection', { type: 'ventilationBranch', id: branchId });
    if (focus) this.sceneManager.focusAnomalyBranch(branchId);
  }

  updateAnomalies() {
    const time = this.context.get('time');
    const tolerance = this.params.timeToleranceMinutes * 60 * 1000;
    this.currentSnapshot = this.inputs.airflowState.getSnapshot(time, tolerance);
    this.anomalies = this.computeAnomalies();
    this.anomalyByBranch = new Map(this.anomalies.map((item) => [String(item.branchId), item]));
    this.filteredAnomalies = this.getFilteredAnomalies();
    this.filteredAnomalyByBranch = new Map(this.filteredAnomalies.map((item) => [String(item.branchId), item]));
    this.timelineCounts = this.computeTimelineCounts();
    this.applyAnomalyEncoding();
    this.refreshOverlay();
    this.drawTopology();
    this.updateListPanel();
    this.updateTimelinePanel();
    this.updateDetailPanel();
  }

  computeAnomaliesForSnapshot(snapshot) {
    const items = [];
    this.inputs.ventilationNetwork.listBranches().forEach((branch) => {
      const state = snapshot.get(String(branch.id));
      const types = new Set();
      const reasons = [];
      const rules = [];
      let airflowThreshold = null;
      if (!state) {
        if (this.params.detectMissingData) {
          types.add('missing_data');
          reasons.push('No airflow state near current time.');
          rules.push('No branch state record within tolerance.');
        }
      } else {
        const anomalyType = String(state.anomalyType || 'normal');
        if (anomalyType && anomalyType !== 'normal') {
          types.add(anomalyType);
          reasons.push(`State reports ${anomalyType}.`);
          rules.push('anomaly_type != normal');
        }
        if (this.params.detectReverseFlow && (Number(state.directionSign) < 0 || state.direction === 'to_from')) {
          types.add('reverse_flow');
          reasons.push('Actual direction is opposite or to_from.');
          rules.push('directionSign < 0 or direction = to_from');
        }
        const airQuantity = Math.abs(Number(state.airQuantity));
        const designAirQuantity = Math.abs(Number(branch.designAirQuantity));
        airflowThreshold = Number.isFinite(this.params.lowAirQuantityThreshold)
          ? this.params.lowAirQuantityThreshold
          : Number.isFinite(designAirQuantity)
            ? designAirQuantity * this.params.lowAirQuantityRatio
            : null;
        if (airflowThreshold != null && Number.isFinite(airQuantity) && airQuantity < airflowThreshold) {
          types.add('low_airflow');
          reasons.push(`Air quantity ${formatScalar(airQuantity, 3)} is below ${formatScalar(airflowThreshold, 3)} m3/s.`);
          rules.push(`airQuantity < designAirQuantity * ${formatScalar(this.params.lowAirQuantityRatio, 2)}`);
        }
        const velocity = Math.abs(Number(state.velocity));
        if (Number.isFinite(this.params.highVelocityThreshold) && Number.isFinite(velocity) && velocity > this.params.highVelocityThreshold) {
          types.add('high_velocity');
          reasons.push(`Velocity ${formatScalar(velocity, 3)} exceeds threshold.`);
          rules.push(`velocity > ${formatScalar(this.params.highVelocityThreshold, 3)} m/s`);
        }
        const pressureDrop = Math.abs(Number(state.pressureDrop));
        if (Number.isFinite(this.params.highPressureDropThreshold) && Number.isFinite(pressureDrop) && pressureDrop > this.params.highPressureDropThreshold) {
          types.add('high_pressure_drop');
          reasons.push(`Pressure drop ${formatScalar(pressureDrop, 3)} exceeds threshold.`);
          rules.push(`pressureDrop > ${formatScalar(this.params.highPressureDropThreshold, 3)} Pa`);
        }
      }
      if (!types.size) return;
      const priority = types.has('reverse_flow') || types.has('missing_data') ? 'high' : types.has('high_pressure_drop') || types.has('low_airflow') || types.has('high_velocity') ? 'medium' : 'low';
      const primaryType = [...types][0];
      items.push({
        branchId: branch.id,
        branch,
        state,
        types: [...types],
        primaryType,
        reasons,
        rules,
        severity: priority,
        scenarioId: state?.scenarioId || '-',
        currentValue: this.anomalySortValue(primaryType, state),
        currentValueLabel: this.anomalyValueLabel(primaryType, state, branch, airflowThreshold)
      });
    });
    const rank = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.branchId).localeCompare(String(b.branchId)));
  }

  computeAnomalies() {
    return this.computeAnomaliesForSnapshot(this.currentSnapshot);
  }

  anomalySortValue(type, state) {
    if (!state) return -Infinity;
    const key = String(type || '').toLowerCase();
    if (key.includes('pressure')) return Math.abs(Number(state.pressureDrop));
    if (key.includes('velocity')) return Math.abs(Number(state.velocity));
    if (key.includes('reverse')) return Math.abs(Number(state.directionSign)) || 1;
    return Math.abs(Number(state.airQuantity));
  }

  anomalyValueLabel(type, state, branch, threshold = null) {
    if (!state) return 'missing state';
    const key = String(type || '').toLowerCase();
    if (key.includes('reverse')) return `direction = ${state.direction || '-'}; sign = ${formatScalar(state.directionSign, 0)}`;
    if (key.includes('pressure')) return `${formatScalar(Math.abs(Number(state.pressureDrop)), 3)} Pa`;
    if (key.includes('velocity')) return `${formatScalar(Math.abs(Number(state.velocity)), 3)} m/s`;
    if (key.includes('low')) {
      const design = Number(branch?.designAirQuantity);
      const limit = threshold ?? (Number.isFinite(design) ? Math.abs(design) * this.params.lowAirQuantityRatio : null);
      return `${formatScalar(Math.abs(Number(state.airQuantity)), 3)} / ${formatScalar(limit, 3)} m3/s`;
    }
    return `${formatScalar(Math.abs(Number(state.airQuantity)), 3)} m3/s`;
  }

  getFilteredAnomalies() {
    const search = this.filters.search.trim().toLowerCase();
    const filtered = this.anomalies.filter((item) => {
      if (this.filters.type !== 'all' && !item.types.includes(this.filters.type)) return false;
      if (this.filters.severity !== 'all' && item.severity !== this.filters.severity) return false;
      const branchType = item.branch.branchType || 'unknown';
      if (this.filters.branchType !== 'all' && branchType !== this.filters.branchType) return false;
      if (search && !String(item.branchId).toLowerCase().includes(search)) return false;
      return true;
    });
    const severityRank = { high: 0, medium: 1, low: 2 };
    const sorters = {
      severity: (a, b) => severityRank[a.severity] - severityRank[b.severity] || String(a.branchId).localeCompare(String(b.branchId)),
      type: (a, b) => String(a.primaryType).localeCompare(String(b.primaryType)) || String(a.branchId).localeCompare(String(b.branchId)),
      branchId: (a, b) => String(a.branchId).localeCompare(String(b.branchId), undefined, { numeric: true }),
      value: (a, b) => Math.abs(Number(b.currentValue)) - Math.abs(Number(a.currentValue)) || String(a.branchId).localeCompare(String(b.branchId))
    };
    return [...filtered].sort(sorters[this.filters.sort] || sorters.severity);
  }

  countByType(items = this.anomalies) {
    return items.reduce((acc, item) => {
      item.types.forEach((type) => {
        acc[type] = (acc[type] || 0) + 1;
      });
      return acc;
    }, {});
  }

  computeTimelineCounts() {
    const tolerance = this.params.timeToleranceMinutes * 60 * 1000;
    return this.inputs.airflowState.getTimeRange().times.map((time) => {
      const snapshot = this.inputs.airflowState.getSnapshot(time, tolerance);
      return { time, count: this.computeAnomaliesForSnapshot(snapshot).length };
    });
  }

  setFilter(key, value) {
    this.filters[key] = value;
    this.filteredAnomalies = this.getFilteredAnomalies();
    this.filteredAnomalyByBranch = new Map(this.filteredAnomalies.map((item) => [String(item.branchId), item]));
    this.applyAnomalyEncoding();
    this.refreshOverlay();
    this.drawTopology();
    this.updateListPanel();
    this.updateDetailPanel();
  }

  anomalyColor(type) {
    const key = String(type || '').toLowerCase();
    if (key.includes('reverse')) return '#d16bff';
    if (key.includes('missing')) return '#9aa6b8';
    if (key.includes('pressure')) return '#ff8a3d';
    if (key.includes('velocity')) return '#ff6b6b';
    if (key.includes('low')) return '#ffd166';
    return '#ff4d4d';
  }

  applyAnomalyEncoding() {
    this.renderBranches = this.renderBranches.map((branch) => {
      const anomaly = this.filteredAnomalyByBranch.get(String(branch.id));
      const hiddenAnomaly = this.anomalyByBranch.get(String(branch.id));
      return {
        ...branch,
        renderColor: anomaly ? this.anomalyColor(anomaly.primaryType) : 'rgba(110, 125, 150, 0.35)',
        isAnomaly: Boolean(anomaly),
        anomaly,
        hiddenAnomaly: anomaly ? null : hiddenAnomaly
      };
    });
    this.ventilationTopologyLayout = null;
    this.computeVentilationTopologyLayout();
  }

  refreshOverlay() {
    const branches = this.renderBranches.filter((branch) => branch.isAnomaly);
    this.sceneManager.setVentilationPickingBranches?.(this.id, this.renderBranches);
    this.sceneManager.addAnomalyBranches(branches, { opacity: 0.9 });
    const overlay = this.contributionRegistry?.get(`${this.id}:anomaly-3d-overlay`);
    if (overlay?.visible === false || !this.params.show3DHighlight) this.sceneManager.setAnomalyOverlayVisible(false);
    this.sceneManager.highlightAnomalyBranch(this.selectedBranchId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
  }

  drawTopology() {
    if (this.params.showTopologyHighlight) this.drawGraphCanvas();
  }

  branchColor(branch) {
    const anomaly = this.filteredAnomalyByBranch.get(String(branch.id));
    if (anomaly) return this.anomalyColor(anomaly.primaryType);
    if (this.anomalyByBranch.has(String(branch.id))) return 'rgba(95, 105, 124, 0.52)';
    return 'rgba(110, 125, 150, 0.38)';
  }

  graphBranchStrokeWidth(branch, selected) {
    const anomaly = this.filteredAnomalyByBranch.get(String(branch.id));
    if (selected) return 4.6;
    return anomaly ? 3.1 : 0.9;
  }

  updateSelectionViews() {
    this.sceneManager.highlightAnomalyBranch(this.selectedBranchId);
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
    this.drawTopology();
    this.updateListPanel();
    this.updateDetailPanel();
  }

  handleAnomalyGraphHover(event) {
    if (!this.graphCanvas || this.graphCanvas.dataset.dragMoved === 'true') return;
    const rect = this.graphCanvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    let best = null;
    this.graphBranchSegments.forEach((segment) => {
      const distance = this.distanceToSegment(point, segment.a, segment.b);
      if (!best || distance < best.distance) best = { branchId: segment.branchId, distance };
    });
    if (best && best.distance < 10) {
      const anomaly = this.anomalyByBranch.get(String(best.branchId));
      const branch = this.inputs.ventilationNetwork.getBranch(best.branchId);
      this.graphCanvas.title = anomaly
        ? `${best.branchId} ${branch?.branchType || ''}: ${anomaly.types.join(', ')}`
        : `${best.branchId} ${branch?.branchType || ''}: normal`;
    } else {
      this.graphCanvas.title = '';
    }
  }

  updateListPanel() {
    const content = this.listPanel?.querySelector('.anomaly-list-content');
    if (!content) return;
    const counts = this.countByType(this.anomalies);
    const filteredCounts = this.countByType(this.filteredAnomalies);
    const typeOptions = ['all', ...new Set(this.anomalies.flatMap((item) => item.types))];
    const branchTypeOptions = [
      'all',
      ...new Set(this.inputs.ventilationNetwork.listBranches().map((branch) => branch.branchType || 'unknown'))
    ];
    const currentTime = this.context.get('time');
    content.innerHTML = `
      <div class="anomaly-summary-row">
        <span>${formatTime(currentTime)}</span>
        <span>Showing ${this.filteredAnomalies.length}/${this.anomalies.length}</span>
        <span>Reverse ${counts.reverse_flow || 0}</span>
        <span>Low ${counts.low_airflow || 0}</span>
        <span>High DP ${counts.high_pressure_drop || 0}</span>
        <span>Missing ${counts.missing_data || 0}</span>
        <span>High sev ${this.anomalies.filter((item) => item.severity === 'high').length}</span>
        <span>Filtered tags ${Object.values(filteredCounts).reduce((sum, value) => sum + value, 0)}</span>
      </div>
      <div class="anomaly-filter-grid">
        <label>Type
          <select class="anomaly-filter-type">
            ${typeOptions.map((type) => `<option value="${type}">${type === 'all' ? 'All' : type}</option>`).join('')}
          </select>
        </label>
        <label>Severity
          <select class="anomaly-filter-severity">
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>Branch type
          <select class="anomaly-filter-branch-type">
            ${branchTypeOptions.map((type) => `<option value="${type}">${type === 'all' ? 'All' : type}</option>`).join('')}
          </select>
        </label>
        <label>Sort
          <select class="anomaly-sort">
            <option value="severity">Severity</option>
            <option value="type">Anomaly Type</option>
            <option value="branchId">Branch ID</option>
            <option value="value">Current Value</option>
          </select>
        </label>
        <label class="anomaly-search-label">Search
          <input class="anomaly-search" type="search" placeholder="Branch ID" value="${this.filters.search}" />
        </label>
      </div>
      <div class="anomaly-list-items">
        ${
          this.filteredAnomalies.length
            ? this.filteredAnomalies
                .map(
                  (item) => `
          <button class="anomaly-list-item${String(item.branchId) === String(this.selectedBranchId) ? ' active' : ''}" data-branch-id="${item.branchId}">
            <span class="anomaly-type" style="--anomaly-color:${this.anomalyColor(item.primaryType)}">${item.primaryType}</span>
            <strong class="anomaly-branch-id">${item.branchId}</strong>
            <span class="anomaly-branch-type">${item.branch.branchType || 'unknown'}</span>
            <span class="anomaly-severity ${item.severity}">${item.severity}</span>
            <span class="anomaly-current-value">${item.currentValueLabel}</span>
            <em class="anomaly-scenario">${item.scenarioId}</em>
          </button>
        `
                )
                .join('')
            : this.anomalies.length
              ? '<div class="empty-state">No anomalies match the current filters.</div>'
              : '<div class="empty-state">No ventilation anomalies at the current time.</div>'
        }
      </div>
    `;
    const typeSelect = content.querySelector('.anomaly-filter-type');
    const severitySelect = content.querySelector('.anomaly-filter-severity');
    const branchTypeSelect = content.querySelector('.anomaly-filter-branch-type');
    const sortSelect = content.querySelector('.anomaly-sort');
    const searchInput = content.querySelector('.anomaly-search');
    typeSelect.value = this.filters.type;
    severitySelect.value = this.filters.severity;
    branchTypeSelect.value = this.filters.branchType;
    sortSelect.value = this.filters.sort;
    typeSelect.addEventListener('change', () => this.setFilter('type', typeSelect.value));
    severitySelect.addEventListener('change', () => this.setFilter('severity', severitySelect.value));
    branchTypeSelect.addEventListener('change', () => this.setFilter('branchType', branchTypeSelect.value));
    sortSelect.addEventListener('change', () => this.setFilter('sort', sortSelect.value));
    searchInput.addEventListener('input', () => this.setFilter('search', searchInput.value));
    content.querySelectorAll('.anomaly-list-item').forEach((button) => {
      button.addEventListener('click', () => this.selectBranch(button.dataset.branchId, { focus: false }));
      button.addEventListener('dblclick', () => this.selectBranch(button.dataset.branchId, { focus: true }));
    });
  }

  updateTimelinePanel() {
    const content = this.timelinePanel?.querySelector('.anomaly-timeline-content');
    if (!content) return;
    const range = this.inputs.airflowState.getTimeRange();
    const times = range.times || [];
    const timeScale = buildContinuousTimeScale(times);
    const currentTime = this.context.get('time');
    const maxCount = Math.max(1, ...this.timelineCounts.map((item) => item.count));
    content.innerHTML = `
      <label class="field-row">Current time
        <input class="anomaly-time-slider" type="range" min="0" max="${timeScale.steps}" step="1" value="${timeScale.indexFor(currentTime)}" />
      </label>
      <div class="time-label anomaly-current-time">${formatTime(currentTime)} - ${timeScale.isSampleTime(currentTime) ? 'sample' : 'interpolated'}</div>
      <div class="anomaly-timeline-bars">
        ${
          this.timelineCounts.length
            ? this.timelineCounts
                .map((item, index) => {
                  const active = Math.abs(Number(item.time) - Number(currentTime)) <= Math.max(1, timeScale.stepMs * 0.5);
                  const height = Math.max(4, (item.count / maxCount) * 52);
                  return `<button class="anomaly-timeline-bar${active ? ' active' : ''}" data-time-index="${index}" title="${formatTime(item.time)}: ${item.count} anomalies" style="height:${height}px"><span>${item.count}</span></button>`;
                })
                .join('')
            : '<div class="empty-state">No airflow time steps.</div>'
        }
      </div>
    `;
    const slider = content.querySelector('.anomaly-time-slider');
    if (slider) slider.disabled = timeScale.steps === 0;
    slider?.addEventListener('input', () => {
      const time = timeScale.timeAt(Number(slider.value));
      this.context.set('time', time);
    });
    content.querySelectorAll('.anomaly-timeline-bar').forEach((button) => {
      button.addEventListener('click', () => {
        const time = times[Number(button.dataset.timeIndex)] ?? times[0];
        this.context.set('time', time);
      });
    });
  }

  suggestedInspectionNote(types = []) {
    if (types.includes('reverse_flow')) return 'Check pressure balance, door status, and nearby fan/regulator settings.';
    if (types.includes('low_airflow')) return 'Check branch obstruction, door/regulator status, or fan condition.';
    if (types.includes('high_pressure_drop')) return 'Check potential blockage, high resistance, or regulator change.';
    if (types.includes('missing_data')) return 'Check data source or measurement station availability.';
    if (types.includes('high_velocity')) return 'Check local restriction, branch area, and regulator setting.';
    return 'Inspect the branch state and related ventilation facilities.';
  }

  updateDetailPanel() {
    const content = this.detailPanel?.querySelector('.anomaly-detail-content');
    if (!content) return;
    const branchId = this.selectedBranchId || this.filteredAnomalies[0]?.branchId || this.anomalies[0]?.branchId;
    const anomaly = branchId ? this.anomalyByBranch.get(String(branchId)) : null;
    const branch = branchId ? this.inputs.ventilationNetwork.getBranch(branchId) : null;
    const state = branchId ? this.currentSnapshot.get(String(branchId)) : null;
    if (!branch) {
      content.innerHTML = '<div class="empty-state">Select an anomaly or branch.</div>';
      return;
    }
    const facilities = this.inputs.ventilationNetwork.listFacilities().filter((facility) => String(facility.branchId) === String(branch.id));
    const currentTime = this.context.get('time');
    content.innerHTML = `
      <div class="detail-row"><span>Branch</span><strong>${branch.id}</strong></div>
      <div class="detail-row"><span>Branch type</span><strong>${branch.branchType || 'unknown'}</strong></div>
      <div class="detail-row"><span>Current time</span><strong>${formatTime(currentTime)}</strong></div>
      <div class="detail-row"><span>Anomaly type</span><strong>${anomaly ? anomaly.types.join(', ') : 'normal'}</strong></div>
      <div class="detail-row"><span>Severity</span><strong>${anomaly?.severity || '-'}</strong></div>
      <div class="detail-row"><span>Air quantity</span><strong>${formatScalar(state?.airQuantity, 3)} m3/s</strong></div>
      <div class="detail-row"><span>Velocity</span><strong>${formatScalar(state?.velocity, 3)} m/s</strong></div>
      <div class="detail-row"><span>Pressure drop</span><strong>${formatScalar(state?.pressureDrop, 3)} Pa</strong></div>
      <div class="detail-row"><span>Pressure</span><strong>${formatScalar(state?.pressureFrom, 2)} / ${formatScalar(state?.pressureTo, 2)} Pa</strong></div>
      <div class="detail-row"><span>Direction</span><strong>${state?.direction || '-'}</strong></div>
      <div class="detail-row"><span>Design Q</span><strong>${formatScalar(branch.designAirQuantity, 3)} m3/s</strong></div>
      <div class="detail-row"><span>Rule</span><strong>${anomaly?.rules?.join('; ') || 'Selected branch has no anomaly at the current time.'}</strong></div>
      <div class="detail-row"><span>Reason</span><strong>${anomaly?.reasons?.join(' ') || 'Selected branch has no anomaly at the current time.'}</strong></div>
      <div class="detail-row"><span>Roadway edges</span><strong>${(branch.roadwayEdgeIds || []).join(', ') || '-'}</strong></div>
      <div class="detail-row"><span>Facilities</span><strong>${facilities.map((facility) => `${facility.id}(${facility.type})`).join(', ') || '-'}</strong></div>
      <div class="detail-row"><span>Scenario</span><strong>${state?.scenarioId || '-'}</strong></div>
      <div class="detail-row"><span>Inspection note</span><strong>${this.suggestedInspectionNote(anomaly?.types || [])}</strong></div>
    `;
  }

  renderControls(container) {
    this.controlContainer = container;
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="control-grid">
        <label class="field-row">Low airflow threshold
          <input class="anomaly-low-q" type="number" step="0.1" placeholder="auto" />
        </label>
        <label class="field-row">Low airflow ratio
          <input class="anomaly-low-ratio" type="number" step="0.05" min="0" max="1" />
        </label>
        <label class="field-row">High pressure drop
          <input class="anomaly-high-dp" type="number" step="1" placeholder="off" />
        </label>
        <label class="field-row">Default sort
          <select class="anomaly-default-sort">
            <option value="severity">Severity</option>
            <option value="type">Anomaly Type</option>
            <option value="branchId">Branch ID</option>
            <option value="value">Current Value</option>
          </select>
        </label>
      </div>
      <div class="control-grid control-grid-checks">
        <label class="checkbox-row"><span>Detect reverse flow</span><input class="anomaly-reverse" type="checkbox" /></label>
        <label class="checkbox-row"><span>Detect missing data</span><input class="anomaly-missing" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show timeline</span><input class="anomaly-show-timeline" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show 3D highlight</span><input class="anomaly-show-3d" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show topology highlight</span><input class="anomaly-show-topology" type="checkbox" /></label>
      </div>
    `;
    const lowQ = container.querySelector('.anomaly-low-q');
    const lowRatio = container.querySelector('.anomaly-low-ratio');
    const highDp = container.querySelector('.anomaly-high-dp');
    const defaultSort = container.querySelector('.anomaly-default-sort');
    const reverse = container.querySelector('.anomaly-reverse');
    const missing = container.querySelector('.anomaly-missing');
    const showTimeline = container.querySelector('.anomaly-show-timeline');
    const show3d = container.querySelector('.anomaly-show-3d');
    const showTopology = container.querySelector('.anomaly-show-topology');
    lowQ.value = this.params.lowAirQuantityThreshold ?? '';
    lowRatio.value = this.params.lowAirQuantityRatio;
    highDp.value = this.params.highPressureDropThreshold ?? '';
    defaultSort.value = this.params.defaultSort;
    reverse.checked = this.params.detectReverseFlow;
    missing.checked = this.params.detectMissingData;
    showTimeline.checked = this.params.showTimeline;
    show3d.checked = this.params.show3DHighlight;
    showTopology.checked = this.params.showTopologyHighlight;
    const refresh = () => {
      this.params.lowAirQuantityThreshold = lowQ.value === '' ? null : Number(lowQ.value);
      this.params.lowAirQuantityRatio = lowRatio.value === '' ? 0.6 : Number(lowRatio.value);
      this.params.highPressureDropThreshold = highDp.value === '' ? null : Number(highDp.value);
      this.params.defaultSort = defaultSort.value;
      this.filters.sort = defaultSort.value;
      this.params.detectReverseFlow = reverse.checked;
      this.params.detectMissingData = missing.checked;
      this.params.showTimeline = showTimeline.checked;
      this.params.show3DHighlight = show3d.checked;
      this.params.showTopologyHighlight = showTopology.checked;
      this.timelinePanel.style.display = showTimeline.checked ? 'block' : 'none';
      this.updateAnomalies();
    };
    [lowQ, lowRatio, highDp].forEach((element) => element.addEventListener('input', refresh));
    [defaultSort, reverse, missing, showTimeline, show3d, showTopology].forEach((element) => element.addEventListener('change', refresh));
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager.clearAnomalyOverlay?.();
    this.sceneManager.highlightRoadwayEdges?.([]);
  }
}

const GEOLOGY_PALETTE = [
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

const GEOLOGY_LITHOLOGY_COLORS = {
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

function geologyColorForKey(key, index = 0) {
  const normalized = String(key ?? '').toLowerCase();
  const direct = GEOLOGY_LITHOLOGY_COLORS[normalized];
  if (direct) return direct;
  const match = Object.entries(GEOLOGY_LITHOLOGY_COLORS).find(([name]) => normalized.includes(name));
  if (match) return match[1];
  return GEOLOGY_PALETTE[Math.abs(index) % GEOLOGY_PALETTE.length];
}

function geologyPoint(value = {}) {
  if (Array.isArray(value)) return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  return new THREE.Vector3(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

function disposeThreeObject(object) {
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

function setGroupOpacity(group, opacity) {
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

function geometryObjectNames(mesh) {
  const names = [];
  let current = mesh;
  while (current) {
    if (current.name) names.push(String(current.name));
    current = current.parent;
  }
  return [...new Set(names)];
}

function geologyNumericRange(values) {
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

function geologyPointKey(point, precision = 3) {
  const scale = 10 ** precision;
  return [point.x, point.y, point.z].map((value) => String(Math.round(Number(value) * scale) / scale)).join('|');
}

function geologyHorizontalKey(point, precision = 3) {
  const scale = 10 ** precision;
  return [point.x, point.z].map((value) => String(Math.round(Number(value) * scale) / scale)).join('|');
}

function geometryUniqueVertices(geometry, matrix = null) {
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

function geometryBoundaryEdges(geometry, matrix = null) {
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

function pathDepthRange(points = []) {
  const depths = points.map((point) => Number(point.depth)).filter(Number.isFinite);
  if (depths.length >= 2) return { min: Math.min(...depths), max: Math.max(...depths), hasDepth: true };
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += geologyPoint(points[i - 1]).distanceTo(geologyPoint(points[i]));
  return { min: 0, max: length, hasDepth: false };
}

function pointAtBoreholeMeasure(points = [], measure = 0, range = pathDepthRange(points)) {
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

function sliceBoreholePathByMeasure(points = [], from = 0, to = 0) {
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

class GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.params = {
      showGeologicalBody: true,
      showRoadway: true,
      showBoreholes: true,
      showStructures: true,
      showAttributeModel: false,
      geologicalBodyOpacity: 0.55,
      roadwayOpacity: 0.25,
      boreholeOpacity: 1,
      structureOpacity: 0.7,
      attributeModelOpacity: 0.65,
      colorMode: 'geological-unit',
      activeAttribute: null,
      blockRenderMode: 'volume',
      volumeIsoValue: 0.5,
      volumeFilterMin: 0,
      volumeFilterMax: 1,
      volumeClipXMin: 0,
      volumeClipXMax: 1,
      volumeClipYMin: 0,
      volumeClipYMax: 1,
      volumeClipZMin: 0,
      volumeClipZMax: 1,
      volumeOpacity: 0.5,
      volumeRaySteps: 200,
      volumePointSize: 7,
      showLabels: false,
      showSelectedLabel: true,
      autoFocusOnSelection: true,
      ...(nodeModel.params || {})
    };
    if (this.params.blockRenderMode === 'sampled-boxes') this.params.blockRenderMode = 'volume';
    this.disposers = [];
    this.controlDisposers = [];
    this.pickables = [];
    this.selected = null;
    this.materialOriginals = new WeakMap();
    this.label = nodeModel.label || 'Geological Model Overview';
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    this.createSceneGroups();
    await this.initializeRoadwayContext();
    await this.renderAllLayers();
    this.createPanels();
    this.registerVisualContributions();
    this.installHandlers();
    this.updatePanels();
    this.updateLegend();
    this.updateDetailPanel();
    this.applyLayerState();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    if (this.params.autoFocusOnSelection && this.rootGroup.children.length) this.sceneManager?.focusOnObject?.(this.rootGroup);
    return { cleanup: () => this.cleanup() };
  }

  validateSemanticInputs() {
    const body = this.inputs.geologicalBody;
    if (!body) throw new Error('Missing semantic dataset input: geologicalBody');
    const actualClass = body.contract?.class || body.semanticClass;
    if (actualClass !== 'GeologicalBody') throw new Error(`Input geologicalBody expects GeologicalBody, got ${actualClass}.`);
    if (body.validation?.errors?.length) {
      console.warn('[MineVis Geological Model Overview] Geological body validation errors:', body.validation.errors);
    }
    Object.entries(GeologicalModelOverviewInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Geological Model Overview] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  createSceneGroups() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = `${this.id}:geological-model-overview`;
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.name = 'geological-body-layer';
    this.boreholeGroup = new THREE.Group();
    this.boreholeGroup.name = 'borehole-layer';
    this.structureGroup = new THREE.Group();
    this.structureGroup.name = 'geological-structure-layer';
    this.attributeGroup = new THREE.Group();
    this.attributeGroup.name = 'geological-attribute-layer';
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'geological-selection-highlight';
    this.rootGroup.add(this.bodyGroup, this.boreholeGroup, this.structureGroup, this.attributeGroup, this.highlightGroup);
    this.sceneManager.scene.add(this.rootGroup);
    this.sceneManager.raycaster.params.Points = { threshold: 8 };
  }

  async initializeRoadwayContext() {
    const roadway = this.inputs.roadway;
    if (!roadway || !this.params.showRoadway) return;
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping?.(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping?.(), roadway);
    else this.sceneManager.buildRoadway?.(roadway);
    this.sceneManager.setRoadwayVisible?.(true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacity?.(this.params.roadwayOpacity);
  }

  async renderAllLayers() {
    await this.renderGeologicalBodyLayer();
    this.renderBoreholeLayer();
    await this.renderStructureLayer();
    this.renderAttributeLayer();
  }

  async loadObjText(dataset, sourceKey = 'geometryPath') {
    const raw = dataset?.adaptorResults?.geometry?.raw?.text;
    if (raw) return raw;
    const path = dataset?.source?.[sourceKey] || dataset?.source?.geometryPath;
    if (!path) return '';
    try {
      const response = await fetch(path);
      return response.ok ? response.text() : '';
    } catch (error) {
      console.warn('[MineVis Geological Model Overview] Failed to load OBJ geometry:', path, error);
      return '';
    }
  }

  unitForSurface(surface) {
    const unitId = surface?.geologicalUnitId ?? surface?.unitId ?? surface?.bodyId;
    return this.inputs.geologicalBody?.getUnit?.(unitId) || this.inputs.geologicalBody?.getBody?.(surface?.bodyId) || null;
  }

  colorForSurface(surface, index = 0) {
    const body = this.inputs.geologicalBody;
    const unit = this.unitForSurface(surface);
    if (this.params.colorMode === 'uniform') return '#8fb5ff';
    if (this.params.colorMode === 'lithology') {
      return geologyColorForKey(unit?.lithology ?? unit?.geologicalUnitType ?? surface?.surfaceType, index);
    }
    const explicit = unit?.color || surface?.color || body?.getBody?.(surface?.bodyId)?.color;
    if (explicit) return explicit;
    return geologyColorForKey(unit?.geologicalUnitId ?? surface?.bodyId ?? surface?.surfaceId, index);
  }

  colorForLithology(lithology, index = 0) {
    const key = String(lithology ?? '').toLowerCase();
    if (!key) return GEOLOGY_PALETTE[index % GEOLOGY_PALETTE.length];
    const body = this.inputs.geologicalBody;
    const units = body?.listUnits?.() || [];
    const unit = units.find((item) => {
      const candidates = [
        item.lithology,
        item.geologicalUnitType,
        item.unitType,
        item.unit_type,
        item.geologicalUnitId,
        item.unitId,
        item.geologicalUnitName
      ];
      return candidates.filter(Boolean).some((value) => String(value).toLowerCase() === key || String(value).toLowerCase().includes(key));
    });
    if (unit?.color) return unit.color;
    return geologyColorForKey(key, index);
  }

  geologicalDisplayColor(color) {
    const display = new THREE.Color(color || '#8fb5ff');
    const hsl = {};
    display.getHSL(hsl);
    if (hsl.l > 0.74) hsl.l = 0.66;
    else if (hsl.l > 0.62) hsl.l = 0.58;
    if (hsl.s < 0.16 && hsl.l > 0.2) hsl.s = 0.2;
    display.setHSL(hsl.h, hsl.s, hsl.l);
    return display;
  }

  createGeologicalBodyMaterial(color, opacity = Number(this.params.geologicalBodyOpacity)) {
    const bodyOpacity = Number(opacity);
    return new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor(color),
      transparent: bodyOpacity < 0.98,
      opacity: bodyOpacity,
      side: THREE.DoubleSide,
      depthWrite: bodyOpacity >= 0.98
    });
  }

  configureGeologicalBodyMesh(mesh, opacity = Number(this.params.geologicalBodyOpacity)) {
    const bodyOpacity = Number(opacity);
    mesh.renderOrder = bodyOpacity >= 0.98 ? 0 : 24;
    mesh.userData.opacityRenderOrder = { opaque: 0, transparent: 24 };
  }

  async renderGeologicalBodyLayer() {
    const body = this.inputs.geologicalBody;
    const objText = await this.loadObjText(body);
    const surfaces = body?.listSurfaces?.() || [];
    const surfaceByMesh = new Map();
    surfaces.forEach((surface, index) => {
      const keys = [surface.meshPartId, surface.mesh_part_id, surface.name, surface.surfaceId].filter(Boolean).map(String);
      keys.forEach((key) => surfaceByMesh.set(key, { surface, index }));
    });
    if (objText) {
      const object = new OBJLoader().parse(objText);
      const layeredSurfaceMeshes = new Map();
      let fallbackIndex = 0;
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.computeVertexNormals?.();
        const matched = geometryObjectNames(child).map((name) => surfaceByMesh.get(name)).find(Boolean);
        const surface = matched?.surface || surfaces[fallbackIndex] || {
          surfaceId: child.name || `SURF_${fallbackIndex + 1}`,
          meshPartId: child.name || null,
          surfaceType: 'surface'
        };
        const index = matched?.index ?? fallbackIndex;
        fallbackIndex += 1;
        const bodyOpacity = Number(this.params.geologicalBodyOpacity);
        child.material = this.createGeologicalBodyMaterial(this.colorForSurface(surface, index), bodyOpacity);
        this.configureGeologicalBodyMesh(child, bodyOpacity);
        child.userData.geologyPick = {
          type: 'geologicalSurface',
          id: surface.surfaceId,
          surfaceId: surface.surfaceId,
          unitId: surface.geologicalUnitId ?? surface.unitId,
          bodyId: surface.bodyId,
          label: surface.surfaceId
        };
        const unitId = String(surface.geologicalUnitId ?? surface.unitId ?? surface.bodyId ?? surface.surfaceId);
        const entry = layeredSurfaceMeshes.get(unitId) || { unitId, roof: [], floor: [], closure: [], surfaces: [] };
        const surfaceType = String(surface.surfaceType ?? surface.surface_type ?? '').toLowerCase();
        if (surfaceType.includes('roof') || surfaceType.includes('top')) entry.roof.push({ mesh: child, surface, index });
        else if (surfaceType.includes('floor') || surfaceType.includes('bottom')) entry.floor.push({ mesh: child, surface, index });
        else if (surfaceType.includes('side') || surfaceType.includes('cut') || surfaceType.includes('closure')) entry.closure.push({ mesh: child, surface, index });
        entry.surfaces.push({ mesh: child, surface, index });
        layeredSurfaceMeshes.set(unitId, entry);
        this.pickables.push(child);
      });
      object.updateMatrixWorld(true);
      const sideWallGroup = this.createLayeredShellSideWallGroup(layeredSurfaceMeshes);
      this.bodyGroup.add(object);
      if (sideWallGroup?.children?.length) {
        this.bodyGroup.add(sideWallGroup);
      }
    }
    this.renderGeologicalBlocksFromBody();
  }

  createLayeredShellSideWallGroup(surfaceMeshEntries = new Map()) {
    const body = this.inputs.geologicalBody;
    const profile = body?.getRepresentationProfile?.() || body?.representationProfile;
    const hasRoofFloorPairs = [...surfaceMeshEntries.values()].some((entry) => entry.roof?.length && entry.floor?.length);
    if (profile !== 'layered-surface' && !hasRoofFloorPairs) return null;
    const bodyOpacity = Number(this.params.geologicalBodyOpacity);
    const sideWallGroup = new THREE.Group();
    sideWallGroup.name = 'layered-geological-body-sidewalls';
    surfaceMeshEntries.forEach((entry) => {
      if (entry.closure?.length) return;
      if (!entry.roof.length || !entry.floor.length) return;
      const floorIndex = this.buildFloorVertexIndex(entry.floor.map((item) => item.mesh));
      entry.roof.forEach((roofItem) => {
        roofItem.mesh.updateMatrixWorld?.(true);
        const geometry = this.buildLayerSideWallGeometry(roofItem.mesh.geometry, floorIndex, roofItem.mesh.matrixWorld);
        if (!geometry) return;
        geometry.computeVertexNormals();
        const color = this.colorForSurface(roofItem.surface, roofItem.index);
        const material = this.createGeologicalBodyMaterial(color, Math.min(1, Math.max(bodyOpacity, 0.72)));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${entry.unitId}:generated-side-and-cut-closure`;
        this.configureGeologicalBodyMesh(mesh, Math.min(1, Math.max(bodyOpacity, 0.72)));
        const unit = this.unitForSurface(roofItem.surface);
        mesh.userData.geologyPick = {
          type: 'geologicalUnit',
          id: entry.unitId,
          unitId: entry.unitId,
          surfaceId: roofItem.surface.surfaceId,
          bodyId: roofItem.surface.bodyId,
          label: unit?.geologicalUnitName ?? roofItem.surface.bodyId ?? entry.unitId
        };
        sideWallGroup.add(mesh);
        this.pickables.push(mesh);
      });
    });
    return sideWallGroup;
  }

  buildFloorVertexIndex(floorMeshes = []) {
    const index = new Map();
    const vertices = [];
    floorMeshes.forEach((mesh) => {
      mesh.updateMatrixWorld?.(true);
      geometryUniqueVertices(mesh.geometry, mesh.matrixWorld).forEach((point) => {
        vertices.push(point);
        const key = geologyHorizontalKey(point);
        if (!index.has(key)) index.set(key, point);
      });
    });
    index.vertices = vertices;
    return index;
  }

  findMatchingFloorVertex(point, floorVertexIndex) {
    const exact = floorVertexIndex.get(geologyHorizontalKey(point));
    if (exact) return exact;
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of floorVertexIndex.vertices || []) {
      const dx = candidate.x - point.x;
      const dz = candidate.z - point.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return bestDistance <= 30 * 30 ? best : null;
  }

  buildLayerSideWallGeometry(roofGeometry, floorVertexIndex, roofMatrix = null) {
    const positions = [];
    const pushTriangle = (a, b, c) => {
      if (!a || !b || !c) return;
      if (a.distanceToSquared(b) < 1e-8 || b.distanceToSquared(c) < 1e-8 || c.distanceToSquared(a) < 1e-8) return;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    geometryBoundaryEdges(roofGeometry, roofMatrix).forEach((edge) => {
      const topA = edge.a.point;
      const topB = edge.b.point;
      const floorA = this.findMatchingFloorVertex(topA, floorVertexIndex);
      const floorB = this.findMatchingFloorVertex(topB, floorVertexIndex);
      if (!floorA || !floorB) return;
      pushTriangle(topA, floorA, topB);
      pushTriangle(topB, floorA, floorB);
    });
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  renderGeologicalBlocksFromBody() {
    const blocks = this.inputs.geologicalBody?.listBlocks?.() || [];
    if (!blocks.length) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const bodyOpacity = Number(this.params.geologicalBodyOpacity);
    const material = new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor('#6f92d8'),
      transparent: bodyOpacity < 0.98,
      opacity: bodyOpacity,
      depthWrite: bodyOpacity >= 0.98
    });
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
    mesh.name = 'geological-body-blocks';
    mesh.renderOrder = bodyOpacity >= 0.98 ? 0 : 24;
    mesh.userData.opacityRenderOrder = { opaque: 0, transparent: 24 };
    const transform = new THREE.Matrix4();
    blocks.forEach((block, index) => {
      const center = geologyPoint(block.centroid);
      const size = block.size || {};
      transform.compose(center, new THREE.Quaternion(), new THREE.Vector3(Number(size.x) || 8, Number(size.y) || 8, Number(size.z) || 8));
      mesh.setMatrixAt(index, transform);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.geologyPick = { type: 'geologicalBlockCollection', id: 'geological-body-blocks', elements: blocks };
    this.pickables.push(mesh);
    this.bodyGroup.add(mesh);
  }

  renderBoreholeLayer() {
    const boreholeDataset = this.inputs.borehole;
    if (!boreholeDataset) return;
    boreholeDataset.listBoreholes().forEach((borehole) => {
      const rawPoints = boreholeDataset.getTrajectory(borehole.boreholeId);
      const points = rawPoints.map(geologyPoint);
      const intervals = (boreholeDataset.getIntervals?.(borehole.boreholeId) || [])
        .filter((interval) => Number.isFinite(Number(interval.depthFrom)) && Number.isFinite(Number(interval.depthTo)) && Number(interval.depthTo) > Number(interval.depthFrom))
        .sort((a, b) => Number(a.depthFrom) - Number(b.depthFrom));
      let renderedSegments = 0;
      intervals.forEach((interval, index) => {
        const segment = sliceBoreholePathByMeasure(rawPoints, interval.depthFrom, interval.depthTo);
        const lithology = interval.lithology ?? interval.attributeValue ?? interval.attribute_value ?? interval.rock_type ?? interval.value ?? interval.grade;
        if (this.addBoreholeSegmentTube(segment, this.colorForLithology(lithology, index), borehole, interval)) renderedSegments += 1;
      });
      if (!renderedSegments && points.length >= 2) {
        this.addBoreholeSegmentTube(points, '#66d9ef', borehole, null);
      }
      const collar = this.resolveBoreholeCollar(borehole, rawPoints, points);
      this.addBoreholeCollarCone(collar, borehole);
    });
  }

  resolveBoreholeCollar(borehole = {}, rawPoints = [], renderedPoints = []) {
    const asVector = (value) => {
      if (!value) return null;
      const point = value?.isVector3 ? value.clone() : geologyPoint(value);
      return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) ? point : null;
    };
    const collar = asVector(borehole.collar ?? borehole.position ?? borehole);
    const firstRaw = asVector(rawPoints?.[0]);
    const firstRendered = asVector(renderedPoints?.[0]);
    const first = firstRaw || firstRendered;
    if (collar) {
      const collarLooksDefault = collar.lengthSq() < 1e-8 && first && first.lengthSq() > 1e-8;
      if (!collarLooksDefault) return collar;
    }
    return first || collar || new THREE.Vector3();
  }

  addBoreholeCollarCone(collar, borehole = {}) {
    const coneMaterial = new THREE.MeshLambertMaterial({
      color: '#ef4444',
      side: THREE.DoubleSide,
      transparent: Number(this.params.boreholeOpacity) < 0.98,
      opacity: Number(this.params.boreholeOpacity),
      depthTest: false,
      depthWrite: false
    });
    coneMaterial.userData.alwaysTransparent = true;
    coneMaterial.userData.keepDepthWrite = false;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4.4, 9.5, 18), coneMaterial);
    cone.position.copy(collar).add(new THREE.Vector3(0, 7, 0));
    cone.rotation.x = Math.PI;
    cone.renderOrder = 39;
    cone.userData.geologyPick = {
      type: 'borehole',
      id: borehole.boreholeId,
      boreholeId: borehole.boreholeId,
      label: borehole.boreholeName
    };
    this.pickables.push(cone);
    this.boreholeGroup.add(cone);
  }

  addBoreholeSegmentTube(points = [], color = '#66d9ef', borehole = {}, interval = null) {
    const compact = points
      .map((point) => (point?.isVector3 ? point.clone() : geologyPoint(point)))
      .filter((point, index, list) => index === 0 || point.distanceToSquared(list[index - 1]) > 1e-6);
    if (compact.length < 2) return false;
    const curve = new THREE.CatmullRomCurve3(compact);
    const geometry = new THREE.TubeGeometry(curve, Math.max(2, compact.length * 3), 1.05, 8, false);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.58,
      metalness: 0.02,
      transparent: true,
      opacity: Number(this.params.boreholeOpacity),
      depthTest: false,
      depthWrite: false
    });
    material.userData.alwaysTransparent = true;
    material.userData.keepDepthWrite = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 36;
    mesh.userData.geologyPick = {
      type: 'borehole',
      id: borehole.boreholeId,
      boreholeId: borehole.boreholeId,
      intervalId: interval?.id ?? interval?.intervalId ?? interval?.interval_id,
      lithology: interval?.lithology ?? interval?.attributeValue ?? interval?.attribute_value,
      label: borehole.boreholeName
    };
    this.pickables.push(mesh);
    this.boreholeGroup.add(mesh);
    return true;
  }

  async renderStructureLayer() {
    const structureDataset = this.inputs.geologicalStructure;
    if (!structureDataset) return;
    const structures = structureDataset.listStructures?.() || [];
    const structureByMesh = new Map();
    structures.forEach((structure, index) => {
      [structure.meshPartId, structure.mesh_part_id, structure.structureId, structure.name].filter(Boolean).forEach((key) => {
        structureByMesh.set(String(key), { structure, index });
      });
    });
    const objText = await this.loadObjText(structureDataset);
    if (objText) {
      const object = new OBJLoader().parse(objText);
      let fallbackIndex = 0;
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.computeVertexNormals?.();
        const matched = geometryObjectNames(child).map((name) => structureByMesh.get(name)).find(Boolean);
        const structure = matched?.structure || structures[fallbackIndex] || { structureId: child.name || `GS_${fallbackIndex + 1}`, structureType: 'structure' };
        fallbackIndex += 1;
        child.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(geologyColorForKey(structure.structureType || 'fault', fallbackIndex + 3)),
          transparent: true,
          opacity: Number(this.params.structureOpacity),
          roughness: 0.6,
          metalness: 0.02,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        child.renderOrder = 28;
        child.userData.geologyPick = {
          type: 'geologicalStructure',
          id: structure.structureId,
          structureId: structure.structureId,
          label: structure.structureName
        };
        this.pickables.push(child);
      });
      this.structureGroup.add(object);
    }
  }

  renderAttributeLayer() {
    const dataset = this.inputs.attributeModel;
    if (!dataset) return;
    const active = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || dataset.getPrimaryAttribute?.();
    this.params.activeAttribute = active;
    if (!active) return;
    this.attributeGroup.clear();
    const grid = dataset.grid;
    const binaryKey = this.resolveBinaryAttributeKey(dataset, active);
    const mode = this.getVolumeRenderMode();
    if (grid && binaryKey) {
      if (mode === 'points') this.renderAttributeGridPoints(dataset, active, binaryKey);
      else if (mode !== 'boundary-only') this.renderAttributeVolume(dataset, active, binaryKey);
      return;
    }
    if (mode === 'boundary-only') return;
    const blocks = dataset.listBlocks?.() || [];
    if (mode === 'points') this.renderAttributeElementPoints(dataset, active, blocks);
    else this.renderAttributeElementBoxes(dataset, active, blocks);
  }

  getVolumeRenderMode() {
    const mode = String(this.params.blockRenderMode || 'volume');
    if (mode === 'sampled-boxes' || mode === 'boxes') return 'volume';
    if (mode === 'isosurface' || mode === 'points' || mode === 'boundary-only') return mode;
    return 'volume';
  }

  rerenderAttributeLayer({ updatePanels = true } = {}) {
    this.pickables = this.pickables.filter((object) => {
      let current = object;
      while (current) {
        if (current === this.attributeGroup) return false;
        current = current.parent;
      }
      return true;
    });
    disposeThreeObject(this.attributeGroup);
    this.attributeGroup.clear();
    this.renderAttributeLayer();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updateLegend();
    if (updatePanels) this.updatePanels();
    else this.updateAttributePanel();
  }

  resolveBinaryAttributeKey(dataset, active) {
    const keys = Object.keys(dataset?.binaryAttributes || {});
    if (!keys.length || !active) return null;
    if (dataset.binaryAttributes[active]) return active;
    const schema = (dataset.attributes || []).find((attribute) =>
      [attribute.attributeName, attribute.name, attribute.key].some((value) => String(value ?? '').toLowerCase() === String(active).toLowerCase())
    );
    if (schema) {
      const matched = [schema.key, schema.attributeName, schema.name].find((value) => dataset.binaryAttributes?.[value]);
      if (matched) return matched;
    }
    return keys.find((key) => key.toLowerCase() === String(active).toLowerCase()) || null;
  }

  gridDimensions(grid = {}) {
    return {
      nx: Number(grid.nx ?? grid.width ?? 0),
      ny: Number(grid.ny ?? grid.height ?? 0),
      nz: Number(grid.nz ?? grid.depth ?? 0)
    };
  }

  gridBounds(grid = {}) {
    const origin = grid.origin || grid.bounds?.min || [0, 0, 0];
    const cell = grid.cellSize || [1, 1, 1];
    const { nx, ny, nz } = this.gridDimensions(grid);
    const min = grid.bounds?.min || origin;
    const max =
      grid.bounds?.max ||
      [
        Number(origin[0] || 0) + nx * Number(cell[0] ?? cell ?? 1),
        Number(origin[1] || 0) + ny * Number(cell[1] ?? cell ?? 1),
        Number(origin[2] || 0) + nz * Number(cell[2] ?? cell ?? 1)
      ];
    return {
      min: new THREE.Vector3(Number(min[0]) || 0, Number(min[1]) || 0, Number(min[2]) || 0),
      max: new THREE.Vector3(Number(max[0]) || 0, Number(max[1]) || 0, Number(max[2]) || 0)
    };
  }

  volumeAttributeMeta(dataset, active, values) {
    const schema = (dataset.attributes || []).find((attribute) =>
      [attribute.attributeName, attribute.name, attribute.key].some((value) => String(value ?? '').toLowerCase() === String(active).toLowerCase())
    );
    const range = this.attributeRange(dataset, active, values);
    const name = String(schema?.label ?? schema?.attributeName ?? schema?.name ?? active);
    const valueType = String(schema?.valueType ?? schema?.dtype ?? schema?.type ?? '').toLowerCase();
    const lower = String(active).toLowerCase();
    const isDiscrete = lower.includes('lithology') || lower.includes('category') || lower.includes('class') || lower.endsWith('_id') || valueType.includes('category');
    return {
      name,
      unit: schema?.unit || '',
      min: range.min,
      max: range.max,
      nodata: schema?.nodata ?? schema?.noData,
      isDiscrete
    };
  }

  normalizedVolumeTextureData(values, total, meta) {
    const output = new Uint8Array(total);
    const range = meta.max - meta.min || 1;
    const nodata = meta.nodata == null || meta.nodata === '' ? null : Number(meta.nodata);
    for (let index = 0; index < total; index += 1) {
      const value = Number(values[index]);
      if (!Number.isFinite(value) || (nodata != null && value === nodata)) {
        output[index] = 0;
        continue;
      }
      const normalized = Math.max(0, Math.min(1, (value - meta.min) / range));
      output[index] = Math.round(normalized * 255);
    }
    return output;
  }

  effectiveVolumeOpacity() {
    return Math.max(0, Math.min(1, Number(this.params.attributeModelOpacity) || 0)) * Math.max(0, Math.min(1, Number(this.params.volumeOpacity) || 0));
  }

  renderAttributeVolume(dataset, active, binaryKey = active) {
    const grid = dataset.grid;
    const values = dataset.binaryAttributes?.[binaryKey];
    if (!grid || !values?.length || !THREE.Data3DTexture) {
      this.renderAttributeGridPoints(dataset, active, binaryKey);
      return;
    }
    const { nx, ny, nz } = this.gridDimensions(grid);
    const total = Math.max(0, nx * ny * nz);
    if (!total) return;
    const meta = this.volumeAttributeMeta(dataset, active, values);
    this.activeVolumeMeta = meta;
    const texture = new THREE.Data3DTexture(this.normalizedVolumeTextureData(values, total, meta), nx, ny, nz);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    const vertexShader = /* glsl */ `
      in vec3 position;
      uniform mat4 modelMatrix;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform vec3 cameraPos;
      out vec3 vOrigin;
      out vec3 vDirection;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPos, 1.0)).xyz;
        vDirection = position - vOrigin;
        gl_Position = projectionMatrix * mvPosition;
      }
    `;
    const fragmentShader = /* glsl */ `
      precision highp float;
      precision highp sampler3D;
      in vec3 vOrigin;
      in vec3 vDirection;
      out vec4 color;
      uniform sampler3D map;
      uniform float opacity;
      uniform float steps;
      uniform int uRenderMode;
      uniform float uIsoThreshold;
      uniform float uFilterMin;
      uniform float uFilterMax;
      uniform bool uIsDiscrete;
      uniform vec3 uVolDims;
      uniform vec3 uPickedCoord;
      uniform vec3 uClipMin;
      uniform vec3 uClipMax;

      vec3 discreteColor(float n) {
        float id = floor(n * 255.0 + 0.5);
        if (id < 0.5) return vec3(0.0);
        float r = fract(sin(id * 12.9898) * 43758.5453);
        float g = fract(sin(id * 78.233) * 43758.5453);
        float b = fract(sin(id * 34.123) * 43758.5453);
        return vec3(0.2) + 0.8 * vec3(r, g, b);
      }

      vec3 continuousColor(float t) {
        return vec3(
          smoothstep(0.5, 0.8, t) + smoothstep(0.95, 1.0, t) * 0.5,
          smoothstep(0.1, 0.45, t) - smoothstep(0.8, 1.0, t),
          smoothstep(0.0, 0.2, t) - smoothstep(0.6, 0.9, t)
        );
      }

      vec3 gradientAt(vec3 p) {
        vec3 eps = vec3(1.0) / uVolDims;
        float dx = texture(map, clamp(p + vec3(eps.x, 0.0, 0.0), 0.0, 1.0)).r - texture(map, clamp(p - vec3(eps.x, 0.0, 0.0), 0.0, 1.0)).r;
        float dy = texture(map, clamp(p + vec3(0.0, eps.y, 0.0), 0.0, 1.0)).r - texture(map, clamp(p - vec3(0.0, eps.y, 0.0), 0.0, 1.0)).r;
        float dz = texture(map, clamp(p + vec3(0.0, 0.0, eps.z), 0.0, 1.0)).r - texture(map, clamp(p - vec3(0.0, 0.0, eps.z), 0.0, 1.0)).r;
        return normalize(vec3(dx, dy, dz));
      }

      vec3 litColor(vec3 pos, vec3 normal, vec3 baseColor, vec3 viewDir) {
        vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
        vec3 ambient = 0.32 * baseColor;
        float diff = max(dot(normal, lightDir), 0.0);
        vec3 diffuse = diff * baseColor;
        vec3 reflectDir = reflect(-lightDir, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
        return ambient + diffuse + vec3(0.28) * spec;
      }

      vec2 hitBox(vec3 orig, vec3 dir) {
        const vec3 boxMin = vec3(-0.5);
        const vec3 boxMax = vec3(0.5);
        vec3 invDir = 1.0 / dir;
        vec3 tminTmp = (boxMin - orig) * invDir;
        vec3 tmaxTmp = (boxMax - orig) * invDir;
        vec3 tmin = min(tminTmp, tmaxTmp);
        vec3 tmax = max(tminTmp, tmaxTmp);
        float t0 = max(tmin.x, max(tmin.y, tmin.z));
        float t1 = min(tmax.x, min(tmax.y, tmax.z));
        return vec2(t0, t1);
      }

      void main() {
        vec3 rayDir = normalize(vDirection);
        vec2 bounds = hitBox(vOrigin, rayDir);
        if (bounds.x > bounds.y) discard;
        bounds.x = max(bounds.x, 0.0);
        vec3 p = vOrigin + bounds.x * rayDir;
        vec3 inc = 1.0 / abs(rayDir);
        float delta = min(inc.x, min(inc.y, inc.z)) / steps;
        vec4 ac = vec4(0.0);

        for (float t = bounds.x; t < bounds.y; t += delta) {
          vec3 texCoord = p + 0.5;
          if (any(lessThan(texCoord, uClipMin)) || any(greaterThan(texCoord, uClipMax))) {
            p += rayDir * delta;
            continue;
          }
          float val = texture(map, texCoord).r;

          if (uRenderMode == 1) {
            if (val >= uIsoThreshold && val >= uFilterMin && val <= uFilterMax) {
              vec3 col = uIsDiscrete ? discreteColor(val) : continuousColor(val);
              vec3 normal = gradientAt(texCoord);
              if (length(normal) < 0.1) normal = -rayDir;
              vec3 shaded = litColor(p, normal, col, -rayDir);
              color = vec4(shaded, 1.0);
              ivec3 currentIdx = ivec3(floor(texCoord * uVolDims));
              if (currentIdx == ivec3(uPickedCoord)) color.rgb = vec3(1.0);
              return;
            }
          } else {
            if (val >= uFilterMin && val <= uFilterMax) {
              vec3 col = uIsDiscrete ? discreteColor(val) : continuousColor(val);
              ivec3 currentIdx = ivec3(floor(texCoord * uVolDims));
              float localAlpha = opacity;
              if (currentIdx == ivec3(uPickedCoord)) {
                col = vec3(1.0);
                localAlpha = 1.0;
              } else if (uPickedCoord.x >= 0.0) {
                localAlpha *= 0.15;
                col *= 0.5;
              }
              ac.rgb += (1.0 - ac.a) * localAlpha * col;
              ac.a += (1.0 - ac.a) * localAlpha;
              if (ac.a >= 0.98) break;
            }
          }
          p += rayDir * delta;
        }
        color = ac;
        if (color.a <= 0.001) discard;
      }
    `;

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        map: { value: texture },
        cameraPos: { value: new THREE.Vector3() },
        uRenderMode: { value: this.getVolumeRenderMode() === 'isosurface' ? 1 : 0 },
        uIsoThreshold: { value: Number.isFinite(Number(this.params.volumeIsoValue)) ? Number(this.params.volumeIsoValue) : 0.5 },
        uFilterMin: { value: Number.isFinite(Number(this.params.volumeFilterMin)) ? Number(this.params.volumeFilterMin) : 0.0 },
        uFilterMax: { value: Number.isFinite(Number(this.params.volumeFilterMax)) ? Number(this.params.volumeFilterMax) : 1.0 },
        opacity: { value: this.effectiveVolumeOpacity() },
        steps: { value: Number(this.params.volumeRaySteps) || Math.max(96, Math.min(320, Math.max(nx, ny, nz) * 3)) },
        uIsDiscrete: { value: !!meta.isDiscrete },
        uVolDims: { value: new THREE.Vector3(nx, ny, nz) },
        uPickedCoord: { value: new THREE.Vector3(-1, -1, -1) },
        uClipMin: {
          value: new THREE.Vector3(
            Number.isFinite(Number(this.params.volumeClipXMin)) ? Number(this.params.volumeClipXMin) : 0,
            Number.isFinite(Number(this.params.volumeClipYMin)) ? Number(this.params.volumeClipYMin) : 0,
            Number.isFinite(Number(this.params.volumeClipZMin)) ? Number(this.params.volumeClipZMin) : 0
          )
        },
        uClipMax: {
          value: new THREE.Vector3(
            Number.isFinite(Number(this.params.volumeClipXMax)) ? Number(this.params.volumeClipXMax) : 1,
            Number.isFinite(Number(this.params.volumeClipYMax)) ? Number(this.params.volumeClipYMax) : 1,
            Number.isFinite(Number(this.params.volumeClipZMax)) ? Number(this.params.volumeClipZMax) : 1
          )
        }
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });
    material.userData.volumeOpacity = Number.isFinite(Number(this.params.volumeOpacity)) ? Number(this.params.volumeOpacity) : 0.5;
    material.userData.keepDepthWrite = false;

    const bounds = this.gridBounds(grid);
    const size = bounds.max.clone().sub(bounds.min);
    const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      material.uniforms.cameraPos.value.copy(camera.position);
    };
    mesh.name = `geological-volume:${active}`;
    mesh.scale.copy(size);
    mesh.position.copy(center);
    mesh.renderOrder = 18;
    mesh.userData.geologyPick = {
      type: 'geologicalVolume',
      id: `volume:${active}`,
      label: active,
      activeAttribute: active,
      centroid: { x: center.x, y: center.y, z: center.z },
      size: { x: size.x, y: size.y, z: size.z },
      value: `${formatScalar(meta.min)} - ${formatScalar(meta.max)}${meta.unit ? ` ${meta.unit}` : ''}`,
      volumeData: { grid, values, meta, active, nx, ny, nz }
    };
    this.pickables.push(mesh);
    this.attributeGroup.add(mesh);
    this.updateVolumeUniforms();
  }

  renderAttributeGridPoints(dataset, active, binaryKey = active) {
    const grid = dataset.grid;
    const values = dataset.binaryAttributes?.[binaryKey];
    if (!grid || !values?.length) return;
    const nx = Number(grid.nx ?? grid.width ?? 0);
    const ny = Number(grid.ny ?? grid.height ?? 0);
    const nz = Number(grid.nz ?? grid.depth ?? 0);
    const total = Math.max(0, nx * ny * nz);
    const origin = grid.origin || grid.bounds?.min || [0, 0, 0];
    const cell = grid.cellSize || [1, 1, 1];
    const range = this.attributeRange(dataset, active, values);
    const positions = [];
    const colors = [];
    const elements = [];
    for (let index = 0; index < total; index += 1) {
      const value = Number(values[index]);
      if (!Number.isFinite(value)) continue;
      const ix = index % nx;
      const iy = Math.floor(index / nx) % ny;
      const iz = Math.floor(index / (nx * ny));
      const x = Number(origin[0] || 0) + (ix + 0.5) * Number(cell[0] ?? cell ?? 1);
      const y = Number(origin[1] || 0) + (iy + 0.5) * Number(cell[1] ?? cell ?? 1);
      const z = Number(origin[2] || 0) + (iz + 0.5) * Number(cell[2] ?? cell ?? 1);
      positions.push(x, y, z);
      const color = new THREE.Color(sampleColor('viridis', (value - range.min) / (range.max - range.min || 1)));
      colors.push(color.r, color.g, color.b);
      elements.push({ elementId: `VOX_${ix}_${iy}_${iz}`, value, centroid: { x, y, z }, gridIndex: [ix, iy, iz] });
    }
    this.addAttributePoints(positions, colors, elements, Math.max(3, Math.min(14, Number(cell[0] ?? cell ?? 1) * 0.18)));
  }

  renderAttributeElementPoints(dataset, active, elements = []) {
    const valid = elements.filter((element) => element?.centroid);
    const values = valid.map((element) => Number(dataset.getValue?.(element.elementId, active)));
    const range = geologyNumericRange(values);
    const positions = [];
    const colors = [];
    valid.forEach((element, index) => {
      const center = geologyPoint(element.centroid);
      const value = Number(dataset.getValue?.(element.elementId, active));
      positions.push(center.x, center.y, center.z);
      const color = new THREE.Color(Number.isFinite(value) ? sampleColor('viridis', (value - range.min) / (range.max - range.min || 1)) : GEOLOGY_PALETTE[index % GEOLOGY_PALETTE.length]);
      colors.push(color.r, color.g, color.b);
    });
    this.addAttributePoints(positions, colors, valid, 5);
  }

  renderAttributeElementBoxes(dataset, active, elements = []) {
    const valid = elements.filter((element) => element?.centroid);
    if (!valid.length) return;
    const values = valid.map((element) => Number(dataset.getValue?.(element.elementId, active)));
    const range = geologyNumericRange(values);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: Number(this.params.attributeModelOpacity),
      roughness: 0.64,
      metalness: 0.02,
      depthWrite: false
    });
    const mesh = new THREE.InstancedMesh(geometry, material, valid.length);
    mesh.renderOrder = 18;
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();
    valid.forEach((element, index) => {
      const center = geologyPoint(element.centroid);
      const size = element.size || {};
      transform.compose(center, new THREE.Quaternion(), new THREE.Vector3(Number(size.x) || 8, Number(size.y) || 8, Number(size.z) || 8));
      mesh.setMatrixAt(index, transform);
      const value = Number(dataset.getValue?.(element.elementId, active));
      color.set(Number.isFinite(value) ? sampleColor('viridis', (value - range.min) / (range.max - range.min || 1)) : GEOLOGY_PALETTE[index % GEOLOGY_PALETTE.length]);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.geologyPick = { type: 'geologicalBlockCollection', id: 'attribute-blocks', elements: valid, activeAttribute: active };
    this.pickables.push(mesh);
    this.attributeGroup.add(mesh);
  }

  addAttributePoints(positions, colors, elements, size = 5) {
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: Number(this.params.volumePointSize) || size,
      vertexColors: true,
      transparent: true,
      opacity: Number(this.params.attributeModelOpacity),
      sizeAttenuation: true,
      depthTest: false
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 18;
    points.userData.geologyPick = { type: 'geologicalBlockCollection', id: 'attribute-points', elements, activeAttribute: this.params.activeAttribute };
    this.pickables.push(points);
    this.attributeGroup.add(points);
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlContainer = container;
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const activeAttribute = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.() || '';
    const mode = this.getVolumeRenderMode();
    container.innerHTML = `
      <div class="panel-title">${escapeHtml(this.label)}</div>
      <div class="geology-quick-note">Quick controls. Use Geological Model Panel for object lists and detailed volume rendering parameters.</div>
      <div class="geology-quick-toggles">
        ${this.layerToggle('showGeologicalBody', 'Body')}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute') : ''}
        ${this.inputs.roadway ? this.layerToggle('showRoadway', 'Roadway') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
      </div>
      <div class="control-grid geology-quick-fields">
        <label class="field-row">Color mode
          <select data-color-mode>
            ${['geological-unit', 'lithology', 'attribute', 'uniform']
              .map((mode) => `<option value="${mode}" ${this.params.colorMode === mode ? 'selected' : ''}>${mode}</option>`)
              .join('')}
          </select>
        </label>
        ${
          this.inputs.attributeModel
            ? `<label class="field-row">Active attribute
                <select data-active-attribute>${attributes
                  .map((attribute) => `<option value="${escapeHtml(attribute)}" ${String(activeAttribute) === String(attribute) ? 'selected' : ''}>${escapeHtml(attribute)}</option>`)
                  .join('')}</select>
              </label>`
            : ''
        }
        ${
          this.inputs.attributeModel
            ? `<label class="field-row">Render mode
                <select data-volume-setting="blockRenderMode">
                  ${['volume', 'isosurface', 'points']
                    .map((value) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${value === 'volume' ? 'Volumetric' : value === 'isosurface' ? 'Isosurface' : 'Points'}</option>`)
                    .join('')}
                </select>
              </label>`
            : ''
        }
      </div>
      <div class="geology-quick-actions">
        <button type="button" data-focus-geology-model>Focus model</button>
        ${this.inputs.attributeModel ? '<button type="button" data-volume-reset>Reset volume</button>' : ''}
      </div>
    `;
    const onChange = (event) => this.handlePanelChange(event);
    const onClick = (event) => this.handlePanelClick(event);
    const onInput = (event) => {
      const target = event.target;
      if (target?.matches?.('input[data-volume-setting], input[data-opacity]')) this.handlePanelChange(event);
    };
    container.addEventListener('change', onChange);
    container.addEventListener('click', onClick);
    container.addEventListener('input', onInput);
    this.controlDisposers.push(() => container.removeEventListener('change', onChange));
    this.controlDisposers.push(() => container.removeEventListener('click', onClick));
    this.controlDisposers.push(() => container.removeEventListener('input', onInput));
  }

  updateVolumeUniforms() {
    const mode = this.getVolumeRenderMode();
    const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    this.attributeGroup?.traverse?.((child) => {
      const material = child.material;
      if (material?.uniforms?.map) {
        material.userData.volumeOpacity = numberOr(this.params.volumeOpacity, 0.5);
        material.uniforms.uRenderMode.value = mode === 'isosurface' ? 1 : 0;
        material.uniforms.uIsoThreshold.value = numberOr(this.params.volumeIsoValue, 0.5);
        material.uniforms.uFilterMin.value = numberOr(this.params.volumeFilterMin, 0);
        material.uniforms.uFilterMax.value = numberOr(this.params.volumeFilterMax, 1);
        material.uniforms.opacity.value = this.effectiveVolumeOpacity();
        material.uniforms.steps.value = Number(this.params.volumeRaySteps) || 200;
        material.uniforms.uClipMin.value.set(
          numberOr(this.params.volumeClipXMin, 0),
          numberOr(this.params.volumeClipYMin, 0),
          numberOr(this.params.volumeClipZMin, 0)
        );
        material.uniforms.uClipMax.value.set(
          numberOr(this.params.volumeClipXMax, 1),
          numberOr(this.params.volumeClipYMax, 1),
          numberOr(this.params.volumeClipZMax, 1)
        );
        material.needsUpdate = true;
      }
      if (child.isPoints && child.material) {
        child.material.size = Number(this.params.volumePointSize) || child.material.size;
        child.material.needsUpdate = true;
      }
    });
  }

  attributeRange(dataset, active, fallbackValues = []) {
    const schema = (dataset.attributes || []).find((attribute) =>
      [attribute.attributeName, attribute.name, attribute.key].some((value) => String(value ?? '').toLowerCase() === String(active).toLowerCase())
    );
    if (Number.isFinite(Number(schema?.min)) && Number.isFinite(Number(schema?.max))) return { min: Number(schema.min), max: Number(schema.max) };
    return geologyNumericRange(Array.from(fallbackValues || []));
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Geological Model Panel', 'geological-layer-panel', '<div class="geology-layer-content"></div>');
    this.legendPanel = createWorkspacePanel('Geological Legend', 'geological-legend-panel', '<div class="geology-legend-content"></div>');
    this.detailPanel = createWorkspacePanel('Selected Geological Object Detail', 'geological-detail-panel', '<div class="geology-detail-content"></div>');
    this.attributePanel = createWorkspacePanel('Attribute Summary', 'geological-attribute-panel', '<div class="geology-attribute-content"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '420px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '520px', width: '260px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '92px', width: '310px' });
    Object.assign(this.attributePanel.style, { right: '330px', top: '430px', width: '310px' });
    if (!this.inputs.attributeModel) this.attributePanel.style.display = 'none';
  }

  registerVisualContributions() {
    this.applyLayerState();
    this.registerSceneContribution('geological-body-layer', 'Geological Body Layer', this.bodyGroup, 'geologicalBody', 'structure', this.params.geologicalBodyOpacity);
    if (this.inputs.roadway) {
      this.contributionRegistry.register({
        id: `${this.id}:roadway-context-layer`,
        label: 'Roadway Context Layer',
        ownerId: this.id,
        functionId: this.functionId,
        type: 'scene-layer',
        host: 'main-3d-scene',
        contributionKind: 'layer',
        semanticRole: 'context',
        objectSystem: 'roadway',
        visualChannels: { opacity: 'contextOpacity' },
        composition: { mergePolicy: 'reuse', focusBehavior: 'context', defaultOpacity: this.params.roadwayOpacity, canPin: true },
        visible: this.params.showRoadway,
        opacity: this.params.roadwayOpacity,
        show: () => this.sceneManager.setRoadwayVisible?.(true),
        hide: () => this.sceneManager.setRoadwayVisible?.(false),
        setOpacity: (value) => {
          this.params.roadwayOpacity = Number(value);
          this.sceneManager.setRoadwayOpacity?.(Number(value));
        },
        focus: () => this.sceneManager.focusOnRoadway?.()
      });
    }
    if (this.inputs.borehole) this.registerSceneContribution('borehole-layer', 'Borehole Layer', this.boreholeGroup, 'borehole', 'structure', this.params.boreholeOpacity);
    if (this.inputs.geologicalStructure) {
      this.registerSceneContribution('geological-structure-layer', 'Geological Structure Layer', this.structureGroup, 'geologicalStructure', 'structure', this.params.structureOpacity, {
        visualChannels: { color: 'structureType', opacity: 'confidence' },
        composition: { mergePolicy: 'compose', focusBehavior: 'annotation', defaultOpacity: this.params.structureOpacity, canPin: true }
      });
    }
    if (this.inputs.attributeModel) {
      this.registerSceneContribution('geological-attribute-layer', 'Geological Attribute Layer', this.attributeGroup, 'geologicalAttributeModel', 'state', this.params.attributeModelOpacity, {
        visualChannels: { color: 'activeGeologicalAttribute' }
      });
    }
    [
      ['layer-panel', 'Geological Model Panel', this.layerPanel, 'panel', 'control'],
      ['legend', 'Geological Legend', this.legendPanel, 'legend', 'legend'],
      ['detail-panel', 'Selected Geological Object Detail', this.detailPanel, 'panel', 'detail'],
      ['attribute-summary', 'Attribute Summary', this.attributePanel, 'panel', 'detail']
    ].forEach(([suffix, label, panel, type, semanticRole]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        host: type === 'legend' ? 'legend' : 'right-panel',
        contributionKind: type,
        semanticRole,
        objectSystem: 'geologicalModel',
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  registerSceneContribution(suffix, label, group, objectSystem, semanticRole, opacity, overrides = {}) {
    this.contributionRegistry.register({
      id: `${this.id}:${suffix}`,
      label,
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      contributionKind: 'layer',
      semanticRole,
      objectSystem,
      visualChannels: { color: 'geologicalUnit', opacity: 'layerOpacity', ...(overrides.visualChannels || {}) },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: opacity, canPin: true, ...(overrides.composition || {}) },
      visible: group.visible,
      opacity,
      show: () => (group.visible = true),
      hide: () => (group.visible = false),
      setOpacity: (value) => {
        setGroupOpacity(group, value);
        if (suffix.includes('body')) this.params.geologicalBodyOpacity = Number(value);
        if (suffix.includes('borehole')) this.params.boreholeOpacity = Number(value);
        if (suffix.includes('structure')) this.params.structureOpacity = Number(value);
        if (suffix.includes('attribute')) this.params.attributeModelOpacity = Number(value);
      },
      focus: () => this.sceneManager.focusOnObject?.(group),
      cleanup: () => {
        group.visible = false;
      }
    });
  }

  installHandlers() {
    this.disposers.push(this.context.subscribe('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context.subscribe('activeGeologicalAttribute', (attribute) => {
      this.params.activeAttribute = attribute;
      this.rerenderAttributeLayer();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
    }));
    this.layerPanel.addEventListener('change', (event) => this.handlePanelChange(event));
    this.layerPanel.addEventListener('click', (event) => this.handlePanelClick(event));
    this.layerPanel.addEventListener('input', (event) => {
      const target = event.target;
      if (target?.matches?.('input[data-volume-setting], input[data-opacity]')) this.handlePanelChange(event);
    });
  }

  handlePanelChange(event) {
    const target = event.target;
    if (target.matches('[data-toggle-layer]')) {
      this.params[target.dataset.toggleLayer] = target.checked;
      this.applyLayerState();
      this.updateLegend();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    if (target.matches('[data-opacity]')) {
      const value = this.readBoundedNumber(target, 0);
      this.params[target.dataset.opacity] = value;
      if (target.dataset.opacity === 'geologicalBodyOpacity') setGroupOpacity(this.bodyGroup, value);
      if (target.dataset.opacity === 'boreholeOpacity') setGroupOpacity(this.boreholeGroup, value);
      if (target.dataset.opacity === 'structureOpacity') setGroupOpacity(this.structureGroup, value);
      if (target.dataset.opacity === 'attributeModelOpacity') setGroupOpacity(this.attributeGroup, value);
      if (target.dataset.opacity === 'roadwayOpacity') this.sceneManager.setRoadwayOpacity?.(value);
      this.syncGeologyControls();
      return;
    }
    if (target.matches('[data-volume-setting]')) {
      const key = target.dataset.volumeSetting;
      const previousMode = this.getVolumeRenderMode();
      this.params[key] = target.type === 'number' || target.type === 'range' ? this.readBoundedNumber(target, this.params[key]) : target.value;
      this.normalizeVolumeSettings(key);
      const nextMode = this.getVolumeRenderMode();
      if (key === 'blockRenderMode' && previousMode !== nextMode) {
        this.rerenderAttributeLayer();
        this.updatePanels();
        if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      }
      else {
        this.updateVolumeUniforms();
        this.syncGeologyControls();
        this.updateAttributePanel();
        this.updateLegend();
      }
      return;
    }
    if (target.matches('[data-color-mode]')) {
      this.params.colorMode = target.value;
      this.recolorBodyLayer();
      this.updateLegend();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    if (target.matches('[data-active-attribute]')) {
      this.context.set('activeGeologicalAttribute', target.value);
    }
  }

  handlePanelClick(event) {
    if (event.target.closest('[data-focus-geology-model]')) {
      const target = this.attributeGroup?.visible && this.attributeGroup.children.length ? this.attributeGroup : this.bodyGroup;
      this.sceneManager.focusOnObject?.(target);
      return;
    }
    if (event.target.closest('[data-volume-reset]')) {
      Object.assign(this.params, {
        blockRenderMode: 'volume',
        volumeIsoValue: 0.5,
        volumeFilterMin: 0,
        volumeFilterMax: 1,
        volumeClipXMin: 0,
        volumeClipXMax: 1,
        volumeClipYMin: 0,
        volumeClipYMax: 1,
        volumeClipZMin: 0,
        volumeClipZMax: 1,
        volumeOpacity: 0.5,
        volumeRaySteps: 200,
        volumePointSize: 7
      });
      this.rerenderAttributeLayer();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    const row = event.target.closest('[data-select-type]');
    if (!row) return;
    this.setSelection(row.dataset.selectType, row.dataset.selectId);
  }

  readBoundedNumber(target, fallback = 0) {
    const raw = Number(target.value);
    const min = Number(target.min);
    const max = Number(target.max);
    let value = Number.isFinite(raw) ? raw : Number(fallback) || 0;
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);
    return value;
  }

  normalizeVolumeSettings(changedKey = null) {
    const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : fallback));
    [
      ['volumeIsoValue', 0.5],
      ['volumeFilterMin', 0],
      ['volumeFilterMax', 1],
      ['volumeClipXMin', 0],
      ['volumeClipXMax', 1],
      ['volumeClipYMin', 0],
      ['volumeClipYMax', 1],
      ['volumeClipZMin', 0],
      ['volumeClipZMax', 1],
      ['volumeOpacity', 0.5]
    ].forEach(([key, fallback]) => {
      this.params[key] = clamp01(this.params[key], fallback);
    });
    [['volumeFilterMin', 'volumeFilterMax'], ['volumeClipXMin', 'volumeClipXMax'], ['volumeClipYMin', 'volumeClipYMax'], ['volumeClipZMin', 'volumeClipZMax']].forEach(([minKey, maxKey]) => {
      if (Number(this.params[minKey]) > Number(this.params[maxKey])) {
        if (changedKey === minKey) this.params[minKey] = this.params[maxKey];
        else if (changedKey === maxKey) this.params[maxKey] = this.params[minKey];
        else {
          const temp = this.params[minKey];
          this.params[minKey] = this.params[maxKey];
          this.params[maxKey] = temp;
        }
      }
    });
    this.params.volumeRaySteps = Math.max(50, Math.min(500, Math.round(Number(this.params.volumeRaySteps) || 200)));
    this.params.volumePointSize = Math.max(1, Math.min(32, Number(this.params.volumePointSize) || 7));
  }

  syncGeologyControls() {
    const roots = [this.layerPanel, this.controlContainer].filter((root) => root?.isConnected);
    const sync = (selector, value, digits = 2) => {
      roots.forEach((root) => {
        root.querySelectorAll(selector).forEach((input) => {
          const numeric = Number(value);
          if (input === document.activeElement && input.type === 'range') return;
          input.value = Number.isFinite(numeric) ? numeric.toFixed(digits).replace(/\.?0+$/, '') : String(value ?? '');
        });
      });
    };
    ['geologicalBodyOpacity', 'roadwayOpacity', 'boreholeOpacity', 'structureOpacity', 'attributeModelOpacity'].forEach((key) => {
      if (key in this.params) sync(`[data-opacity="${key}"]`, this.params[key], 2);
    });
    [
      ['volumeIsoValue', 2],
      ['volumeFilterMin', 2],
      ['volumeFilterMax', 2],
      ['volumeClipXMin', 2],
      ['volumeClipXMax', 2],
      ['volumeClipYMin', 2],
      ['volumeClipYMax', 2],
      ['volumeClipZMin', 2],
      ['volumeClipZMax', 2],
      ['volumeOpacity', 2],
      ['volumeRaySteps', 0],
      ['volumePointSize', 0]
    ].forEach(([key, digits]) => {
      if (key in this.params) sync(`[data-volume-setting="${key}"]`, this.params[key], digits);
    });
    roots.forEach((root) => {
      root.querySelectorAll('[data-volume-pair]').forEach((row) => {
        const [minKey, maxKey] = String(row.dataset.volumePair || '').split(':');
        const min = Number(this.params[minKey]);
        const max = Number(this.params[maxKey]);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return;
        row.style.setProperty('--min-pct', `${min * 100}%`);
        row.style.setProperty('--max-pct', `${max * 100}%`);
      });
    });
  }

  applyLayerState() {
    this.bodyGroup.visible = !!this.params.showGeologicalBody;
    this.boreholeGroup.visible = !!this.params.showBoreholes;
    this.structureGroup.visible = !!this.params.showStructures;
    this.attributeGroup.visible = !!this.params.showAttributeModel;
    this.sceneManager?.setRoadwayVisible?.(!!this.params.showRoadway && !!this.inputs.roadway);
  }

  recolorBodyLayer() {
    const surfaces = this.inputs.geologicalBody?.listSurfaces?.() || [];
    const byId = new Map(surfaces.map((surface, index) => [String(surface.surfaceId), { surface, index }]));
    this.bodyGroup.traverse((child) => {
      if (!child.isMesh || !child.userData?.geologyPick?.surfaceId) return;
      const entry = byId.get(String(child.userData.geologyPick.surfaceId));
      if (!entry) return;
      child.material.color.copy(this.geologicalDisplayColor(this.colorForSurface(entry.surface, entry.index)));
    });
  }

  updatePanels() {
    const body = this.inputs.geologicalBody;
    const bodySummary = body.getSummary?.() || {};
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const units = body.listUnits?.() || [];
    const surfaces = body.listSurfaces?.() || [];
    const structures = this.inputs.geologicalStructure?.listStructures?.() || [];
    const boreholes = this.inputs.borehole?.listBoreholes?.() || [];
    const profile = body.getRepresentationProfile?.() || body.representationProfile || 'generic';
    const activeAttribute = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.() || '';
    this.layerPanel.querySelector('.geology-layer-content').innerHTML = `
      <div class="geology-panel-summary">
        <span>${escapeHtml(profile)}</span><span>${bodySummary.unitCount || 0} units</span><span>${bodySummary.surfaceCount || 0} surfaces</span><span>${bodySummary.blockCount || 0} blocks</span>
      </div>
      <div class="control-grid geology-controls">
        ${this.layerToggle('showGeologicalBody', 'Geological body')}
        ${this.inputs.roadway ? this.layerToggle('showRoadway', 'Roadway context') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute model') : ''}
      </div>
      <div class="geology-control-stack">
        ${this.opacityRow('geologicalBodyOpacity', 'Body opacity')}
        ${this.inputs.roadway ? this.opacityRow('roadwayOpacity', 'Roadway opacity') : ''}
        ${this.inputs.borehole ? this.opacityRow('boreholeOpacity', 'Borehole opacity') : ''}
        ${this.inputs.geologicalStructure ? this.opacityRow('structureOpacity', 'Structure opacity') : ''}
        ${this.inputs.attributeModel ? this.opacityRow('attributeModelOpacity', 'Attribute opacity') : ''}
      </div>
      <label class="field-row">Color mode
        <select data-color-mode>
          ${['geological-unit', 'lithology', 'attribute', 'uniform']
            .map((mode) => `<option value="${mode}" ${this.params.colorMode === mode ? 'selected' : ''}>${mode}</option>`)
            .join('')}
        </select>
      </label>
      ${
        this.inputs.attributeModel
          ? `<label class="field-row">Active attribute
              <select data-active-attribute>${attributes
                .map((attribute) => `<option value="${escapeHtml(attribute)}" ${String(activeAttribute) === String(attribute) ? 'selected' : ''}>${escapeHtml(attribute)}</option>`)
                .join('')}</select>
            </label>`
          : ''
      }
      ${this.inputs.attributeModel ? this.volumeControlsHtml() : ''}
      <div class="geology-object-section">
        <strong>Geological Units</strong>
        <div class="geology-object-list">${units
          .slice(0, 40)
          .map((unit) => `<button data-select-type="geologicalUnit" data-select-id="${escapeHtml(unit.geologicalUnitId)}"><span>${escapeHtml(unit.geologicalUnitName)}</span><small>${escapeHtml(unit.geologicalUnitType)}</small></button>`)
          .join('') || '<div class="muted-note">No units</div>'}</div>
      </div>
      <div class="geology-object-section">
        <strong>Surfaces</strong>
        <div class="geology-object-list compact">${surfaces
          .slice(0, 24)
          .map((surface) => `<button data-select-type="geologicalSurface" data-select-id="${escapeHtml(surface.surfaceId)}"><span>${escapeHtml(surface.surfaceId)}</span><small>${escapeHtml(surface.surfaceType)}</small></button>`)
          .join('') || '<div class="muted-note">No surfaces</div>'}</div>
      </div>
      ${
        boreholes.length
          ? `<div class="geology-object-section"><strong>Boreholes</strong><div class="geology-object-list compact">${boreholes
              .slice(0, 28)
              .map((item) => `<button data-select-type="borehole" data-select-id="${escapeHtml(item.boreholeId)}"><span>${escapeHtml(item.boreholeId)}</span><small>${escapeHtml(item.boreholeName)}</small></button>`)
              .join('')}</div></div>`
          : ''
      }
      ${
        structures.length
          ? `<div class="geology-object-section"><strong>Structures</strong><div class="geology-object-list compact">${structures
              .slice(0, 28)
              .map((item) => `<button data-select-type="geologicalStructure" data-select-id="${escapeHtml(item.structureId)}"><span>${escapeHtml(item.structureId)}</span><small>${escapeHtml(item.structureType)}</small></button>`)
              .join('')}</div></div>`
          : ''
      }
    `;
    this.updateAttributePanel();
  }

  layerToggle(key, label) {
    return `<label class="checkbox-row"><span>${label}</span><input data-toggle-layer="${key}" type="checkbox" ${this.params[key] ? 'checked' : ''}></label>`;
  }

  opacityRow(key, label) {
    return this.compactSliderRow({ key, label, min: 0, max: 1, step: 0.05, digits: 2, dataAttr: 'data-opacity' });
  }

  volumeControlsHtml() {
    const grid = this.inputs.attributeModel?.grid;
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    const hasVolume = !!(grid && this.resolveBinaryAttributeKey(this.inputs.attributeModel, active));
    if (!hasVolume) {
      return '<div class="geology-volume-controls"><div class="muted-note">Volume controls are available for grid-backed resource block models.</div></div>';
    }
    const mode = this.getVolumeRenderMode();
    return `
      <div class="geology-volume-controls">
        <div class="geology-volume-header">
          <strong>Attribute Volume Rendering</strong>
          <button type="button" data-volume-reset>Reset</button>
        </div>
        <label class="field-row">Render mode
          <select data-volume-setting="blockRenderMode">
            ${['volume', 'isosurface', 'points']
              .map((value) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${value === 'volume' ? 'Volumetric' : value === 'isosurface' ? 'Isosurface' : 'Points'}</option>`)
              .join('')}
          </select>
        </label>
        ${
          mode === 'points'
            ? `${this.volumeSliderRow('volumePointSize', 'Point size', 1, 32, 1, 0)}`
            : `
              <div class="geology-volume-stack">
                ${this.volumePairRow('volumeFilterMin', 'volumeFilterMax', 'Volume filtering')}
                ${mode === 'isosurface' ? this.volumeSliderRow('volumeIsoValue', 'Isosurface value', 0, 1, 0.01, 2) : ''}
                ${this.volumeSliderRow('volumeOpacity', 'Opacity', 0, 1, 0.01, 2)}
              </div>
              <div class="geology-volume-section-title">Spatial slicing</div>
              <div class="geology-volume-stack">
                ${this.volumePairRow('volumeClipXMin', 'volumeClipXMax', 'X range')}
                ${this.volumePairRow('volumeClipYMin', 'volumeClipYMax', 'Y range')}
                ${this.volumePairRow('volumeClipZMin', 'volumeClipZMax', 'Z range')}
                ${mode === 'volume' ? this.volumeSliderRow('volumeRaySteps', 'Ray steps', 50, 500, 10, 0) : ''}
              </div>
            `
        }
      </div>
    `;
  }

  volumeSliderRow(key, label, min = 0, max = 1, step = 0.01, digits = 2) {
    return this.compactSliderRow({ key, label, min, max, step, digits, dataAttr: 'data-volume-setting' });
  }

  compactSliderRow({ key, label, min, max, step, digits = 2, dataAttr = 'data-volume-setting', valueOverride = null }) {
    const sourceValue = valueOverride ?? this.params[key];
    const value = Number.isFinite(Number(sourceValue)) ? Number(sourceValue) : Number(min) || 0;
    const display = value.toFixed(digits).replace(/\.?0+$/, '');
    return `
      <label class="geology-slider-row">
        <span class="geology-slider-label">${escapeHtml(label)}</span>
        <input class="geology-slider" ${dataAttr}="${escapeHtml(key)}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        <input class="geology-value-input" ${dataAttr}="${escapeHtml(key)}" type="number" min="${min}" max="${max}" step="${step}" value="${display}" inputmode="decimal">
      </label>
    `;
  }

  volumePairRow(minKey, maxKey, label) {
    const minValue = Math.max(0, Math.min(1, Number(this.params[minKey]) || 0));
    const maxValue = Math.max(0, Math.min(1, Number(this.params[maxKey]) || 0));
    return `
      <div class="geology-range-pair" data-volume-pair="${escapeHtml(minKey)}:${escapeHtml(maxKey)}" style="--min-pct:${minValue * 100}%; --max-pct:${maxValue * 100}%">
        <span class="geology-slider-label">${escapeHtml(label)}</span>
        <div class="geology-dual-slider">
          <input class="geology-slider-min" data-volume-setting="${escapeHtml(minKey)}" type="range" min="0" max="1" step="0.01" value="${minValue}">
          <input class="geology-slider-max" data-volume-setting="${escapeHtml(maxKey)}" type="range" min="0" max="1" step="0.01" value="${maxValue}">
        </div>
        <div class="geology-range-values">
          <input class="geology-value-input" data-volume-setting="${escapeHtml(minKey)}" type="number" min="0" max="1" step="0.01" value="${formatScalar(minValue, 2)}" inputmode="decimal" title="${escapeHtml(label)} min" aria-label="${escapeHtml(label)} min">
          <input class="geology-value-input" data-volume-setting="${escapeHtml(maxKey)}" type="number" min="0" max="1" step="0.01" value="${formatScalar(maxValue, 2)}" inputmode="decimal" title="${escapeHtml(label)} max" aria-label="${escapeHtml(label)} max">
        </div>
      </div>
    `;
  }

  updateLegend() {
    const body = this.inputs.geologicalBody;
    const units = body?.listUnits?.() || [];
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    const binaryKey = this.resolveBinaryAttributeKey(this.inputs.attributeModel, active);
    const volumeMeta = binaryKey ? this.volumeAttributeMeta(this.inputs.attributeModel, active, this.inputs.attributeModel.binaryAttributes?.[binaryKey]) : null;
    const rows =
      (this.params.colorMode === 'attribute' || this.params.showAttributeModel) && this.inputs.attributeModel && active
        ? `<div class="geology-gradient"><span>${escapeHtml(volumeMeta?.name || active)}</span><div style="background:${
            volumeMeta?.isDiscrete
              ? 'linear-gradient(90deg,#2b8cff,#2dd4bf,#a3e635,#facc15,#fb7185,#c084fc)'
              : 'linear-gradient(90deg,#0a5bff,#00a9ff,#35d35d,#f4df38,#f97316,#ef4444)'
          }"></div><small>${volumeMeta ? `${formatScalar(volumeMeta.min)} - ${formatScalar(volumeMeta.max)}${volumeMeta.unit ? ` ${escapeHtml(volumeMeta.unit)}` : ''}` : ''}</small></div>`
        : units
            .slice(0, 12)
            .map((unit, index) => `<div><span class="legend-dot" style="background:${escapeHtml(unit.color || geologyColorForKey(unit.geologicalUnitType ?? unit.geologicalUnitId, index))}"></span>${escapeHtml(unit.geologicalUnitName)}</div>`)
            .join('');
    this.legendPanel.querySelector('.geology-legend-content').innerHTML = `
      <div class="route-legend-list">${rows || '<div class="muted-note">No legend entries</div>'}</div>
      <div class="geology-symbols">
        ${this.inputs.borehole ? '<div><span class="legend-dot" style="background:#66d9ef"></span>Borehole trajectory</div>' : ''}
        ${this.inputs.geologicalStructure ? '<div><span class="legend-dot" style="background:#ff6f61"></span>Structure / fault</div>' : ''}
        ${this.inputs.roadway ? '<div><span class="legend-dot" style="background:#8f9398"></span>Roadway context</div>' : ''}
      </div>
    `;
  }

  updateAttributePanel() {
    if (!this.inputs.attributeModel || !this.attributePanel) return;
    const active = this.params.activeAttribute || this.inputs.attributeModel.getPrimaryAttribute?.();
    const summary = this.inputs.attributeModel.getSummary?.(active) || {};
    const binaryKey = this.resolveBinaryAttributeKey(this.inputs.attributeModel, active);
    const values = binaryKey ? this.inputs.attributeModel.binaryAttributes?.[binaryKey] : null;
    const range = values ? this.attributeRange(this.inputs.attributeModel, active, values) : summary.valueRange;
    const grid = this.inputs.attributeModel.grid;
    const { nx, ny, nz } = grid ? this.gridDimensions(grid) : { nx: 0, ny: 0, nz: 0 };
    const gridCount = nx * ny * nz;
    this.attributePanel.querySelector('.geology-attribute-content').innerHTML = `
      <div class="detail-row"><span>Active attribute</span><strong>${escapeHtml(active || '-')}</strong></div>
      <div class="detail-row"><span>Elements</span><strong>${formatScalar(summary.elementCount || summary.blockCount || gridCount || 0, 0)}</strong></div>
      <div class="detail-row"><span>Blocks</span><strong>${formatScalar(summary.blockCount ?? 0, 0)}</strong></div>
      <div class="detail-row"><span>Grid</span><strong>${escapeHtml(summary.gridSize || '-')}</strong></div>
      <div class="detail-row"><span>Range</span><strong>${
        range ? `${formatScalar(range.min)} - ${formatScalar(range.max)}` : '-'
      }</strong></div>
      <div class="detail-row"><span>Render mode</span><strong>${binaryKey && this.params.blockRenderMode !== 'points' ? 'volume' : this.params.blockRenderMode}</strong></div>
    `;
  }

  handleGeologyPick(entity) {
    if (entity.type === 'geologicalBlockCollection' && entity.elements?.length && Number.isInteger(entity.index)) {
      const block = entity.elements[entity.index] || entity.elements[0];
      if (block) this.setSelection('geologicalBlock', block.elementId ?? block.blockId, block);
      else this.clearGeologicalSelection();
      return;
    }
    if (entity.type === 'geologicalVolume') {
      const voxel = this.pickVolumeVoxel(entity);
      if (voxel) {
        this.setSelection('geologicalBlock', voxel.elementId, voxel);
        return;
      }
      this.clearGeologicalSelection();
      return;
    }
    this.setSelection(entity.type, entity.id, entity);
  }

  pickVolumeVoxel(entity) {
    const object = entity.object;
    const volume = entity.volumeData || object?.userData?.geologyPick?.volumeData;
    const material = object?.material;
    const ray = this.sceneManager?.raycaster?.ray;
    if (!object || !volume || !ray || !material?.uniforms?.map) return null;
    const inverseMatrix = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const localOrigin = ray.origin.clone().applyMatrix4(inverseMatrix);
    const localDir = ray.direction.clone().transformDirection(inverseMatrix).normalize();
    const boxMin = new THREE.Vector3(-0.5, -0.5, -0.5);
    const boxMax = new THREE.Vector3(0.5, 0.5, 0.5);
    const invDir = new THREE.Vector3(
      localDir.x === 0 ? 1e12 : 1 / localDir.x,
      localDir.y === 0 ? 1e12 : 1 / localDir.y,
      localDir.z === 0 ? 1e12 : 1 / localDir.z
    );
    const tMinVec = boxMin.clone().sub(localOrigin).multiply(invDir);
    const tMaxVec = boxMax.clone().sub(localOrigin).multiply(invDir);
    const t1 = tMinVec.clone().min(tMaxVec);
    const t2 = tMinVec.clone().max(tMaxVec);
    const tNear = Math.max(t1.x, t1.y, t1.z);
    const tFar = Math.min(t2.x, t2.y, t2.z);
    if (tNear > tFar || tFar < 0) return null;

    const { nx, ny, nz, values, meta, active } = volume;
    const stepSize = 0.25 / Math.max(nx, ny, nz);
    const maxIterations = Math.max(800, Math.min(5000, Math.ceil((Math.max(tFar, 0) - Math.max(tNear, 0)) / stepSize) + 4));
    const filterMin = material.uniforms.uFilterMin.value;
    const filterMax = material.uniforms.uFilterMax.value;
    const iso = material.uniforms.uIsoThreshold.value;
    const mode = material.uniforms.uRenderMode.value;
    const clipMin = material.uniforms.uClipMin.value;
    const clipMax = material.uniforms.uClipMax.value;
    const range = meta.max - meta.min || 1;
    let t = Math.max(tNear, 0);
    for (let iteration = 0; iteration < maxIterations && t <= tFar; iteration += 1) {
      const p = localOrigin.clone().add(localDir.clone().multiplyScalar(t));
      const tex = p.clone().addScalar(0.5);
      if (tex.x < clipMin.x || tex.y < clipMin.y || tex.z < clipMin.z || tex.x > clipMax.x || tex.y > clipMax.y || tex.z > clipMax.z) {
        t += stepSize;
        continue;
      }
      const ix = Math.max(0, Math.min(nx - 1, Math.floor(tex.x * nx)));
      const iy = Math.max(0, Math.min(ny - 1, Math.floor(tex.y * ny)));
      const iz = Math.max(0, Math.min(nz - 1, Math.floor(tex.z * nz)));
      const index = iz * nx * ny + iy * nx + ix;
      const rawValue = Number(values[index]);
      const normalized = Math.max(0, Math.min(1, (rawValue - meta.min) / range));
      const visible = mode === 1 ? normalized >= iso : normalized >= filterMin && normalized <= filterMax;
      if (Number.isFinite(rawValue) && visible) {
        material.uniforms.uPickedCoord.value.set(ix, iy, iz);
        const bounds = this.gridBounds(volume.grid);
        const size = bounds.max.clone().sub(bounds.min);
        const center = new THREE.Vector3(
          bounds.min.x + ((ix + 0.5) / nx) * size.x,
          bounds.min.y + ((iy + 0.5) / ny) * size.y,
          bounds.min.z + ((iz + 0.5) / nz) * size.z
        );
        const attributeValues = this.volumeAttributeValuesAt(index);
        return {
          elementId: `VOX_${ix}_${iy}_${iz}`,
          blockId: `VOX_${ix}_${iy}_${iz}`,
          centroid: { x: center.x, y: center.y, z: center.z },
          gridIndex: [ix, iy, iz],
          activeAttribute: active,
          value: rawValue,
          attributeValues,
          normalizedValue: normalized,
          size: { x: size.x / nx, y: size.y / ny, z: size.z / nz }
        };
      }
      t += stepSize;
    }
    material.uniforms.uPickedCoord.value.set(-1, -1, -1);
    return null;
  }

  volumeAttributeValuesAt(index) {
    const dataset = this.inputs.attributeModel;
    if (!dataset?.binaryAttributes) return null;
    const result = {};
    (dataset.listAttributes?.() || Object.keys(dataset.binaryAttributes)).forEach((attribute) => {
      const key = this.resolveBinaryAttributeKey(dataset, attribute);
      const value = key ? Number(dataset.binaryAttributes[key]?.[index]) : NaN;
      if (Number.isFinite(value)) result[attribute] = value;
    });
    return result;
  }

  setSelection(type, id, extra = null) {
    const value = id == null ? null : String(id);
    if (type === 'geologicalUnit') this.context.set('selectedGeologicalUnit', value);
    if (type === 'geologicalSurface') {
      this.context.set('selectedSurface', value);
      const surface = this.inputs.geologicalBody?.surfaceMap?.get?.(value);
      if (surface?.geologicalUnitId || surface?.unitId) this.context.set('selectedGeologicalUnit', surface.geologicalUnitId ?? surface.unitId);
    }
    if (type === 'borehole') this.context.set('selectedBorehole', value);
    if (type === 'geologicalStructure') this.context.set('selectedStructure', value);
    if (type === 'geologicalBlock') this.context.set('selectedBlock', value);
    this.context.set('selection', { type, id: value, data: extra || undefined });
  }

  clearGeologicalSelection() {
    [
      'selectedGeologicalUnit',
      'selectedGeologicalBody',
      'selectedSurface',
      'selectedBorehole',
      'selectedStructure',
      'selectedBlock'
    ].forEach((key) => this.context.set(key, null));
    this.context.set('selection', null);
    this.resetVolumePick();
  }

  applyContextSelection(selection) {
    if (!selection || (!(String(selection.type || '').startsWith('geological')) && selection.type !== 'borehole')) {
      this.selected = null;
      this.resetVolumePick();
      this.updateHighlight();
      this.updateDetailPanel();
      return;
    }
    this.selected = selection;
    this.updateHighlight();
    this.updateDetailPanel();
  }

  updateHighlight() {
    this.highlightGroup.clear();
    [this.bodyGroup, this.boreholeGroup, this.structureGroup].forEach((group) => {
      group.traverse((child) => {
        if (!child.userData?.geologyPick) return;
        this.restoreMaterial(child);
        if (this.matchesSelection(child.userData.geologyPick)) this.highlightMaterial(child);
      });
    });
  }

  resetVolumePick() {
    this.attributeGroup?.traverse?.((child) => {
      const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
      materials.forEach((material) => {
        if (material?.uniforms?.uPickedCoord) material.uniforms.uPickedCoord.value.set(-1, -1, -1);
      });
    });
  }

  matchesSelection(pick = {}) {
    const type = this.selected?.type;
    const id = String(this.selected?.id ?? '');
    if (!id) return false;
    if (type === 'geologicalUnit') return String(pick.unitId ?? pick.geologicalUnitId) === id;
    if (type === 'geologicalSurface') return String(pick.surfaceId ?? pick.id) === id;
    if (type === 'borehole') return String(pick.boreholeId ?? pick.id) === id;
    if (type === 'geologicalStructure') return String(pick.structureId ?? pick.id) === id;
    return false;
  }

  restoreMaterial(object) {
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    materials.forEach((material) => {
      const original = this.materialOriginals.get(material);
      if (!original) return;
      material.color?.copy?.(original.color);
      if ('emissive' in material) material.emissive.copy(original.emissive);
      if ('emissiveIntensity' in material) material.emissiveIntensity = original.emissiveIntensity;
    });
  }

  highlightMaterial(object) {
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    materials.forEach((material) => {
      if (!this.materialOriginals.has(material)) {
        this.materialOriginals.set(material, {
          color: material.color?.clone?.() || new THREE.Color('#ffffff'),
          emissive: material.emissive?.clone?.() || new THREE.Color('#000000'),
          emissiveIntensity: material.emissiveIntensity || 0
        });
      }
      material.color?.set?.('#ffd54f');
      if ('emissive' in material) material.emissive.set('#ffd54f');
      if ('emissiveIntensity' in material) material.emissiveIntensity = 0.28;
    });
  }

  selectedObjectCenter() {
    const selected = this.selected;
    if (!selected) return null;
    const box = new THREE.Box3();
    const matches = [];
    this.rootGroup.traverse((child) => {
      if (!child.userData?.geologyPick || !this.matchesSelection(child.userData.geologyPick)) return;
      matches.push(child);
    });
    matches.forEach((object) => box.expandByObject(object));
    if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
    if (selected.type === 'geologicalBlock' && selected.data?.centroid) return geologyPoint(selected.data.centroid);
    return null;
  }

  updateDetailPanel() {
    const content = this.detailPanel?.querySelector('.geology-detail-content');
    if (!content) return;
    if (!this.selected) {
      content.innerHTML = '<div class="empty-state">Select a geological object to inspect details.</div>';
      return;
    }
    content.innerHTML = this.detailHtml(this.selected);
  }

  detailHtml(selection) {
    const id = String(selection.id ?? '');
    if (selection.type === 'geologicalUnit') {
      const unit = this.inputs.geologicalBody.getUnit?.(id) || this.inputs.geologicalBody.getBody?.(id);
      return this.rows([
        ['Unit ID', id],
        ['Name', unit?.geologicalUnitName ?? unit?.bodyName],
        ['Type', unit?.geologicalUnitType ?? unit?.bodyType],
        ['Lithology', unit?.lithology],
        ['Layer order', unit?.layerOrder ?? unit?.layer_order],
        ['Color', unit?.color]
      ]);
    }
    if (selection.type === 'geologicalSurface') {
      const surface = this.inputs.geologicalBody.surfaceMap?.get?.(id);
      return this.rows([
        ['Surface ID', id],
        ['Unit ID', surface?.geologicalUnitId ?? surface?.unitId],
        ['Body ID', surface?.bodyId],
        ['Surface type', surface?.surfaceType],
        ['Mesh part', surface?.meshPartId ?? surface?.mesh_part_id],
        ['Role', surface?.role]
      ]);
    }
    if (selection.type === 'borehole') {
      const borehole = this.inputs.borehole?.getBorehole?.(id);
      const intervals = this.inputs.borehole?.getIntervals?.(id) || [];
      return this.rows([
        ['Borehole ID', id],
        ['Label', borehole?.boreholeName],
        ['Collar', borehole?.collar ? `${formatScalar(borehole.collar.x)}, ${formatScalar(borehole.collar.y)}, ${formatScalar(borehole.collar.z)}` : '-'],
        ['Total depth', borehole?.totalDepth ?? borehole?.total_depth],
        ['Interval count', intervals.length],
        ['Sample count', this.inputs.borehole?.getSamples?.(id)?.length ?? 0]
      ]);
    }
    if (selection.type === 'geologicalStructure') {
      const structure = this.inputs.geologicalStructure?.getStructure?.(id);
      return this.rows([
        ['Structure ID', id],
        ['Name', structure?.structureName],
        ['Type', structure?.structureType],
        ['Strike', structure?.strike],
        ['Dip', structure?.dip],
        ['Throw', structure?.throw],
        ['Width', structure?.width],
        ['Risk level', structure?.riskLevel ?? structure?.risk_level],
        ['Confidence', structure?.confidence]
      ]);
    }
    if (selection.type === 'geologicalBlock') {
      const block = selection.data || this.inputs.attributeModel?.getBlock?.(id);
      const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
      const baseRows = [
        ['Block / element ID', id],
        ['Grid index', Array.isArray(block?.gridIndex) ? block.gridIndex.join(', ') : null],
        ['Centroid', block?.centroid ? `${formatScalar(block.centroid.x)}, ${formatScalar(block.centroid.y)}, ${formatScalar(block.centroid.z)}` : '-'],
        ['Size', block?.size ? `${formatScalar(block.size.x)}, ${formatScalar(block.size.y)}, ${formatScalar(block.size.z)}` : '-'],
        ['Lithology', block?.lithology],
        ['Orebody ID', block?.orebodyId ?? block?.bodyId],
        [block?.activeAttribute || active || 'Value', this.inputs.attributeModel?.getValue?.(id, active) ?? block?.value],
        ['Normalized value', block?.normalizedValue],
        ['Resource category', block?.resourceCategory]
      ];
      const attributeRows = Object.entries(block?.attributeValues || {}).map(([name, value]) => [name, formatScalar(value, 4)]);
      return this.rows(baseRows) + (attributeRows.length ? `<div class="geology-detail-subtitle">Voxel attributes</div>${this.rows(attributeRows)}` : '');
    }
    return '<div class="empty-state">No detail available for this selection.</div>';
  }

  rows(rows) {
    return rows
      .filter(([, value]) => value != null && value !== '')
      .map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join('');
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    [this.layerPanel, this.legendPanel, this.detailPanel, this.attributePanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

class BoreholeStratigraphyCorrelationRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Borehole & Stratigraphy Correlation';
    this.params = {
      selectedBoreholeIds: [],
      displayMode: 'correlation-canvas',
      depthReference: 'depth',
      alignmentMode: 'depth',
      boreholeOrder: 'section-distance',
      show3DLayer: true,
      showLogPanel: true,
      showCorrelationCanvas: true,
      showCorrelationLines: true,
      showLithology: true,
      showAssays: true,
      showModelIntersections: true,
      showGeologicalBody: false,
      showRoadway: false,
      showBoreholes: true,
      showStructures: false,
      showAttributeModel: false,
      geologicalBodyOpacity: 0.32,
      structureOpacity: 0.7,
      roadwayOpacity: 0.22,
      activeAttribute: null,
      maxBoreholesInCanvas: 12,
      autoSelectBoreholesNearSection: true,
      sectionDistanceTolerance: 20,
      boreholeOpacity: 1,
      logPanelWidth: 160,
      autoFocusOnSelection: true,
      ...(nodeModel.params || {})
    };
    this.selectedInterval = null;
    this.currentBoreholes = [];
    this.sectionFrame = null;
    this.logPanel = null;
    this.correlationPanel = null;
  }

  validateSemanticInputs() {
    const borehole = this.inputs.borehole;
    if (!borehole) throw new Error('Missing semantic dataset input: borehole');
    const actualClass = borehole.contract?.class || borehole.semanticClass;
    if (actualClass !== 'Borehole') throw new Error(`Input borehole expects Borehole, got ${actualClass}.`);
    if (borehole.validation?.errors?.length) {
      console.warn('[MineVis Borehole Correlation] Borehole validation errors:', borehole.validation.errors);
    }
    Object.entries(BoreholeStratigraphyCorrelationInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Borehole Correlation] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  async renderAllLayers() {
    if (this.inputs.geologicalBody && this.params.showModelIntersections) await this.renderGeologicalBodyLayer();
    if (this.params.show3DLayer !== false) this.renderBoreholeLayer();
    if (this.inputs.geologicalStructure && this.params.showModelIntersections) await this.renderStructureLayer();
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Borehole Correlation Controls', 'geology-panel geology-control-panel borehole-correlation-control-panel', '<div class="panel-body"></div>');
    this.logPanel = createWorkspacePanel('Borehole Log Panel', 'geology-panel borehole-log-panel', '<div class="panel-body"></div>');
    this.correlationPanel = createWorkspacePanel('Multi-borehole Correlation Canvas', 'geology-panel borehole-correlation-panel', '<div class="panel-body"></div>');
    this.detailPanel = createWorkspacePanel('Borehole / Interval Detail', 'geology-panel geology-detail-panel borehole-detail-panel', '<div class="panel-body"></div>');
    this.legendPanel = createWorkspacePanel('Borehole Legend', 'geology-panel geology-legend-panel borehole-legend-panel', '<div class="panel-body"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '330px' });
    Object.assign(this.logPanel.style, { right: '330px', top: '92px', width: '360px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '492px', width: '330px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '560px', width: '300px' });
    Object.assign(this.correlationPanel.style, { left: '370px', bottom: '28px', top: 'auto', width: '760px', maxHeight: '520px' });
  }

  registerVisualContributions() {
    if (this.params.show3DLayer !== false) this.registerSceneContribution('borehole-correlation-layer', '3D Borehole Correlation Layer', this.boreholeGroup, 'borehole', 'structure', this.params.boreholeOpacity, {
      semanticRole: 'structure',
      objectSystem: 'borehole',
      visualChannels: { color: 'lithology', line: 'trajectory' }
    });
    if (this.inputs.geologicalBody && this.params.showModelIntersections) {
      this.registerSceneContribution('borehole-geological-context', 'Geological Model Context', this.bodyGroup, 'geologicalBody', 'context', this.params.geologicalBodyOpacity, {
        semanticRole: 'context',
        objectSystem: 'geologicalBody'
      });
    }
    if (this.inputs.geologicalStructure && this.params.showModelIntersections) {
      this.registerSceneContribution('borehole-structure-context', 'Geological Structure Context', this.structureGroup, 'geologicalStructure', 'context', this.params.structureOpacity);
    }
    this.registerPanelContribution('Borehole Log Panel', this.logPanel, 'right-panel', 'detail', 'borehole');
    this.registerPanelContribution('Multi-borehole Correlation Canvas', this.correlationPanel, 'bottom-panel', 'detail', 'boreholeCorrelation');
    this.registerPanelContribution('Correlation Control Panel', this.layerPanel, 'right-panel', 'control', 'boreholeCorrelation');
    this.registerPanelContribution('Borehole / Interval Detail Panel', this.detailPanel, 'right-panel', 'detail', 'borehole');
    this.registerPanelContribution('Borehole Legend', this.legendPanel, 'legend', 'legend', 'borehole');
  }

  registerPanelContribution(name, element, host, semanticRole, objectSystem) {
    if (!element || !this.contributionRegistry) return;
    this.contributionRegistry.register?.({
      id: `${this.id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: name,
      ownerId: this.id,
      functionId: this.functionId,
      type: semanticRole === 'legend' ? 'legend' : 'panel',
      host,
      element,
      descriptor: {
        host,
        contributionKind: semanticRole === 'control' ? 'control' : semanticRole === 'legend' ? 'legend' : 'panel',
        semanticRole,
        objectSystem,
        composition: {
          mergePolicy: semanticRole === 'legend' ? 'replace' : 'compose',
          focusBehavior: 'primary-when-focused',
          canPin: true
        }
      },
      visible: element.style.display !== 'none',
      show: () => (element.style.display = 'block'),
      hide: () => (element.style.display = 'none'),
      cleanup: () => element.remove()
    });
  }

  installHandlers() {
    this.disposers.push(this.context?.subscribe?.('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context?.subscribe?.('selectedBorehole', (boreholeId) => {
      if (boreholeId && this.selected?.id !== boreholeId) {
        this.selected = { type: 'borehole', id: boreholeId };
        this.updateHighlight();
        this.updatePanels();
      }
    }));
    this.disposers.push(this.context?.subscribe?.('selectedBoreholeInterval', (intervalId) => {
      if (intervalId && this.selectedInterval?.id !== intervalId) {
        const boreholeId = this.context?.get?.('selectedBorehole') || this.selectedInterval?.boreholeId;
        this.selectedInterval = { id: intervalId, boreholeId };
        this.selected = { type: 'boreholeInterval', id: intervalId, data: { boreholeId } };
        this.updateHighlight();
        this.updatePanels();
      }
    }));
    this.disposers.push(this.context?.subscribe?.('sectionFrame', (frame) => {
      this.sectionFrame = frame;
      if (this.params.autoSelectBoreholesNearSection) this.updatePanels();
    }));
    this.disposers.push(this.context?.subscribe?.('activeGeologicalAttribute', (attribute) => {
      if (attribute && attribute !== this.params.activeAttribute) {
        this.params.activeAttribute = attribute;
        this.updatePanels();
      }
    }));

    const controlHandler = (event) => this.handleCorrelationControlChange(event);
    const clickHandler = (event) => this.handleCorrelationClick(event);
    [this.layerPanel, this.logPanel, this.correlationPanel].forEach((panel) => {
      panel?.addEventListener?.('change', controlHandler);
      panel?.addEventListener?.('input', controlHandler);
      panel?.addEventListener?.('click', clickHandler);
      this.controlDisposers.push(() => {
        panel?.removeEventListener?.('change', controlHandler);
        panel?.removeEventListener?.('input', controlHandler);
        panel?.removeEventListener?.('click', clickHandler);
      });
    });
  }

  renderControls(container) {
    container.innerHTML = this.correlationControlsHtml({ compact: true });
    const handler = (event) => this.handleCorrelationControlChange(event);
    container.addEventListener('change', handler);
    container.addEventListener('input', handler);
    this.controlDisposers.push(() => {
      container.removeEventListener('change', handler);
      container.removeEventListener('input', handler);
    });
  }

  handleCorrelationControlChange(event) {
    const target = event.target;
    const key = target?.dataset?.correlationParam;
    if (!key) return;
    if (target.type === 'checkbox') this.params[key] = target.checked;
    else if (target.type === 'number' || target.type === 'range') this.params[key] = Number(target.value);
    else this.params[key] = target.value;
    if (key === 'activeAttribute') this.context?.set?.('activeGeologicalAttribute', this.params.activeAttribute || null);
    if (key === 'selectedBoreholeIds') {
      const values = Array.from(this.layerPanel?.querySelectorAll?.('[data-borehole-checkbox]:checked') || []).map((item) => item.value);
      this.params.selectedBoreholeIds = values;
    }
    this.updatePanels();
    this.updateLegend();
  }

  handleCorrelationClick(event) {
    const intervalTarget = event.target?.closest?.('[data-borehole-interval]');
    if (intervalTarget) {
      this.selectInterval(intervalTarget.dataset.boreholeId, intervalTarget.dataset.boreholeInterval);
      return;
    }
    const boreholeTarget = event.target?.closest?.('[data-borehole-id]');
    if (boreholeTarget) {
      this.setSelection('borehole', boreholeTarget.dataset.boreholeId, {});
      return;
    }
    const unitTarget = event.target?.closest?.('[data-correlation-unit]');
    if (unitTarget) {
      this.setSelection('geologicalUnit', unitTarget.dataset.correlationUnit, {});
    }
  }

  updatePanels() {
    this.currentBoreholes = this.resolveDisplayedBoreholes();
    if (this.layerPanel) this.layerPanel.querySelector('.panel-body').innerHTML = this.correlationControlsHtml();
    if (this.logPanel) {
      this.logPanel.style.display = this.params.showLogPanel ? '' : 'none';
      this.logPanel.querySelector('.panel-body').innerHTML = this.params.showLogPanel ? this.renderSingleLog() : '';
    }
    if (this.correlationPanel) {
      this.correlationPanel.style.display = this.params.showCorrelationCanvas ? '' : 'none';
      this.correlationPanel.querySelector('.panel-body').innerHTML = this.params.showCorrelationCanvas ? this.renderCorrelationCanvas() : '';
    }
    this.updateDetailPanel();
    this.syncControlValues();
  }

  syncControlValues() {
    [this.layerPanel, this.logPanel, this.correlationPanel].forEach((panel) => {
      panel?.querySelectorAll?.('[data-correlation-param]').forEach((input) => {
        if (input.dataset.boreholeCheckbox != null) return;
        const key = input.dataset.correlationParam;
        if (input.type === 'checkbox') input.checked = !!this.params[key];
        else if (key in this.params && input.value !== String(this.params[key] ?? '')) input.value = this.params[key] ?? '';
      });
    });
  }

  correlationControlsHtml({ compact = false } = {}) {
    const attributes = this.listBoreholeAttributes();
    const boreholes = this.inputs.borehole?.listBoreholes?.() || [];
    const selected = new Set(this.resolveSelectedBoreholeIds());
    const boreholeList = compact ? '' : `
      <div class="geology-detail-subtitle">Borehole selection</div>
      <div class="scroll-list compact-scroll">
        ${boreholes.map((borehole) => {
          const id = borehole.boreholeId;
          return `<label class="checkbox-row"><input type="checkbox" data-correlation-param="selectedBoreholeIds" data-borehole-checkbox value="${escapeHtml(id)}" ${selected.has(id) ? 'checked' : ''}> ${escapeHtml(borehole.boreholeName || id)}</label>`;
        }).join('')}
      </div>`;
    return `
      <div class="field-grid">
        <label>Display mode<select data-correlation-param="displayMode">
          ${['correlation-canvas', 'single-log'].map((value) => `<option value="${value}" ${this.params.displayMode === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Depth reference<select data-correlation-param="depthReference">
          ${['depth', 'elevation'].map((value) => `<option value="${value}" ${this.params.depthReference === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Alignment<select data-correlation-param="alignmentMode">
          ${['depth', 'elevation'].map((value) => `<option value="${value}" ${this.params.alignmentMode === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Order<select data-correlation-param="boreholeOrder">
          ${['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'].map((value) => `<option value="${value}" ${this.params.boreholeOrder === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Active attribute<select data-correlation-param="activeAttribute">
          <option value="">None</option>
          ${attributes.map((name) => `<option value="${escapeHtml(name)}" ${this.params.activeAttribute === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select></label>
        <label>Max boreholes<input type="number" min="1" max="48" data-correlation-param="maxBoreholesInCanvas" value="${escapeHtml(this.params.maxBoreholesInCanvas)}"></label>
      </div>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-correlation-param="show3DLayer" ${this.params.show3DLayer ? 'checked' : ''}> 3D boreholes</label>
        <label><input type="checkbox" data-correlation-param="showLogPanel" ${this.params.showLogPanel ? 'checked' : ''}> log panel</label>
        <label><input type="checkbox" data-correlation-param="showCorrelationCanvas" ${this.params.showCorrelationCanvas ? 'checked' : ''}> correlation canvas</label>
        <label><input type="checkbox" data-correlation-param="showCorrelationLines" ${this.params.showCorrelationLines ? 'checked' : ''}> correlation lines</label>
        <label><input type="checkbox" data-correlation-param="showLithology" ${this.params.showLithology ? 'checked' : ''}> lithology</label>
        <label><input type="checkbox" data-correlation-param="showAssays" ${this.params.showAssays ? 'checked' : ''}> assays</label>
        <label><input type="checkbox" data-correlation-param="showModelIntersections" ${this.params.showModelIntersections ? 'checked' : ''}> model intersections</label>
        <label><input type="checkbox" data-correlation-param="autoSelectBoreholesNearSection" ${this.params.autoSelectBoreholesNearSection ? 'checked' : ''}> auto near section</label>
      </div>
      ${boreholeList}`;
  }

  resolveSelectedBoreholeIds() {
    const ids = Array.isArray(this.params.selectedBoreholeIds)
      ? this.params.selectedBoreholeIds
      : String(this.params.selectedBoreholeIds || '').split(',').map((value) => value.trim()).filter(Boolean);
    const current = this.context?.get?.('selectedBorehole') || (this.selected?.type === 'borehole' ? this.selected.id : null);
    return [...new Set([current, ...ids].filter(Boolean))];
  }

  resolveDisplayedBoreholes() {
    const all = this.inputs.borehole?.listBoreholes?.() || [];
    const byId = new Map(all.map((item) => [item.boreholeId, item]));
    let rows = this.resolveSelectedBoreholeIds().map((id) => byId.get(id)).filter(Boolean);
    if (!rows.length) rows = [...all];
    rows = this.sortBoreholes(rows);
    const limit = Math.max(1, Number(this.params.maxBoreholesInCanvas) || 12);
    return rows.slice(0, limit);
  }

  sortBoreholes(rows) {
    const mode = this.params.boreholeOrder;
    const sorted = [...rows];
    if (mode === 'name') {
      sorted.sort((a, b) => String(a.boreholeName || a.boreholeId).localeCompare(String(b.boreholeName || b.boreholeId)));
    } else if (mode === 'spatial-x') {
      sorted.sort((a, b) => Number(a.position?.x ?? a.collarX ?? 0) - Number(b.position?.x ?? b.collarX ?? 0));
    } else if (mode === 'spatial-y') {
      sorted.sort((a, b) => Number(a.position?.y ?? a.collarY ?? 0) - Number(b.position?.y ?? b.collarY ?? 0));
    } else if (mode === 'section-distance') {
      const frame = this.sectionFrame || this.context?.get?.('sectionFrame');
      if (frame?.projectPoint) {
        sorted.sort((a, b) => {
          const pa = frame.projectPoint(this.resolveBoreholeCollar(a, this.inputs.borehole?.getTrajectory?.(a.boreholeId) || []));
          const pb = frame.projectPoint(this.resolveBoreholeCollar(b, this.inputs.borehole?.getTrajectory?.(b.boreholeId) || []));
          return Number(pa?.x ?? 0) - Number(pb?.x ?? 0);
        });
      } else {
        sorted.sort((a, b) => String(a.boreholeName || a.boreholeId).localeCompare(String(b.boreholeName || b.boreholeId)));
      }
    }
    return sorted;
  }

  selectedBorehole() {
    const id = this.context?.get?.('selectedBorehole') || this.selectedInterval?.boreholeId || (this.selected?.type === 'borehole' ? this.selected.id : null);
    return this.inputs.borehole?.getBorehole?.(id) || this.currentBoreholes[0] || this.inputs.borehole?.listBoreholes?.()[0] || null;
  }

  sortedIntervals(boreholeId) {
    return (this.inputs.borehole?.getIntervals?.(boreholeId) || [])
      .filter((interval) => Number.isFinite(Number(interval.depthFrom)) && Number.isFinite(Number(interval.depthTo)))
      .sort((a, b) => Number(a.depthFrom) - Number(b.depthFrom));
  }

  intervalId(interval, index = 0) {
    return interval?.id || interval?.intervalId || interval?.interval_id || `${interval?.boreholeId || interval?.borehole_id || 'interval'}_${index}`;
  }

  intervalLithology(interval) {
    return interval?.lithology || interval?.rock_type || interval?.unitName || interval?.unitId || interval?.attributeValue || interval?.value || 'unknown';
  }

  intervalUnit(interval) {
    return interval?.unitId || interval?.unit_id || interval?.geologicalUnitId || interval?.seamId || interval?.seam_id || null;
  }

  boreholeDepthExtent(boreholes = this.currentBoreholes) {
    let min = Infinity;
    let max = -Infinity;
    boreholes.forEach((borehole) => {
      const intervals = this.sortedIntervals(borehole.boreholeId);
      intervals.forEach((interval) => {
        min = Math.min(min, Number(interval.depthFrom));
        max = Math.max(max, Number(interval.depthTo));
      });
      if (Number.isFinite(Number(borehole.totalDepth))) {
        min = Math.min(min, 0);
        max = Math.max(max, Number(borehole.totalDepth));
      }
    });
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { min: 0, max: 100 };
    return { min, max };
  }

  listBoreholeAttributes() {
    const names = new Set(this.inputs.attributeModel?.listAttributes?.() || []);
    (this.inputs.borehole?.listBoreholes?.() || []).forEach((borehole) => {
      this.sortedIntervals(borehole.boreholeId).forEach((interval) => {
        ['grade', 'ash', 'sulfur', 'value', 'attributeValue'].forEach((key) => {
          if (interval[key] != null && interval[key] !== '') names.add(key);
        });
      });
    });
    return [...names];
  }

  renderSingleLog() {
    const borehole = this.selectedBorehole();
    if (!borehole) return '<div class="empty-state">No borehole dataset connected.</div>';
    const intervals = this.sortedIntervals(borehole.boreholeId);
    if (!intervals.length) return '<div class="empty-state">No borehole intervals available.</div>';
    const extent = this.boreholeDepthExtent([borehole]);
    const width = 310;
    const top = 36;
    const bottom = 28;
    const trackX = 80;
    const trackW = 96;
    const curveX = 202;
    const height = Math.max(360, (extent.max - extent.min) * 4 + top + bottom);
    const scaleY = (depth) => top + ((Number(depth) - extent.min) / Math.max(1, extent.max - extent.min)) * (height - top - bottom);
    const active = this.params.activeAttribute;
    const values = intervals.map((interval) => Number(interval[active])).filter(Number.isFinite);
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 1;
    const rects = intervals.map((interval, index) => {
      const y0 = scaleY(interval.depthFrom);
      const y1 = scaleY(interval.depthTo);
      const id = this.intervalId(interval, index);
      const lithology = this.intervalLithology(interval);
      const selected = this.selectedInterval?.id === id;
      const color = this.params.showLithology ? this.colorForLithology(lithology, index) : '#9aa5b1';
      const value = Number(interval[active]);
      const point = active && Number.isFinite(value)
        ? `<circle cx="${curveX + ((value - minValue) / Math.max(0.0001, maxValue - minValue)) * 70}" cy="${(y0 + y1) / 2}" r="3.5" fill="#f59e0b" />`
        : '';
      return `
        <g data-borehole-id="${escapeHtml(borehole.boreholeId)}" data-borehole-interval="${escapeHtml(id)}">
          <rect x="${trackX}" y="${y0}" width="${trackW}" height="${Math.max(2, y1 - y0)}" fill="${escapeHtml(color)}" stroke="${selected ? '#facc15' : '#1f2937'}" stroke-width="${selected ? 3 : 0.7}" />
          <text x="${trackX + trackW + 8}" y="${Math.max(y0 + 12, (y0 + y1) / 2)}" font-size="10" fill="#d7dde7">${escapeHtml(lithology)}</text>
          ${point}
        </g>`;
    }).join('');
    return `
      <div class="borehole-log-header"><strong>${escapeHtml(borehole.boreholeName || borehole.boreholeId)}</strong><span class="muted-note">${intervals.length} intervals</span></div>
      <div class="borehole-log-content">
        <svg class="borehole-log-svg" viewBox="0 0 ${width} ${height}" role="img">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#101722" rx="8" />
          <text x="18" y="22" font-size="11" fill="#a7b4c5">Depth (m)</text>
          <line x1="58" y1="${top}" x2="58" y2="${height - bottom}" stroke="#6b7280" stroke-width="1" />
          ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const depth = extent.min + t * (extent.max - extent.min);
            const y = scaleY(depth);
            return `<line x1="52" y1="${y}" x2="176" y2="${y}" stroke="#334155" stroke-width="0.7" /><text x="8" y="${y + 4}" font-size="10" fill="#93a4b8">${formatScalar(depth, 1)}</text>`;
          }).join('')}
          <text x="${trackX}" y="22" font-size="11" fill="#a7b4c5">Lithology</text>
          ${active ? `<text x="${curveX}" y="22" font-size="11" fill="#a7b4c5">${escapeHtml(active)}</text>` : ''}
          ${rects}
        </svg>
      </div>`;
  }

  renderCorrelationCanvas() {
    const boreholes = this.currentBoreholes;
    if (!boreholes.length) return '<div class="empty-state">No boreholes available for correlation.</div>';
    const extent = this.boreholeDepthExtent(boreholes);
    const top = 44;
    const bottom = 28;
    const columnW = 86;
    const gap = 34;
    const left = 54;
    const height = Math.max(420, (extent.max - extent.min) * 3.6 + top + bottom);
    const width = Math.max(520, left + boreholes.length * (columnW + gap) + 40);
    const scaleY = (depth) => top + ((Number(depth) - extent.min) / Math.max(1, extent.max - extent.min)) * (height - top - bottom);
    const markers = new Map();
    const columns = boreholes.map((borehole, columnIndex) => {
      const x = left + columnIndex * (columnW + gap);
      const intervals = this.sortedIntervals(borehole.boreholeId);
      const rects = intervals.map((interval, index) => {
        const y0 = scaleY(interval.depthFrom);
        const y1 = scaleY(interval.depthTo);
        const id = this.intervalId(interval, index);
        const unit = this.intervalUnit(interval) || this.intervalLithology(interval);
        const key = String(unit || '').trim();
        if (key) {
          if (!markers.has(key)) markers.set(key, []);
          markers.get(key).push({ x: x + columnW / 2, y: y0, boreholeId: borehole.boreholeId, intervalId: id });
        }
        const selected = this.selectedInterval?.id === id;
        const color = this.params.showLithology ? this.colorForLithology(this.intervalLithology(interval), index) : '#94a3b8';
        return `
          <g data-borehole-id="${escapeHtml(borehole.boreholeId)}" data-borehole-interval="${escapeHtml(id)}">
            <rect x="${x}" y="${y0}" width="${columnW}" height="${Math.max(2, y1 - y0)}" fill="${escapeHtml(color)}" stroke="${selected ? '#facc15' : '#0f172a'}" stroke-width="${selected ? 3 : 0.7}" />
          </g>`;
      }).join('');
      const selectedBorehole = this.selected?.type === 'borehole' && this.selected.id === borehole.boreholeId;
      return `
        <g data-borehole-id="${escapeHtml(borehole.boreholeId)}">
          <text x="${x + columnW / 2}" y="25" text-anchor="middle" font-size="11" font-weight="${selectedBorehole ? 700 : 500}" fill="${selectedBorehole ? '#facc15' : '#d7dde7'}">${escapeHtml(borehole.boreholeName || borehole.boreholeId)}</text>
          <rect x="${x - 2}" y="${top}" width="${columnW + 4}" height="${height - top - bottom}" fill="none" stroke="${selectedBorehole ? '#facc15' : '#334155'}" stroke-width="${selectedBorehole ? 2 : 1}" />
          ${rects}
        </g>`;
    }).join('');
    const lines = this.params.showCorrelationLines ? [...markers.entries()].map(([unit, points], index) => {
      if (points.length < 2) return '';
      const sorted = points.sort((a, b) => a.x - b.x);
      const d = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const selected = this.selected?.type === 'geologicalUnit' && this.selected.id === unit;
      return `<path data-correlation-unit="${escapeHtml(unit)}" d="${d}" fill="none" stroke="${escapeHtml(geologyColorForKey(unit, index))}" stroke-width="${selected ? 3.2 : 1.4}" stroke-opacity="${selected ? 0.95 : 0.58}" stroke-linecap="round" stroke-linejoin="round" />`;
    }).join('') : '';
    return `
      <div class="borehole-correlation-content">
        <svg class="borehole-correlation-svg" viewBox="0 0 ${width} ${height}" role="img">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#0f1722" rx="10" />
          <text x="18" y="25" font-size="11" fill="#a7b4c5">Depth (m)</text>
          ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const depth = extent.min + t * (extent.max - extent.min);
            const y = scaleY(depth);
            return `<line x1="46" y1="${y}" x2="${width - 22}" y2="${y}" stroke="#263445" stroke-width="0.7" /><text x="10" y="${y + 4}" font-size="10" fill="#93a4b8">${formatScalar(depth, 1)}</text>`;
          }).join('')}
          ${columns}
          ${lines}
        </svg>
      </div>`;
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const intervals = this.currentBoreholes.flatMap((borehole) => this.sortedIntervals(borehole.boreholeId));
    const lithologies = [...new Set(intervals.map((interval) => this.intervalLithology(interval)).filter(Boolean))].slice(0, 12);
    this.legendPanel.querySelector('.panel-body').innerHTML = `
      <div class="route-legend-list">
        ${lithologies.map((name, index) => `<div class="legend-row"><span class="legend-dot" style="background:${escapeHtml(this.colorForLithology(name, index))}"></span><span>${escapeHtml(name)}</span></div>`).join('')}
        <div class="legend-row"><span class="legend-line" style="background:#facc15"></span><span>Selected borehole / interval</span></div>
        <div class="legend-row"><span class="legend-line" style="background:#60a5fa"></span><span>Correlation line</span></div>
      </div>`;
  }

  handleGeologyPick(entity) {
    if (!entity) return;
    if (entity.type === 'borehole' && entity.intervalId) {
      this.selectInterval(entity.boreholeId || entity.id, entity.intervalId);
      return;
    }
    if (entity.type === 'borehole') {
      this.setSelection('borehole', entity.boreholeId || entity.id, entity);
      return;
    }
    this.setSelection(entity.type, entity.id, entity);
  }

  selectInterval(boreholeId, intervalId) {
    if (!boreholeId || !intervalId) return;
    const interval = this.sortedIntervals(boreholeId).find((item, index) => this.intervalId(item, index) === intervalId);
    this.selectedInterval = { id: intervalId, boreholeId, interval };
    this.selected = { type: 'boreholeInterval', id: intervalId, data: { boreholeId, interval } };
    this.context?.set?.('selectedBorehole', boreholeId);
    this.context?.set?.('selectedBoreholeInterval', intervalId);
    this.context?.set?.('selection', { type: 'boreholeInterval', id: intervalId, data: { boreholeId, interval } });
    this.updateHighlight();
    this.updatePanels();
  }

  setSelection(type, id, extra = {}) {
    if (!id) return;
    this.selected = { type, id, data: extra };
    if (type === 'borehole') {
      this.selectedInterval = null;
      this.context?.set?.('selectedBorehole', id);
      this.context?.set?.('selectedBoreholeInterval', null);
    } else if (type === 'geologicalUnit') {
      this.context?.set?.('selectedGeologicalUnit', id);
    } else if (type === 'geologicalStructure') {
      this.context?.set?.('selectedStructure', id);
    }
    this.context?.set?.('selection', { type, id, data: extra });
    this.updateHighlight();
    this.updatePanels();
  }

  applyContextSelection(selection) {
    if (!selection || !selection.type || !selection.id) {
      this.selected = null;
      this.selectedInterval = null;
      this.updateHighlight();
      this.updatePanels();
      return;
    }
    if (!['borehole', 'boreholeInterval', 'geologicalUnit', 'geologicalStructure'].includes(selection.type)) return;
    this.selected = selection;
    if (selection.type === 'boreholeInterval') {
      this.selectedInterval = { id: selection.id, boreholeId: selection.data?.boreholeId || this.context?.get?.('selectedBorehole'), interval: selection.data?.interval };
    } else if (selection.type === 'borehole') {
      this.selectedInterval = null;
    }
    this.updateHighlight();
    this.updatePanels();
  }

  matchesSelection(pick) {
    if (!this.selected || !pick) return false;
    if (this.selected.type === 'boreholeInterval') {
      return pick.type === 'borehole' && pick.intervalId === this.selected.id;
    }
    if (this.selected.type === 'borehole') {
      return pick.type === 'borehole' && (pick.boreholeId === this.selected.id || pick.id === this.selected.id);
    }
    if (this.selected.type === 'geologicalUnit') return pick.unitId === this.selected.id || pick.id === this.selected.id;
    return super.matchesSelection(pick);
  }

  updateDetailPanel() {
    if (!this.detailPanel) return;
    this.detailPanel.querySelector('.panel-body').innerHTML = this.detailHtml(this.selected);
  }

  detailHtml(selection) {
    if (!selection) return '<div class="empty-state">Select a borehole, interval, or correlation line to inspect details.</div>';
    if (selection.type === 'borehole') {
      const borehole = this.inputs.borehole?.getBorehole?.(selection.id);
      const intervals = this.sortedIntervals(selection.id);
      return this.rows([
        ['Borehole ID', selection.id],
        ['Name', borehole?.boreholeName],
        ['Collar', borehole?.position ? `${formatScalar(borehole.position.x)}, ${formatScalar(borehole.position.y)}, ${formatScalar(borehole.position.z)}` : null],
        ['Total depth', borehole?.totalDepth],
        ['Interval count', intervals.length],
        ['Sample count', this.inputs.borehole?.getSamples?.(selection.id)?.length ?? 0]
      ]);
    }
    if (selection.type === 'boreholeInterval') {
      const boreholeId = selection.data?.boreholeId || this.selectedInterval?.boreholeId;
      const interval = selection.data?.interval || this.selectedInterval?.interval || this.sortedIntervals(boreholeId).find((item, index) => this.intervalId(item, index) === selection.id);
      const unitId = this.intervalUnit(interval);
      const unit = unitId ? this.inputs.geologicalBody?.getUnit?.(unitId) : null;
      const lithology = this.intervalLithology(interval);
      const mismatch = unit?.lithology && lithology && String(unit.lithology).toLowerCase() !== String(lithology).toLowerCase();
      const active = this.params.activeAttribute;
      return this.rows([
        ['Interval ID', selection.id],
        ['Borehole ID', boreholeId],
        ['Depth from', interval?.depthFrom],
        ['Depth to', interval?.depthTo],
        ['Lithology', lithology],
        ['Unit ID', unitId],
        ['Model match', unit ? (mismatch ? 'Lithology mismatch' : 'Matched') : unitId ? 'Unmatched unit' : 'No unit id'],
        [active || 'Grade / value', active ? interval?.[active] : (interval?.grade ?? interval?.value ?? interval?.attributeValue)]
      ]);
    }
    if (selection.type === 'geologicalUnit') {
      const unit = this.inputs.geologicalBody?.getUnit?.(selection.id);
      const matched = (this.inputs.borehole?.listBoreholes?.() || [])
        .flatMap((borehole) => this.sortedIntervals(borehole.boreholeId))
        .filter((interval) => this.intervalUnit(interval) === selection.id).length;
      return this.rows([
        ['Unit ID', selection.id],
        ['Name', unit?.geologicalUnitName || unit?.unitName],
        ['Type', unit?.geologicalUnitType || unit?.unitType],
        ['Lithology', unit?.lithology],
        ['Matched borehole intervals', matched]
      ]);
    }
    return super.detailHtml(selection);
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    [this.layerPanel, this.logPanel, this.correlationPanel, this.legendPanel, this.detailPanel, this.attributePanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

class GeologicalAttributeDistributionAnalysisRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Geological Attribute Distribution Analysis';
    this.params = {
      activeAttribute: null,
      colorMode: 'continuous',
      colormap: 'viridis',
      valueRangeMode: 'auto',
      minValue: null,
      maxValue: null,
      filterMode: 'highlight',
      rangeFilter: null,
      categoryFilter: [],
      renderMode: 'auto',
      blockRenderMode: 'sampled-boxes',
      maxRenderedElements: 8000,
      showHistogram: true,
      showTargetZone: true,
      showContextElements: true,
      selectedOpacity: 0.95,
      contextOpacity: 0.12,
      attributeLayerOpacity: 0.75,
      attributeModelOpacity: 0.75,
      showRoadwayContext: true,
      showGeologicalBodyContext: true,
      showStructureContext: true,
      showRoadway: true,
      showGeologicalBody: true,
      showStructures: true,
      showBoreholes: false,
      showAttributeModel: true,
      autoFocusOnSelection: true,
      ...(nodeModel.params || {})
    };
    this.attributeElements = [];
    this.renderedAttributeElements = [];
    this.attributeStats = null;
    this.targetZoneResult = null;
  }

  validateSemanticInputs() {
    const attributeModel = this.inputs.attributeModel;
    if (!attributeModel) throw new Error('Missing semantic dataset input: attributeModel');
    const actualClass = attributeModel.contract?.class || attributeModel.semanticClass;
    if (actualClass !== 'GeologicalAttributeModel') throw new Error(`Input attributeModel expects GeologicalAttributeModel, got ${actualClass}.`);
    if (attributeModel.validation?.errors?.length) {
      console.warn('[MineVis Geological Attribute Distribution] Attribute model validation errors:', attributeModel.validation.errors);
    }
    Object.entries(GeologicalAttributeDistributionInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Geological Attribute Distribution] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  async initializeRoadwayContext() {
    if (!this.params.showRoadwayContext) return;
    return super.initializeRoadwayContext();
  }

  async renderAllLayers() {
    if (this.inputs.geologicalBody && this.params.showContextElements && this.params.showGeologicalBodyContext) await this.renderGeologicalBodyLayer();
    if (this.inputs.geologicalStructure && this.params.showContextElements && this.params.showStructureContext) await this.renderStructureLayer();
    this.renderDistributionLayer();
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Attribute Distribution Controls', 'geology-panel geology-control-panel attribute-distribution-control-panel', '<div class="panel-body"></div>');
    this.correlationPanel = createWorkspacePanel('Attribute Histogram / Distribution', 'geology-panel attribute-histogram-panel', '<div class="panel-body"></div>');
    this.attributePanel = createWorkspacePanel('Attribute Summary', 'geology-panel geological-attribute-panel attribute-summary-panel', '<div class="panel-body"></div>');
    this.detailPanel = createWorkspacePanel('Attribute Element Detail', 'geology-panel geology-detail-panel attribute-detail-panel', '<div class="panel-body"></div>');
    this.legendPanel = createWorkspacePanel('Attribute Legend', 'geology-panel geology-legend-panel attribute-legend-panel', '<div class="panel-body"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '340px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '520px', width: '300px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '92px', width: '330px' });
    Object.assign(this.attributePanel.style, { right: '330px', top: '450px', width: '330px' });
    Object.assign(this.correlationPanel.style, { left: '380px', bottom: '28px', top: 'auto', width: '760px', maxHeight: '420px' });
  }

  registerVisualContributions() {
    this.registerSceneContribution('attribute-distribution-layer', '3D Attribute Distribution Layer', this.attributeGroup, 'geologicalAttributeModel', 'state', this.params.attributeLayerOpacity, {
      visualChannels: { color: 'activeGeologicalAttribute', opacity: 'filterState', halo: 'targetZone' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: this.params.attributeLayerOpacity, canPin: true }
    });
    if (this.inputs.geologicalBody && this.params.showContextElements && this.params.showGeologicalBodyContext) {
      this.registerSceneContribution('attribute-geological-context', 'Geological Body Context', this.bodyGroup, 'geologicalBody', 'context', this.params.contextOpacity);
    }
    if (this.inputs.geologicalStructure && this.params.showContextElements && this.params.showStructureContext) {
      this.registerSceneContribution('attribute-structure-context', 'Geological Structure Context', this.structureGroup, 'geologicalStructure', 'context', this.params.contextOpacity);
    }
    if (this.inputs.roadway && this.params.showRoadwayContext) {
      this.contributionRegistry.register({
        id: `${this.id}:attribute-roadway-context`,
        label: 'Roadway Context Layer',
        ownerId: this.id,
        functionId: this.functionId,
        type: 'scene-layer',
        host: 'main-3d-scene',
        contributionKind: 'layer',
        semanticRole: 'context',
        objectSystem: 'roadway',
        visible: true,
        opacity: this.params.contextOpacity,
        show: () => this.sceneManager.setRoadwayVisible?.(true),
        hide: () => this.sceneManager.setRoadwayVisible?.(false),
        setOpacity: (value) => this.sceneManager.setRoadwayOpacity?.(Number(value)),
        focus: () => this.sceneManager.focusOnRoadway?.()
      });
    }
    [
      ['controls', 'Attribute Control Panel', this.layerPanel, 'panel', 'control', 'right-panel'],
      ['histogram', 'Attribute Histogram / Distribution View', this.correlationPanel, 'chart', 'detail', 'bottom-panel'],
      ['summary', 'Attribute Summary Panel', this.attributePanel, 'panel', 'detail', 'right-panel'],
      ['detail', 'Attribute Detail Panel', this.detailPanel, 'panel', 'detail', 'right-panel'],
      ['legend', 'Attribute Legend', this.legendPanel, 'legend', 'legend', 'legend']
    ].forEach(([suffix, label, panel, type, semanticRole, host]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        host,
        contributionKind: type,
        semanticRole,
        objectSystem: 'geologicalAttributeModel',
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context?.subscribe?.('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context?.subscribe?.('activeGeologicalAttribute', (attribute) => {
      if (attribute && attribute !== this.params.activeAttribute) {
        this.params.activeAttribute = attribute;
        this.rerenderDistribution();
      }
    }));
    this.disposers.push(this.context?.subscribe?.('attributeRangeFilter', (filter) => {
      if (!filter || filter.attribute !== this.params.activeAttribute) return;
      this.params.minValue = filter.min;
      this.params.maxValue = filter.max;
      this.rerenderDistribution();
    }));
    const changeHandler = (event) => this.handleAttributeControlChange(event);
    const clickHandler = (event) => this.handleAttributePanelClick(event);
    [this.layerPanel, this.correlationPanel].forEach((panel) => {
      panel?.addEventListener?.('change', changeHandler);
      panel?.addEventListener?.('input', changeHandler);
      panel?.addEventListener?.('click', clickHandler);
      this.controlDisposers.push(() => {
        panel?.removeEventListener?.('change', changeHandler);
        panel?.removeEventListener?.('input', changeHandler);
        panel?.removeEventListener?.('click', clickHandler);
      });
    });
  }

  renderControls(container) {
    container.innerHTML = this.attributeControlsHtml({ compact: true });
    const handler = (event) => this.handleAttributeControlChange(event);
    container.addEventListener('change', handler);
    container.addEventListener('input', handler);
    this.controlDisposers.push(() => {
      container.removeEventListener('change', handler);
      container.removeEventListener('input', handler);
    });
  }

  getActiveAttribute() {
    const dataset = this.inputs.attributeModel;
    const attributes = dataset?.listAttributes?.() || [];
    let active = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || dataset?.getPrimaryAttribute?.() || attributes[0] || null;
    if (active && !attributes.includes(active)) active = attributes[0] || active;
    this.params.activeAttribute = active;
    return active;
  }

  collectAttributeElements(active, { forRender = false } = {}) {
    const dataset = this.inputs.attributeModel;
    if (!dataset || !active) return [];
    const grid = dataset.grid;
    const binaryKey = this.resolveBinaryAttributeKey(dataset, active);
    if (grid && binaryKey && dataset.binaryAttributes?.[binaryKey]?.length) {
      const values = dataset.binaryAttributes[binaryKey];
      const { nx, ny, nz } = this.gridDimensions(grid);
      const total = Math.max(0, nx * ny * nz);
      const origin = grid.origin || grid.bounds?.min || [0, 0, 0];
      const cell = grid.cellSize || [1, 1, 1];
      const max = Math.max(1, Number(this.params.maxRenderedElements) || 8000);
      const step = forRender ? Math.max(1, Math.ceil(total / max)) : Math.max(1, Math.ceil(total / 200000));
      const elements = [];
      for (let index = 0; index < total; index += step) {
        const value = Number(values[index]);
        if (!Number.isFinite(value)) continue;
        const ix = index % nx;
        const iy = Math.floor(index / nx) % ny;
        const iz = Math.floor(index / (nx * ny));
        const size = {
          x: Number(cell[0] ?? cell ?? 1),
          y: Number(cell[1] ?? cell ?? 1),
          z: Number(cell[2] ?? cell ?? 1)
        };
        elements.push({
          elementId: `VOX_${ix}_${iy}_${iz}`,
          blockId: `VOX_${ix}_${iy}_${iz}`,
          gridIndex: [ix, iy, iz],
          centroid: {
            x: Number(origin[0] || 0) + (ix + 0.5) * size.x,
            y: Number(origin[1] || 0) + (iy + 0.5) * size.y,
            z: Number(origin[2] || 0) + (iz + 0.5) * size.z
          },
          size,
          [active]: value,
          value,
          activeAttribute: active
        });
      }
      return elements;
    }
    const source = dataset.listBlocks?.()?.length ? dataset.listBlocks() : dataset.elements || [];
    const max = Math.max(1, Number(this.params.maxRenderedElements) || 8000);
    const step = forRender ? Math.max(1, Math.ceil(source.length / max)) : 1;
    return source.filter((_, index) => index % step === 0).map((element) => ({
      ...element,
      value: Number(dataset.getValue?.(element.elementId ?? element.blockId, active)),
      activeAttribute: active
    }));
  }

  computeAttributeState() {
    const active = this.getActiveAttribute();
    const all = this.collectAttributeElements(active, { forRender: false });
    const renderSource = this.collectAttributeElements(active, { forRender: true });
    const values = all.map((element) => Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active))).filter(Number.isFinite);
    const range = geologyNumericRange(values);
    const minValue = Number.isFinite(Number(this.params.minValue)) ? Number(this.params.minValue) : range.min;
    const maxValue = Number.isFinite(Number(this.params.maxValue)) ? Number(this.params.maxValue) : range.max;
    const filterMin = Math.min(minValue, maxValue);
    const filterMax = Math.max(minValue, maxValue);
    const isInRange = (element) => {
      const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
      return Number.isFinite(value) && value >= filterMin && value <= filterMax;
    };
    const selectedElements = all.filter(isInRange);
    const selectedValues = selectedElements.map((element) => Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active))).filter(Number.isFinite);
    this.attributeElements = all;
    this.attributeStats = {
      active,
      values,
      range,
      filterMin,
      filterMax,
      count: all.length,
      renderedCount: renderSource.length,
      filteredCount: selectedElements.length,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      filteredMean: selectedValues.length ? selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length : null
    };
    this.targetZoneResult = this.buildTargetZoneResult(selectedElements, this.attributeStats);
    this.renderedAttributeElements = renderSource;
    return { active, renderSource, isInRange, stats: this.attributeStats };
  }

  buildTargetZoneResult(elements, stats) {
    const active = stats.active;
    let volume = 0;
    let tonnage = 0;
    const bounds = new THREE.Box3();
    elements.forEach((element) => {
      const center = geologyPoint(element.centroid);
      if (Number.isFinite(center.x)) bounds.expandByPoint(center);
      const size = element.size || {};
      const cellVolume = Math.max(0, Number(size.x) || 0) * Math.max(0, Number(size.y) || 0) * Math.max(0, Number(size.z) || 0);
      volume += cellVolume;
      const density = Number(element.density ?? this.inputs.attributeModel?.getValue?.(element.elementId, 'density'));
      if (Number.isFinite(density)) tonnage += cellVolume * density;
    });
    return {
      attribute: active,
      min: stats.filterMin,
      max: stats.filterMax,
      elementIds: elements.map((element) => element.elementId ?? element.blockId),
      count: elements.length,
      volume,
      meanValue: stats.filteredMean,
      estimatedTonnage: tonnage || null,
      bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() }
    };
  }

  renderDistributionLayer() {
    if (!this.inputs.attributeModel) return;
    disposeThreeObject(this.attributeGroup);
    this.attributeGroup.clear();
    this.pickables = this.pickables.filter((object) => {
      let current = object;
      while (current) {
        if (current === this.attributeGroup) return false;
        current = current.parent;
      }
      return true;
    });
    const { active, renderSource, isInRange, stats } = this.computeAttributeState();
    if (!active || !renderSource.length) return;
    const mode = this.resolveAttributeRenderMode(renderSource);
    if (mode === 'points') this.renderAttributeDistributionPoints(active, renderSource, isInRange, stats);
    else this.renderAttributeDistributionBoxes(active, renderSource, isInRange, stats);
  }

  resolveAttributeRenderMode(elements) {
    const mode = String(this.params.renderMode || this.params.blockRenderMode || 'auto');
    if (mode === 'points' || mode === 'surface-samples') return 'points';
    if (mode === 'sampled-boxes' || mode === 'boxes') return 'sampled-boxes';
    if (mode === 'boundary-only') return 'points';
    return elements.some((element) => {
      const size = element.size || {};
      return Number(size.x) > 0 && Number(size.y) > 0 && Number(size.z) > 0;
    }) && elements.length <= Math.max(12000, Number(this.params.maxRenderedElements) || 8000)
      ? 'sampled-boxes'
      : 'points';
  }

  colorForAttributeValue(value, stats, inRange) {
    if (!Number.isFinite(value)) return new THREE.Color('#64748b');
    if (!inRange && this.params.filterMode === 'highlight') return new THREE.Color('#475569');
    const t = (value - stats.range.min) / (stats.range.max - stats.range.min || 1);
    return new THREE.Color(sampleColor(this.params.colormap || 'viridis', t));
  }

  renderAttributeDistributionPoints(active, elements, isInRange, stats) {
    const visible = this.params.filterMode === 'selected-only' || this.params.filterMode === 'hide-filtered'
      ? elements.filter(isInRange)
      : elements;
    const positions = [];
    const colors = [];
    const plotted = [];
    visible.forEach((element) => {
      const center = geologyPoint(element.centroid);
      if (!Number.isFinite(center.x)) return;
      const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
      const color = this.colorForAttributeValue(value, stats, isInRange(element));
      positions.push(center.x, center.y, center.z);
      colors.push(color.r, color.g, color.b);
      plotted.push(element);
    });
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 7,
      vertexColors: true,
      transparent: true,
      opacity: Number(this.params.attributeLayerOpacity) || 0.75,
      sizeAttenuation: true,
      depthTest: true,
      depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 22;
    points.userData.geologyPick = { type: 'geologicalAttributeElementCollection', id: 'attribute-points', elements: plotted, activeAttribute: active };
    this.pickables.push(points);
    this.attributeGroup.add(points);
  }

  renderAttributeDistributionBoxes(active, elements, isInRange, stats) {
    const visible = this.params.filterMode === 'selected-only' || this.params.filterMode === 'hide-filtered'
      ? elements.filter(isInRange)
      : elements;
    const plotted = visible.filter((element) => Number.isFinite(geologyPoint(element.centroid).x));
    if (!plotted.length) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: Number(this.params.attributeLayerOpacity) || 0.75,
      roughness: 0.62,
      metalness: 0.02,
      depthWrite: false
    });
    const mesh = new THREE.InstancedMesh(geometry, material, plotted.length);
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();
    plotted.forEach((element, index) => {
      const center = geologyPoint(element.centroid);
      const size = element.size || {};
      const scale = new THREE.Vector3(Number(size.x) || 6, Number(size.y) || 6, Number(size.z) || 6);
      transform.compose(center, new THREE.Quaternion(), scale);
      mesh.setMatrixAt(index, transform);
      const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
      color.copy(this.colorForAttributeValue(value, stats, isInRange(element)));
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = 22;
    mesh.userData.geologyPick = { type: 'geologicalAttributeElementCollection', id: 'attribute-boxes', elements: plotted, activeAttribute: active };
    this.pickables.push(mesh);
    this.attributeGroup.add(mesh);
  }

  rerenderDistribution({ panels = true } = {}) {
    this.renderDistributionLayer();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updateLegend();
    if (panels) this.updatePanels();
  }

  updatePanels() {
    if (!this.attributeStats) this.computeAttributeState();
    if (this.layerPanel) this.layerPanel.querySelector('.panel-body').innerHTML = this.attributeControlsHtml();
    if (this.correlationPanel) {
      this.correlationPanel.style.display = this.params.showHistogram ? '' : 'none';
      this.correlationPanel.querySelector('.panel-body').innerHTML = this.params.showHistogram ? this.histogramHtml() : '';
    }
    this.updateAttributeSummary();
    this.updateDetailPanel();
    this.syncAttributeControls();
  }

  attributeControlsHtml({ compact = false } = {}) {
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const active = this.getActiveAttribute() || '';
    const stats = this.attributeStats || this.computeAttributeState().stats;
    const min = Number.isFinite(Number(this.params.minValue)) ? Number(this.params.minValue) : stats.range.min;
    const max = Number.isFinite(Number(this.params.maxValue)) ? Number(this.params.maxValue) : stats.range.max;
    return `
      <div class="geology-analysis-form">
        <section class="geology-form-section">
          <div class="geology-form-section-title">Attribute</div>
          <div class="geology-form-grid">
            <label class="geology-form-row"><span>Attribute</span><select data-attribute-param="activeAttribute">
              ${attributes.map((name) => `<option value="${escapeHtml(name)}" ${active === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Colormap</span><select data-attribute-param="colormap">
              ${['viridis', 'heat', 'rainbow'].map((name) => `<option value="${name}" ${this.params.colormap === name ? 'selected' : ''}>${name}</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Filter mode</span><select data-attribute-param="filterMode">
              ${['highlight', 'selected-only', 'hide-filtered'].map((name) => `<option value="${name}" ${this.params.filterMode === name ? 'selected' : ''}>${name}</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Render mode</span><select data-attribute-param="renderMode">
              ${['auto', 'points', 'sampled-boxes', 'surface-samples', 'boundary-only'].map((name) => `<option value="${name}" ${this.params.renderMode === name ? 'selected' : ''}>${name}</option>`).join('')}
            </select></label>
          </div>
        </section>
        <section class="geology-form-section">
          <div class="geology-form-section-title">Range / Rendering</div>
          <div class="geology-form-grid">
            <label class="geology-form-row"><span>Min</span><input type="number" step="0.001" data-attribute-param="minValue" value="${formatScalar(min, 4)}"></label>
            <label class="geology-form-row"><span>Max</span><input type="number" step="0.001" data-attribute-param="maxValue" value="${formatScalar(max, 4)}"></label>
            <label class="geology-form-row"><span>Max elements</span><input type="number" min="100" step="100" data-attribute-param="maxRenderedElements" value="${escapeHtml(this.params.maxRenderedElements)}"></label>
          </div>
          <div class="geology-control-stack compact">
            ${this.compactSliderRow({ key: 'attributeLayerOpacity', label: 'Layer opacity', min: 0.05, max: 1, step: 0.05, digits: 2, dataAttr: 'data-attribute-param' })}
          </div>
        </section>
        <section class="geology-form-section">
          <div class="geology-form-section-title">Visible Context</div>
          <div class="geology-toggle-grid">
            <label class="geology-toggle-row"><input type="checkbox" data-attribute-param="showHistogram" ${this.params.showHistogram ? 'checked' : ''}><span>Histogram</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-attribute-param="showTargetZone" ${this.params.showTargetZone ? 'checked' : ''}><span>Target zone</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-attribute-param="showContextElements" ${this.params.showContextElements ? 'checked' : ''}><span>Context</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-attribute-param="showGeologicalBodyContext" ${this.params.showGeologicalBodyContext ? 'checked' : ''}><span>Geological body</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-attribute-param="showRoadwayContext" ${this.params.showRoadwayContext ? 'checked' : ''}><span>Roadway</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-attribute-param="showStructureContext" ${this.params.showStructureContext ? 'checked' : ''}><span>Structures</span></label>
          </div>
        </section>
        ${compact ? '' : '<div class="geology-form-actions"><button type="button" data-attribute-reset-range>Reset range</button></div>'}
      </div>`;
  }

  histogramHtml() {
    const stats = this.attributeStats || this.computeAttributeState().stats;
    const values = stats.values || [];
    if (!values.length) return '<div class="empty-state">No numeric values available for this attribute.</div>';
    const bins = 24;
    const counts = Array.from({ length: bins }, () => 0);
    values.forEach((value) => {
      const t = (value - stats.range.min) / (stats.range.max - stats.range.min || 1);
      counts[Math.max(0, Math.min(bins - 1, Math.floor(t * bins)))] += 1;
    });
    const width = 720;
    const height = 220;
    const chartLeft = 46;
    const chartTop = 18;
    const chartWidth = width - chartLeft - 24;
    const chartHeight = 142;
    const maxCount = Math.max(...counts, 1);
    const filterMinT = (stats.filterMin - stats.range.min) / (stats.range.max - stats.range.min || 1);
    const filterMaxT = (stats.filterMax - stats.range.min) / (stats.range.max - stats.range.min || 1);
    const bars = counts.map((count, index) => {
      const x = chartLeft + (index / bins) * chartWidth;
      const w = chartWidth / bins - 2;
      const h = (count / maxCount) * chartHeight;
      const t = (index + 0.5) / bins;
      return `<rect x="${x}" y="${chartTop + chartHeight - h}" width="${w}" height="${h}" fill="${sampleColor(this.params.colormap || 'viridis', t)}" opacity="0.9" />`;
    }).join('');
    return `
      <div class="attribute-histogram-content">
        <svg viewBox="0 0 ${width} ${height}" role="img">
          <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#101722" />
          <text x="16" y="22" font-size="11" fill="#a7b4c5">Count</text>
          <text x="${chartLeft}" y="${height - 18}" font-size="11" fill="#a7b4c5">${formatScalar(stats.range.min)}</text>
          <text x="${width - 96}" y="${height - 18}" font-size="11" fill="#a7b4c5">${formatScalar(stats.range.max)}</text>
          <line x1="${chartLeft}" y1="${chartTop + chartHeight}" x2="${chartLeft + chartWidth}" y2="${chartTop + chartHeight}" stroke="#526074" />
          ${bars}
          <rect x="${chartLeft + Math.max(0, filterMinT) * chartWidth}" y="${chartTop}" width="${Math.max(1, (filterMaxT - filterMinT) * chartWidth)}" height="${chartHeight}" fill="none" stroke="#facc15" stroke-width="2" />
          <text x="${chartLeft}" y="${height - 44}" font-size="12" fill="#d7dde7">${escapeHtml(stats.active)}: ${formatScalar(stats.filterMin)} - ${formatScalar(stats.filterMax)}</text>
          <text x="${chartLeft + 260}" y="${height - 44}" font-size="12" fill="#d7dde7">Filtered ${stats.filteredCount} / ${stats.count}</text>
        </svg>
        <div class="geology-control-stack attribute-range-controls">
          ${this.compactSliderRow({ key: 'minValue', label: 'Range min', min: stats.range.min, max: stats.range.max, step: (stats.range.max - stats.range.min) / 200 || 0.01, digits: 4, dataAttr: 'data-attribute-param', valueOverride: stats.filterMin })}
          ${this.compactSliderRow({ key: 'maxValue', label: 'Range max', min: stats.range.min, max: stats.range.max, step: (stats.range.max - stats.range.min) / 200 || 0.01, digits: 4, dataAttr: 'data-attribute-param', valueOverride: stats.filterMax })}
        </div>
      </div>`;
  }

  updateAttributeSummary() {
    if (!this.attributePanel) return;
    const stats = this.attributeStats || this.computeAttributeState().stats;
    const target = this.targetZoneResult;
    this.attributePanel.querySelector('.panel-body').innerHTML = `
      ${this.rows([
        ['Active attribute', stats.active],
        ['Total elements', formatScalar(stats.count, 0)],
        ['Rendered elements', formatScalar(stats.renderedCount, 0)],
        ['Filtered elements', formatScalar(stats.filteredCount, 0)],
        ['Min / max', `${formatScalar(stats.range.min)} - ${formatScalar(stats.range.max)}`],
        ['Mean', stats.mean == null ? null : formatScalar(stats.mean, 4)]
      ])}
      ${this.params.showTargetZone && target ? `<div class="geology-detail-subtitle">Target Zone</div>${this.rows([
        ['Range', `${formatScalar(target.min)} - ${formatScalar(target.max)}`],
        ['Elements', formatScalar(target.count, 0)],
        ['Mean value', target.meanValue == null ? null : formatScalar(target.meanValue, 4)],
        ['Volume', target.volume ? `${formatScalar(target.volume, 1)} m3` : null],
        ['Estimated tonnage', target.estimatedTonnage ? formatScalar(target.estimatedTonnage, 1) : null]
      ])}<button type="button" disabled>Save Target Zone (future)</button>` : ''}`;
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const stats = this.attributeStats || this.computeAttributeState().stats;
    this.legendPanel.querySelector('.panel-body').innerHTML = `
      <div class="geology-gradient">
        <span>${escapeHtml(stats.active || 'Attribute')}</span>
        <div style="background:${generateCssGradient(this.params.colormap || 'viridis')}"></div>
        <small>${formatScalar(stats.range.min)} - ${formatScalar(stats.range.max)}</small>
      </div>
      <div class="route-legend-list">
        <div class="legend-row"><span class="legend-line" style="background:#facc15"></span><span>Filtered target range</span></div>
        <div class="legend-row"><span class="legend-dot" style="background:#475569"></span><span>Context / outside range</span></div>
      </div>`;
  }

  handleAttributeControlChange(event) {
    const target = event.target;
    const key = target?.dataset?.attributeParam;
    if (!key) return;
    if (target.type === 'checkbox') this.params[key] = target.checked;
    else if (target.type === 'number' || target.type === 'range') this.params[key] = Number(target.value);
    else this.params[key] = target.value;
    if (key === 'activeAttribute') {
      this.params.minValue = null;
      this.params.maxValue = null;
      this.context?.set?.('activeGeologicalAttribute', this.params.activeAttribute || null);
    }
    if (['showContextElements', 'showGeologicalBodyContext', 'showStructureContext', 'showRoadwayContext'].includes(key)) {
      if (this.bodyGroup) this.bodyGroup.visible = !!(this.params.showContextElements && this.params.showGeologicalBodyContext);
      if (this.structureGroup) this.structureGroup.visible = !!(this.params.showContextElements && this.params.showStructureContext);
      this.sceneManager?.setRoadwayVisible?.(!!(this.params.showContextElements && this.params.showRoadwayContext));
    }
    if (['minValue', 'maxValue'].includes(key)) {
      this.context?.set?.('attributeRangeFilter', { attribute: this.params.activeAttribute, min: this.params.minValue, max: this.params.maxValue });
    }
    this.rerenderDistribution();
  }

  handleAttributePanelClick(event) {
    if (event.target?.closest?.('[data-attribute-reset-range]')) {
      this.params.minValue = null;
      this.params.maxValue = null;
      this.rerenderDistribution();
    }
  }

  syncAttributeControls() {
    [this.layerPanel, this.correlationPanel].forEach((panel) => {
      panel?.querySelectorAll?.('[data-attribute-param]').forEach((input) => {
        const key = input.dataset.attributeParam;
        if (input.type === 'checkbox') input.checked = !!this.params[key];
        else if (key in this.params && this.params[key] != null && input.value !== String(this.params[key])) input.value = this.params[key];
      });
    });
  }

  handleGeologyPick(entity) {
    if (entity.type === 'geologicalAttributeElementCollection' && entity.elements?.length && Number.isInteger(entity.index)) {
      const element = entity.elements[entity.index] || entity.elements[0];
      if (element) this.setSelection('geologicalAttributeElement', element.elementId ?? element.blockId, element);
      return;
    }
    if (entity.type === 'geologicalBlockCollection' && entity.elements?.length && Number.isInteger(entity.index)) {
      const element = entity.elements[entity.index] || entity.elements[0];
      if (element) this.setSelection('geologicalAttributeElement', element.elementId ?? element.blockId, element);
      return;
    }
    this.setSelection(entity.type, entity.id, entity);
  }

  setSelection(type, id, extra = {}) {
    if (!id) return;
    this.selected = { type, id, data: extra };
    if (type === 'geologicalAttributeElement') {
      this.context?.set?.('selectedAttributeElement', id);
      this.context?.set?.('selectedBlock', id);
    }
    this.context?.set?.('selection', { type, id, data: extra });
    this.updateHighlight();
    this.updateDetailPanel();
  }

  applyContextSelection(selection) {
    if (!selection || !selection.type || !selection.id) {
      this.selected = null;
      this.updateHighlight();
      this.updateDetailPanel();
      return;
    }
    if (!['geologicalAttributeElement', 'geologicalBlock', 'geologicalUnit', 'geologicalSurface'].includes(selection.type)) return;
    this.selected = selection.type === 'geologicalBlock' ? { ...selection, type: 'geologicalAttributeElement' } : selection;
    this.updateHighlight();
    this.updateDetailPanel();
  }

  matchesSelection(pick) {
    if (!this.selected || !pick) return false;
    if (this.selected.type === 'geologicalAttributeElement') {
      return pick.elementId === this.selected.id || pick.blockId === this.selected.id || pick.id === this.selected.id;
    }
    return super.matchesSelection(pick);
  }

  updateHighlight() {
    super.updateHighlight();
    if (!this.selected || this.selected.type !== 'geologicalAttributeElement') return;
    const element = this.selected.data || this.attributeElements.find((item) => String(item.elementId ?? item.blockId) === String(this.selected.id));
    if (!element?.centroid) return;
    const center = geologyPoint(element.centroid);
    const size = element.size || {};
    const radius = Math.max(Number(size.x) || 6, Number(size.y) || 6, Number(size.z) || 6, 6) * 0.75;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 10),
      new THREE.MeshBasicMaterial({ color: '#facc15', wireframe: true, transparent: true, opacity: 0.95, depthTest: false })
    );
    marker.position.copy(center);
    marker.renderOrder = 60;
    this.highlightGroup.add(marker);
  }

  updateDetailPanel() {
    if (!this.detailPanel) return;
    this.detailPanel.querySelector('.panel-body').innerHTML = this.detailHtml(this.selected);
  }

  detailHtml(selection) {
    if (!selection) return '<div class="empty-state">Select an attribute element to inspect values.</div>';
    if (selection.type === 'geologicalAttributeElement') {
      const element = selection.data || this.attributeElements.find((item) => String(item.elementId ?? item.blockId) === String(selection.id));
      const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
      const active = this.getActiveAttribute();
      const rows = [
        ['Element ID', selection.id],
        ['Position', element?.centroid ? `${formatScalar(element.centroid.x)}, ${formatScalar(element.centroid.y)}, ${formatScalar(element.centroid.z)}` : null],
        ['Size', element?.size ? `${formatScalar(element.size.x)}, ${formatScalar(element.size.y)}, ${formatScalar(element.size.z)}` : null],
        ['Active attribute', active],
        ['Active value', element ? (element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active)) : null],
        ['Lithology', element?.lithology],
        ['Orebody / unit', element?.orebodyId ?? element?.bodyId ?? element?.seamId],
        ['Resource category', element?.resourceCategory ?? element?.category]
      ];
      const valueRows = attributes
        .map((name) => [name, element ? (element[name] ?? this.inputs.attributeModel?.getValue?.(element.elementId, name)) : null])
        .filter(([, value]) => value != null && value !== '');
      return `${this.rows(rows)}${valueRows.length ? `<div class="geology-detail-subtitle">All attributes</div>${this.rows(valueRows)}` : ''}`;
    }
    return super.detailHtml(selection);
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    [this.layerPanel, this.correlationPanel, this.attributePanel, this.detailPanel, this.legendPanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

class RoadwayGeologyRelationshipAnalysisRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Roadway-Geology Relationship Analysis';
    this.params = {
      analysisMode: 'risk-level',
      showRoadwayOverlay: true,
      showGeologicalBodyContext: true,
      showStructures: true,
      showBoreholes: false,
      showProfile: true,
      activeAttribute: null,
      structureWarningDistance: 50,
      structureCriticalDistance: 20,
      attributeThreshold: null,
      attributeRiskDirection: 'high',
      colorMode: 'risk-level',
      sampleInterval: 10,
      maxSamplesPerEdge: 20,
      filterRiskLevel: 'all',
      filterGeologicalUnit: 'all',
      filterStructureProximity: 'all',
      roadwayOverlayOpacity: 0.9,
      contextOpacity: 0.2,
      autoCreateSectionFromSelectedRoadway: false,
      showRoadway: true,
      showGeologicalBody: true,
      showAttributeModel: false,
      geologicalBodyOpacity: 0.2,
      structureOpacity: 0.55,
      boreholeOpacity: 0.9,
      ...(nodeModel.params || {})
    };
    this.relationResult = null;
    this.mapHitEdges = [];
  }

  validateSemanticInputs() {
    const roadway = this.inputs.roadway;
    if (!roadway) throw new Error('Missing semantic dataset input: roadway');
    const actualClass = roadway.contract?.class || roadway.semanticClass;
    if (actualClass !== 'Roadway') throw new Error(`Input roadway expects Roadway, got ${actualClass}.`);
    Object.entries(RoadwayGeologyRelationshipInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Roadway-Geology Relationship] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  async renderAllLayers() {
    await this.initializeRoadwayContext();
    this.computeRelations();
    if (this.inputs.geologicalBody && this.params.showGeologicalBodyContext) await this.renderGeologicalBodyLayer();
    if (this.inputs.geologicalStructure && this.params.showStructures) await this.renderStructureLayer();
    if (this.inputs.borehole && this.params.showBoreholes) this.renderBoreholeLayer();
    this.renderRelationshipOverlay();
  }

  async initializeRoadwayContext() {
    const roadway = this.inputs.roadway;
    if (!roadway) return;
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping?.(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping?.(), roadway);
    else this.sceneManager.buildRoadway?.(roadway);
    this.sceneManager.setRoadwayVisible?.(true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacity?.(0.16);
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Roadway-Geology Controls', 'geology-panel roadway-geology-control-panel', '<div class="panel-body"></div>');
    this.correlationPanel = createWorkspacePanel('Roadway-Geology Map View', 'geology-panel roadway-geology-map-panel', '<canvas class="roadway-geology-map" width="680" height="360"></canvas>');
    this.attributePanel = createWorkspacePanel('Roadway Geological Profile', 'geology-panel roadway-geology-profile-panel', '<div class="panel-body"></div>');
    this.detailPanel = createWorkspacePanel('Roadway-Geology Relation Table', 'geology-panel roadway-geology-table-panel', '<div class="panel-body"></div>');
    this.legendPanel = createWorkspacePanel('Roadway-Geology Legend / Summary', 'geology-panel roadway-geology-legend-panel', '<div class="panel-body"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '340px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '548px', width: '320px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '92px', width: '420px' });
    Object.assign(this.attributePanel.style, { right: '330px', top: '540px', width: '420px' });
    Object.assign(this.correlationPanel.style, { left: '380px', bottom: '28px', top: 'auto', width: '700px', maxHeight: '430px' });
  }

  registerVisualContributions() {
    this.registerSceneContribution('roadway-geology-overlay', '3D Roadway-Geology Relationship Overlay', this.attributeGroup, 'roadway', 'diagnostic', this.params.roadwayOverlayOpacity, {
      visualChannels: { color: 'roadwayGeologyRelation', halo: 'riskLevel' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: this.params.roadwayOverlayOpacity, canPin: true }
    });
    if (this.inputs.geologicalBody && this.params.showGeologicalBodyContext) this.registerSceneContribution('roadway-geology-body-context', 'Geological Body Context', this.bodyGroup, 'geologicalBody', 'context', this.params.contextOpacity);
    if (this.inputs.geologicalStructure && this.params.showStructures) this.registerSceneContribution('roadway-geology-structure-context', 'Geological Structure Context', this.structureGroup, 'geologicalStructure', 'context', this.params.contextOpacity);
    [
      ['controls', 'Control Panel', this.layerPanel, 'panel', 'control', 'right-panel'],
      ['map', 'Roadway-Geology Topology / Map View', this.correlationPanel, 'topology-view', 'detail', 'bottom-panel'],
      ['profile', 'Roadway Geological Profile Panel', this.attributePanel, 'panel', 'detail', 'bottom-panel'],
      ['table', 'Roadway-Geology Relation Table', this.detailPanel, 'panel', 'detail', 'right-panel'],
      ['legend', 'Legend / Summary', this.legendPanel, 'legend', 'legend', 'legend']
    ].forEach(([suffix, label, panel, type, semanticRole, host]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        host,
        contributionKind: type,
        semanticRole,
        objectSystem: 'roadwayGeologyRelation',
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context?.subscribe?.('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context?.subscribe?.('activeGeologicalAttribute', (attribute) => {
      if (attribute && attribute !== this.params.activeAttribute) {
        this.params.activeAttribute = attribute;
        this.recomputeAndRender();
      }
    }));
    const changeHandler = (event) => this.handleRelationshipControlChange(event);
    const clickHandler = (event) => this.handleRelationshipClick(event);
    [this.layerPanel, this.detailPanel, this.correlationPanel].forEach((panel) => {
      panel?.addEventListener?.('change', changeHandler);
      panel?.addEventListener?.('input', changeHandler);
      panel?.addEventListener?.('click', clickHandler);
      this.controlDisposers.push(() => {
        panel?.removeEventListener?.('change', changeHandler);
        panel?.removeEventListener?.('input', changeHandler);
        panel?.removeEventListener?.('click', clickHandler);
      });
    });
  }

  renderControls(container) {
    container.innerHTML = this.controlsHtml({ compact: true });
    const handler = (event) => this.handleRelationshipControlChange(event);
    container.addEventListener('change', handler);
    container.addEventListener('input', handler);
    this.controlDisposers.push(() => {
      container.removeEventListener('change', handler);
      container.removeEventListener('input', handler);
    });
  }

  activeAttribute() {
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const active = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || this.inputs.attributeModel?.getPrimaryAttribute?.() || attributes[0] || null;
    this.params.activeAttribute = active;
    return active;
  }

  computeRelations() {
    this.relationResult = buildRoadwayGeologyRelationResult({
      roadway: this.inputs.roadway,
      geologicalBody: this.inputs.geologicalBody,
      geologicalStructure: this.inputs.geologicalStructure,
      attributeModel: this.inputs.attributeModel,
      borehole: this.inputs.borehole,
      activeAttribute: this.activeAttribute(),
      params: this.params
    });
    return this.relationResult;
  }

  recomputeAndRender() {
    this.computeRelations();
    this.renderRelationshipOverlay();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updatePanels();
    this.updateLegend();
  }

  renderRelationshipOverlay() {
    disposeThreeObject(this.attributeGroup);
    this.attributeGroup.clear();
    this.pickables = this.pickables.filter((object) => {
      let current = object;
      while (current) {
        if (current === this.attributeGroup) return false;
        current = current.parent;
      }
      return true;
    });
    if (!this.params.showRoadwayOverlay) return;
    const relations = this.filteredRelations();
    relations.forEach((relation) => {
      if (!relation.path?.length || relation.path.length < 2) return;
      const points = relation.path.map((point) => new THREE.Vector3(point.x, point.y + 1.5, point.z));
      const curve = new THREE.CatmullRomCurve3(points);
      const radius = relation.riskLevel === 'high' ? 2.4 : relation.riskLevel === 'medium' ? 1.9 : 1.45;
      const geometry = new THREE.TubeGeometry(curve, Math.max(4, points.length * 6), radius, 8, false);
      const selected = this.selected?.type === 'roadwaySegment' && this.selected.id === relation.edgeId;
      const material = new THREE.MeshBasicMaterial({
        color: selected ? '#facc15' : this.colorForRelation(relation),
        transparent: true,
        opacity: Number(this.params.roadwayOverlayOpacity) || 0.9,
        depthTest: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = selected ? 55 : 40;
      mesh.userData.geologyPick = { type: 'roadwaySegment', id: relation.edgeId, edgeId: relation.edgeId, relation };
      this.pickables.push(mesh);
      this.attributeGroup.add(mesh);
    });
  }

  colorForRelation(relation) {
    const mode = this.params.colorMode || this.params.analysisMode;
    if (mode === 'geological-unit') return relation.dominantGeologicalUnit ? geologyColorForKey(relation.dominantGeologicalUnit) : '#94a3b8';
    if (mode === 'structure-distance') {
      const d = Number(relation.distanceToStructure);
      if (!Number.isFinite(d)) return '#94a3b8';
      if (d < Number(this.params.structureCriticalDistance)) return '#ef4444';
      if (d < Number(this.params.structureWarningDistance)) return '#f59e0b';
      return '#22c55e';
    }
    if (mode === 'active-attribute') {
      const values = this.relationResult?.relations?.map((item) => Number(item.activeAttributeValue)).filter(Number.isFinite) || [];
      const range = geologyNumericRange(values);
      const value = Number(relation.activeAttributeValue);
      return Number.isFinite(value) ? sampleColor('viridis', (value - range.min) / (range.max - range.min || 1)) : '#94a3b8';
    }
    if (mode === 'uniform') return '#38bdf8';
    return relation.riskLevel === 'high' ? '#ef4444' : relation.riskLevel === 'medium' ? '#f59e0b' : '#22c55e';
  }

  filteredRelations() {
    const rows = this.relationResult?.relations || [];
    return rows.filter((relation) => {
      if (this.params.filterRiskLevel !== 'all' && relation.riskLevel !== this.params.filterRiskLevel) return false;
      if (this.params.filterGeologicalUnit !== 'all' && relation.dominantGeologicalUnit !== this.params.filterGeologicalUnit) return false;
      if (this.params.filterStructureProximity === 'near' && !(relation.distanceToStructure < Number(this.params.structureWarningDistance))) return false;
      if (this.params.filterStructureProximity === 'critical' && !(relation.distanceToStructure < Number(this.params.structureCriticalDistance))) return false;
      return true;
    });
  }

  updatePanels() {
    if (!this.relationResult) this.computeRelations();
    if (this.layerPanel) this.layerPanel.querySelector('.panel-body').innerHTML = this.controlsHtml();
    if (this.detailPanel) this.detailPanel.querySelector('.panel-body').innerHTML = this.tableHtml();
    if (this.attributePanel) {
      this.attributePanel.style.display = this.params.showProfile ? '' : 'none';
      this.attributePanel.querySelector('.panel-body').innerHTML = this.profileHtml();
    }
    this.drawMap();
    this.updateLegend();
  }

  controlsHtml({ compact = false } = {}) {
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const units = [...new Set((this.relationResult?.relations || []).map((relation) => relation.dominantGeologicalUnit).filter(Boolean))];
    return `
      <div class="geology-analysis-form">
        <section class="geology-form-section">
          <div class="geology-form-section-title">Analysis</div>
          <div class="geology-form-grid">
            <label class="geology-form-row"><span>Analysis mode</span><select data-rg-param="analysisMode">
              ${['risk-level', 'geological-unit', 'structure-proximity', 'attribute-sampling'].map((value) => `<option value="${value}" ${this.params.analysisMode === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Color mode</span><select data-rg-param="colorMode">
              ${['risk-level', 'geological-unit', 'structure-distance', 'active-attribute', 'uniform'].map((value) => `<option value="${value}" ${this.params.colorMode === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Active attribute</span><select data-rg-param="activeAttribute">
              <option value="">None</option>
              ${attributes.map((name) => `<option value="${escapeHtml(name)}" ${this.params.activeAttribute === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select></label>
          </div>
        </section>
        <section class="geology-form-section">
          <div class="geology-form-section-title">Thresholds</div>
          <div class="geology-form-grid">
            <label class="geology-form-row"><span>Warning distance</span><input type="number" data-rg-param="structureWarningDistance" value="${escapeHtml(this.params.structureWarningDistance)}"></label>
            <label class="geology-form-row"><span>Critical distance</span><input type="number" data-rg-param="structureCriticalDistance" value="${escapeHtml(this.params.structureCriticalDistance)}"></label>
            <label class="geology-form-row"><span>Attribute threshold</span><input type="number" data-rg-param="attributeThreshold" value="${this.params.attributeThreshold ?? ''}"></label>
            <label class="geology-form-row"><span>Risk direction</span><select data-rg-param="attributeRiskDirection">
              ${['high', 'low'].map((value) => `<option value="${value}" ${this.params.attributeRiskDirection === value ? 'selected' : ''}>${value} is risky</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Sample interval</span><input type="number" data-rg-param="sampleInterval" value="${escapeHtml(this.params.sampleInterval)}"></label>
          </div>
        </section>
        <section class="geology-form-section">
          <div class="geology-form-section-title">Filters</div>
          <div class="geology-form-grid">
            <label class="geology-form-row"><span>Risk filter</span><select data-rg-param="filterRiskLevel">
              ${['all', 'low', 'medium', 'high'].map((value) => `<option value="${value}" ${this.params.filterRiskLevel === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select></label>
            <label class="geology-form-row"><span>Unit filter</span><select data-rg-param="filterGeologicalUnit">
              <option value="all">all</option>
              ${units.map((unit) => `<option value="${escapeHtml(unit)}" ${this.params.filterGeologicalUnit === unit ? 'selected' : ''}>${escapeHtml(unit)}</option>`).join('')}
            </select></label>
          </div>
        </section>
        <section class="geology-form-section">
          <div class="geology-form-section-title">Visible Context</div>
          <div class="geology-toggle-grid">
            <label class="geology-toggle-row"><input type="checkbox" data-rg-param="showRoadwayOverlay" ${this.params.showRoadwayOverlay ? 'checked' : ''}><span>Roadway overlay</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-rg-param="showGeologicalBodyContext" ${this.params.showGeologicalBodyContext ? 'checked' : ''}><span>Geological body</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-rg-param="showStructures" ${this.params.showStructures ? 'checked' : ''}><span>Structures</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-rg-param="showBoreholes" ${this.params.showBoreholes ? 'checked' : ''}><span>Boreholes</span></label>
            <label class="geology-toggle-row"><input type="checkbox" data-rg-param="showProfile" ${this.params.showProfile ? 'checked' : ''}><span>Profile</span></label>
          </div>
        </section>
        ${compact ? '' : '<div class="geology-form-actions"><button type="button" data-rg-create-section>Create Section Near Selected Roadway</button></div>'}
      </div>`;
  }

  tableHtml() {
    const rows = this.filteredRelations().slice().sort((a, b) => b.riskScore - a.riskScore || (a.distanceToStructure ?? Infinity) - (b.distanceToStructure ?? Infinity));
    return `
      <div class="relation-table-header">
        <span>Edge</span>
        <span>Risk</span>
        <span>Structure</span>
        <span>Attribute</span>
      </div>
      <div class="scroll-list relation-table">
        ${rows.map((relation) => `
          <button type="button" class="relation-row ${this.selected?.id === relation.edgeId ? 'selected' : ''}" data-rg-edge="${escapeHtml(relation.edgeId)}">
            <span>${escapeHtml(relation.edgeId)}</span>
            <span>${escapeHtml(relation.riskLevel)}</span>
            <span>${relation.distanceToStructure == null ? '-' : `${formatScalar(relation.distanceToStructure, 1)} m`}</span>
            <span>${relation.activeAttributeValue == null ? '-' : formatScalar(relation.activeAttributeValue, 3)}</span>
          </button>`).join('')}
      </div>
      ${this.selected ? this.detailRowsHtml(this.selected.id) : '<div class="empty-state">Select a roadway segment to inspect details.</div>'}`;
  }

  detailRowsHtml(edgeId) {
    const relation = this.relationResult?.edgeRelations?.get(edgeId);
    if (!relation) return '';
    return `<div class="geology-detail-subtitle">Selected Segment</div>${this.rows([
      ['Edge ID', relation.edgeId],
      ['Length', `${formatScalar(relation.length, 1)} m`],
      ['Dominant geological unit', relation.dominantGeologicalUnit],
      ['Nearest structure', relation.nearestStructureId],
      ['Structure type', relation.nearestStructureType],
      ['Distance to structure', relation.distanceToStructure == null ? null : `${formatScalar(relation.distanceToStructure, 1)} m`],
      [`${this.params.activeAttribute || 'Attribute'} mean`, relation.activeAttributeValue == null ? null : formatScalar(relation.activeAttributeValue, 4)],
      ['Risk level', relation.riskLevel],
      ['Nearby boreholes', relation.nearbyBoreholes.map((item) => item.boreholeId).join(', ')],
      ['Recommendation', relation.recommendation]
    ])}`;
  }

  profileHtml() {
    const relation = this.relationResult?.edgeRelations?.get(this.selected?.id) || this.filteredRelations()[0];
    if (!relation) return '<div class="empty-state">No roadway relation profile available.</div>';
    const width = 390;
    const height = 180;
    const left = 42;
    const right = 16;
    const top = 18;
    const bottom = 28;
    const samples = relation.samplePoints || [];
    const values = samples.map((sample) => Number(sample.attributeValue)).filter(Number.isFinite);
    const range = geologyNumericRange(values);
    const points = samples
      .filter((sample) => Number.isFinite(Number(sample.attributeValue)))
      .map((sample) => {
        const x = left + (sample.distance / Math.max(1, relation.length)) * (width - left - right);
        const t = (Number(sample.attributeValue) - range.min) / (range.max - range.min || 1);
        const y = top + (1 - t) * (height - top - bottom);
        return `${x},${y}`;
      })
      .join(' ');
    return `
      <div><strong>${escapeHtml(relation.edgeId)}</strong> <span class="muted-note">${escapeHtml(relation.riskLevel)}</span></div>
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#101722" />
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#64748b" />
        <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#64748b" />
        ${points ? `<polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="2.5" />` : ''}
        ${relation.distanceToStructure != null ? `<line x1="${left}" y1="${top + 10}" x2="${width - right}" y2="${top + 10}" stroke="#f59e0b" stroke-dasharray="5 4" />` : ''}
        <text x="${left}" y="${height - 8}" fill="#a7b4c5" font-size="11">Distance along roadway</text>
        <text x="${left + 4}" y="${top + 12}" fill="#a7b4c5" font-size="11">${escapeHtml(this.params.activeAttribute || 'attribute')}</text>
      </svg>`;
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const summary = this.relationResult?.summary || {};
    this.legendPanel.querySelector('.panel-body').innerHTML = `
      <div class="route-legend-list">
        <div class="legend-row"><span class="legend-dot" style="background:#22c55e"></span><span>Low risk</span></div>
        <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span><span>Medium risk / warning</span></div>
        <div class="legend-row"><span class="legend-dot" style="background:#ef4444"></span><span>High risk / critical</span></div>
        <div class="legend-row"><span class="legend-line" style="background:#facc15"></span><span>Selected roadway segment</span></div>
      </div>
      ${this.rows([
        ['Total length', summary.totalLength == null ? null : `${formatScalar(summary.totalLength, 1)} m`],
        ['High-risk length', summary.highRiskLength == null ? null : `${formatScalar(summary.highRiskLength, 1)} m`],
        ['Medium-risk length', summary.mediumRiskLength == null ? null : `${formatScalar(summary.mediumRiskLength, 1)} m`],
        ['Edges near structures', summary.nearStructureCount],
        ['Attribute threshold exceeded', summary.thresholdExceededCount]
      ])}`;
  }

  drawMap() {
    const canvas = this.correlationPanel?.querySelector?.('canvas.roadway-geology-map');
    if (!canvas || !this.relationResult) return;
    const ctx = canvas.getContext('2d');
    const relations = this.filteredRelations();
    const points = relations.flatMap((relation) => relation.path || []);
    if (!points.length) return;
    const xs = points.map((point) => point.x);
    const zs = points.map((point) => point.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const pad = 26;
    const sx = (canvas.width - pad * 2) / Math.max(1, maxX - minX);
    const sz = (canvas.height - pad * 2) / Math.max(1, maxZ - minZ);
    const scale = Math.min(sx, sz);
    const map = (point) => ({ x: pad + (point.x - minX) * scale, y: canvas.height - pad - (point.z - minZ) * scale });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f1722';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.mapHitEdges = [];
    relations.forEach((relation) => {
      const mapped = relation.path.map(map);
      ctx.beginPath();
      mapped.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.strokeStyle = relation.edgeId === this.selected?.id ? '#facc15' : this.colorForRelation(relation);
      ctx.lineWidth = relation.edgeId === this.selected?.id ? 5 : 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      this.mapHitEdges.push({ edgeId: relation.edgeId, points: mapped });
    });
  }

  handleRelationshipControlChange(event) {
    const target = event.target;
    const key = target?.dataset?.rgParam;
    if (!key) return;
    if (target.type === 'checkbox') this.params[key] = target.checked;
    else if (target.type === 'number' || target.type === 'range') this.params[key] = target.value === '' ? null : Number(target.value);
    else this.params[key] = target.value;
    if (key === 'activeAttribute') this.context?.set?.('activeGeologicalAttribute', this.params.activeAttribute || null);
    if (key === 'analysisMode') this.context?.set?.('roadwayGeologyAnalysisMode', this.params.analysisMode);
    if (['showGeologicalBodyContext', 'showStructures', 'showBoreholes'].includes(key)) {
      if (this.bodyGroup) this.bodyGroup.visible = !!this.params.showGeologicalBodyContext;
      if (this.structureGroup) this.structureGroup.visible = !!this.params.showStructures;
      if (this.boreholeGroup) this.boreholeGroup.visible = !!this.params.showBoreholes;
    }
    this.recomputeAndRender();
  }

  handleRelationshipClick(event) {
    const row = event.target?.closest?.('[data-rg-edge]');
    if (row) {
      this.setSelection('roadwaySegment', row.dataset.rgEdge, {});
      return;
    }
    if (event.target?.closest?.('[data-rg-create-section]')) this.createSectionNearSelectedRoadway();
    if (event.currentTarget === this.correlationPanel && event.target?.matches?.('canvas.roadway-geology-map')) this.handleMapClick(event);
  }

  handleMapClick(event) {
    const rect = event.target.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * event.target.width;
    const y = ((event.clientY - rect.top) / rect.height) * event.target.height;
    let best = null;
    this.mapHitEdges.forEach((entry) => {
      for (let i = 1; i < entry.points.length; i += 1) {
        const d = pointToCanvasSegmentDistance({ x, y }, entry.points[i - 1], entry.points[i]);
        if (!best || d < best.distance) best = { edgeId: entry.edgeId, distance: d };
      }
    });
    if (best && best.distance < 10) this.setSelection('roadwaySegment', best.edgeId, {});
    else this.applyContextSelection(null);
  }

  handleGeologyPick(entity) {
    if (entity.type === 'roadwaySegment') {
      this.setSelection('roadwaySegment', entity.edgeId || entity.id, entity);
      return;
    }
    super.handleGeologyPick(entity);
  }

  setSelection(type, id, extra = {}) {
    if (!id) return;
    this.selected = { type, id, data: extra };
    if (type === 'roadwaySegment') this.context?.set?.('selectedRoadwaySegment', id);
    this.context?.set?.('selection', { type, id, data: extra });
    this.renderRelationshipOverlay();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updatePanels();
  }

  applyContextSelection(selection) {
    if (!selection || !selection.type || !selection.id) {
      this.selected = null;
      this.renderRelationshipOverlay();
      this.updatePanels();
      return;
    }
    if (!['roadwaySegment', 'roadwayHazardSegment'].includes(selection.type)) return;
    this.selected = { type: 'roadwaySegment', id: selection.id, data: selection.data };
    this.renderRelationshipOverlay();
    this.updatePanels();
  }

  createSectionNearSelectedRoadway() {
    const relation = this.relationResult?.edgeRelations?.get(this.selected?.id);
    const path = relation?.path || [];
    if (path.length < 2) return;
    const frame = createSectionFrame({
      sectionMode: 'vertical-two-point',
      verticalLinePointA: path[0],
      verticalLinePointB: path[path.length - 1],
      thickness: Math.max(5, Number(this.params.sampleInterval) || 10)
    });
    this.context?.set?.('sectionFrame', frame);
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    [this.layerPanel, this.correlationPanel, this.attributePanel, this.detailPanel, this.legendPanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

function pointToCanvasSegmentDistance(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const denom = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / denom));
  return Math.hypot(point.x - (a.x + vx * t), point.y - (a.y + vy * t));
}

class GeologicalSectionAnalysisRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
    this.label = nodeModel.label || 'Geological Section Analysis';
    this.hasExplicitPosition = nodeModel.params?.position != null && Number(nodeModel.params.position) !== 0;
    this.params = {
      sectionMode: 'axis-aligned',
      axis: 'X',
      position: 0,
      thickness: 5,
      verticalLinePointA: null,
      verticalLinePointB: null,
      showCutaway: true,
      clippingSide: 'positive',
      showSectionPlane: true,
      showGeologicalBody: true,
      showRoadway: true,
      showBoreholes: true,
      showStructures: true,
      showAttributeModel: true,
      geologicalBodyOpacity: 0.28,
      roadwayOpacity: 0.35,
      boreholeOpacity: 1,
      structureOpacity: 0.82,
      attributeModelOpacity: 0.82,
      activeAttribute: null,
      colorMode: 'geological-unit',
      autoUpdate: true,
      maxRenderedBlocksInSection: 5000,
      sectionViewPlacement: 'bottom-panel',
      ...(nodeModel.params || {})
    };
    this.sectionHitItems = [];
    this.sectionResult = null;
    this.sectionFrame = null;
    this.modelBounds = new THREE.Box3();
    this.bodyObjText = '';
    this.structureObjText = '';
    this.recomputeTimer = null;
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    this.createSectionGroups();
    await this.initializeRoadwayContext();
    this.bodyObjText = await this.loadObjText(this.inputs.geologicalBody);
    this.structureObjText = this.inputs.geologicalStructure ? await this.loadObjText(this.inputs.geologicalStructure) : '';
    this.modelBounds = this.computeModelBounds();
    this.applyDefaultSectionPosition();
    this.computeAndRenderSection();
    this.createSectionPanels();
    this.registerSectionContributions();
    this.installSectionHandlers();
    this.updateSectionPanels();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    if (this.params.autoFocusOnSelection && this.rootGroup.children.length) this.sceneManager?.focusOnObject?.(this.rootGroup);
    return { cleanup: () => this.cleanup() };
  }

  validateSemanticInputs() {
    const body = this.inputs.geologicalBody;
    if (!body) throw new Error('Missing semantic dataset input: geologicalBody');
    const actualClass = body.contract?.class || body.semanticClass;
    if (actualClass !== 'GeologicalBody') throw new Error(`Input geologicalBody expects GeologicalBody, got ${actualClass}.`);
    Object.entries(GeologicalSectionAnalysisInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Geological Section Analysis] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  createSectionGroups() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = `${this.id}:geological-section-analysis`;
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.name = 'section-geological-body-context';
    this.sectionGroup = new THREE.Group();
    this.sectionGroup.name = 'geological-section-layer';
    this.boreholeGroup = new THREE.Group();
    this.boreholeGroup.name = 'section-borehole-projections';
    this.structureGroup = new THREE.Group();
    this.structureGroup.name = 'section-structure-projections';
    this.attributeGroup = new THREE.Group();
    this.attributeGroup.name = 'section-attribute-slice';
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'section-selection-highlight';
    this.rootGroup.add(this.bodyGroup, this.sectionGroup, this.attributeGroup, this.boreholeGroup, this.structureGroup, this.highlightGroup);
    this.sceneManager.scene.add(this.rootGroup);
    this.sceneManager.raycaster.params.Line = { threshold: 6 };
    this.sceneManager.raycaster.params.Points = { threshold: 10 };
  }

  applyDefaultSectionPosition() {
    if (this.hasExplicitPosition || this.modelBounds.isEmpty()) return;
    const axis = String(this.params.axis || 'X').toLowerCase();
    this.params.position = this.modelBounds.getCenter(new THREE.Vector3())[axis] ?? 0;
  }

  computeModelBounds() {
    const box = new THREE.Box3();
    const expand = (point) => box.expandByPoint(geologyPoint(point));
    if (this.bodyObjText) {
      try {
        const object = new OBJLoader().parse(this.bodyObjText);
        object.updateMatrixWorld(true);
        box.expandByObject(object);
      } catch (error) {
        console.warn('[MineVis Geological Section Analysis] Failed to compute body bounds:', error);
      }
    }
    (this.inputs.attributeModel?.listBlocks?.() || []).slice(0, 10000).forEach((block) => expand(block.centroid ?? block));
    const grid = this.inputs.attributeModel?.grid;
    if (grid) {
      const min = Array.isArray(grid.bounds?.min) ? grid.bounds.min : grid.origin || [0, 0, 0];
      const max = Array.isArray(grid.bounds?.max) ? grid.bounds.max : null;
      expand({ x: min[0], y: min[1], z: min[2] });
      if (max) expand({ x: max[0], y: max[1], z: max[2] });
    }
    (this.inputs.borehole?.listBoreholes?.() || []).forEach((borehole) => {
      (this.inputs.borehole.getTrajectory?.(borehole.boreholeId) || []).forEach(expand);
    });
    (this.inputs.roadway?.getEdges?.() || []).forEach((edge) => roadwayEdgePath(this.inputs.roadway, edge).forEach(expand));
    if (box.isEmpty()) box.expandByPoint(new THREE.Vector3(-500, -500, -500)).expandByPoint(new THREE.Vector3(500, 500, 500));
    return box;
  }

  computeAndRenderSection() {
    const activeAttribute = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || this.inputs.attributeModel?.getPrimaryAttribute?.();
    this.params.activeAttribute = activeAttribute || null;
    this.sectionFrame = createSectionFrame(this.params);
    this.sectionResult = buildGeologicalSectionResult({
      geologicalBody: this.inputs.geologicalBody,
      roadway: this.inputs.roadway,
      borehole: this.inputs.borehole,
      geologicalStructure: this.inputs.geologicalStructure,
      attributeModel: this.inputs.attributeModel,
      sectionFrame: this.sectionFrame,
      activeAttribute,
      maxRenderedBlocksInSection: this.params.maxRenderedBlocksInSection,
      geologicalBodyObjText: this.bodyObjText,
      structureObjText: this.structureObjText
    });
    this.context?.set?.('sectionFrame', this.sectionFrame.toPlainObject());
    this.render3DSection();
    this.updateSectionPanels();
  }

  scheduleSectionUpdate({ immediate = false } = {}) {
    window.clearTimeout(this.recomputeTimer);
    const update = () => this.computeAndRenderSection();
    if (immediate) update();
    else if (this.params.autoUpdate) this.recomputeTimer = window.setTimeout(update, 90);
    else this.updateSectionPanels();
  }

  render3DSection() {
    [this.bodyGroup, this.sectionGroup, this.attributeGroup, this.boreholeGroup, this.structureGroup, this.highlightGroup].forEach((group) => {
      disposeThreeObject(group);
      group.clear();
    });
    this.pickables = [];
    this.renderCutawayBodyContext();
    this.renderSectionPlane();
    this.renderSectionIntersections3D();
    this.applySectionLayerState();
    this.updateHighlight();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
  }

  renderCutawayBodyContext() {
    if (!this.params.showGeologicalBody || !this.bodyObjText) return;
    let object = null;
    try {
      object = new OBJLoader().parse(this.bodyObjText);
    } catch (error) {
      console.warn('[MineVis Geological Section Analysis] Failed to render cutaway body:', error);
      return;
    }
    object.updateMatrixWorld(true);
    const surfaces = this.inputs.geologicalBody?.listSurfaces?.() || [];
    const surfaceByMesh = new Map();
    surfaces.forEach((surface, index) => {
      [surface.meshPartId, surface.mesh_part_id, surface.name, surface.surfaceId].filter(Boolean).forEach((key) => surfaceByMesh.set(String(key), { surface, index }));
    });
    const clipPlane = this.sectionFrame?.plane?.();
    if (clipPlane && this.params.clippingSide === 'negative') clipPlane.negate();
    const capGroup = new THREE.Group();
    capGroup.name = 'section-stencil-caps';
    let fallbackIndex = 0;
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.computeVertexNormals?.();
      const matched = geometryObjectNames(child).map((name) => surfaceByMesh.get(name)).find(Boolean);
      const surface = matched?.surface || surfaces[fallbackIndex] || { surfaceId: child.name || `SURF_${fallbackIndex + 1}`, surfaceType: 'surface' };
      const index = matched?.index ?? fallbackIndex;
      fallbackIndex += 1;
      const surfaceColor = this.colorForSurface(surface, index);
      const material = this.createGeologicalBodyMaterial(this.colorForSurface(surface, index), Number(this.params.geologicalBodyOpacity));
      const pickData = {
        type: 'geologicalSurface',
        id: surface.surfaceId,
        surfaceId: surface.surfaceId,
        unitId: surface.geologicalUnitId ?? surface.unitId,
        bodyId: surface.bodyId,
        label: surface.surfaceId
      };
      child.userData.geologyPick = pickData;
      if (this.params.showCutaway && this.params.clippingSide !== 'both' && clipPlane) {
        material.clippingPlanes = [clipPlane];
        material.clipShadows = true;
        this.createStencilCapForMesh(child, surfaceColor, clipPlane, 30 + index * 3).forEach((mesh) => capGroup.add(mesh));
      }
      child.material = material;
      this.configureGeologicalBodyMesh(child, Number(this.params.geologicalBodyOpacity));
      this.pickables.push(child);
    });
    this.bodyGroup.add(object);
    if (capGroup.children.length) this.bodyGroup.add(capGroup);
  }

  createStencilCapForMesh(sourceMesh, color, clipPlane, renderOrder = 30) {
    if (!sourceMesh?.geometry || !this.sectionFrame) return [];
    const geometry = sourceMesh.geometry.clone();
    sourceMesh.updateMatrixWorld?.(true);
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    const makeStencilMaterial = (side, op) => {
      const material = new THREE.MeshBasicMaterial({
        depthWrite: false,
        depthTest: false,
        colorWrite: false,
        side,
        clippingPlanes: [clipPlane],
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op
      });
      return material;
    };
    const back = new THREE.Mesh(geometry, makeStencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp));
    const front = new THREE.Mesh(geometry.clone(), makeStencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp));
    back.renderOrder = renderOrder;
    front.renderOrder = renderOrder + 1;
    const bounds = this.sectionViewBounds();
    const spanU = Math.max(120, bounds.maxX - bounds.minX + 120);
    const spanV = Math.max(120, bounds.maxY - bounds.minY + 120);
    const capGeometry = this.createSectionPlaneGeometry(spanU, spanV);
    const capMaterial = new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: Math.min(0.92, Math.max(0.55, Number(this.params.geologicalBodyOpacity) + 0.25)),
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp
    });
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.renderOrder = renderOrder + 2;
    cap.userData.geologyPick = {
      type: sourceMesh.userData?.geologyPick?.type || 'geologicalSurface',
      id: sourceMesh.userData?.geologyPick?.id,
      surfaceId: sourceMesh.userData?.geologyPick?.surfaceId,
      unitId: sourceMesh.userData?.geologyPick?.unitId,
      label: sourceMesh.userData?.geologyPick?.label
    };
    this.pickables.push(cap);
    return [back, front, cap];
  }

  createSectionPlaneGeometry(spanU = 500, spanV = 500) {
    const origin = this.sectionFrame.origin;
    const u = this.sectionFrame.u;
    const v = this.sectionFrame.v;
    const corners = [
      origin.clone().addScaledVector(u, -spanU / 2).addScaledVector(v, -spanV / 2),
      origin.clone().addScaledVector(u, spanU / 2).addScaledVector(v, -spanV / 2),
      origin.clone().addScaledVector(u, spanU / 2).addScaledVector(v, spanV / 2),
      origin.clone().addScaledVector(u, -spanU / 2).addScaledVector(v, spanV / 2)
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return geometry;
  }

  sectionViewBounds() {
    const points = [];
    const add = (item) => (item.points || []).forEach((point) => {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
    });
    (this.sectionResult?.geologicalIntersections || []).forEach(add);
    (this.sectionResult?.boreholeProjections || []).forEach(add);
    (this.sectionResult?.structureIntersections || []).forEach(add);
    (this.sectionResult?.roadwayProjections || []).forEach(add);
    (this.sectionResult?.blockSliceElements || []).forEach((block) => points.push({ x: block.x, y: block.y }));
    if (!points.length) return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    return {
      minX: Math.min(...points.map((point) => point.x)),
      maxX: Math.max(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxY: Math.max(...points.map((point) => point.y))
    };
  }

  renderSectionPlane() {
    if (!this.params.showSectionPlane || !this.sectionFrame) return;
    const bounds = this.sectionViewBounds();
    const spanU = Math.max(120, bounds.maxX - bounds.minX + 120);
    const spanV = Math.max(120, bounds.maxY - bounds.minY + 120);
    const geometry = this.createSectionPlaneGeometry(spanU, spanV);
    const material = new THREE.MeshBasicMaterial({
      color: '#67e8f9',
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'geological-section-plane';
    plane.renderOrder = 48;
    this.sectionGroup.add(plane);
    const position = geometry.attributes.position;
    const corners = [0, 1, 2, 3, 0].map((index) => new THREE.Vector3().fromBufferAttribute(position, index));
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(corners);
    const edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.76, depthTest: false }));
    edge.renderOrder = 49;
    this.sectionGroup.add(edge);
  }

  renderLine3D(group, points3D = [], color = '#ffffff', userData = {}, width = 1) {
    const points = points3D.map(geologyPoint);
    if (points.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 54 + width;
    line.userData.geologyPick = userData;
    group.add(line);
    this.pickables.push(line);
    return line;
  }

  render3DBlockMarker(block) {
    const center = geologyPoint(block.centroid);
    const size = block.size || {};
    const radius = Math.max(2, Math.min(8, Math.max(Number(size.x) || 4, Number(size.y) || 4, Number(size.z) || 4) * 0.18));
    const color = block.normalizedValue != null ? sampleColor('viridis', block.normalizedValue) : '#35d0ff';
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(radius, radius, radius), material);
    mesh.position.copy(center);
    mesh.renderOrder = 58;
    mesh.userData.geologyPick = { type: 'geologicalBlock', id: block.id, blockId: block.blockId, label: block.id, data: block };
    this.attributeGroup.add(mesh);
    this.pickables.push(mesh);
  }

  renderSectionIntersections3D() {
    (this.sectionResult?.geologicalIntersections || []).forEach((line, index) => {
      const surface = this.inputs.geologicalBody?.surfaceMap?.get?.(String(line.surfaceId));
      this.renderLine3D(this.sectionGroup, line.points3D, this.colorForSurface(surface || line, index), {
        type: 'geologicalSurface',
        id: line.surfaceId || line.id,
        surfaceId: line.surfaceId || line.id,
        unitId: line.unitId,
        label: line.surfaceId || line.id
      });
    });
    (this.sectionResult?.blockSliceElements || []).slice(0, Number(this.params.maxRenderedBlocksInSection) || 5000).forEach((block) => this.render3DBlockMarker(block));
    (this.sectionResult?.boreholeProjections || []).forEach((item) => {
      this.renderLine3D(this.boreholeGroup, item.points3D, '#66d9ef', { type: 'borehole', id: item.boreholeId, boreholeId: item.boreholeId, label: item.label }, 2);
    });
    (this.sectionResult?.structureIntersections || []).forEach((item, index) => {
      this.renderLine3D(this.structureGroup, item.points3D, geologyColorForKey(item.structureType || 'fault', index + 4), {
        type: 'geologicalStructure',
        id: item.structureId || item.id,
        structureId: item.structureId || item.id,
        label: item.label
      });
    });
    (this.sectionResult?.roadwayProjections || []).forEach((item) => {
      this.renderLine3D(this.sectionGroup, item.points3D, '#b5b9bf', { type: 'roadwaySegment', id: item.roadwayEdgeId, roadwayEdgeId: item.roadwayEdgeId, label: item.roadwayEdgeId });
    });
  }

  applySectionLayerState() {
    this.bodyGroup.visible = !!this.params.showGeologicalBody;
    this.attributeGroup.visible = !!this.params.showAttributeModel;
    this.boreholeGroup.visible = !!this.params.showBoreholes;
    this.structureGroup.visible = !!this.params.showStructures;
    this.sectionGroup.visible = true;
    this.sceneManager?.setRoadwayVisible?.(!!this.params.showRoadway && !!this.inputs.roadway);
  }

  createSectionPanels() {
    this.sectionViewPanel = createWorkspacePanel('2D Geological Section View', 'geological-section-view-panel', '<canvas class="geological-section-canvas" width="720" height="390"></canvas><div class="geological-section-tooltip"></div>');
    this.layerPanel = createWorkspacePanel('Section Control Panel', 'geological-section-control-panel', '<div class="geological-section-control-content"></div>');
    this.legendPanel = createWorkspacePanel('Section Legend', 'geological-section-legend-panel', '<div class="geology-legend-content"></div>');
    this.detailPanel = createWorkspacePanel('Section Summary / Detail', 'geological-section-detail-panel', '<div class="geology-detail-content"></div>');
    this.attributePanel = null;
    Object.assign(this.sectionViewPanel.style, { left: '18px', bottom: '24px', width: '760px' });
    Object.assign(this.layerPanel.style, { right: '330px', top: '92px', width: '360px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '92px', width: '280px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '520px', width: '330px' });
    this.sectionCanvas = this.sectionViewPanel.querySelector('.geological-section-canvas');
    this.sectionTooltip = this.sectionViewPanel.querySelector('.geological-section-tooltip');
  }

  registerSectionContributions() {
    this.registerSceneContribution('section-layer', '3D Geological Section Layer', this.sectionGroup, 'geologicalSection', 'analysis', 0.8, {
      visualChannels: { color: 'geologicalUnitOrAttribute', opacity: 'sectionOpacity' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: 0.8, canPin: true }
    });
    this.registerSceneContribution('section-body-context', 'Section Geological Body Context', this.bodyGroup, 'geologicalBody', 'context', this.params.geologicalBodyOpacity, {
      composition: { mergePolicy: 'compose', focusBehavior: 'context', defaultOpacity: this.params.geologicalBodyOpacity, canPin: true }
    });
    if (this.inputs.borehole) this.registerSceneContribution('section-boreholes', 'Section Borehole Projection Layer', this.boreholeGroup, 'borehole', 'context', this.params.boreholeOpacity);
    if (this.inputs.geologicalStructure) this.registerSceneContribution('section-structures', 'Section Structure Projection Layer', this.structureGroup, 'geologicalStructure', 'annotation', this.params.structureOpacity);
    if (this.inputs.attributeModel) this.registerSceneContribution('section-attributes', 'Section Attribute Slice Layer', this.attributeGroup, 'geologicalAttributeModel', 'state', this.params.attributeModelOpacity);
    [
      ['section-view', '2D Geological Section View', this.sectionViewPanel, 'panel', 'detail', 'bottom-panel'],
      ['section-controls', 'Section Control Panel', this.layerPanel, 'control', 'control', 'right-panel'],
      ['section-legend', 'Section Legend', this.legendPanel, 'legend', 'legend', 'legend'],
      ['section-detail', 'Section Summary / Detail Panel', this.detailPanel, 'panel', 'detail', 'right-panel']
    ].forEach(([suffix, label, panel, type, semanticRole, host]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        host,
        contributionKind: type,
        semanticRole,
        objectSystem: 'geologicalSection',
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installSectionHandlers() {
    this.disposers.push(this.context.subscribe('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context.subscribe('activeGeologicalAttribute', (attribute) => {
      this.params.activeAttribute = attribute;
      this.scheduleSectionUpdate({ immediate: true });
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
    }));
    const change = (event) => this.handleSectionControlChange(event);
    const click = (event) => this.handleSectionControlClick(event);
    this.layerPanel.addEventListener('change', change);
    this.layerPanel.addEventListener('input', change);
    this.layerPanel.addEventListener('click', click);
    this.installSectionCanvasHandlers();
  }

  installSectionCanvasHandlers() {
    if (!this.sectionCanvas) return;
    const pointer = (event) => {
      const hit = this.findSectionCanvasHit(event);
      this.updateSectionTooltip(event, hit);
      this.renderSectionCanvas(hit);
    };
    const click = (event) => {
      const hit = this.findSectionCanvasHit(event);
      if (!hit) {
        this.clearGeologicalSelection();
        return;
      }
      this.setSectionSelection(hit.element);
    };
    const leave = () => {
      if (this.sectionTooltip) this.sectionTooltip.style.display = 'none';
      this.renderSectionCanvas();
    };
    this.sectionCanvas.addEventListener('pointermove', pointer);
    this.sectionCanvas.addEventListener('click', click);
    this.sectionCanvas.addEventListener('pointerleave', leave);
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('pointermove', pointer));
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('click', click));
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('pointerleave', leave));
  }

  positionRangeForAxis() {
    const axis = String(this.params.axis || 'X').toLowerCase();
    if (!this.modelBounds || this.modelBounds.isEmpty()) return { min: -500, max: 500 };
    return { min: this.modelBounds.min[axis] ?? -500, max: this.modelBounds.max[axis] ?? 500 };
  }

  sectionControlsHtml() {
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.() || '';
    const range = this.positionRangeForAxis();
    return `
      <div class="geology-panel-summary">
        <span>${escapeHtml(this.sectionFrame?.mode || this.params.sectionMode)}</span>
        <span>${escapeHtml(this.params.axis)}</span>
        <span>${formatScalar(this.params.position)}</span>
      </div>
      <label class="field-row">Mode
        <select data-section-param="sectionMode">
          ${['axis-aligned', 'vertical-two-point'].map((mode) => `<option value="${mode}" ${this.params.sectionMode === mode ? 'selected' : ''}>${mode === 'axis-aligned' ? 'Axis-aligned' : 'Vertical two-point'}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Axis
        <select data-section-param="axis" ${this.params.sectionMode === 'vertical-two-point' ? 'disabled' : ''}>
          ${['X', 'Y', 'Z'].map((axis) => `<option value="${axis}" ${this.params.axis === axis ? 'selected' : ''}>${axis}</option>`).join('')}
        </select>
      </label>
      ${this.compactSliderRow({ key: 'position', label: 'Position', min: Math.floor(range.min), max: Math.ceil(range.max), step: 1, digits: 1, dataAttr: 'data-section-param' })}
      ${this.compactSliderRow({ key: 'thickness', label: 'Thickness', min: 1, max: 120, step: 1, digits: 1, dataAttr: 'data-section-param' })}
      <div class="geology-control-stack">
        ${this.layerToggle('showGeologicalBody', 'Geological body')}
        ${this.inputs.roadway ? this.layerToggle('showRoadway', 'Roadway') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute model') : ''}
        ${this.layerToggle('showSectionPlane', 'Section plane')}
        ${this.layerToggle('showCutaway', 'Cutaway body')}
        ${this.layerToggle('autoUpdate', 'Auto update')}
      </div>
      <label class="field-row">Cutaway side
        <select data-section-param="clippingSide">
          ${['positive', 'negative', 'both'].map((side) => `<option value="${side}" ${this.params.clippingSide === side ? 'selected' : ''}>${side}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Color by
        <select data-color-mode>
          ${['geological-unit', 'lithology', 'attribute', 'uniform'].map((mode) => `<option value="${mode}" ${this.params.colorMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}
        </select>
      </label>
      ${this.inputs.attributeModel ? `<label class="field-row">Active attribute
        <select data-active-attribute>${attributes.map((attribute) => `<option value="${escapeHtml(attribute)}" ${String(active) === String(attribute) ? 'selected' : ''}>${escapeHtml(attribute)}</option>`).join('')}</select>
      </label>` : ''}
      ${this.inputs.attributeModel ? this.compactSliderRow({ key: 'maxRenderedBlocksInSection', label: 'Max section blocks', min: 100, max: 50000, step: 100, digits: 0, dataAttr: 'data-section-param' }) : ''}
      ${this.params.sectionMode === 'vertical-two-point' ? this.verticalPointControlsHtml() : ''}
      <div class="geology-quick-actions">
        <button type="button" data-section-recompute>Recompute section</button>
        <button type="button" data-focus-geology-model>Focus section</button>
      </div>
      ${this.params.sectionMode === 'vertical-two-point' ? '<div class="muted-note">3D pick Point A/B is reserved for a later update; numeric points are active now.</div>' : ''}
    `;
  }

  verticalPointControlsHtml() {
    const pointA = this.params.verticalLinePointA || { x: -100, y: 0, z: 0 };
    const pointB = this.params.verticalLinePointB || { x: 100, y: 0, z: 0 };
    const field = (key, axis, value) => `<label class="field-row">${axis.toUpperCase()}<input data-section-point="${key}:${axis}" type="number" step="1" value="${formatScalar(value, 2)}"></label>`;
    return `
      <div class="geology-volume-controls">
        <div class="geology-volume-header"><strong>Vertical Section Points</strong></div>
        <div class="geology-volume-grid">
          ${field('verticalLinePointA', 'x', pointA.x)}
          ${field('verticalLinePointA', 'y', pointA.y)}
          ${field('verticalLinePointA', 'z', pointA.z)}
          ${field('verticalLinePointB', 'x', pointB.x)}
          ${field('verticalLinePointB', 'y', pointB.y)}
          ${field('verticalLinePointB', 'z', pointB.z)}
        </div>
      </div>
    `;
  }

  updateSectionPanels() {
    if (this.layerPanel?.isConnected) {
      this.layerPanel.querySelector('.geological-section-control-content').innerHTML = this.sectionControlsHtml();
      this.syncSectionControls();
    }
    this.updateLegend();
    this.updateDetailPanel();
    this.renderSectionCanvas();
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlContainer = container;
    container.innerHTML = `
      <div class="panel-title">${escapeHtml(this.label)}</div>
      <div class="geology-quick-note">Adjust the section frame and inspect the generated 2D geological section.</div>
      <div class="control-grid geology-quick-fields">
        <label class="field-row">Axis
          <select data-section-param="axis">${['X', 'Y', 'Z'].map((axis) => `<option value="${axis}" ${this.params.axis === axis ? 'selected' : ''}>${axis}</option>`).join('')}</select>
        </label>
        <label class="field-row">Thickness
          <input data-section-param="thickness" type="number" min="1" step="1" value="${formatScalar(this.params.thickness, 1)}">
        </label>
      </div>
      <div class="geology-quick-toggles">
        ${this.layerToggle('showGeologicalBody', 'Body')}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
      </div>
      <div class="geology-quick-actions"><button type="button" data-section-recompute>Recompute section</button></div>
    `;
    const change = (event) => this.handleSectionControlChange(event);
    const click = (event) => this.handleSectionControlClick(event);
    container.addEventListener('change', change);
    container.addEventListener('input', change);
    container.addEventListener('click', click);
    this.controlDisposers.push(() => container.removeEventListener('change', change));
    this.controlDisposers.push(() => container.removeEventListener('input', change));
    this.controlDisposers.push(() => container.removeEventListener('click', click));
  }

  handleSectionControlChange(event) {
    const target = event.target;
    if (target.matches('[data-toggle-layer]')) {
      this.params[target.dataset.toggleLayer] = target.checked;
      this.applySectionLayerState();
      this.renderSectionCanvas();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    if (target.matches('[data-section-param]')) {
      const key = target.dataset.sectionParam;
      this.params[key] = target.type === 'number' || target.type === 'range' ? this.readBoundedNumber(target, this.params[key]) : target.value;
      if (key === 'axis' && !this.hasExplicitPosition) this.applyDefaultSectionPosition();
      this.scheduleSectionUpdate();
      return;
    }
    if (target.matches('[data-section-point]')) {
      const [key, axis] = String(target.dataset.sectionPoint || '').split(':');
      if (!key || !axis) return;
      const nextPoint = { ...(this.params[key] || (key.endsWith('A') ? { x: -100, y: 0, z: 0 } : { x: 100, y: 0, z: 0 })) };
      nextPoint[axis] = this.readBoundedNumber(target, nextPoint[axis]);
      this.params[key] = nextPoint;
      this.scheduleSectionUpdate();
      return;
    }
    if (target.matches('[data-color-mode]')) {
      this.params.colorMode = target.value;
      this.computeAndRenderSection();
      return;
    }
    if (target.matches('[data-active-attribute]')) {
      this.context.set('activeGeologicalAttribute', target.value);
    }
  }

  handleSectionControlClick(event) {
    if (event.target.closest('[data-section-recompute]')) {
      this.computeAndRenderSection();
      return;
    }
    if (event.target.closest('[data-focus-geology-model]')) {
      this.sceneManager.focusOnObject?.(this.rootGroup);
    }
  }

  syncSectionControls() {
    const roots = [this.layerPanel, this.controlContainer].filter((root) => root?.isConnected);
    roots.forEach((root) => {
      root.querySelectorAll('[data-section-param="position"]').forEach((input) => {
        if (input === document.activeElement && input.type === 'range') return;
        input.value = formatScalar(this.params.position, 1);
      });
      root.querySelectorAll('[data-section-param="thickness"]').forEach((input) => {
        if (input === document.activeElement && input.type === 'range') return;
        input.value = formatScalar(this.params.thickness, 1);
      });
      root.querySelectorAll('[data-section-param="maxRenderedBlocksInSection"]').forEach((input) => {
        input.value = Math.round(Number(this.params.maxRenderedBlocksInSection) || 5000);
      });
    });
  }

  canvasTransform(width, height) {
    const bounds = this.sectionViewBounds();
    const padding = 28;
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    const offsetX = (width - spanX * scale) * 0.5;
    const offsetY = (height - spanY * scale) * 0.5;
    return (point) => ({
      x: offsetX + (point.x - bounds.minX) * scale,
      y: height - (offsetY + (point.y - bounds.minY) * scale)
    });
  }

  renderSectionCanvas(hover = null) {
    if (!this.sectionCanvas) return;
    const canvas = this.sectionCanvas;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(560, Math.round(rect.width || canvas.clientWidth || 720));
    const height = Math.max(300, Math.round(rect.height || canvas.clientHeight || 390));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, width, height);
    const toCanvas = this.canvasTransform(width, height);
    this.sectionHitItems = [];
    this.drawSectionGrid(ctx, width, height);
    (this.params.showAttributeModel ? this.sectionResult?.blockSliceElements || [] : []).forEach((block) => this.drawSectionBlock(ctx, toCanvas, block));
    (this.params.showGeologicalBody ? this.sectionResult?.geologicalIntersections || [] : []).forEach((line, index) => this.drawSectionPolyline(ctx, toCanvas, line, this.colorForCanvasSurface(line, index), 2.2));
    (this.params.showRoadway ? this.sectionResult?.roadwayProjections || [] : []).forEach((line) => this.drawSectionPolyline(ctx, toCanvas, line, '#b5b9bf', 2.5, [6, 4]));
    (this.params.showStructures ? this.sectionResult?.structureIntersections || [] : []).forEach((line, index) => this.drawSectionPolyline(ctx, toCanvas, line, geologyColorForKey(line.structureType || 'fault', index + 4), 3, [8, 4]));
    (this.params.showBoreholes ? this.sectionResult?.boreholeProjections || [] : []).forEach((line) => this.drawSectionPolyline(ctx, toCanvas, line, '#66d9ef', 3.4));
    if (hover?.element) this.drawSectionHover(ctx, toCanvas, hover.element);
    if (this.selected) this.drawSelectedSectionElement(ctx, toCanvas);
  }

  drawSectionGrid(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
    ctx.lineWidth = 1;
    for (let x = 24; x < width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 24; y < height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(226,232,240,0.72)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${this.params.sectionMode} ${this.params.axis} @ ${formatScalar(this.params.position, 1)}, thickness ${formatScalar(this.params.thickness, 1)}`, 16, 22);
    ctx.restore();
  }

  colorForCanvasSurface(line, index) {
    const surface = this.inputs.geologicalBody?.surfaceMap?.get?.(String(line.surfaceId));
    return this.colorForSurface(surface || line, index);
  }

  drawSectionPolyline(ctx, toCanvas, element, color, width = 2, dash = []) {
    const points = (element.points || []).map(toCanvas);
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
    ctx.restore();
    this.sectionHitItems.push({ kind: 'polyline', points, element });
  }

  drawSectionBlock(ctx, toCanvas, block) {
    if (!Number.isFinite(block.x) || !Number.isFinite(block.y)) return;
    const point = toCanvas(block);
    const size = 5;
    const color = block.normalizedValue != null ? sampleColor('viridis', block.normalizedValue) : '#38bdf8';
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
    ctx.restore();
    this.sectionHitItems.push({ kind: 'point', x: point.x, y: point.y, radius: 7, element: block });
  }

  drawSectionHover(ctx, toCanvas, element) {
    ctx.save();
    ctx.strokeStyle = '#facc15';
    ctx.fillStyle = 'rgba(250,204,21,0.14)';
    ctx.lineWidth = 3;
    if (element.points?.length >= 2) {
      const points = element.points.map(toCanvas);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
    } else if (Number.isFinite(element.x) && Number.isFinite(element.y)) {
      const point = toCanvas(element);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSelectedSectionElement(ctx, toCanvas) {
    const selectedId = String(this.selected?.id ?? '');
    if (!selectedId) return;
    const elements = [
      ...(this.sectionResult?.geologicalIntersections || []),
      ...(this.sectionResult?.blockSliceElements || []),
      ...(this.sectionResult?.boreholeProjections || []),
      ...(this.sectionResult?.structureIntersections || []),
      ...(this.sectionResult?.roadwayProjections || [])
    ];
    elements
      .filter((item) => [item.id, item.surfaceId, item.boreholeId, item.structureId, item.blockId, item.roadwayEdgeId].some((value) => String(value ?? '') === selectedId))
      .forEach((item) => this.drawSectionHover(ctx, toCanvas, item));
  }

  findSectionCanvasHit(event) {
    const rect = this.sectionCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDistance = Infinity;
    this.sectionHitItems.forEach((item) => {
      const distance = item.kind === 'point' ? Math.hypot(item.x - x, item.y - y) : this.distanceToPolyline(x, y, item.points);
      const threshold = item.kind === 'point' ? item.radius : 8;
      if (distance <= threshold && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    });
    return best;
  }

  distanceToPolyline(x, y, points = []) {
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq));
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
    }
    return best;
  }

  updateSectionTooltip(event, hit) {
    if (!this.sectionTooltip) return;
    if (!hit) {
      this.sectionTooltip.style.display = 'none';
      return;
    }
    this.sectionTooltip.style.display = 'block';
    this.sectionTooltip.style.left = `${event.clientX + 12}px`;
    this.sectionTooltip.style.top = `${event.clientY + 12}px`;
    this.sectionTooltip.innerHTML = this.tooltipHtml(hit.element);
  }

  tooltipHtml(element) {
    const rows = [
      ['Type', element.type],
      ['ID', element.id || element.surfaceId || element.blockId || element.boreholeId || element.structureId || element.roadwayEdgeId],
      ['Unit', element.unitId],
      ['Surface', element.surfaceType],
      ['Attribute', element.activeAttribute],
      ['Value', element.value != null ? formatScalar(element.value, 4) : null]
    ].filter(([, value]) => value != null && value !== '');
    return rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }

  setSectionSelection(element) {
    const type = element.type === 'roadwaySegment' ? 'roadwaySegment' : element.type;
    const id = element.surfaceId || element.boreholeId || element.structureId || element.blockId || element.roadwayEdgeId || element.id;
    if (type === 'roadwaySegment') {
      this.context.set('selectedRoadwaySegment', String(id));
      this.context.set('selection', { type: 'roadwaySegment', id: String(id), data: element });
      return;
    }
    this.context.set('selectedSectionElement', { type, id: String(id), data: element });
    this.setSelection(type, id, element);
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const units = this.inputs.geologicalBody?.listUnits?.() || [];
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    const rows = this.params.colorMode === 'attribute' && active
      ? `<div class="geology-gradient"><span>${escapeHtml(active)}</span><div style="background:linear-gradient(90deg,#0a5bff,#00a9ff,#35d35d,#f4df38,#f97316,#ef4444)"></div><small>section attribute values</small></div>`
      : units
          .slice(0, 12)
          .map((unit, index) => `<div><span class="legend-dot" style="background:${escapeHtml(unit.color || geologyColorForKey(unit.geologicalUnitType ?? unit.geologicalUnitId, index))}"></span>${escapeHtml(unit.geologicalUnitName)}</div>`)
          .join('');
    this.legendPanel.querySelector('.geology-legend-content').innerHTML = `
      <div class="route-legend-list">${rows || '<div class="muted-note">No legend entries</div>'}</div>
      <div class="geology-symbols">
        <div><span class="legend-dot" style="background:#67e8f9"></span>Section plane / borehole</div>
        <div><span class="legend-dot" style="background:#ff6f61"></span>Structure / fault</div>
        <div><span class="legend-dot" style="background:#b5b9bf"></span>Roadway</div>
      </div>
    `;
  }

  updateDetailPanel() {
    const content = this.detailPanel?.querySelector('.geology-detail-content');
    if (!content) return;
    const summary = this.sectionResult?.summary || {};
    const summaryHtml = this.rows([
      ['Mode', this.sectionFrame?.mode],
      ['Axis', this.params.axis],
      ['Position', formatScalar(this.params.position, 2)],
      ['Thickness', formatScalar(this.params.thickness, 2)],
      ['Geological lines', summary.geologicalLineCount],
      ['Blocks in section', summary.blockCount],
      ['Boreholes', summary.boreholeCount],
      ['Structures', summary.structureCount],
      ['Roadway crossings', summary.roadwayCount],
      ['Active attribute', summary.activeAttribute]
    ]);
    if (!this.selected) {
      content.innerHTML = `<div class="geology-detail-subtitle">Section Summary</div>${summaryHtml}<div class="empty-state">Click a section element to inspect details.</div>`;
      return;
    }
    content.innerHTML = `<div class="geology-detail-subtitle">Selected Element</div>${this.detailHtml(this.selected)}<div class="geology-detail-subtitle">Section Summary</div>${summaryHtml}`;
  }

  applyContextSelection(selection) {
    if (!selection || (!(String(selection.type || '').startsWith('geological')) && selection.type !== 'borehole' && selection.type !== 'roadwaySegment')) {
      this.selected = null;
      this.updateHighlight();
      this.updateDetailPanel();
      this.renderSectionCanvas();
      return;
    }
    this.selected = selection;
    this.updateHighlight();
    this.updateDetailPanel();
    this.renderSectionCanvas();
  }

  updateHighlight() {
    this.highlightGroup?.clear?.();
    [this.bodyGroup, this.sectionGroup, this.attributeGroup, this.boreholeGroup, this.structureGroup].forEach((group) => {
      group?.traverse?.((child) => {
        if (!child.userData?.geologyPick) return;
        this.restoreMaterial(child);
        if (this.matchesSelection(child.userData.geologyPick)) this.highlightMaterial(child);
      });
    });
  }

  matchesSelection(pick = {}) {
    if (this.selected?.type === 'roadwaySegment') return String(pick.roadwayEdgeId ?? pick.id) === String(this.selected.id);
    if (this.selected?.type === 'geologicalBlock') return String(pick.blockId ?? pick.id) === String(this.selected.id);
    return super.matchesSelection(pick);
  }

  cleanup() {
    window.clearTimeout(this.recomputeTimer);
    super.cleanup();
    this.sectionViewPanel?.remove?.();
  }
}

function buildParamSchema(preset) {
  const schema = [
    { key: 'variable', label: 'Variable', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'legendLabel', label: 'Legend label', type: 'text' },
    { key: 'minValue', label: 'Min range', type: 'number' },
    { key: 'maxValue', label: 'Max range', type: 'number' },
    { key: 'colormap', label: 'Color map', type: 'select', options: ['rainbow', 'viridis', 'heat'] },
    { key: 'toleranceMinutes', label: 'Tolerance minutes', type: 'number' },
    { key: 'showSensors', label: 'Show sensors', type: 'boolean' },
    { key: 'chartMode', label: 'Chart mode', type: 'select', options: ['overlay', 'billboard'] }
  ];
  if (preset.warningThreshold != null) {
    schema.splice(5, 0, { key: 'warningThreshold', label: 'Warning threshold', type: 'number' });
  }
  return schema;
}

function createRoadwayScalarAnalysisDefinition(preset) {
  return {
    typeId: typeIdsByPreset[preset.id],
    label: preset.label,
    kind: 'operator',
    category: preset.id === 'scalar' ? 'Operator / Generic' : 'Operator',
    libraryCategory: 'Spatial',
    color: '#f2a51a',
    taxonomy: {
      primaryClass: 'Spatial',
      auxiliaryTags: preset.tags
    },
    inputRequirements: RoadwayScalarStateAnalysisInputRequirements,
    ports: [
      { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
      { id: 'sensorRegistry', name: 'Sensor Registry', direction: 'in', type: 'SensorRegistryDataset' },
      { id: 'sensorReadings', name: 'Sensor Readings', direction: 'in', type: 'SensorReadingsDataset' },
      { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
    ],
    defaultParams: defaultParamsFromPreset(preset),
    paramSchema: buildParamSchema(preset),
    inlineControls: [
      { type: 'rangeAuto', label: 'Range' },
      {
        type: 'numberPair',
        label: 'Min / Max',
        fields: [
          { key: 'minValue', label: 'Min', step: 0.1 },
          { key: 'maxValue', label: 'Max', step: 0.1 }
        ]
      },
      { type: 'colormap', key: 'colormap', label: 'Color map', options: ['rainbow', 'viridis', 'heat'] },
      { type: 'checkbox', key: 'showSensors', label: 'Show sensors' }
    ],
    createRuntime() {
      return {
        createOperator(nodeModel, inputs) {
          return new RoadwayScalarStateAnalysisRuntime(nodeModel, inputs);
        }
      };
    }
  };
}

const VentilationNetworkOverviewDefinition = {
  typeId: 'VentilationNetworkOverviewOperator',
  label: 'Ventilation Network Overview',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'ventilation',
      'overview',
      'spatial-reference',
      'scene',
      'topology-view',
      'facility',
      'selection-linked'
    ]
  },
  inputRequirements: VentilationNetworkOverviewInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    showFacilities: true,
    showDirection: true,
    showIntakeReturn: true,
    branchColorMode: 'type',
    branchColormap: 'viridis',
    autoFocusOnSelection: true
  },
  paramSchema: [
    { key: 'showFacilities', label: 'Show facilities', type: 'boolean' },
    { key: 'showDirection', label: 'Show direction', type: 'boolean' },
    { key: 'showIntakeReturn', label: 'Show intake / return', type: 'boolean' },
    {
      key: 'branchColorMode',
      label: 'Branch color',
      type: 'select',
      options: ['type', 'designAirQuantity', 'pressureDrop', 'resistance', 'area', 'uniform']
    },
    { key: 'branchColormap', label: 'Color map', type: 'select', options: ['viridis', 'rainbow', 'heat'] },
    { key: 'autoFocusOnSelection', label: 'Focus on selection', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'checkbox', key: 'showDirection', label: 'Show direction' },
    { type: 'checkbox', key: 'showFacilities', label: 'Show facilities' },
    { type: 'checkbox', key: 'showIntakeReturn', label: 'Show intake / return' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new VentilationNetworkOverviewRuntime(nodeModel, inputs);
      }
    };
  }
};

const AirflowDistributionAnalysisDefinition = {
  typeId: 'AirflowDistributionAnalysisOperator',
  label: 'Airflow Distribution Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'ventilation',
      'airflow-state',
      'graph-supported-field',
      'spatial',
      'temporal',
      'scene',
      'topology-view',
      'chart',
      'legend',
      'time-synchronized',
      'selection-linked'
    ]
  },
  inputRequirements: AirflowDistributionInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    defaultVariable: 'velocity',
    displayMode: 'balanced',
    showDirection: true,
    showAnomalyHighlight: true,
    showPressureMarkers: false,
    showTopologyStateView: true,
    showBranchSummary: true,
    colormap: 'rainbow',
    minValue: null,
    maxValue: null,
    opacity: 0.85,
    timeToleranceMinutes: 60
  },
  paramSchema: [
    { key: 'defaultVariable', label: 'Default variable', type: 'select', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { key: 'displayMode', label: 'Display mode', type: 'select', options: ['balanced', 'quantity-focused', 'velocity-focused', 'pressure-focused', 'direction-focused'] },
    { key: 'colormap', label: 'Color map', type: 'select', options: ['rainbow', 'viridis', 'heat'] },
    { key: 'minValue', label: 'Min value', type: 'number' },
    { key: 'maxValue', label: 'Max value', type: 'number' },
    { key: 'opacity', label: 'Overlay opacity', type: 'number' },
    { key: 'timeToleranceMinutes', label: 'Time tolerance minutes', type: 'number' },
    { key: 'showDirection', label: 'Show direction', type: 'boolean' },
    { key: 'showAnomalyHighlight', label: 'Show anomaly highlight', type: 'boolean' },
    { key: 'showPressureMarkers', label: 'Show pressure markers', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'defaultVariable', label: 'Variable', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { type: 'colormap', key: 'colormap', label: 'Color map', options: ['rainbow', 'viridis', 'heat'] },
    { type: 'checkbox', key: 'showDirection', label: 'Show direction' },
    { type: 'checkbox', key: 'showAnomalyHighlight', label: 'Show anomaly' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new AirflowDistributionAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const BranchAirflowTrendInspectionDefinition = {
  typeId: 'BranchAirflowTrendInspectionOperator',
  label: 'Branch Airflow Trend Inspection',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Temporal',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Temporal',
    auxiliaryTags: [
      'ventilation',
      'airflow-state',
      'branch',
      'time-series',
      'scene',
      'topology-view',
      'chart',
      'statistics',
      'selection-linked',
      'time-synchronized'
    ]
  },
  inputRequirements: BranchAirflowTrendInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    defaultVariable: 'airQuantity',
    availableVariables: ['airQuantity', 'velocity', 'pressureDrop'],
    timeWindowMode: 'all',
    showStatistics: true,
    showAnomalyMarkers: true,
    allowBranchSelector: true,
    syncWithWorkspaceTime: true,
    showDirection: true,
    showIntakeReturn: true,
    showFacilities: false,
    autoFocusOnSelection: true
  },
  paramSchema: [
    { key: 'defaultVariable', label: 'Default variable', type: 'select', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { key: 'timeWindowMode', label: 'Time window', type: 'select', options: ['all', 'recent', 'custom'] },
    { key: 'showStatistics', label: 'Show statistics', type: 'boolean' },
    { key: 'showAnomalyMarkers', label: 'Show anomaly markers', type: 'boolean' },
    { key: 'allowBranchSelector', label: 'Allow branch selector', type: 'boolean' },
    { key: 'syncWithWorkspaceTime', label: 'Sync with workspace time', type: 'boolean' },
    { key: 'showDirection', label: 'Show direction', type: 'boolean' },
    { key: 'showIntakeReturn', label: 'Show intake / return', type: 'boolean' },
    { key: 'autoFocusOnSelection', label: 'Focus on selection', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'defaultVariable', label: 'Variable', options: ['airQuantity', 'velocity', 'pressureDrop'] },
    { type: 'checkbox', key: 'showDirection', label: 'Direction' },
    { type: 'checkbox', key: 'showStatistics', label: 'Statistics' },
    { type: 'checkbox', key: 'syncWithWorkspaceTime', label: 'Sync time' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new BranchAirflowTrendInspectionRuntime(nodeModel, inputs);
      }
    };
  }
};

const VentilationAnomalyInspectionDefinition = {
  typeId: 'VentilationAnomalyInspectionOperator',
  label: 'Ventilation Anomaly Inspection',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'ventilation',
      'diagnostic',
      'anomaly',
      'threshold',
      'temporal',
      'summary',
      'selection-linked',
      'scene',
      'topology-view'
    ]
  },
  inputRequirements: VentilationAnomalyInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset' },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    lowAirQuantityThreshold: null,
    highVelocityThreshold: null,
    highPressureDropThreshold: null,
    lowAirQuantityRatio: 0.6,
    detectReverseFlow: true,
    detectMissingData: true,
    mode: 'currentTime',
    timeToleranceMinutes: 60,
    defaultSort: 'severity',
    showTimeline: true,
    show3DHighlight: true,
    showTopologyHighlight: true
  },
  paramSchema: [
    { key: 'lowAirQuantityThreshold', label: 'Low airflow threshold', type: 'number' },
    { key: 'lowAirQuantityRatio', label: 'Low airflow ratio', type: 'number' },
    { key: 'highVelocityThreshold', label: 'High velocity threshold', type: 'number' },
    { key: 'highPressureDropThreshold', label: 'High pressure drop threshold', type: 'number' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['currentTime', 'timeWindow'] },
    { key: 'timeToleranceMinutes', label: 'Time tolerance minutes', type: 'number' },
    { key: 'defaultSort', label: 'Default sort', type: 'select', options: ['severity', 'type', 'branchId', 'value'] },
    { key: 'detectReverseFlow', label: 'Detect reverse flow', type: 'boolean' },
    { key: 'detectMissingData', label: 'Detect missing data', type: 'boolean' },
    { key: 'showTimeline', label: 'Show timeline', type: 'boolean' },
    { key: 'show3DHighlight', label: 'Show 3D highlight', type: 'boolean' },
    { key: 'showTopologyHighlight', label: 'Show topology highlight', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'checkbox', key: 'detectReverseFlow', label: 'Reverse flow' },
    { type: 'checkbox', key: 'detectMissingData', label: 'Missing data' },
    { type: 'checkbox', key: 'show3DHighlight', label: '3D highlight' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new VentilationAnomalyInspectionRuntime(nodeModel, inputs);
      }
    };
  }
};

const GeologicalModelOverviewInputRequirements = {
  geologicalBody: {
    class: 'GeologicalBody',
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  }
};

const GeologicalSectionAnalysisInputRequirements = {
  geologicalBody: {
    class: 'GeologicalBody',
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  }
};

const BoreholeStratigraphyCorrelationInputRequirements = {
  borehole: {
    class: 'Borehole',
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  }
};

const GeologicalAttributeDistributionInputRequirements = {
  attributeModel: {
    class: 'GeologicalAttributeModel',
    requiredTemplates: ['Geometry', 'Field']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  }
};

const RoadwayGeologyRelationshipInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  }
};

const GeologicalModelOverviewDefinition = {
  typeId: 'GeologicalModelOverviewOperator',
  label: 'Geological Model Overview',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'resource',
      'overview',
      '3d-scene',
      'layer-control',
      'selection-linked',
      'borehole',
      'fault',
      'attribute-model'
    ]
  },
  inputRequirements: GeologicalModelOverviewInputRequirements,
  ports: [
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset' },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    showGeologicalBody: true,
    showRoadway: true,
    showBoreholes: true,
    showStructures: true,
    showAttributeModel: false,
    geologicalBodyOpacity: 0.55,
    roadwayOpacity: 0.25,
    boreholeOpacity: 1,
    structureOpacity: 0.7,
    attributeModelOpacity: 0.65,
    colorMode: 'geological-unit',
    activeAttribute: null,
    blockRenderMode: 'volume',
    volumeIsoValue: 0.5,
    volumeFilterMin: 0,
    volumeFilterMax: 1,
    volumeClipXMin: 0,
    volumeClipXMax: 1,
    volumeClipYMin: 0,
    volumeClipYMax: 1,
    volumeClipZMin: 0,
    volumeClipZMax: 1,
    volumeOpacity: 0.5,
    volumeRaySteps: 200,
    volumePointSize: 7,
    showLabels: false,
    showSelectedLabel: true,
    autoFocusOnSelection: true
  },
  paramSchema: [
    { key: 'showGeologicalBody', label: 'Show geological body', type: 'boolean' },
    { key: 'showRoadway', label: 'Show roadway', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showAttributeModel', label: 'Show attribute model', type: 'boolean' },
    { key: 'geologicalBodyOpacity', label: 'Body opacity', type: 'number' },
    { key: 'roadwayOpacity', label: 'Roadway opacity', type: 'number' },
    { key: 'boreholeOpacity', label: 'Borehole opacity', type: 'number' },
    { key: 'structureOpacity', label: 'Structure opacity', type: 'number' },
    { key: 'attributeModelOpacity', label: 'Attribute opacity', type: 'number' },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { key: 'blockRenderMode', label: 'Block render mode', type: 'select', options: ['volume', 'points', 'isosurface'] },
    { key: 'volumeIsoValue', label: 'Default isosurface value', type: 'number' },
    { key: 'volumeFilterMin', label: 'Default volume filter min', type: 'number' },
    { key: 'volumeFilterMax', label: 'Default volume filter max', type: 'number' },
    { key: 'volumeOpacity', label: 'Default volume opacity', type: 'number' },
    { key: 'volumeRaySteps', label: 'Default ray steps', type: 'number' },
    { key: 'volumePointSize', label: 'Default point size', type: 'number' },
    { key: 'showLabels', label: 'Show labels', type: 'boolean' },
    { key: 'showSelectedLabel', label: 'Show selected label', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'colorMode', label: 'Color', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { type: 'checkbox', key: 'showGeologicalBody', label: 'Body' },
    { type: 'checkbox', key: 'showBoreholes', label: 'Boreholes' },
    { type: 'checkbox', key: 'showStructures', label: 'Structures' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new GeologicalModelOverviewRuntime(nodeModel, inputs);
      }
    };
  }
};

const GeologicalSectionAnalysisDefinition = {
  typeId: 'GeologicalSectionAnalysisOperator',
  label: 'Geological Section Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'section',
      'slice',
      'cutaway',
      'clipping',
      'mesh',
      'volume',
      'block-model',
      'borehole',
      'fault',
      'roadway',
      'linked-view',
      'produces-dataset'
    ]
  },
  inputRequirements: GeologicalSectionAnalysisInputRequirements,
  ports: [
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset' },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sectionMode: 'axis-aligned',
    axis: 'X',
    position: 0,
    thickness: 5,
    showCutaway: true,
    clippingSide: 'positive',
    showSectionPlane: true,
    showGeologicalBody: true,
    showRoadway: true,
    showBoreholes: true,
    showStructures: true,
    showAttributeModel: true,
    activeAttribute: null,
    colorMode: 'geological-unit',
    autoUpdate: true,
    maxRenderedBlocksInSection: 5000
  },
  paramSchema: [
    { key: 'sectionMode', label: 'Section mode', type: 'select', options: ['axis-aligned', 'vertical-two-point'] },
    { key: 'axis', label: 'Axis', type: 'select', options: ['X', 'Y', 'Z'] },
    { key: 'position', label: 'Position', type: 'number' },
    { key: 'thickness', label: 'Thickness', type: 'number' },
    { key: 'showCutaway', label: 'Show cutaway', type: 'boolean' },
    { key: 'clippingSide', label: 'Clipping side', type: 'select', options: ['positive', 'negative', 'both'] },
    { key: 'showGeologicalBody', label: 'Show geological body', type: 'boolean' },
    { key: 'showRoadway', label: 'Show roadway', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showAttributeModel', label: 'Show attribute model', type: 'boolean' },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { key: 'maxRenderedBlocksInSection', label: 'Max section blocks', type: 'number' },
    { key: 'autoUpdate', label: 'Auto update', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'axis', label: 'Axis', options: ['X', 'Y', 'Z'] },
    { type: 'number', key: 'position', label: 'Position' },
    { type: 'number', key: 'thickness', label: 'Thickness' },
    { type: 'checkbox', key: 'showCutaway', label: 'Cutaway' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new GeologicalSectionAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const BoreholeStratigraphyCorrelationDefinition = {
  typeId: 'BoreholeStratigraphyCorrelationOperator',
  label: 'Borehole & Stratigraphy Correlation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'borehole',
      'stratigraphy',
      'correlation',
      'well-log',
      'section',
      'linked-view',
      'model-validation',
      'attribute',
      'interpretation'
    ]
  },
  inputRequirements: BoreholeStratigraphyCorrelationInputRequirements,
  ports: [
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    selectedBoreholeIds: [],
    displayMode: 'correlation-canvas',
    depthReference: 'depth',
    alignmentMode: 'depth',
    boreholeOrder: 'section-distance',
    show3DLayer: true,
    showLogPanel: true,
    showCorrelationCanvas: true,
    showCorrelationLines: true,
    showLithology: true,
    showAssays: true,
    showModelIntersections: true,
    activeAttribute: null,
    maxBoreholesInCanvas: 12,
    autoSelectBoreholesNearSection: true,
    sectionDistanceTolerance: 20,
    boreholeOpacity: 1,
    logPanelWidth: 160
  },
  paramSchema: [
    { key: 'displayMode', label: 'Display mode', type: 'select', options: ['single-log', 'correlation-canvas'] },
    { key: 'depthReference', label: 'Depth reference', type: 'select', options: ['depth', 'elevation'] },
    { key: 'alignmentMode', label: 'Alignment mode', type: 'select', options: ['depth', 'elevation'] },
    { key: 'boreholeOrder', label: 'Borehole order', type: 'select', options: ['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'] },
    { key: 'show3DLayer', label: 'Show 3D layer', type: 'boolean' },
    { key: 'showLogPanel', label: 'Show log panel', type: 'boolean' },
    { key: 'showCorrelationCanvas', label: 'Show correlation canvas', type: 'boolean' },
    { key: 'showCorrelationLines', label: 'Show correlation lines', type: 'boolean' },
    { key: 'showLithology', label: 'Show lithology', type: 'boolean' },
    { key: 'showAssays', label: 'Show assays', type: 'boolean' },
    { key: 'showModelIntersections', label: 'Show model intersections', type: 'boolean' },
    { key: 'maxBoreholesInCanvas', label: 'Max boreholes in canvas', type: 'number' },
    { key: 'autoSelectBoreholesNearSection', label: 'Auto select near section', type: 'boolean' },
    { key: 'boreholeOpacity', label: 'Borehole opacity', type: 'number' }
  ],
  inlineControls: [
    { type: 'select', key: 'displayMode', label: 'Mode', options: ['single-log', 'correlation-canvas'] },
    { type: 'select', key: 'boreholeOrder', label: 'Order', options: ['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'] },
    { type: 'checkbox', key: 'showCorrelationLines', label: 'Correlation lines' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new BoreholeStratigraphyCorrelationRuntime(nodeModel, inputs);
      }
    };
  }
};

const GeologicalAttributeDistributionAnalysisDefinition = {
  typeId: 'GeologicalAttributeDistributionAnalysisOperator',
  label: 'Geological Attribute Distribution Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'resource',
      'attribute-field',
      'block-model',
      'volume',
      'surface-attribute',
      'threshold',
      'histogram',
      'linked-brushing',
      'target-zone',
      'resource-evaluation',
      'risk-analysis'
    ]
  },
  inputRequirements: GeologicalAttributeDistributionInputRequirements,
  ports: [
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    activeAttribute: null,
    colorMode: 'continuous',
    colormap: 'viridis',
    valueRangeMode: 'auto',
    minValue: null,
    maxValue: null,
    filterMode: 'highlight',
    renderMode: 'auto',
    blockRenderMode: 'sampled-boxes',
    maxRenderedElements: 8000,
    showHistogram: true,
    showTargetZone: true,
    showContextElements: true,
    selectedOpacity: 0.95,
    contextOpacity: 0.12,
    attributeLayerOpacity: 0.75,
    showRoadwayContext: true,
    showGeologicalBodyContext: true,
    showStructureContext: true
  },
  paramSchema: [
    { key: 'activeAttribute', label: 'Active attribute', type: 'text' },
    { key: 'colormap', label: 'Colormap', type: 'select', options: ['viridis', 'heat', 'rainbow'] },
    { key: 'filterMode', label: 'Filter mode', type: 'select', options: ['highlight', 'selected-only', 'hide-filtered'] },
    { key: 'renderMode', label: 'Render mode', type: 'select', options: ['auto', 'points', 'sampled-boxes', 'surface-samples', 'boundary-only'] },
    { key: 'maxRenderedElements', label: 'Max rendered elements', type: 'number' },
    { key: 'showHistogram', label: 'Show histogram', type: 'boolean' },
    { key: 'showTargetZone', label: 'Show target zone', type: 'boolean' },
    { key: 'showContextElements', label: 'Show context elements', type: 'boolean' },
    { key: 'attributeLayerOpacity', label: 'Attribute opacity', type: 'number' },
    { key: 'showRoadwayContext', label: 'Show roadway context', type: 'boolean' },
    { key: 'showGeologicalBodyContext', label: 'Show geological body context', type: 'boolean' },
    { key: 'showStructureContext', label: 'Show structure context', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'colormap', label: 'Colormap', options: ['viridis', 'heat', 'rainbow'] },
    { type: 'select', key: 'filterMode', label: 'Filter', options: ['highlight', 'selected-only', 'hide-filtered'] },
    { type: 'checkbox', key: 'showHistogram', label: 'Histogram' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new GeologicalAttributeDistributionAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const RoadwayGeologyRelationshipAnalysisDefinition = {
  typeId: 'RoadwayGeologyRelationshipAnalysisOperator',
  label: 'Roadway-Geology Relationship Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'roadway',
      'relationship',
      'fault-proximity',
      'attribute-sampling',
      'risk',
      'section',
      'profile',
      'topological-context',
      'linked-view',
      'diagnostic'
    ]
  },
  inputRequirements: RoadwayGeologyRelationshipInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    analysisMode: 'risk-level',
    showRoadwayOverlay: true,
    showGeologicalBodyContext: true,
    showStructures: true,
    showBoreholes: false,
    showProfile: true,
    activeAttribute: null,
    structureWarningDistance: 50,
    structureCriticalDistance: 20,
    attributeThreshold: null,
    attributeRiskDirection: 'high',
    colorMode: 'risk-level',
    sampleInterval: 10,
    maxSamplesPerEdge: 20,
    filterRiskLevel: 'all',
    filterGeologicalUnit: 'all',
    filterStructureProximity: 'all',
    roadwayOverlayOpacity: 0.9,
    contextOpacity: 0.2,
    autoCreateSectionFromSelectedRoadway: false
  },
  paramSchema: [
    { key: 'analysisMode', label: 'Analysis mode', type: 'select', options: ['geological-unit', 'structure-proximity', 'attribute-sampling', 'risk-level'] },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'structure-distance', 'active-attribute', 'risk-level', 'uniform'] },
    { key: 'activeAttribute', label: 'Active attribute', type: 'text' },
    { key: 'structureWarningDistance', label: 'Structure warning distance', type: 'number' },
    { key: 'structureCriticalDistance', label: 'Structure critical distance', type: 'number' },
    { key: 'attributeThreshold', label: 'Attribute threshold', type: 'number' },
    { key: 'attributeRiskDirection', label: 'Attribute risk direction', type: 'select', options: ['high', 'low'] },
    { key: 'sampleInterval', label: 'Sample interval', type: 'number' },
    { key: 'maxSamplesPerEdge', label: 'Max samples per edge', type: 'number' },
    { key: 'filterRiskLevel', label: 'Risk filter', type: 'select', options: ['all', 'low', 'medium', 'high'] },
    { key: 'showRoadwayOverlay', label: 'Show roadway overlay', type: 'boolean' },
    { key: 'showGeologicalBodyContext', label: 'Show geological body context', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showProfile', label: 'Show profile', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'analysisMode', label: 'Mode', options: ['risk-level', 'geological-unit', 'structure-proximity', 'attribute-sampling'] },
    { type: 'select', key: 'colorMode', label: 'Color', options: ['risk-level', 'geological-unit', 'structure-distance', 'active-attribute', 'uniform'] },
    { type: 'checkbox', key: 'showProfile', label: 'Profile' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new RoadwayGeologyRelationshipAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const WaterInrushSimulationDefinition = {
  typeId: 'WaterInrushSimulationOperator',
  label: 'Water Inrush Simulation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Simulation',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Simulation',
    auxiliaryTags: [
      'emergency',
      'water-inrush',
      'scenario',
      'what-if',
      'roadway-hazard-state',
      'produces-dataset',
      'dataset-closure',
      'spatial',
      'temporal'
    ]
  },
  inputRequirements: WaterInrushSimulationInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'hazardState', name: 'Roadway Hazard State', direction: 'out', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sourceMode: 'pick',
    sourceEdgeId: null,
    sourceNodeId: null,
    sourceRatio: 0.5,
    startTime: 0,
    duration: 20,
    inflowMode: 'continuous',
    timeSteps: 30,
    timeInterval: 1,
    intensity: 1,
    inflowRate: 8,
    propagationSpeed: 1,
    depthGrowthRate: 1,
    decay: 0.15,
    cellLength: 10,
    roadwayWidth: 4,
    roadwayHeight: 3,
    conductanceScale: 1.2,
    leakageRate: 0,
    riskyDepthThreshold: 0.3,
    blockedDepthThreshold: 0.8,
    fullFlowRatio: 0.95,
    scenarioId: 'water_inrush_demo',
    autoRun: true
  },
  paramSchema: [
    { key: 'sourceMode', label: 'Source mode', type: 'select', options: ['pick', 'edge'] },
    { key: 'sourceEdgeId', label: 'Source edge', type: 'text' },
    { key: 'sourceRatio', label: 'Source ratio', type: 'number' },
    { key: 'startTime', label: 'Start time', type: 'number' },
    { key: 'inflowMode', label: 'Inflow mode', type: 'select', options: ['continuous', 'timed'] },
    { key: 'duration', label: 'Inflow duration', type: 'number' },
    { key: 'timeSteps', label: 'Time steps', type: 'number' },
    { key: 'timeInterval', label: 'Time interval', type: 'number' },
    { key: 'inflowRate', label: 'Inflow rate', type: 'number' },
    { key: 'intensity', label: 'Intensity', type: 'number' },
    { key: 'cellLength', label: 'Cell length', type: 'number' },
    { key: 'roadwayWidth', label: 'Roadway width', type: 'number' },
    { key: 'roadwayHeight', label: 'Roadway height', type: 'number' },
    { key: 'conductanceScale', label: 'Conductance', type: 'number' },
    { key: 'leakageRate', label: 'Leakage', type: 'number' },
    { key: 'riskyDepthThreshold', label: 'Risky threshold', type: 'number' },
    { key: 'blockedDepthThreshold', label: 'Blocked threshold', type: 'number' },
    { key: 'fullFlowRatio', label: 'Full flow ratio', type: 'number' },
    { key: 'autoRun', label: 'Auto run', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'text', key: 'sourceEdgeId', label: 'Source edge' },
    { type: 'checkbox', key: 'autoRun', label: 'Auto run' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new WaterInrushSimulationRuntime(nodeModel, inputs);
      }
    };
  }
};

const FireAndSmokeSimulationInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation'],
    requiredRoles: ['spatialSupport', 'networkStructure', 'constitutiveCorrespondence']
  },
  ventilationNetwork: {
    class: 'VentilationNetwork',
    optional: true,
    requiredTemplates: ['Graph', 'Registry', 'Relation'],
    requiredRoles: ['ventilationNetworkStructure', 'facilityIdentity', 'roadwayReference']
  },
  airflowState: {
    class: 'AirflowState',
    optional: true,
    requiredTemplates: ['State', 'Field', 'Relation'],
    requiredRoles: ['branchState', 'airflowField', 'branchStateRelation']
  }
};

const FireAndSmokeSimulationDefinition = {
  typeId: 'FireAndSmokeSimulationOperator',
  label: 'Fire and Smoke Simulation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Simulation',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Simulation',
    auxiliaryTags: [
      'emergency',
      'fire',
      'smoke',
      'ventilation-coupled',
      'roadway-hazard-state',
      'temporal',
      'spatial',
      'produces-dataset',
      'what-if'
    ]
  },
  inputRequirements: FireAndSmokeSimulationInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'ventilationNetwork', name: 'Ventilation Network', direction: 'in', type: 'VentilationNetworkDataset', optional: true },
    { id: 'airflowState', name: 'Airflow State', direction: 'in', type: 'AirflowStateDataset', optional: true },
    { id: 'hazardState', name: 'Roadway Hazard State', direction: 'out', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sourceEdgeId: null,
    sourceRatio: 0.5,
    ignitionTime: 0,
    simulationDuration: 1800,
    timeSteps: 60,
    timeInterval: 30,
    cellLength: 10,
    roadwayWidth: 4,
    roadwayHeight: 3,
    initialHeatRelease: 1,
    burnRate: 0.03,
    fuelLoad: 4,
    heatYield: 1,
    heatLossRate: 0.006,
    ignitionThreshold: 1,
    smokeYield: 1,
    coYield: 0.1,
    smokeDiffusion: 0.05,
    ventilationAdvectionScale: 1,
    ventilationDilutionScale: 0.2,
    airflowFireBoost: 0.5,
    riskyTempThreshold: 60,
    blockedTempThreshold: 120,
    riskySmokeThreshold: 0.25,
    blockedSmokeThreshold: 0.6,
    riskyVisibilityThreshold: 20,
    blockedVisibilityThreshold: 5,
    riskyCOThreshold: 50,
    blockedCOThreshold: 150,
    useVentilation: true,
    showFireLayer: true,
    showSmokeLayer: true,
    showRiskLayer: true,
    showSourceMarker: true,
    scenarioId: 'fire_smoke_demo',
    autoRun: true
  },
  paramSchema: [
    { key: 'sourceEdgeId', label: 'Source edge', type: 'text' },
    { key: 'sourceRatio', label: 'Source ratio', type: 'number' },
    { key: 'ignitionTime', label: 'Ignition time', type: 'number' },
    { key: 'timeSteps', label: 'Time steps', type: 'number' },
    { key: 'timeInterval', label: 'Time interval', type: 'number' },
    { key: 'fuelLoad', label: 'Fuel load', type: 'number' },
    { key: 'burnRate', label: 'Burn rate', type: 'number' },
    { key: 'smokeYield', label: 'Smoke yield', type: 'number' },
    { key: 'coYield', label: 'CO yield', type: 'number' },
    { key: 'useVentilation', label: 'Use ventilation', type: 'boolean' },
    { key: 'autoRun', label: 'Auto run', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'text', key: 'sourceEdgeId', label: 'Source edge' },
    { type: 'checkbox', key: 'useVentilation', label: 'Ventilation' },
    { type: 'checkbox', key: 'autoRun', label: 'Auto run' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new FireAndSmokeSimulationRuntime(nodeModel, inputs);
      }
    };
  }
};

const PersonnelEmergencyAnalysisDefinition = {
  typeId: 'PersonnelEmergencyAnalysisOperator',
  label: 'Personnel Emergency Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'emergency',
      'personnel',
      'evacuation',
      'hazard-aware',
      'routing',
      'resource',
      'risk',
      'spatial',
      'temporal',
      'scene',
      'response',
      'what-if',
      'consumes-derived-dataset'
    ]
  },
  inputRequirements: SafeRouteAnalysisInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'people', name: 'People', direction: 'in', type: 'PeopleDataset' },
    { id: 'emergencyResources', name: 'Emergency Resources', direction: 'in', type: 'EmergencyResourcesDataset' },
    { id: 'hazardState', name: 'Hazard State', direction: 'in', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    routeMode: 'nearest-safe',
    destinationMode: 'nearest-resource',
    resourceTypes: ['refuge', 'exit'],
    avoidRiskySegments: true,
    riskWeight: 5,
    riskPenalty: 5,
    blockedCost: Infinity,
    showAllRoutes: true,
    showOnlyAtRiskPeople: false,
    enableQuickHazardSketch: true,
    autoRecompute: true,
    travelSpeed: 1.2,
    walkingSpeed: 1.2,
    capacityAware: false,
    manualMode: false,
    manualMarkMode: 'blocked'
  },
  paramSchema: [
    { key: 'routeMode', label: 'Route mode', type: 'select', options: ['nearest-safe', 'shortest', 'lowest-risk'] },
    { key: 'destinationMode', label: 'Destination mode', type: 'select', options: ['nearest-resource', 'selected-resource', 'nearest-exit', 'nearest-refuge'] },
    { key: 'riskWeight', label: 'Risk weight', type: 'number' },
    { key: 'travelSpeed', label: 'Travel speed', type: 'number' },
    { key: 'avoidRiskySegments', label: 'Avoid risky segments', type: 'boolean' },
    { key: 'showAllRoutes', label: 'Show all routes', type: 'boolean' },
    { key: 'showOnlyAtRiskPeople', label: 'Show only at-risk people', type: 'boolean' },
    { key: 'enableQuickHazardSketch', label: 'Quick hazard sketch', type: 'boolean' },
    { key: 'manualMarkMode', label: 'Sketch mark', type: 'select', options: ['blocked', 'risky', 'clear'] }
  ],
  inlineControls: [
    { type: 'select', key: 'destinationMode', label: 'Destination', options: ['nearest-resource', 'selected-resource', 'nearest-exit', 'nearest-refuge'] },
    { type: 'checkbox', key: 'avoidRiskySegments', label: 'Avoid risky' },
    { type: 'checkbox', key: 'showOnlyAtRiskPeople', label: 'At-risk only' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new SafeRouteAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const SafeRouteAnalysisDefinition = {
  typeId: 'SafeRouteAnalysisOperator',
  label: 'Safe Route Analysis (Legacy)',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Topological',
  deprecated: true,
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Topological',
    auxiliaryTags: [
      'emergency',
      'evacuation',
      'routing',
      'hazard-aware',
      'people',
      'resource',
      'consumes-derived-dataset',
      'scene',
      'path'
    ]
  },
  inputRequirements: SafeRouteAnalysisInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'people', name: 'People', direction: 'in', type: 'PeopleDataset' },
    { id: 'emergencyResources', name: 'Emergency Resources', direction: 'in', type: 'EmergencyResourcesDataset' },
    { id: 'hazardState', name: 'Hazard State', direction: 'in', type: 'RoadwayHazardStateDataset' },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    routeMode: 'nearest-safe',
    destinationMode: 'nearest-resource',
    resourceTypes: ['refuge', 'exit'],
    avoidRiskySegments: true,
    riskPenalty: 5,
    walkingSpeed: 1.2,
    showAllRoutes: true,
    showOnlyAtRiskPeople: false,
    enableQuickHazardSketch: true,
    manualMode: false,
    manualMarkMode: 'blocked'
  },
  paramSchema: [
    { key: 'riskPenalty', label: 'Risk penalty', type: 'number' },
    { key: 'walkingSpeed', label: 'Walking speed', type: 'number' },
    { key: 'manualMode', label: 'Manual constraints', type: 'boolean' },
    { key: 'manualMarkMode', label: 'Mark mode', type: 'select', options: ['blocked', 'risky', 'clear'] }
  ],
  inlineControls: [
    { type: 'checkbox', key: 'manualMode', label: 'Manual constraints' },
    { type: 'select', key: 'manualMarkMode', label: 'Mark', options: ['blocked', 'risky', 'clear'] }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new SafeRouteAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

export const OperatorNodeDefinitions = [
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.temperature),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.CO),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.humidity),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.CH4),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.scalar),
  VentilationNetworkOverviewDefinition,
  AirflowDistributionAnalysisDefinition,
  BranchAirflowTrendInspectionDefinition,
  VentilationAnomalyInspectionDefinition,
  GeologicalModelOverviewDefinition,
  GeologicalSectionAnalysisDefinition,
  BoreholeStratigraphyCorrelationDefinition,
  GeologicalAttributeDistributionAnalysisDefinition,
  RoadwayGeologyRelationshipAnalysisDefinition,
  WaterInrushSimulationDefinition,
  FireAndSmokeSimulationDefinition,
  PersonnelEmergencyAnalysisDefinition,
  SafeRouteAnalysisDefinition
];
