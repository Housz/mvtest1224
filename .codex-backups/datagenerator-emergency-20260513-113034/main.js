import { State } from './state.js';
import { DataConfig } from './config.js';
import { parseNETFile } from './parsers/netParser.js';
import { init2D, autoZoom2D, draw2D } from './renderers/renderer2d.js';
import { init3D, loadOBJ, renderHeatmap, renderVectorField, clearHeatmap, highlight, updateSensors, updateNetLines, toggleAxes, toggleNetLines, toggleWireframe, renderVentilationPreview } from './renderers/renderer3d.js';
import { applyCoordinateTransform } from './algorithms.js';
import { generateRandomData, exportCurrentData, exportSensorCSV, exportTimeSeriesCSV, importData, exportGraphJson, exportOBJ } from './managers/dataManager.js';
import {
    AirflowVariables,
    BranchTypes,
    FacilityTypes,
    ScenarioPresets,
    addFacilityToSelected,
    branchInfo,
    clearVentilationBoundary,
    deleteSelectedFacility,
    drawBranchTrend,
    exportAirflowState,
    exportVentilationNetwork,
    facilityInfo,
    generateAirflowState,
    generateVentilationNetwork,
    getVentilationBoundary,
    importVentilationNetwork,
    mergeSelectedBranchWithConnected,
    selectedBranch,
    setVentilationBoundary,
    splitSelectedBranch,
    updateSelectedBranch
} from './ventilation.js';

// DOM
const fileLoaderNet = document.getElementById('file-loader-net');
const fileLoaderObj = document.getElementById('file-loader-obj');
const fileLoaderJson = document.getElementById('file-loader-json');
const fileLoaderVentNetwork = document.getElementById('file-loader-vent-network');
const dataTypeSelect = document.getElementById('data-type-select');
const generationModeSelect = document.getElementById('generation-mode-select');
const modeHelp = document.getElementById('mode-help');
const hmMin = document.getElementById('hm-min');
const hmMax = document.getElementById('hm-max');
const propsPanel = document.getElementById('properties-content');
const sensorEditor = document.getElementById('sensor-editor');
const inputSensorVal = document.getElementById('input-sensor-val');
const btnSetVal = document.getElementById('btn-set-val');
const btnDelSensor = document.getElementById('btn-del-sensor');
const btnToggleDir = document.getElementById('btn-toggle-dir');
const btnSetInlet = document.getElementById('btn-set-inlet');
const btnSetOutlet = document.getElementById('btn-set-outlet');
const btnClearBoundary = document.getElementById('btn-clear-boundary');
const ventControls = document.getElementById('vent-controls');
const boundaryLabel = document.getElementById('boundary-label');
const boundaryPressure = document.getElementById('boundary-pressure');
const boundaryCapacity = document.getElementById('boundary-capacity');
const lblValUnit = document.getElementById('lbl-val-unit');
const layerPanel = document.getElementById('layer-panel');
const resetViewBtn = document.getElementById('reset-view-btn');
const ventStrategy = document.getElementById('vent-strategy');
const ventBranchType = document.getElementById('vent-branch-type');
const ventDirection = document.getElementById('vent-direction');
const ventArea = document.getElementById('vent-area');
const ventResistance = document.getElementById('vent-resistance');
const ventDesignQ = document.getElementById('vent-design-q');
const ventFacilityType = document.getElementById('vent-facility-type');
const ventScenario = document.getElementById('vent-scenario');
const ventVariable = document.getElementById('vent-variable');
const ventSteps = document.getElementById('vent-steps');
const ventEventStart = document.getElementById('vent-event-start');
const ventEventEnd = document.getElementById('vent-event-end');
const ventIntensity = document.getElementById('vent-intensity');
const ventTime = document.getElementById('vent-time');
const ventTrendCanvas = document.getElementById('vent-trend-canvas');

// Modal Elements
const tsModal = document.getElementById('timeseries-modal');
const btnOpenTsModal = document.getElementById('btn-open-timeseries-modal');
const btnCancelTs = document.getElementById('btn-cancel-ts');
const btnConfirmTs = document.getElementById('btn-confirm-ts');
const inpTsStart = document.getElementById('ts-start-time');
const inpTsInterval = document.getElementById('ts-interval');
const inpTsCount = document.getElementById('ts-count');

window.updateUICallback = updateUI;

function fillSelect(select, values) {
    if (!select) return;
    select.innerHTML = '';
    values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });
}

