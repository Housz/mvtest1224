import { SampleSnapshotKernel, HeatmapColorKernel } from './OperatorKernels.js';
import { buildHeatmapInput, diffuseNodeValues, resetHeatmapColors } from '../algorithms/FieldSolver.js';
import { RoadwayScalarAnalysisPresets } from '../environmental/EnvironmentalPresets.js';
import { ChartManager } from '../../ui/ChartManager.js';
import { ColorLegend } from '../../ui/ColorLegend.js';
import { generateCssGradient, getDefaultStops, sampleColor, setCustomColorMap } from '../../utils/colors.js';

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
        const a = points[Math.max(0, Math.floor((points.length - 1) / 2))];
        const b = points[Math.min(points.length - 1, Math.floor((points.length - 1) / 2) + 1)];
        this.drawArrow(ctx, a, b, selected ? '#ffffff' : this.branchColor(branch), glyphScale * 0.31);
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
        const flowEnd = layout.positions.get(edge.flowTo);
        const flowNear = curvePoint(a, control, b, edge.flowTo === edge.target ? 0.78 : 0.22);
        drawModelArrow(flowNear, flowEnd, selected ? '#ffffff' : edgeColor);
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
    const size = Math.max(2.5, 3.5 * scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(mid.x + ux * size, mid.y + uy * size);
    ctx.lineTo(mid.x - ux * size * 0.55 - uy * size * 0.55, mid.y - uy * size * 0.55 + ux * size * 0.55);
    ctx.lineTo(mid.x - ux * size * 0.55 + uy * size * 0.55, mid.y - uy * size * 0.55 - ux * size * 0.55);
    ctx.closePath();
    ctx.fill();
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

export const OperatorNodeDefinitions = [
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.temperature),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.CO),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.humidity),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.CH4),
  createRoadwayScalarAnalysisDefinition(RoadwayScalarAnalysisPresets.scalar),
  VentilationNetworkOverviewDefinition,
  AirflowDistributionAnalysisDefinition,
  BranchAirflowTrendInspectionDefinition,
  VentilationAnomalyInspectionDefinition
];
