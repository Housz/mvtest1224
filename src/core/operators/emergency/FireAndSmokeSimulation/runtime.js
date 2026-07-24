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

export class FireAndSmokeSimulationRuntime {
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
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayVisibleForOwner(this.id, true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.82);
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
      show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
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
      this.params.sourceRatio = projectRoadwayEdgeRatio(this.inputs.roadway, entity.edgeId, entity.point);
      this.awaitingSourcePick = false;
      selectHazardRoadwayEdge(this, entity.edgeId);
      this.syncControlValues?.();
      this.syncSourcePickState?.();
      if (this.params.autoRun) this.generateHazardState();
      return true;
    }));
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
    this.publishOutput('hazardState', createRoadwayHazardDataset(result.rows || [], {
      generatedBy: 'Fire and Smoke Simulation',
      scenarioId: this.params.scenarioId,
      source: { edgeId: this.params.sourceEdgeId, ratio: this.params.sourceRatio },
      parameters: { ...this.params },
      solver: this.simulationSummary
    }));
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