fillSelect(ventBranchType, BranchTypes);
fillSelect(ventFacilityType, FacilityTypes);
fillSelect(ventScenario, ScenarioPresets);
fillSelect(ventVariable, AirflowVariables);

function ensureVentilationDataReady() {
    if (!State.connections.length) return;
    if (!State.ventilationNetwork.branches.length) generateVentilationNetwork(ventStrategy?.value || 'edge-based');
    if (State.ventilationNetwork.branches.length && !State.airflowState.length) generateAirflowState(currentAirflowOptions());
    syncVentilationForm();
}

function applyGenerationMode(mode = State.generationMode) {
    State.switchGenerationMode(mode);
    if (generationModeSelect) generationModeSelect.value = mode;

    document.querySelectorAll('[data-mode-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.modePanel !== mode;
    });

    if (modeHelp) {
        modeHelp.textContent = mode === 'ventilation'
            ? '在 roadway 上生成通风业务网络，编辑 branch / facility，并导出 ventilation_network.json 与 airflow_state.csv。'
            : '在巷道 edge 上标注传感器位置，并生成 Temperature / CO / Humidity / CH4 等时序读数。';
    }

    sensorEditor.style.display = 'none';
    ventControls.style.display = 'none';

    if (State.isVentilationMode()) {
        ensureVentilationDataReady();
        renderVentilationPreview();
        drawBranchTrend(ventTrendCanvas);
    } else {
        renderVentilationPreview();
        const cfg = DataConfig[State.activeDataType];
        updateSensors(cfg.defaultMin, cfg.defaultMax);
    }

    draw2D();
    updateUI();
}

function updateUI() {
    if (!State.selectedEntity) {
        propsPanel.textContent = State.isVentilationMode() ? "未选择通风支路或节点" : "(未选择图元)";
        sensorEditor.style.display = "none";
        ventControls.style.display = "none";
        highlight(null, -1);
        return;
    }

    const { type, index, data } = State.selectedEntity;
    const currentConfig = DataConfig[State.activeDataType];
    const unit = currentConfig ? currentConfig.unit : '';
    const isWind = State.isEnvironmentalMode() && State.activeDataType === 'WindSpeed';

    if (State.isVentilationMode() && type === 'VentilationBranch') {
        propsPanel.textContent = branchInfo(data);
        sensorEditor.style.display = "none";
        ventControls.style.display = "none";
        syncVentilationForm();
        renderVentilationPreview();
        drawBranchTrend(ventTrendCanvas);
        return;
    }

    if (State.isVentilationMode() && type === 'VentilationFacility') {
        propsPanel.textContent = facilityInfo(data);
        sensorEditor.style.display = "none";
        ventControls.style.display = "none";
        syncVentilationForm();
        renderVentilationPreview();
        drawBranchTrend(ventTrendCanvas);
        return;
    }

    let info = `TYPE: ${type}\n`;
    
    if (State.isEnvironmentalMode() && type === 'Sensor') {
        info += `ID: ${data.id}\nRatio: ${data.ratio?.toFixed(4)}\nBind: ${data.parentId}`;
        btnDelSensor.style.display = 'inline-block';
        if (isWind) {
            btnToggleDir.style.display = 'inline-block';
            info += `\nDir: ${data.direction === -1 ? '反向' : '正向'}`;
        } else {
            btnToggleDir.style.display = 'none';
        }
        highlight('Sensor', data.id);
        ventControls.style.display = "none";
    } else {
        info += `Idx: ${index}\nLyr: ${data.layer}\n`;
        if (type === 'Node') {
            info += `BH: ${data.id}\nPos: (${data.x.toFixed(1)}, ${data.y.toFixed(1)})`;
            if (State.isVentilationMode()) {
                const vent = State.ventilationNodes.get(data.id);
                if(vent) info += `\n[通风节点]: ${vent}`;
                syncBoundaryForm(data.id);
                ventControls.style.display = "block";
            } else {
                ventControls.style.display = "none";
            }
        }
        if (type === 'Connection') {
            info += `Conn: ${data.j1} -> ${data.j2}`;
            ventControls.style.display = "none";
        }
        btnDelSensor.style.display = 'none';
        highlight(type, index);
    }

    let v = '-';
    if (type === 'Sensor') v = data.value;
    else if (data.sensorVal !== null && data.sensorVal !== undefined) v = data.sensorVal;

    if (State.isEnvironmentalMode()) info += `\n\n[${State.activeDataType}]: ${v} ${unit}`;
    propsPanel.textContent = info;
    
    sensorEditor.style.display = State.isEnvironmentalMode() ? "flex" : "none";
    if (lblValUnit) lblValUnit.textContent = `${State.activeDataType}:`;
    inputSensorVal.value = (typeof v === 'number') ? v : "";
    syncVentilationForm();
    drawBranchTrend(ventTrendCanvas);
}

