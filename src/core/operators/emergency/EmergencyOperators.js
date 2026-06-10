import { createWorkspacePanel } from '../../../ui/RuntimePanels.js';
import {
  installRoadwayHazardViewSelection,
  installRoadwayResponseViewSelection,
  renderRoadwayHazardViewPair
} from '../../../ui/RoadwayHazardViews.js';
import { WaterInrushHydraulic1DSolver, projectRoadwayEdgeRatio } from '../../simulation/WaterInrushHydraulic1DSolver.js';
import { FireSmoke1DSolver } from '../../simulation/FireSmoke1DSolver.js';
import {
  createRoadwayHazardDataset,
  downloadDataset,
  edgeEndpoints,
  edgeLength,
  escapeHtml,
  formatScalar,
  installHazardRoadwayViewHandlers,
  selectedRoadwayEdgeId,
  selectHazardRoadwayEdge,
  updateHazardRoadwayViews
} from '../shared/OperatorRuntimeUtils.js';

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

export const EmergencyOperatorNodeDefinitions = [
  WaterInrushSimulationDefinition,
  FireAndSmokeSimulationDefinition,
  PersonnelEmergencyAnalysisDefinition,
  SafeRouteAnalysisDefinition
];
