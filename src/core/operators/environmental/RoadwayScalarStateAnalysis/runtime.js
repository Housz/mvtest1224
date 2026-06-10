import { SampleSnapshotKernel, HeatmapColorKernel } from '../../OperatorKernels.js';
import { buildHeatmapInput, diffuseNodeValues, resetHeatmapColors } from '../../../algorithms/FieldSolver.js';
import { ChartManager } from '../../../../ui/ChartManager.js';
import { ColorLegend } from '../../../../ui/ColorLegend.js';
import { generateCssGradient, getDefaultStops, setCustomColorMap } from '../../../../utils/colors.js';
import { buildContinuousTimeScale, escapeHtml, formatScalar, formatTime, getSelectionSensorID } from '../../shared/OperatorRuntimeUtils.js';
import { RoadwayScalarStateAnalysisInputRequirements, presetForNode } from './constants.js';

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