function populateLayers() {
    layerPanel.innerHTML = '';
    State.layers.forEach(l => {
        const row = document.createElement('div');
        row.style.marginBottom = '4px'; row.style.display = 'flex'; row.style.alignItems = 'center';
        const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !l.hidden; chk.style.marginRight = '6px';
        chk.onchange = (e) => { State.layerVisibility.set(l.name, e.target.checked); draw2D(); };
        const span = document.createElement('span'); span.textContent = l.name; span.style.fontSize = '12px';
        row.append(chk, span); layerPanel.appendChild(row);
    });
}

function syncVentilationForm() {
    const branch = selectedBranch();
    if (!branch) return;
    if (ventBranchType) ventBranchType.value = branch.branchType || BranchTypes[0];
    if (ventDirection) ventDirection.value = branch.manualDirection ? (branch.nominalDirection || 'from_to') : 'auto';
    if (ventArea) ventArea.value = branch.area ?? 12;
    if (ventResistance) ventResistance.value = branch.resistance ?? 0.013;
    if (ventDesignQ) ventDesignQ.value = branch.designAirQuantity ?? 18;
    if (ventStrategy) ventStrategy.value = State.airflowSettings.strategy || 'edge-based';
    if (ventScenario) ventScenario.value = State.airflowSettings.scenario || 'normal';
    if (ventVariable) ventVariable.value = State.airflowSettings.variable || 'air_quantity_m3s';
    if (ventSteps) ventSteps.value = State.airflowSettings.timeSteps || 60;
    if (ventEventStart) ventEventStart.value = State.airflowSettings.eventStart || 20;
    if (ventEventEnd) ventEventEnd.value = State.airflowSettings.eventEnd || 40;
    if (ventIntensity) ventIntensity.value = State.airflowSettings.intensity ?? 0.8;
    if (ventTime) {
        ventTime.max = Math.max(0, (State.airflowSettings.timeSteps || 1) - 1);
        ventTime.value = State.airflowSettings.timeIndex || 0;
    }
}

function refreshVentilationPreview() {
    renderVentilationPreview();
    draw2D();
    if (!State.isVentilationMode()) return;
    drawBranchTrend(ventTrendCanvas);
    if (State.selectedEntity?.type === 'VentilationBranch') propsPanel.textContent = branchInfo();
}

function currentAirflowOptions() {
    return {
        scenario: ventScenario?.value || 'normal',
        variable: ventVariable?.value || 'air_quantity_m3s',
        timeSteps: Number(ventSteps?.value || 60),
        eventStart: Number(ventEventStart?.value || 20),
        eventEnd: Number(ventEventEnd?.value || 40),
        intensity: Number(ventIntensity?.value || 0.8),
        targetBranchId: selectedBranch()?.id
    };
}

function boundaryFormValues(kind) {
    return {
        kind,
        label: boundaryLabel?.value || (kind === 'intake' ? 'Main Intake' : 'Main Return'),
        pressurePa: Number(boundaryPressure?.value || (kind === 'intake' ? 600 : 0)),
        capacityM3s: Number(boundaryCapacity?.value || 35)
    };
}

function syncBoundaryForm(rawNodeId) {
    const boundary = getVentilationBoundary(rawNodeId);
    if (boundaryLabel) boundaryLabel.value = boundary?.label || '';
    if (boundaryPressure) boundaryPressure.value = boundary?.pressurePa ?? '';
    if (boundaryCapacity) boundaryCapacity.value = boundary?.capacityM3s ?? 35;
}

function regenerateVentilationFromBoundaries() {
    if (!State.connections.length) return;
    generateVentilationNetwork(ventStrategy?.value || 'edge-based');
    generateAirflowState(currentAirflowOptions());
    syncVentilationForm();
    refreshVentilationPreview();
}

