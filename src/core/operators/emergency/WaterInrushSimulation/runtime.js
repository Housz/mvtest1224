import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import {
  installRoadwayHazardViewSelection,
  installRoadwayResponseViewSelection,
  renderRoadwayHazardViewPair
} from '../../../../ui/RoadwayHazardViews.js';
import { WaterInrushHydraulic1DSolver, projectRoadwayEdgeRatio } from '../../../simulation/WaterInrushHydraulic1DSolver.js';
import { FireSmoke1DSolver } from '../../../simulation/FireSmoke1DSolver.js';
import {
  edgeEndpoints,
  edgeLength,
  escapeHtml,
  formatScalar,
  installHazardRoadwayViewHandlers,
  selectedRoadwayEdgeId,
  selectHazardRoadwayEdge,
  updateHazardRoadwayViews
} from '../../shared/OperatorRuntimeUtils.js';
import { createRoadwayHazardDataset } from '../../../datasets/RoadwayHazardStateFactory.js';
import { downloadDataset } from '../../../datasets/DatasetExporter.js';

import {
  WaterInrushSimulationInputRequirements,
  FireAndSmokeSimulationInputRequirements,
  SafeRouteAnalysisInputRequirements
} from '../contracts.js';
import { loadRoadwayDataset } from '../../shared/OperatorRuntimeUtils.js';

export class WaterInrushSimulationRuntime {
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
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayVisibleForOwner(this.id, true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.82);
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
      show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
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
        element: panel,
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        onResize: () => {
          if (panel === this.mapPanel || panel === this.topologyPanel) this.updateHazardRoadwayViews();
        },
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
    this.disposers.push(this.sceneManager.registerInteractionHandler('roadway', this.id, (entity) => {
      if (!this.awaitingSourcePick) {
        if (entity.type === 'edge') selectHazardRoadwayEdge(this, entity.edgeId);
        return false;
      }
      if (entity.type !== 'edge') return false;
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
      return true;
    }));
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
    this.publishOutput('hazardState', createRoadwayHazardDataset(rows, {
      generatedBy: 'Water Inrush Simulation',
      scenarioId: this.params.scenarioId,
      source: { edgeId: this.params.sourceEdgeId, nodeId: this.params.sourceNodeId, ratio: this.params.sourceRatio },
      parameters: { ...this.params },
      solver: this.simulationSummary
    }));
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
