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
import { VentilationNetworkOverviewRuntime } from '../VentilationNetworkOverview/runtime.js';

export class VentilationAnomalyInspectionRuntime extends VentilationNetworkOverviewRuntime {
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
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.5);
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
      element: this.listPanel,
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
      host: 'timeline',
      element: this.timelinePanel,
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
      id: `${this.id}:anomaly-detail`,
      label: 'Anomaly Detail Panel',
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
    this.disposers.push(this.sceneManager.registerInteractionHandler('ventilation-branch', this.id, (branchId) => {
      this.selectBranch(branchId, { focus: false });
      return true;
    }));
    this.disposers.push(() => {
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
