import { TimeSeriesChartView } from '../../../../ui/charts/TimeSeriesChartView.js';
import { ChartPresentationService } from '../../../../ui/charts/ChartPresentationService.js';
import { SelectionSetController, chartPresentationFromParams } from '../../../selection/SelectionSetController.js';
import { VentilationBranchComparisonAdapter } from '../BranchAirflowTrendInspection/comparisonAdapter.js';
import { generateCssGradient, sampleColor } from '../../../../utils/colors.js';
import {
  buildContinuousTimeScale,
  escapeHtml,
  formatScalar,
  formatTime,
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
import { VentilationNetworkOverviewRuntime } from '../VentilationNetworkOverview/runtime.js';

export class AirflowDistributionAnalysisRuntime extends VentilationNetworkOverviewRuntime {
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
      timeToleranceMinutes: Number(nodeModel.params?.timeToleranceMinutes ?? 60),
      chartPresentation: chartPresentationFromParams(nodeModel.params),
      comparisonLayout: nodeModel.params?.comparisonLayout || 'auto',
      selectionMode: nodeModel.params?.selectionMode || 'multiple',
      maxComparedItems: Math.max(1, Number(nodeModel.params?.maxComparedItems) || 8),
      worldChartScale: Number(nodeModel.params?.worldChartScale ?? 1),
      worldChartOcclusion: nodeModel.params?.worldChartOcclusion || 'depth-aware'
    };
    this.nodeModel.params = {
      ...(nodeModel.params || {}),
      chartPresentation: this.params.chartPresentation,
      comparisonLayout: this.params.comparisonLayout,
      selectionMode: this.params.selectionMode,
      maxComparedItems: this.params.maxComparedItems,
      worldChartScale: this.params.worldChartScale,
      worldChartOcclusion: this.params.worldChartOcclusion
    };
    this.inputRequirements = AirflowDistributionInputRequirements;
    this.currentSnapshot = new Map();
    this.currentVariable = this.params.defaultVariable;
    this.currentRange = { min: 0, max: 1 };
    this.stateByBranch = new Map();
    this.summaryChartView = null;
    this.summaryChartPresentation = null;
    this.branchSelectionController = null;
    this.branchComparisonAdapter = null;
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.branchSelectionController = new SelectionSetController({
      context,
      type: 'ventilationBranch',
      selectionType: 'ventilationBranch',
      primaryContextKey: 'selectedVentilationBranch',
      maxItems: this.params.maxComparedItems,
      source: this.id + ':airflow-branch-selection',
      onLimit: ({ limit }) => {
        this.branchComparisonStatus = 'Compare up to ' + limit + ' branches.';
        this.updateDetailPanel();
      }
    });
    this.branchComparisonAdapter = new VentilationBranchComparisonAdapter({
      ventilationNetwork: this.inputs.ventilationNetwork,
      airflowState: this.inputs.airflowState,
      sceneManager
    });
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.prepareVentilationGeometry();
    this.createPanels();
    this.registerVisualContributions();
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.5);
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
      <div class="airflow-trend-chart-slot chart-presentation-dock-host"><div class="airflow-trend-chart chart-panel"></div></div>
    `;
    host.appendChild(this.summaryPanel);
    this.installPanelCollapse(this.summaryPanel);
    this.makeDraggable(this.summaryPanel);

    this.graphCanvas = this.graphPanel.querySelector('.ventilation-graph-canvas');
    this.installCanvasNavigation(this.graphCanvas, this.graphView);
    this.graphCanvas.addEventListener('click', (event) => this.handleGraphClick(event));
    this.initializeSummaryChart();
  }

  initializeSummaryChart() {
    const chartHost = this.summaryPanel?.querySelector('.airflow-trend-chart');
    const chartSlot = this.summaryPanel?.querySelector('.airflow-trend-chart-slot');
    if (!chartHost || !chartSlot) return;
    this.summaryChartPresentation?.dispose?.();
    this.summaryChartView?.dispose?.();
    this.summaryChartView = new TimeSeriesChartView(chartHost);
    this.summaryChartView.setCallbacks({
      onTimeChange: (time) => this.context.set('time', time),
      onPrimaryChange: (branchId) => this.branchSelectionController?.setPrimary(branchId),
      onHoverChange: (branchId) => this.branchSelectionController?.setHovered(branchId)
    });
    this.summaryChartPresentation = new ChartPresentationService({
      id: this.id + ':airflow-summary-chart',
      sceneManager: this.sceneManager,
      chartView: this.summaryChartView,
      chartElement: chartHost,
      dockHost: chartSlot,
      anchorProvider: () => {
        const primaryId = this.branchSelectionController?.getState().primaryId;
        return primaryId ? this.branchComparisonAdapter?.getWorldAnchor(primaryId) : null;
      },
      avoidAnchorProvider: () => this.branchComparisonAdapter.listComparableEntities()
        .map((entity) => this.branchComparisonAdapter.getWorldAnchor(entity.id))
        .filter(Boolean),
      onRequestDocked: () => this.setSummaryChartPresentation('docked'),
      worldScale: this.params.worldChartScale,
      occlusion: this.params.worldChartOcclusion
    });
    this.summaryChartPresentation.setPresentation(this.params.chartPresentation, { notify: false });
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
      show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
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
      element: this.summaryPanel,
      visible: true,
      show: () => {
        this.summaryPanel.style.display = 'block';
        this.summaryChartView?.resizeToContainer?.();
      },
      hide: () => {
        this.summaryPanel.style.display = 'none';
      },
      cleanup: () => {
        this.disposeSummaryChart();
        this.summaryPanel.remove();
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:airflow-summary-scene-presentation`,
      label: 'Airflow Summary Scene Presentation',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      contributionKind: 'layer',
      semanticRole: 'detail',
      objectSystem: 'airflowState',
      host: 'main-3d-scene',
      visible: this.params.chartPresentation !== 'docked',
      show: () => this.summaryChartPresentation?.setSceneVisible(true),
      hide: () => this.summaryChartPresentation?.setSceneVisible(false),
      cleanup: () => this.summaryChartPresentation?.setSceneVisible(false)
    });
  }

  installSceneHandlers() {
    this.disposers.push(this.sceneManager.registerInteractionHandler('ventilation-branch', this.id, (branchId, event) => {
      this.selectBranch(branchId, { focus: false, event });
      return true;
    }));
    this.disposers.push(() => {
      this.sceneManager.clearVentilationPickingBranches?.(this.id);
    });
  }

  installContextHandlers() {
    this.disposers.push(
      this.context.subscribe('time', () => this.updateAirflowState({ autoRange: false }))
    );
    this.disposers.push(
      this.branchSelectionController.subscribe((selection) => {
        this.selectedBranchId = selection.primaryId || null;
        this.updateSelectionViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('hoveredSelection', () => this.updateBranchSelectionHighlights())
    );
    this.disposers.push(
      this.context.subscribe('activeAirflowVariable', (variable) => {
        if (AIRFLOW_VARIABLES[variable]) {
          this.currentVariable = variable;
          this.params.defaultVariable = variable;
          this.branchComparisonAdapter?.setValueKey(AIRFLOW_VARIABLES[variable].valueKey);
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

  selectBranch(branchId, { focus = false, event = {} } = {}) {
    if (!branchId) return;
    if (this.params.selectionMode === 'single') {
      this.branchSelectionController?.replace(branchId);
    } else {
      this.branchSelectionController?.applyPointerSelection(branchId, event || {});
    }
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
    this.updateBranchSelectionHighlights();
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
    this.updateBranchSelectionHighlights();
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
    this.drawTopology();
    this.updateDetailPanel();
  }
  updateBranchSelectionHighlights() {
    const selection = this.branchSelectionController?.getState() || { ids: [], primaryId: null };
    const hovered = this.context.get('hoveredSelection');
    const hoveredId = hovered?.type === 'ventilationBranch' ? hovered.id : null;
    this.sceneManager.highlightAirflowBranch(selection.primaryId);
    this.sceneManager.setVentilationBranchSelectionState?.({
      ids: selection.ids,
      primaryId: selection.primaryId,
      hoveredId,
      colors: this.branchSelectionController?.colorsFor(selection.ids) || {}
    });
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

  updateSummaryChart() {
    if (!this.summaryChartView) return;
    const selection = this.branchSelectionController?.getState() || { ids: [], primaryId: null };
    const meta = this.getVariableMeta();
    this.branchComparisonAdapter?.setValueKey(meta.valueKey);
    const entities = new Map(
      (this.branchComparisonAdapter?.listComparableEntities() || [])
        .map((entity) => [String(entity.id), entity])
    );
    const series = selection.ids.map((id) => {
      const entity = entities.get(String(id));
      return {
        id: String(id),
        label: entity?.label || String(id),
        unit: meta.unit,
        data: this.branchComparisonAdapter?.getTimeSeries(id) || [],
        color: this.branchSelectionController.colorFor(id),
        primary: String(id) === String(selection.primaryId || '')
      };
    });
    this.summaryChartView.setModel({
      title: meta.label + ' Comparison',
      subtitle: series.length === 1 ? series[0].label : series.length + ' branches',
      metricLabel: meta.label,
      unit: meta.unit,
      series,
      currentTime: this.context.get('time'),
      comparisonLayout: this.params.comparisonLayout
    });
    this.summaryChartPresentation?.updateFrame();
  }

  setSummaryChartPresentation(value) {
    const presentation = String(value || 'docked');
    this.params.chartPresentation = presentation;
    this.nodeModel.params.chartPresentation = presentation;
    const docked = presentation === 'docked';
    const sceneId = this.id + ':airflow-summary-scene-presentation';
    if (this.contributionRegistry?.get?.(sceneId)) {
      this.contributionRegistry.setVisible(sceneId, !docked);
    }
    this.summaryChartPresentation?.setPresentation(presentation);
    this.summaryChartPresentation?.setDockVisible(docked);
    this.summaryChartPresentation?.setSceneVisible(!docked);
    this.syncSummaryChartPresentationControls();
  }

  syncSummaryChartPresentationControls() {
    if (!this.controlContainer) return;
    const presentation = this.controlContainer.querySelector('.chart-presentation-select');
    if (presentation && presentation.value !== this.params.chartPresentation) {
      presentation.value = this.params.chartPresentation;
    }
    const worldControls = this.controlContainer.querySelector('.chart-world-controls');
    if (worldControls) {
      worldControls.hidden = !['world-billboard', 'world-plane'].includes(this.params.chartPresentation);
    }
    const reorient = this.controlContainer.querySelector('.chart-reorient');
    if (reorient) reorient.hidden = this.params.chartPresentation !== 'world-plane';
  }

  disposeSummaryChart() {
    this.summaryChartPresentation?.dispose?.();
    this.summaryChartPresentation = null;
    this.summaryChartView?.dispose?.();
    this.summaryChartView = null;
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
      <div class="control-section chart-presentation-controls">
        <div class="control-section-title">Linked chart</div>
        <label class="field-row"><span>Presentation</span>
          <select class="chart-presentation-select">
            <option value="docked">Docked panel</option>
            <option value="scene-callout">Scene callout</option>
            <option value="world-billboard">World billboard</option>
            <option value="world-plane">World plane</option>
          </select>
        </label>
        <label class="field-row"><span>Comparison</span>
          <select class="chart-comparison-layout">
            <option value="auto">Auto</option>
            <option value="superimposed">Superimposed</option>
            <option value="small-multiples">Small multiples</option>
          </select>
        </label>
        <div class="chart-world-controls">
          <label class="field-row"><span>World scale</span><input class="chart-world-scale" type="range" min="0.25" max="4" step="0.05" /></label>
          <label class="field-row"><span>Occlusion</span>
            <select class="chart-world-occlusion">
              <option value="depth-aware">Depth-aware</option>
              <option value="always-visible">Always visible</option>
            </select>
          </label>
          <button class="chart-reorient" type="button">Reorient to camera</button>
        </div>
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
    const presentation = container.querySelector('.chart-presentation-select');
    const comparison = container.querySelector('.chart-comparison-layout');
    const worldScale = container.querySelector('.chart-world-scale');
    const worldOcclusion = container.querySelector('.chart-world-occlusion');
    const reorient = container.querySelector('.chart-reorient');
    variable.value = this.currentVariable;
    colormap.value = this.params.colormap || this.getVariableMeta().colormap;
    showDirection.checked = this.params.showDirection;
    showAnomaly.checked = this.params.showAnomalyHighlight;
    showPressure.checked = this.params.showPressureMarkers;
    presentation.value = this.params.chartPresentation;
    comparison.value = this.params.comparisonLayout;
    worldScale.value = String(this.params.worldChartScale);
    worldOcclusion.value = this.params.worldChartOcclusion;
    this.syncSummaryChartPresentationControls();
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
    presentation.addEventListener('change', () => this.setSummaryChartPresentation(presentation.value));
    comparison.addEventListener('change', () => {
      this.params.comparisonLayout = comparison.value;
      this.nodeModel.params.comparisonLayout = comparison.value;
      this.updateSummaryChart();
    });
    worldScale.addEventListener('input', () => {
      this.params.worldChartScale = Number(worldScale.value);
      this.nodeModel.params.worldChartScale = this.params.worldChartScale;
      this.summaryChartPresentation?.setWorldScale(this.params.worldChartScale);
    });
    worldOcclusion.addEventListener('change', () => {
      this.params.worldChartOcclusion = worldOcclusion.value;
      this.nodeModel.params.worldChartOcclusion = worldOcclusion.value;
      this.summaryChartPresentation?.setOcclusion(worldOcclusion.value);
    });
    reorient.addEventListener('click', () => this.summaryChartPresentation?.reorientToCamera());
    this.updateControlsView();
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.branchSelectionController?.dispose?.();
    this.branchSelectionController = null;
    this.sceneManager.setVentilationBranchSelectionState?.({ ids: [] });
    this.disposeSummaryChart();
    this.sceneManager.clearAirflowOverlay?.();
    this.sceneManager.highlightRoadwayEdges?.([]);
  }
}
