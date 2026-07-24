import { legendList } from '../../../../ui/RuntimeLegends.js';
import { generateCssGradient, sampleColor } from '../../../../utils/colors.js';
import {
  buildContinuousTimeScale,
  escapeHtml,
  formatScalar,
  formatTime,
  getSelectionBranchID,
  getSelectionFacilityID,
  pointOf
} from '../../shared/OperatorRuntimeUtils.js';

import {
  VentilationNetworkOverviewInputRequirements,
  AirflowDistributionInputRequirements,
  BranchAirflowTrendInputRequirements,
  VentilationAnomalyInputRequirements,
  AIRFLOW_VARIABLES
} from '../contracts.js';
import { loadRoadwayDataset } from '../../shared/OperatorRuntimeUtils.js';

export class VentilationNetworkOverviewRuntime {
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
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.5);
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
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayVisibleForOwner(this.id, true);
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
      ${legendList([
        { label: 'Intake', color: '#42a5ff' },
        { label: 'Return', color: '#ff6b6b' },
        { label: 'Fan', color: '#ffd166' },
        { label: 'Door', color: '#76d7c4' },
        { label: 'Regulator', color: '#c084fc' },
        { label: 'Stopping', color: '#94a3b8' }
      ], { title: 'Facilities' })}
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
    panel.classList.remove('panel-collapsed');
    panel.querySelector(':scope > .panel-title')?.remove();
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
    panel.classList.remove('dragging');
    ['position', 'left', 'right', 'top', 'bottom', 'width', 'height'].forEach((property) => {
      panel.style.removeProperty(property);
    });
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:ventilation-2d-drawing`,
      label: 'Ventilation 2D Drawing',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'drawing',
      element: this.topologyPanel,
      visible: true,
      show: () => {
        this.topologyPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.topologyPanel.style.display = 'none';
      },
      onResize: () => this.drawTopology(),
      cleanup: () => this.topologyPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:ventilation-topology-graph`,
      label: 'Ventilation Topology Graph',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'topology-view',
      element: this.graphPanel,
      visible: true,
      show: () => {
        this.graphPanel.style.display = 'block';
        this.drawTopology();
      },
      hide: () => {
        this.graphPanel.style.display = 'none';
      },
      onResize: () => this.drawTopology(),
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
      show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
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
      element: this.legendPanel,
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
      element: this.detailPanel,
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
    this.disposers.push(this.sceneManager.registerInteractionHandler('ventilation-branch', this.id, (branchId, event) => {
      this.selectBranch(branchId, { focus: this.params.autoFocusOnSelection, event });
      return true;
    }));
    this.disposers.push(this.sceneManager.registerInteractionHandler('ventilation-facility', this.id, (facilityId) => {
      this.selectFacility(facilityId, { focus: this.params.autoFocusOnSelection });
      return true;
    }));
    this.disposers.push(() => {
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
      this.selectBranch(branchHit.branchId, { focus: this.params.autoFocusOnSelection, event });
      return;
    }
    let best = null;
    this.topologyBranchSegments.forEach((segment) => {
      const distance = this.distanceToSegment(point, segment.a, segment.b);
      if (!best || distance < best.distance) best = { branchId: segment.branchId, distance };
    });
    if (best && best.distance < 10) this.selectBranch(best.branchId, { focus: this.params.autoFocusOnSelection, event });
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
    if (best && best.distance < 10) this.selectBranch(best.branchId, { focus: this.params.autoFocusOnSelection, event });
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