// Events
fileLoaderNet.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const enc = document.querySelector('input[name="encoding"]:checked').value;
    const r = new FileReader(); r.readAsArrayBuffer(f);
    r.onload = evt => {
        if(parseNETFile(new TextDecoder(enc).decode(evt.target.result))) {
            populateLayers();
            if (State.isVentilationMode()) {
                generateVentilationNetwork(ventStrategy?.value || 'edge-based');
                generateAirflowState(currentAirflowOptions());
                syncVentilationForm();
            }
            refreshVentilationPreview();
        }
    };
});
fileLoaderObj.addEventListener('change', (e) => { if (e.target.files[0]) loadOBJ(e.target.files[0]); });

dataTypeSelect.addEventListener('change', (e) => {
    if (!State.isEnvironmentalMode()) return;
    State.switchMode(e.target.value);
    const cfg = DataConfig[e.target.value];
    hmMin.value = cfg.defaultMin; hmMax.value = cfg.defaultMax;
    draw2D(); updateSensors(cfg.defaultMin, cfg.defaultMax);
    State.selectedEntity = null; updateUI();
});

generationModeSelect?.addEventListener('change', (e) => {
    applyGenerationMode(e.target.value);
});

fileLoaderJson.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = evt => importData(evt.target.result); r.readAsText(f); e.target.value = '';
});

document.getElementById('btn-export-current').onclick = exportCurrentData;
document.getElementById('btn-export-csv').onclick = exportSensorCSV; 
document.getElementById('btn-gen-random').onclick = generateRandomData;
document.getElementById('btn-clear-data').onclick = () => {
    if(confirm(`确定清空?`)) { State.dataStore[State.activeDataType] = []; State.sensors = State.dataStore[State.activeDataType]; draw2D(); updateSensors(0, 100); State.selectedEntity = null; updateUI(); }
};
document.getElementById('btn-export-graph-json').onclick = exportGraphJson;
document.getElementById('btn-export-obj').onclick = exportOBJ;
document.getElementById('btn-update-coords').onclick = () => {
    applyCoordinateTransform();
    if (State.isVentilationMode() && State.connections.length) {
        generateVentilationNetwork(ventStrategy?.value || 'edge-based');
        generateAirflowState(currentAirflowOptions());
    }
    refreshVentilationPreview();
};

document.getElementById('btn-vent-build').onclick = () => {
    if (!State.connections.length) { alert('Load roadway topology first.'); return; }
    generateVentilationNetwork(ventStrategy?.value || 'edge-based');
    syncVentilationForm();
    generateAirflowState(currentAirflowOptions());
    refreshVentilationPreview();
    updateUI();
};
document.getElementById('btn-vent-import-network').onclick = () => fileLoaderVentNetwork?.click();
fileLoaderVentNetwork?.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            importVentilationNetwork(evt.target.result);
            generateAirflowState(currentAirflowOptions());
            syncVentilationForm();
            refreshVentilationPreview();
            updateUI();
        } catch (error) {
            console.error(error);
            alert(`Failed to import ventilation network: ${error.message}`);
        }
    };
    reader.readAsText(f);
    e.target.value = '';
});
document.getElementById('btn-vent-export-network').onclick = exportVentilationNetwork;
document.getElementById('btn-vent-export-state').onclick = exportAirflowState;
document.getElementById('btn-vent-apply-branch').onclick = () => {
    const directionValue = ventDirection?.value || 'auto';
    updateSelectedBranch({
        branchType: ventBranchType?.value,
        directionMode: directionValue === 'auto' ? 'auto' : 'manual',
        nominalDirection: directionValue === 'auto' ? undefined : directionValue,
        area: ventArea?.value,
        resistance: ventResistance?.value,
        designAirQuantity: ventDesignQ?.value
    });
    generateAirflowState(currentAirflowOptions());
    refreshVentilationPreview();
    updateUI();
};
document.getElementById('btn-vent-merge').onclick = () => {
    mergeSelectedBranchWithConnected();
    generateAirflowState(currentAirflowOptions());
    refreshVentilationPreview();
    updateUI();
};
document.getElementById('btn-vent-split').onclick = () => {
    splitSelectedBranch();
    generateAirflowState(currentAirflowOptions());
    refreshVentilationPreview();
    updateUI();
};
document.getElementById('btn-vent-add-facility').onclick = () => {
    addFacilityToSelected(ventFacilityType?.value || 'fan');
    generateAirflowState(currentAirflowOptions());
    refreshVentilationPreview();
    updateUI();
};
document.getElementById('btn-vent-delete-facility').onclick = () => {
    if (!deleteSelectedFacility()) return;
    generateAirflowState(currentAirflowOptions());
    refreshVentilationPreview();
    updateUI();
};
document.getElementById('btn-vent-generate-state').onclick = () => {
    generateAirflowState(currentAirflowOptions());
    syncVentilationForm();
    refreshVentilationPreview();
};
ventVariable?.addEventListener('change', () => {
    State.airflowSettings.variable = ventVariable.value;
    refreshVentilationPreview();
});
ventScenario?.addEventListener('change', () => {
    State.airflowSettings.scenario = ventScenario.value;
});
ventTime?.addEventListener('input', () => {
    State.airflowSettings.timeIndex = Number(ventTime.value || 0);
    refreshVentilationPreview();
});

