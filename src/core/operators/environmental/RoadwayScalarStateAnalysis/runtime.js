import { SampleSnapshotKernel, HeatmapColorKernel } from '../../OperatorKernels.js';
import { buildHeatmapInput, diffuseNodeValues, resetHeatmapColors } from '../../../algorithms/FieldSolver.js';
import { TimeSeriesChartView } from '../../../../ui/charts/TimeSeriesChartView.js';
import { ChartPresentationService } from '../../../../ui/charts/ChartPresentationService.js';
import { ColorLegend } from '../../../../ui/ColorLegend.js';
import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import { generateCssGradient, getDefaultStops, setCustomColorMap } from '../../../../utils/colors.js';
import { SelectionSetController, chartPresentationFromParams } from '../../../selection/SelectionSetController.js';
import { buildContinuousTimeScale, escapeHtml, formatScalar, formatTime } from '../../shared/OperatorRuntimeUtils.js';
import { RoadwayScalarStateAnalysisInputRequirements, presetForNode } from './constants.js';
import { SensorComparisonAdapter } from './comparisonAdapter.js';
import { loadRoadwayDataset } from '../../shared/OperatorRuntimeUtils.js';

export class RoadwayScalarStateAnalysisRuntime {
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
      chartPresentation: chartPresentationFromParams(nodeModel.params),
      comparisonLayout: nodeModel.params?.comparisonLayout || 'auto',
      selectionMode: nodeModel.params?.selectionMode || 'multiple',
      maxComparedItems: Math.max(1, Number(nodeModel.params?.maxComparedItems) || 8),
      chartAnchor: nodeModel.params?.chartAnchor || 'primary-selection',
      worldChartScale: Number(nodeModel.params?.worldChartScale ?? 1),
      worldChartOcclusion: nodeModel.params?.worldChartOcclusion || 'depth-aware',
      warningThreshold:
        nodeModel.params?.warningThreshold != null ? Number(nodeModel.params.warningThreshold) : this.preset.warningThreshold
    };
    this.nodeModel.params = {
      ...(nodeModel.params || {}),
      chartPresentation: this.params.chartPresentation,
      comparisonLayout: this.params.comparisonLayout,
      selectionMode: this.params.selectionMode,
      maxComparedItems: this.params.maxComparedItems,
      chartAnchor: this.params.chartAnchor,
      worldChartScale: this.params.worldChartScale,
      worldChartOcclusion: this.params.worldChartOcclusion
    };
    this.disposers = [];
    this.chartView = null;
    this.chartPresentation = null;
    this.selectionController = null;
    this.comparisonAdapter = null;
    this.chartPanel = null;
    this.chartContainer = null;
    this.sensorListPanel = null;
    this.sensorListDisposers = [];
    this.sensorFilter = '';
    this.sensorSnapshot = new Map();
    this.sensorListStatus = '';
    this.controlPanel = null;
    this.controlContainer = null;
    this.legend = null;
    this.initialized = false;
    this.inputRequirements = RoadwayScalarStateAnalysisInputRequirements;
    this.controlDisposers = [];
    this.performancePhases = [];
  }

  recordPerformancePhase(name, startedAt) {
    this.performancePhases.push({ name, startedAt, durationMs: performance.now() - startedAt });
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.performancePhases = [];
    let phaseStartedAt = performance.now();
    this.validateSemanticInputs();

    this.sampleSnapshot = new SampleSnapshotKernel(this.inputs.sensorReadings);
    this.heatmap = new HeatmapColorKernel(sceneManager);
    this.heatmap.setRange(this.params.minValue, this.params.maxValue);
    this.heatmap.setMap(this.params.colormap);
    setCustomColorMap(this.params.colormap, getDefaultStops(this.params.colormap));

    this.selectionController = new SelectionSetController({
      context,
      type: 'sensor',
      selectionType: 'sensor',
      primaryContextKey: 'selectedSensor',
      maxItems: this.params.maxComparedItems,
      source: this.id + ':sensor-selection',
      onLimit: ({ limit }) => {
        this.sensorListStatus = 'Compare up to ' + limit + ' sensors.';
        this.renderSensorList();
      }
    });
    this.comparisonAdapter = new SensorComparisonAdapter({
      sensorRegistry: this.inputs.sensorRegistry,
      sensorReadings: this.inputs.sensorReadings,
      sceneManager
    });
    this.recordPerformancePhase('state-and-selection', phaseStartedAt);
    phaseStartedAt = performance.now();
    this.createChartPanel();
    this.createSensorListPanel();
    this.controlPanel?.remove?.();
    this.controlPanel = createWorkspacePanel(
      `${this.metric.legendLabel} Controls`,
      'roadway-scalar-controls'
    );
    this.renderControls(this.controlPanel);
    this.recordPerformancePhase('panels', phaseStartedAt);
    phaseStartedAt = performance.now();
    this.registerVisualContributions();
    this.recordPerformancePhase('contributions', phaseStartedAt);
    phaseStartedAt = performance.now();
    await this.initializeScene();
    this.recordPerformancePhase('scene', phaseStartedAt);
    phaseStartedAt = performance.now();
    this.installContextHandlers();
    this.ensureInitialContext();
    this.updateFromTime();
    this.updateFromSelection(true);
    this.recordPerformancePhase('initial-update', phaseStartedAt);

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

  createChartPanel() {
    this.chartPresentation?.dispose?.();
    this.chartView?.dispose?.();
    this.chartPanel?.remove?.();
    this.chartPanel = createWorkspacePanel('Sensor Trend Chart', 'sensor-trend-workspace-panel');
    this.chartSlot = document.createElement('div');
    this.chartSlot.className = 'chart-presentation-dock-host';
    this.chartContainer = document.createElement('div');
    this.chartContainer.className = 'chart-panel sensor-trend-chart-host';
    this.chartSlot.appendChild(this.chartContainer);
    this.chartPanel.appendChild(this.chartSlot);
    this.chartView = new TimeSeriesChartView(this.chartContainer);
    this.chartView.setCallbacks({
      onTimeChange: (time) => {
        const range = this.inputs.sensorReadings.getTimeRange();
        const scale = buildContinuousTimeScale(range.times);
        const nextTime = Math.max(scale.min, Math.min(scale.max, Number(time)));
        this.context.set('time', Number.isFinite(nextTime) ? nextTime : scale.min);
      },
      onPrimaryChange: (sensorID) => this.selectionController?.setPrimary(sensorID),
      onHoverChange: (sensorID) => this.selectionController?.setHovered(sensorID)
    });
    this.chartPresentation = new ChartPresentationService({
      id: this.id + ':sensor-chart',
      sceneManager: this.sceneManager,
      chartView: this.chartView,
      chartElement: this.chartContainer,
      dockHost: this.chartSlot,
      anchorProvider: () => {
        const primaryId = this.selectionController?.getState().primaryId;
        return primaryId ? this.comparisonAdapter?.getWorldAnchor(primaryId) : null;
      },
      avoidAnchorProvider: () => (
        [...this.sceneManager.sensors.values()]
      ),
      onRequestDocked: () => this.setChartPresentation('docked'),
      worldScale: this.params.worldChartScale,
      occlusion: this.params.worldChartOcclusion
    });
    this.chartPresentation.setPresentation(this.params.chartPresentation, { notify: false });
  }

  createSensorListPanel() {
    this.sensorListDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sensorListPanel?.remove?.();
    this.sensorListPanel = createWorkspacePanel(
      'Sensor List',
      'sensor-list-panel',
      `
        <div class="sensor-list-layout">
          <div class="sensor-list-tools">
            <input class="sensor-list-search" type="search" placeholder="Filter sensors..." aria-label="Filter sensors" />
            <span class="sensor-list-count" aria-live="polite"></span>
          </div>
          <div class="sensor-list-status" aria-live="polite"></div>
          <div class="sensor-list-items" role="listbox" aria-multiselectable="true" aria-label="Sensors"></div>
        </div>
      `
    );
    const search = this.sensorListPanel.querySelector('.sensor-list-search');
    search.value = this.sensorFilter;
    const handleSearchInput = () => {
      this.sensorFilter = search.value;
      this.renderSensorList();
    };
    const handleListClick = (event) => {
      const target = event.target.closest('[data-sensor-id]');
      const sensorID = target?.dataset?.sensorId;
      if (!sensorID) return;
      if (event.target.closest('.sensor-list-locate')) {
        this.selectionController.setPrimary(sensorID);
        this.sceneManager.focusOnSensor(sensorID);
        return;
      }
      if (event.target.closest('.sensor-list-compare')) return;
      if (event.target.closest('.sensor-list-select')) {
        this.sensorListStatus = '';
        this.applySensorSelection(sensorID, event, {
          orderedIds: this.getVisibleSensors().map((sensor) => String(sensor.sensorID))
        });
      }
    };
    const handleListChange = (event) => {
      const checkbox = event.target.closest('.sensor-list-compare');
      const sensorID = checkbox?.closest('[data-sensor-id]')?.dataset?.sensorId;
      if (!sensorID) return;
      this.sensorListStatus = '';
      this.applySensorSelection(sensorID, event, {
        checkbox: true,
        orderedIds: this.getVisibleSensors().map((sensor) => String(sensor.sensorID))
      });
    };
    search.addEventListener('input', handleSearchInput);
    this.sensorListPanel.addEventListener('click', handleListClick);
    this.sensorListPanel.addEventListener('change', handleListChange);
    this.sensorListDisposers.push(
      () => search.removeEventListener('input', handleSearchInput),
      () => this.sensorListPanel?.removeEventListener('click', handleListClick),
      () => this.sensorListPanel?.removeEventListener('change', handleListChange)
    );
    this.renderSensorList();
  }

  applySensorSelection(sensorID, event = {}, options = {}) {
    const accepted = this.params.selectionMode === 'single'
      ? this.selectionController.replace(sensorID)
      : this.selectionController.applyPointerSelection(sensorID, event, options);
    if (accepted) this.revealChartForSelection();
    return accepted;
  }

  revealChartForSelection() {
    if (!this.selectionController?.getState().primaryId) return;
    this.chartPresentation?.updateFrame();
    if (this.params.chartPresentation === 'docked') {
      this.chartPresentation?.setDockVisible(true);
      this.contributionRegistry?.requestActivate?.(this.id + ':sensor-trend-chart');
      return;
    }
    this.chartPresentation?.setSceneVisible(true);
  }

  getVisibleSensors() {
    const sensors = this.inputs.sensorRegistry?.listSensors?.() || [];
    const query = this.sensorFilter.trim().toLowerCase();
    if (!query) return sensors;
    return sensors.filter((sensor) => (
      [sensor.sensorID, sensor.name, sensor.label, sensor.type, sensor.edgeId, sensor.nodeId]
        .filter((value) => value != null)
        .some((value) => String(value).toLowerCase().includes(query))
    ));
  }

  renderSensorList(snapshot = this.sensorSnapshot) {
    if (!this.sensorListPanel) return;
    const items = this.sensorListPanel.querySelector('.sensor-list-items');
    const count = this.sensorListPanel.querySelector('.sensor-list-count');
    const status = this.sensorListPanel.querySelector('.sensor-list-status');
    if (!items || !count || !status) return;
    const sensors = this.inputs.sensorRegistry?.listSensors?.() || [];
    const visible = this.getVisibleSensors();
    const selection = this.selectionController?.getState() || { ids: [], primaryId: null };
    const selectedIds = new Set(selection.ids);
    status.textContent = this.sensorListStatus;
    count.textContent = `${visible.length} / ${sensors.length} | ${selection.ids.length}/${this.params.maxComparedItems} compared`;
    items.innerHTML = visible.length
      ? visible.map((sensor) => {
          const id = String(sensor.sensorID);
          const name = sensor.name || sensor.label || id;
          const location = sensor.edgeId
            ? `Edge ${sensor.edgeId}`
            : sensor.nodeId
              ? `Node ${sensor.nodeId}`
              : 'Spatial sensor';
          const meta = [sensor.type, location].filter(Boolean).join(' | ');
          const value = snapshot?.get?.(id);
          const hasValue = Number.isFinite(Number(value));
          const valueText = hasValue
            ? `${formatScalar(Number(value), 2)}${this.metric.unit ? ` ${this.metric.unit}` : ''}`
            : 'No sample';
          const warning = hasValue && Number.isFinite(this.params.warningThreshold)
            && Number(value) >= this.params.warningThreshold;
          const compared = selectedIds.has(id);
          const primary = String(selection.primaryId || '') === id;
          const seriesColor = this.selectionController?.colorFor(id) || '#38bdf8';
          return `
            <div class="sensor-list-item${compared ? ' compared' : ''}${primary ? ' selected primary' : ''}${warning ? ' warning' : ''}" data-sensor-id="${escapeHtml(id)}" aria-selected="${compared}">
              <label class="sensor-list-compare-wrap" title="Include ${escapeHtml(name)} in comparison">
                <input class="sensor-list-compare" type="checkbox" ${compared ? 'checked' : ''} aria-label="Compare ${escapeHtml(name)}" />
              </label>
              <button class="sensor-list-select" type="button" aria-pressed="${primary}" title="Select ${escapeHtml(name)}; use Ctrl or Command to compare">
                <span class="sensor-list-marker" style="--series-color:${seriesColor}" aria-hidden="true"></span>
                <span class="sensor-list-copy">
                  <strong>${escapeHtml(name)}</strong>
                  <small>${escapeHtml(meta)}</small>
                  ${primary ? '<span class="sensor-list-primary-badge">Primary</span>' : ''}
                </span>
                <span class="sensor-list-value">${escapeHtml(valueText)}</span>
              </button>
              <button class="sensor-list-locate" type="button" title="Locate ${escapeHtml(name)} in 3D" aria-label="Locate ${escapeHtml(name)} in 3D">Locate</button>
            </div>
          `;
        }).join('')
      : '<div class="empty-state">No sensors match the current filter.</div>';
  }

  registerVisualContributions() {
    const registerAll = () => {
      this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      visible: true,
      opacity: 1,
      keepWithPinnedOwner: true,
      show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
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
        this.sceneManager.setRoadwayFieldLayerVisible?.(this.id, true);
        if (this.initialized) this.updateFromTime();
      },
      hide: () => {
        this.sceneManager.setRoadwayFieldLayerVisible?.(this.id, false);
      },
      setOpacity: (value) => this.sceneManager.setRoadwayFieldLayerOpacity?.(this.id, value),
      focus: () => this.sceneManager.focusOnRoadway(),
      cleanup: () => {
        this.sceneManager.setRoadwayFieldLayerVisible?.(this.id, false);
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
      show: () => this.sceneManager.setSensorsVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setSensorsVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setSensorOpacityForOwner(this.id, value),
      cleanup: () => this.sceneManager.setSensorsVisibleForOwner(this.id, false)
    });

    this.contributionRegistry.register({
      id: `${this.id}:sensor-list`,
      label: 'Sensor List',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'panel',
      contributionKind: 'panel',
      semanticRole: 'detail',
      host: 'right-panel',
      element: this.sensorListPanel,
      visible: true,
      opacity: 1,
      layout: {
        preferredRegion: 'right',
        preferredSize: { width: 300, height: 300 },
        content: { profile: 'table', padding: 'compact', overflow: 'hidden' }
      },
      show: () => this.renderSensorList(),
      hide: () => {},
      cleanup: () => {
        this.sensorListDisposers.splice(0).forEach((dispose) => dispose?.());
        this.sensorListPanel?.remove?.();
      }
    });

    this.contributionRegistry.register({
      id: `${this.id}:sensor-trend-chart`,
      label: 'Sensor Trend Chart',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'chart',
      contributionKind: 'chart',
      semanticRole: 'detail',
      objectSystem: 'sensorReadings',
      element: this.chartPanel,
      visible: this.params.chartPresentation === 'docked',
      opacity: 1,
      layout: {
        preferredRegion: 'bottom',
        preferredSize: { width: 620, height: 270 },
        content: { profile: 'chart', padding: 'none', overflow: 'hidden' }
      },
      show: () => this.chartPresentation?.setDockVisible(true),
      hide: () => this.chartPresentation?.setDockVisible(false),
      cleanup: () => {
        this.chartPresentation?.dispose?.();
        this.chartPresentation = null;
        this.chartView?.dispose?.();
        this.chartView = null;
        this.chartPanel?.remove?.();
      }
    });

    this.contributionRegistry.register({
      id: `${this.id}:sensor-trend-scene-presentation`,
      label: 'Sensor Trend Scene Presentation',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      contributionKind: 'layer',
      semanticRole: 'detail',
      objectSystem: 'sensorReadings',
      host: 'main-3d-scene',
      visible: this.params.chartPresentation !== 'docked',
      opacity: 1,
      show: () => this.chartPresentation?.setSceneVisible(true),
      hide: () => this.chartPresentation?.setSceneVisible(false),
      cleanup: () => this.chartPresentation?.setSceneVisible(false)
    });

    this.contributionRegistry.register({
      id: `${this.id}:scalar-controls`,
      label: `${this.metric.legendLabel} Legend / Controls`,
      ownerId: this.id,
      functionId: this.functionId,
      type: 'control',
      contributionKind: 'control',
      semanticRole: 'control',
      host: 'right-panel',
      element: this.controlPanel,
      visible: true,
      opacity: 1,
      layout: {
        preferredRegion: 'right',
        preferredSize: { width: 300, height: 360 },
        content: { profile: 'form', padding: 'compact', overflow: 'auto' }
      },
      show: () => this.syncChartPresentationControls(),
      hide: () => {},
      cleanup: () => {
        this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
        this.controlPanel?.remove?.();
      }
    });
    };
    if (typeof this.contributionRegistry.transaction === 'function') {
      this.contributionRegistry.transaction(registerAll);
    } else {
      registerAll();
    }
  }

  async initializeScene() {
    if (this.initialized) return;
    const roadway = this.inputs.roadway;
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.32);
    this.fieldLayer = this.sceneManager.ensureRoadwayFieldLayer?.(this.id, roadway, { radius: 2.15 });
    this.heatmap.setTarget(this.fieldLayer);
    const overlay = this.contributionRegistry?.get?.(`${this.id}:roadway-scalar-overlay`);
    this.sceneManager.setRoadwayFieldLayerVisible?.(this.id, overlay?.effectiveVisible !== false);
    this.sceneManager.addSensors(this.inputs.sensorRegistry.listSensors());
    this.sceneManager.setSensorsVisibleForOwner(this.id, this.params.showSensors);
    this.disposers.push(this.sceneManager.registerInteractionHandler('sensor', this.id, (sensorID, event) => {
      this.applySensorSelection(sensorID, event || {});
      return true;
    }));
    this.initialized = true;
  }

  installContextHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.updateFromTime()));
    this.disposers.push(this.selectionController.subscribe(() => this.updateFromSelection()));
    this.disposers.push(
      this.context.subscribe('hoveredSelection', () => this.updateSelectionHighlights())
    );
  }

  ensureInitialContext() {
    const timeRange = this.inputs.sensorReadings.getTimeRange();
    if (this.context.get('time') == null) {
      this.context.set('time', timeRange.min);
    }
    if (!this.selectionController.getState().ids.length) {
      const firstSensor = this.inputs.sensorRegistry.listSensors()[0];
      if (firstSensor) this.selectionController.replace(firstSensor.sensorID);
    }
  }

  updateFromTime() {
    if (!this.sceneManager || !this.inputs?.sensorReadings) return;
    this.heatmap.setRange(this.params.minValue, this.params.maxValue);
    this.heatmap.setMap(this.params.colormap);
    const time = this.context.get('time');
    const toleranceMs = this.params.toleranceMinutes * 60 * 1000;
    const snapshot = this.sampleSnapshot.run(time, toleranceMs);
    this.sensorSnapshot = snapshot;
    const overlay = this.contributionRegistry?.get(`${this.id}:roadway-scalar-overlay`);
    if (overlay?.visible !== false) {
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
      resetHeatmapColors(this.fieldLayer);
    }
    this.legend?.update(this.params.colormap, this.params.minValue, this.params.maxValue, this.metric.unit);
    this.chartView?.setTimeCursor(time);
    this.renderSensorList(snapshot);
  }

  updateFromSelection(focus = false) {
    const selection = this.selectionController?.getState() || { ids: [], primaryId: null };
    const primaryId = selection.primaryId;
    this.sceneManager.setPrimarySensorSelection?.(primaryId);
    if (focus && primaryId) this.sceneManager.focusOnSensor(primaryId);
    this.updateSelectionHighlights();
    const entities = new Map(
      this.comparisonAdapter.listComparableEntities().map((entity) => [String(entity.id), entity])
    );
    const series = selection.ids.map((id) => {
      const entity = entities.get(String(id));
      return {
        id: String(id),
        label: entity?.label || String(id),
        unit: this.metric.unit,
        data: this.comparisonAdapter.getTimeSeries(id),
        color: this.selectionController.colorFor(id),
        primary: String(id) === String(primaryId || '')
      };
    });
    this.chartView?.setModel({
      title: this.metric.legendLabel + ' Comparison',
      subtitle: series.length === 1 ? series[0].label : series.length + ' sensors',
      metricLabel: this.metric.legendLabel,
      unit: this.metric.unit,
      series,
      currentTime: this.context.get('time'),
      comparisonLayout: this.params.comparisonLayout
    });
    this.chartPresentation?.updateFrame();
    this.renderSensorList();
  }

  updateSelectionHighlights() {
    const selection = this.selectionController?.getState() || { ids: [], primaryId: null };
    const hovered = this.context.get('hoveredSelection');
    const hoveredId = hovered?.type === 'sensor' ? hovered.id : null;
    this.sceneManager.setSensorSelectionState?.({
      ids: selection.ids,
      primaryId: selection.primaryId,
      hoveredId,
      colors: this.selectionController?.colorsFor(selection.ids) || {}
    });
  }

  setChartPresentation(value) {
    const presentation = String(value || 'docked');
    this.params.chartPresentation = presentation;
    this.nodeModel.params.chartPresentation = presentation;
    const docked = presentation === 'docked';
    const dockId = this.id + ':sensor-trend-chart';
    const sceneId = this.id + ':sensor-trend-scene-presentation';
    if (this.contributionRegistry?.get?.(dockId)) {
      this.contributionRegistry.setVisible(dockId, docked);
    }
    if (this.contributionRegistry?.get?.(sceneId)) {
      this.contributionRegistry.setVisible(sceneId, !docked);
    }
    this.chartPresentation?.setPresentation(presentation);
    this.chartPresentation?.setDockVisible(docked);
    this.chartPresentation?.setSceneVisible(!docked);
    this.syncChartPresentationControls();
  }

  syncChartPresentationControls() {
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
            <select class="chart-world-occlusion"><option value="depth-aware">Depth-aware</option><option value="always-visible">Always visible</option></select>
          </label>
          <button class="chart-reorient" type="button">Reorient to camera</button>
        </div>
      </div>
      <div class="legend-block">
        <div class="bar"></div>
        <div class="legend-labels"><span class="min"></span><span class="max"></span></div>
      </div>
    `;

    const timeRange = this.inputs.sensorReadings.getTimeRange();
    const timeScale = buildContinuousTimeScale(timeRange.times);
    const timeInput = container.querySelector('.operator-time');
    const timeLabel = container.querySelector('.time-label');
    const minInput = container.querySelector('.operator-min');
    const maxInput = container.querySelector('.operator-max');
    const mapSelect = container.querySelector('.operator-colormap');
    const sensorToggle = container.querySelector('.operator-show-sensors');
    const presentationSelect = container.querySelector('.chart-presentation-select');
    const comparisonSelect = container.querySelector('.chart-comparison-layout');
    const worldScale = container.querySelector('.chart-world-scale');
    const worldOcclusion = container.querySelector('.chart-world-occlusion');
    const reorient = container.querySelector('.chart-reorient');
    this.legend = new ColorLegend(container.querySelector('.legend-block'));

    minInput.value = this.params.minValue;
    maxInput.value = this.params.maxValue;
    mapSelect.value = this.params.colormap;
    sensorToggle.checked = this.params.showSensors;
    presentationSelect.value = this.params.chartPresentation;
    comparisonSelect.value = this.params.comparisonLayout;
    worldScale.value = String(this.params.worldChartScale);
    worldOcclusion.value = this.params.worldChartOcclusion;
    this.syncChartPresentationControls();
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
      this.sceneManager.setSensorsVisibleForOwner(this.id, this.params.showSensors);
    });
    presentationSelect.addEventListener('change', () => {
      this.setChartPresentation(presentationSelect.value);
    });
    comparisonSelect.addEventListener('change', () => {
      this.params.comparisonLayout = comparisonSelect.value;
      this.nodeModel.params.comparisonLayout = comparisonSelect.value;
      this.updateFromSelection();
    });
    worldScale.addEventListener('input', () => {
      this.params.worldChartScale = Number(worldScale.value);
      this.nodeModel.params.worldChartScale = this.params.worldChartScale;
      this.chartPresentation?.setWorldScale(this.params.worldChartScale);
    });
    worldOcclusion.addEventListener('change', () => {
      this.params.worldChartOcclusion = worldOcclusion.value;
      this.nodeModel.params.worldChartOcclusion = worldOcclusion.value;
      this.chartPresentation?.setOcclusion(worldOcclusion.value);
    });
    reorient.addEventListener('click', () => this.chartPresentation?.reorientToCamera());

    this.legend.update(this.params.colormap, this.params.minValue, this.params.maxValue, this.metric.unit);
    this.updateFromSelection();
  }

  cleanup() {
    this.sensorListDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.selectionController?.dispose?.();
    this.selectionController = null;
    this.sceneManager?.setSensorSelectionState?.({ ids: [] });
    this.sceneManager?.setPrimarySensorSelection?.(null);
    this.chartPresentation?.dispose?.();
    this.chartPresentation = null;
    this.chartView?.dispose?.();
    this.chartView = null;
    this.sceneManager?.setRoadwayFieldLayerVisible?.(this.id, false);
    this.sceneManager?.clearSensorOwnerState?.(this.id);
    this.fieldLayer = null;
    this.controlPanel = null;
    this.controlContainer = null;
    this.initialized = false;
  }
}
