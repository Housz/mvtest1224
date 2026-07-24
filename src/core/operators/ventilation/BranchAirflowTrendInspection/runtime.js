import { TimeSeriesChartView } from '../../../../ui/charts/TimeSeriesChartView.js';
import { ChartPresentationService } from '../../../../ui/charts/ChartPresentationService.js';
import { SelectionSetController, chartPresentationFromParams } from '../../../selection/SelectionSetController.js';
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
import { VentilationBranchComparisonAdapter } from './comparisonAdapter.js';

export class BranchAirflowTrendInspectionRuntime extends VentilationNetworkOverviewRuntime {
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
      autoFocusOnSelection: nodeModel.params?.autoFocusOnSelection !== false,
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
    this.inputRequirements = BranchAirflowTrendInputRequirements;
    this.currentVariable = this.params.defaultVariable;
    this.trendChartView = null;
    this.trendChartPresentation = null;
    this.branchSelectionController = null;
    this.branchComparisonAdapter = null;
    this.branchComparisonStatus = '';
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
      source: this.id + ':branch-selection',
      onLimit: ({ limit }) => {
        this.branchComparisonStatus = 'Compare up to ' + limit + ' branches.';
        this.renderSelectorPanel();
      }
    });
    this.branchComparisonAdapter = new VentilationBranchComparisonAdapter({
      ventilationNetwork: this.inputs.ventilationNetwork,
      airflowState: this.inputs.airflowState,
      sceneManager
    });
    this.validateSemanticInputs();
    if (this.inputs.roadway) {
      await this.initializeRoadway();
      this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.5);
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
      <div class="branch-trend-chart-slot chart-presentation-dock-host"><div class="branch-trend-chart chart-panel"></div></div>
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

    this.controlsPanel = document.createElement('section');
    this.controlsPanel.className = 'glass-panel ventilation-panel branch-trend-controls-panel';
    this.controlsPanel.innerHTML = '<div class="branch-trend-controls-content"></div>';
    host.appendChild(this.controlsPanel);
    this.renderControls(this.controlsPanel.querySelector('.branch-trend-controls-content'));

    this.topologyCanvas = this.topologyPanel.querySelector('.ventilation-topology-canvas');
    this.graphCanvas = this.graphPanel.querySelector('.ventilation-graph-canvas');
    this.installCanvasNavigation(this.topologyCanvas, this.drawingView);
    this.installCanvasNavigation(this.graphCanvas, this.graphView);
    this.topologyCanvas.addEventListener('click', (event) => this.handleTopologyClick(event));
    this.graphCanvas.addEventListener('click', (event) => this.handleGraphClick(event));
    this.initializeTrendChart();
  }

  initializeTrendChart() {
    const chartHost = this.trendPanel?.querySelector('.branch-trend-chart');
    const chartSlot = this.trendPanel?.querySelector('.branch-trend-chart-slot');
    if (!chartHost || !chartSlot) return;
    this.trendChartPresentation?.dispose?.();
    this.trendChartView?.dispose?.();
    this.trendChartView = new TimeSeriesChartView(chartHost);
    this.trendChartView.setCallbacks({
      onTimeChange: (time) => {
        if (this.params.syncWithWorkspaceTime) this.context.set('time', time);
      },
      onPrimaryChange: (branchId) => this.branchSelectionController?.setPrimary(branchId),
      onHoverChange: (branchId) => this.branchSelectionController?.setHovered(branchId)
    });
    this.trendChartPresentation = new ChartPresentationService({
      id: this.id + ':branch-trend-chart',
      sceneManager: this.sceneManager,
      chartView: this.trendChartView,
      chartElement: chartHost,
      dockHost: chartSlot,
      anchorProvider: () => {
        const primaryId = this.branchSelectionController?.getState().primaryId;
        return primaryId ? this.branchComparisonAdapter?.getWorldAnchor(primaryId) : null;
      },
      avoidAnchorProvider: () => this.branchComparisonAdapter.listComparableEntities()
        .map((entity) => this.branchComparisonAdapter.getWorldAnchor(entity.id))
        .filter(Boolean),
      onRequestDocked: () => this.setTrendChartPresentation('docked'),
      worldScale: this.params.worldChartScale,
      occlusion: this.params.worldChartOcclusion
    });
    this.trendChartPresentation.setPresentation(this.params.chartPresentation, { notify: false });
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
        show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
        hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
        setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
        focus: () => this.sceneManager.focusOnRoadway(),
        cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
      });
    }
    this.contributionRegistry.register({
      id: `${this.id}:trend-ventilation-2d-drawing`,
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
      id: `${this.id}:trend-ventilation-topology-graph`,
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
      contributionKind: 'chart',
      semanticRole: 'detail',
      objectSystem: 'airflowState',
      element: this.trendPanel,
      visible: this.params.chartPresentation === 'docked',
      layout: {
        preferredRegion: 'bottom',
        preferredSize: { width: 660, height: 280 },
        content: { profile: 'chart', padding: 'none', overflow: 'hidden' }
      },
      show: () => this.trendChartPresentation?.setDockVisible(true),
      hide: () => this.trendChartPresentation?.setDockVisible(false),
      cleanup: () => {
        this.disposeTrendChart();
        this.trendPanel.remove();
      }
    });
    this.contributionRegistry.register({
      id: `${this.id}:branch-trend-scene-presentation`,
      label: 'Branch Trend Scene Presentation',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      contributionKind: 'layer',
      semanticRole: 'detail',
      objectSystem: 'airflowState',
      host: 'main-3d-scene',
      visible: this.params.chartPresentation !== 'docked',
      show: () => this.trendChartPresentation?.setSceneVisible(true),
      hide: () => this.trendChartPresentation?.setSceneVisible(false),
      cleanup: () => this.trendChartPresentation?.setSceneVisible(false)
    });
    this.contributionRegistry.register({
      id: this.id + ':branch-trend-controls',
      label: 'Branch Airflow Trend Controls',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'control',
      contributionKind: 'control',
      semanticRole: 'control',
      objectSystem: 'airflowState',
      host: 'right-panel',
      element: this.controlsPanel,
      visible: true,
      layout: {
        role: 'control',
        preferredRegion: 'right',
        preferredSize: { width: 288, height: 360 },
        content: { profile: 'form', padding: 'compact', overflow: 'auto' }
      },
      cleanup: () => this.controlsPanel.remove()
    });
    this.contributionRegistry.register({
      id: `${this.id}:branch-selector-context`,
      label: 'Branch Selector / Context Panel',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      contributionKind: 'panel',
      semanticRole: 'detail',
      objectSystem: 'ventilationBranch',
      host: 'right-panel',
      element: this.selectorPanel,
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
      element: this.statisticsPanel,
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
    this.disposers.push(this.sceneManager.registerInteractionHandler('ventilation-branch', this.id, (branchId, event) => {
      this.applyBranchSelection(branchId, event || {});
      return true;
    }));
    this.disposers.push(() => {
      this.sceneManager.clearVentilationPickingBranches?.(this.id);
    });
  }

  installContextHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateViews()));
    this.disposers.push(
      this.branchSelectionController.subscribe((selection) => {
        this.selectedBranchId = selection.primaryId || null;
        this.updateViews();
      })
    );
    this.disposers.push(
      this.context.subscribe('hoveredSelection', () => this.updateBranchSelectionHighlights())
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
    const selection = this.branchSelectionController?.getState();
    if (!selection?.ids?.length && branches[0]) {
      this.branchSelectionController.replace(branches[0].id);
    } else {
      this.selectedBranchId = selection?.primaryId || null;
    }
  }

  selectBranch(branchId, { focus = false, event = null } = {}) {
    if (!branchId) return;
    if (event) {
      this.applyBranchSelection(branchId, event);
    } else {
      this.branchSelectionController?.setPrimary(branchId);
    }
    if (focus) this.sceneManager.focusVentilationBranch(branchId);
  }

  applyBranchSelection(branchId, event = {}) {
    if (!branchId) return;
    if (this.params.selectionMode === 'single') {
      this.branchSelectionController?.replace(branchId);
      return;
    }
    this.branchSelectionController?.applyPointerSelection(branchId, event);
  }

  getVariableMeta() {
    return AIRFLOW_VARIABLES[this.currentVariable] || AIRFLOW_VARIABLES.airQuantity;
  }

  updateViews() {
    this.currentVariable = this.context.get('activeAirflowVariable') || this.params.defaultVariable;
    this.selectedBranchId = this.branchSelectionController?.getState().primaryId || null;
    this.branchComparisonAdapter?.setValueKey(this.getVariableMeta().valueKey);
    this.updateBranchSelectionHighlights();
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
    this.updateBranchSelectionHighlights();
    this.sceneManager.highlightRoadwayEdges?.(this.getSelectedRoadwayEdgeIds());
  }

  renderSelectorPanel() {
    const content = this.selectorPanel?.querySelector('.branch-selector-content');
    if (!content) return;
    const branches = this.inputs.ventilationNetwork.listBranches();
    const orderedIds = branches.map((item) => String(item.id));
    const selection = this.branchSelectionController?.getState() || { ids: [], primaryId: null };
    const selectedIds = new Set(selection.ids);
    const branch = selection.primaryId
      ? this.inputs.ventilationNetwork.getBranch(selection.primaryId)
      : null;
    content.innerHTML = `
      <label class="field-row">Primary branch
        <select class="branch-trend-branch"${this.params.allowBranchSelector ? '' : ' disabled'}>
          ${branches.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} ${item.branchType ? `(${escapeHtml(item.branchType)})` : ''}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Variable
        <select class="branch-trend-variable">
          ${this.params.availableVariables.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(AIRFLOW_VARIABLES[key]?.label || key)}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Window
        <select class="branch-trend-window">
          <option value="all">All</option>
          <option value="recent" disabled>Recent</option>
          <option value="custom" disabled>Custom</option>
        </select>
      </label>
      <div class="comparison-list-summary">
        <span>${selection.ids.length} / ${this.params.maxComparedItems} compared</span>
        <span class="comparison-list-status">${escapeHtml(this.branchComparisonStatus || '')}</span>
      </div>
      <div class="branch-comparison-list" role="listbox" aria-multiselectable="true" aria-label="Ventilation branches">
        ${branches.map((item) => {
          const id = String(item.id);
          const selected = selectedIds.has(id);
          const primary = id === String(selection.primaryId || '');
          return `
            <div class="branch-comparison-row${selected ? ' is-compared' : ''}${primary ? ' is-primary' : ''}"
              data-branch-id="${escapeHtml(id)}" role="option" tabindex="0"
              aria-selected="${selected ? 'true' : 'false'}">
              <input class="branch-comparison-checkbox" type="checkbox" ${selected ? 'checked' : ''} aria-label="Compare ${escapeHtml(id)}" />
              <span class="comparison-series-swatch" style="--series-color:${this.branchSelectionController.colorFor(id)}"></span>
              <span class="branch-comparison-label">
                <strong>${escapeHtml(item.name || item.label || id)}</strong>
                <small>${escapeHtml(item.branchType || 'branch')}</small>
              </span>
              ${primary ? '<span class="comparison-primary-badge">Primary</span>' : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div class="detail-row"><span>Type</span><strong>${escapeHtml(branch?.branchType || '-')}</strong></div>
      <div class="detail-row"><span>From / To</span><strong>${branch ? `${escapeHtml(branch.from)} -> ${escapeHtml(branch.to)}` : '-'}</strong></div>
    `;
    const branchSelect = content.querySelector('.branch-trend-branch');
    const variableSelect = content.querySelector('.branch-trend-variable');
    const windowSelect = content.querySelector('.branch-trend-window');
    if (branchSelect) {
      branchSelect.value = selection.primaryId || branches[0]?.id || '';
      branchSelect.addEventListener('change', () => this.selectBranch(branchSelect.value));
    }
    if (variableSelect) {
      variableSelect.value = this.currentVariable;
      variableSelect.addEventListener('change', () => this.context.set('activeAirflowVariable', variableSelect.value));
    }
    if (windowSelect) windowSelect.value = this.params.timeWindowMode;
    content.querySelectorAll('.branch-comparison-row').forEach((row) => {
      const branchId = row.dataset.branchId;
      row.addEventListener('click', (event) => {
        if (event.target.closest('.branch-comparison-checkbox')) return;
        this.branchComparisonStatus = '';
        this.branchSelectionController.applyPointerSelection(branchId, event, { orderedIds });
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.branchComparisonStatus = '';
        this.branchSelectionController.applyPointerSelection(branchId, event, { orderedIds });
      });
      row.querySelector('.branch-comparison-checkbox')?.addEventListener('change', (event) => {
        this.branchComparisonStatus = '';
        this.branchSelectionController.applyPointerSelection(branchId, event, {
          orderedIds,
          checkbox: true
        });
      });
    });
  }

  updateTrendChart() {
    if (!this.trendChartView) return;
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
    this.trendChartView.setModel({
      title: meta.label + ' Comparison',
      subtitle: series.length === 1 ? series[0].label : series.length + ' branches',
      metricLabel: meta.label,
      unit: meta.unit,
      series,
      currentTime: this.context.get('time'),
      comparisonLayout: this.params.comparisonLayout
    });
    this.trendChartPresentation?.updateFrame();
  }

  updateBranchSelectionHighlights() {
    const selection = this.branchSelectionController?.getState() || { ids: [], primaryId: null };
    const hovered = this.context.get('hoveredSelection');
    const hoveredId = hovered?.type === 'ventilationBranch' ? hovered.id : null;
    this.sceneManager.highlightVentilationBranch(selection.primaryId);
    this.sceneManager.setVentilationBranchSelectionState?.({
      ids: selection.ids,
      primaryId: selection.primaryId,
      hoveredId,
      colors: this.branchSelectionController?.colorsFor(selection.ids) || {}
    });
  }

  setTrendChartPresentation(value) {
    const presentation = String(value || 'docked');
    this.params.chartPresentation = presentation;
    this.nodeModel.params.chartPresentation = presentation;
    const docked = presentation === 'docked';
    const dockId = this.id + ':branch-airflow-trend-chart';
    const sceneId = this.id + ':branch-trend-scene-presentation';
    if (this.contributionRegistry?.get?.(dockId)) {
      this.contributionRegistry.setVisible(dockId, docked);
    }
    if (this.contributionRegistry?.get?.(sceneId)) {
      this.contributionRegistry.setVisible(sceneId, !docked);
    }
    this.trendChartPresentation?.setPresentation(presentation);
    this.trendChartPresentation?.setDockVisible(docked);
    this.trendChartPresentation?.setSceneVisible(!docked);
    this.syncTrendChartPresentationControls();
  }

  syncTrendChartPresentationControls() {
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
    this.trendChartPresentation?.dispose?.();
    this.trendChartPresentation = null;
    this.trendChartView?.dispose?.();
    this.trendChartView = null;
  }

  renderControls(container) {
    this.controlContainer = container;
    container.innerHTML = `
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
    `;
    const variable = container.querySelector('.branch-trend-control-variable');
    const showDirection = container.querySelector('.branch-trend-show-direction');
    const showBoundary = container.querySelector('.branch-trend-show-boundary');
    const showStats = container.querySelector('.branch-trend-show-stats');
    const syncTime = container.querySelector('.branch-trend-sync-time');
    const presentation = container.querySelector('.chart-presentation-select');
    const comparison = container.querySelector('.chart-comparison-layout');
    const worldScale = container.querySelector('.chart-world-scale');
    const worldOcclusion = container.querySelector('.chart-world-occlusion');
    const reorient = container.querySelector('.chart-reorient');
    variable.value = this.currentVariable;
    showDirection.checked = this.params.showDirection;
    showBoundary.checked = this.params.showIntakeReturn;
    showStats.checked = this.params.showStatistics;
    syncTime.checked = this.params.syncWithWorkspaceTime;
    presentation.value = this.params.chartPresentation;
    comparison.value = this.params.comparisonLayout;
    worldScale.value = String(this.params.worldChartScale);
    worldOcclusion.value = this.params.worldChartOcclusion;
    this.syncTrendChartPresentationControls();
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
    presentation.addEventListener('change', () => this.setTrendChartPresentation(presentation.value));
    comparison.addEventListener('change', () => {
      this.params.comparisonLayout = comparison.value;
      this.nodeModel.params.comparisonLayout = comparison.value;
      this.updateTrendChart();
    });
    worldScale.addEventListener('input', () => {
      this.params.worldChartScale = Number(worldScale.value);
      this.nodeModel.params.worldChartScale = this.params.worldChartScale;
      this.trendChartPresentation?.setWorldScale(this.params.worldChartScale);
    });
    worldOcclusion.addEventListener('change', () => {
      this.params.worldChartOcclusion = worldOcclusion.value;
      this.nodeModel.params.worldChartOcclusion = worldOcclusion.value;
      this.trendChartPresentation?.setOcclusion(worldOcclusion.value);
    });
    reorient.addEventListener('click', () => this.trendChartPresentation?.reorientToCamera());
  }

  cleanup() {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.branchSelectionController?.dispose?.();
    this.branchSelectionController = null;
    this.sceneManager.setVentilationBranchSelectionState?.({ ids: [] });
    this.disposeTrendChart();
    this.sceneManager.clearVentilationOverlay?.();
    this.sceneManager.highlightRoadwayEdges?.([]);
  }
}