document.getElementById('btn-render-heatmap').onclick = () => {
    const min = parseFloat(hmMin.value), max = parseFloat(hmMax.value);
    if(State.activeDataType === 'WindSpeed') renderVectorField(min, max);
    else renderHeatmap(min, max);
    draw2D();
};
document.getElementById('btn-clear-heatmap').onclick = () => { clearHeatmap(); draw2D(); };

document.getElementById('btn-axes').onclick = (e) => toggleAxes(e.target.classList.toggle('active'));
document.getElementById('btn-net-lines').onclick = (e) => toggleNetLines(e.target.classList.toggle('active'));
document.getElementById('btn-wireframe').onclick = (e) => toggleWireframe(e.target.classList.toggle('active'));
resetViewBtn.onclick = autoZoom2D;

btnSetVal.onclick = () => {
    if (State.selectedEntity) {
        const val = parseFloat(inputSensorVal.value) || 0;
        if (State.selectedEntity.type === 'Sensor') {
            State.selectedEntity.data.value = val;
            const min = parseFloat(hmMin.value), max = parseFloat(hmMax.value);
            updateSensors(min, max);
        } else { State.selectedEntity.data.sensorVal = val; }
        updateUI(); draw2D();
    }
};
btnDelSensor.onclick = () => {
    if (State.selectedEntity?.type === 'Sensor') {
        const idx = State.sensors.indexOf(State.selectedEntity.data);
        if (idx > -1) State.sensors.splice(idx, 1);
        State.selectedEntity = null; updateUI(); draw2D();
        updateSensors(parseFloat(hmMin.value), parseFloat(hmMax.value));
    }
};
btnToggleDir.onclick = () => {
    if (State.selectedEntity?.type === 'Sensor') {
        const s = State.selectedEntity.data;
        s.direction = (s.direction === -1) ? 1 : -1;
        updateUI(); draw2D();
    }
};
btnSetInlet.onclick = () => {
    if (State.isVentilationMode() && State.selectedEntity?.type === 'Node') {
        setVentilationBoundary(State.selectedEntity.data.id, 'intake', boundaryFormValues('intake'));
        regenerateVentilationFromBoundaries();
        updateUI(); draw2D();
    }
};
btnSetOutlet.onclick = () => {
    if (State.isVentilationMode() && State.selectedEntity?.type === 'Node') {
        setVentilationBoundary(State.selectedEntity.data.id, 'return', boundaryFormValues('return'));
        regenerateVentilationFromBoundaries();
        updateUI(); draw2D();
    }
};
btnClearBoundary.onclick = () => {
    if (State.isVentilationMode() && State.selectedEntity?.type === 'Node') {
        clearVentilationBoundary(State.selectedEntity.data.id);
        regenerateVentilationFromBoundaries();
        updateUI(); draw2D();
    }
};

// =======================================================================
// Modal Logic
// =======================================================================
btnOpenTsModal.onclick = () => {
    tsModal.style.display = 'block';
};
btnCancelTs.onclick = () => {
    tsModal.style.display = 'none';
};
btnConfirmTs.onclick = () => {
    const start = inpTsStart.value;
    const interval = inpTsInterval.value;
    const count = inpTsCount.value;
    exportTimeSeriesCSV(start, interval, count);
    tsModal.style.display = 'none';
};
// Close when clicking outside
window.onclick = (e) => {
    if (e.target == tsModal) {
        tsModal.style.display = 'none';
    }
};

const defaultCfg = DataConfig[State.activeDataType];
if(hmMin) hmMin.value = defaultCfg.defaultMin;
if(hmMax) hmMax.value = defaultCfg.defaultMax;
if(lblValUnit) lblValUnit.textContent = `${State.activeDataType}:`;

init2D(document.getElementById('cad-canvas'), updateUI);
init3D(document.getElementById('viewport-3d'), updateUI);
applyGenerationMode(State.generationMode);
