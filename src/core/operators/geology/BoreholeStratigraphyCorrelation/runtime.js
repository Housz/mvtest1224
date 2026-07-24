import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import { generateCssGradient, sampleColor } from '../../../../utils/colors.js';
import { createSectionFrame } from '../../../geometry/SectionFrame.js';
import { buildGeologicalSectionResult } from '../../../geology/GeologicalSectionBuilder.js';
import { buildRoadwayGeologyRelationResult } from '../../../geology/RoadwayGeologyRelationBuilder.js';
import {
  attributeDistributionControlsHtml,
  attributeHistogramHtml,
  roadwayGeologyControlsHtml,
  roadwayGeologyTableHtml
} from '../GeologyAnalysisPanels.js';
import { startRangeBrushDrag } from '../RangeBrushController.js';
import {
  createAttributeBoxMaterial,
  createAttributePointsMaterial,
  createAttributeSurfaceMaterial,
  createVolumeRenderingMesh,
  gridBounds as sharedVolumeGridBounds,
  gridDimensions as sharedVolumeGridDimensions,
  normalizedVolumeTextureData as sharedNormalizedVolumeTextureData,
  renderVolumePointsLayer,
  resolveVolumeBinaryAttributeKey,
  updateVolumeLayerUniforms,
  updateAttributeGlyphLayerUniforms,
  volumeAttributeMeta as sharedVolumeAttributeMeta,
  volumeAttributeRange
} from '../GeologyVolumeRenderer.js';
import {
  disposeThreeObject,
  escapeHtml,
  formatScalar,
  GEOLOGY_PALETTE,
  geometryBoundaryEdges,
  geometryObjectNames,
  geometryUniqueVertices,
  geologyColorForKey,
  geologyHorizontalKey,
  geologyNumericRange,
  geologyPoint,
  geologyPointKey,
  roadwayEdgePath,
  setGroupOpacity,
  sliceBoreholePathByMeasure
} from '../../shared/OperatorRuntimeUtils.js';

import { BoreholeStratigraphyCorrelationInputRequirements } from '../contracts.js';
import { optionalFiniteNumber, clamp01 } from '../runtimeUtils.js';
import { GeologicalModelOverviewRuntime } from '../GeologicalModelOverview/runtime.js';
import { composeRuntimePrototype, initializeRuntimeCapability } from '../../shared/RuntimeComposition.js';

export class BoreholeStratigraphyCorrelationRuntime {
  constructor(nodeModel, inputs = {}) {
    initializeRuntimeCapability(this, GeologicalModelOverviewRuntime, nodeModel, inputs);
    this.label = nodeModel.label || 'Borehole & Stratigraphy Correlation';
    this.params = {
      selectedBoreholeIds: [],
      displayMode: 'correlation-canvas',
      depthReference: 'depth',
      alignmentMode: 'depth',
      boreholeOrder: 'section-distance',
      show3DLayer: true,
      showLogPanel: true,
      showCorrelationCanvas: true,
      showCorrelationLines: true,
      showLithology: true,
      showAssays: true,
      showModelIntersections: true,
      showGeologicalBody: false,
      showRoadway: false,
      showBoreholes: true,
      showStructures: false,
      showAttributeModel: false,
      geologicalBodyOpacity: 0.32,
      structureOpacity: 0.7,
      roadwayOpacity: 0.22,
      activeAttribute: null,
      maxBoreholesInCanvas: 12,
      autoSelectBoreholesNearSection: true,
      sectionDistanceTolerance: 20,
      boreholeOpacity: 1,
      logPanelWidth: 160,
      autoFocusOnSelection: true,
      ...(nodeModel.params || {})
    };
    this.selectedInterval = null;
    this.currentBoreholes = [];
    this.sectionFrame = null;
    this.logPanel = null;
    this.correlationPanel = null;
  }

  validateSemanticInputs() {
    const borehole = this.inputs.borehole;
    if (!borehole) throw new Error('Missing semantic dataset input: borehole');
    const actualClass = borehole.contract?.class || borehole.semanticClass;
    if (actualClass !== 'Borehole') throw new Error(`Input borehole expects Borehole, got ${actualClass}.`);
    if (borehole.validation?.errors?.length) {
      console.warn('[MineVis Borehole Correlation] Borehole validation errors:', borehole.validation.errors);
    }
    Object.entries(BoreholeStratigraphyCorrelationInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Borehole Correlation] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  async renderAllLayers() {
    if (this.inputs.geologicalBody && this.params.showModelIntersections) await this.renderGeologicalBodyLayer();
    if (this.params.show3DLayer !== false) this.renderBoreholeLayer();
    if (this.inputs.geologicalStructure && this.params.showModelIntersections) await this.renderStructureLayer();
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Borehole Correlation Controls', 'geology-panel geology-control-panel borehole-correlation-control-panel', '<div class="panel-body"></div>');
    this.logPanel = createWorkspacePanel('Borehole Log Panel', 'geology-panel borehole-log-panel', '<div class="panel-body"></div>');
    this.correlationPanel = createWorkspacePanel('Multi-borehole Correlation Canvas', 'geology-panel borehole-correlation-panel', '<div class="panel-body"></div>');
    this.detailPanel = createWorkspacePanel('Borehole / Interval Detail', 'geology-panel geology-detail-panel borehole-detail-panel', '<div class="panel-body"></div>');
    this.legendPanel = createWorkspacePanel('Borehole Legend', 'geology-panel geology-legend-panel borehole-legend-panel', '<div class="panel-body"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '330px' });
    Object.assign(this.logPanel.style, { right: '330px', top: '92px', width: '360px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '492px', width: '330px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '560px', width: '300px' });
    Object.assign(this.correlationPanel.style, { left: '370px', bottom: '28px', top: 'auto', width: '760px', maxHeight: '520px' });
  }

  registerVisualContributions() {
    if (this.params.show3DLayer !== false) this.registerSceneContribution('borehole-correlation-layer', '3D Borehole Correlation Layer', this.boreholeGroup, 'borehole', 'structure', this.params.boreholeOpacity, {
      semanticRole: 'structure',
      objectSystem: 'borehole',
      visualChannels: { color: 'lithology', line: 'trajectory' }
    });
    if (this.inputs.geologicalBody && this.params.showModelIntersections) {
      this.registerSceneContribution('borehole-geological-context', 'Geological Model Context', this.bodyGroup, 'geologicalBody', 'context', this.params.geologicalBodyOpacity, {
        semanticRole: 'context',
        objectSystem: 'geologicalBody'
      });
    }
    if (this.inputs.geologicalStructure && this.params.showModelIntersections) {
      this.registerSceneContribution('borehole-structure-context', 'Geological Structure Context', this.structureGroup, 'geologicalStructure', 'context', this.params.structureOpacity);
    }
    this.registerPanelContribution('Borehole Log Panel', this.logPanel, 'right-panel', 'detail', 'borehole');
    this.registerPanelContribution('Multi-borehole Correlation Canvas', this.correlationPanel, 'bottom-panel', 'detail', 'boreholeCorrelation');
    this.registerPanelContribution('Correlation Control Panel', this.layerPanel, 'right-panel', 'control', 'boreholeCorrelation');
    this.registerPanelContribution('Borehole / Interval Detail Panel', this.detailPanel, 'right-panel', 'detail', 'borehole');
    this.registerPanelContribution('Borehole Legend', this.legendPanel, 'legend', 'legend', 'borehole');
  }

  registerPanelContribution(name, element, host, semanticRole, objectSystem) {
    if (!element || !this.contributionRegistry) return;
    this.contributionRegistry.register?.({
      id: `${this.id}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: name,
      ownerId: this.id,
      functionId: this.functionId,
      type: semanticRole === 'legend' ? 'legend' : 'panel',
      host,
      element,
      descriptor: {
        host,
        contributionKind: semanticRole === 'control' ? 'control' : semanticRole === 'legend' ? 'legend' : 'panel',
        semanticRole,
        objectSystem,
        composition: {
          mergePolicy: semanticRole === 'legend' ? 'replace' : 'compose',
          focusBehavior: 'primary-when-focused',
          canPin: true
        }
      },
      visible: element.style.display !== 'none',
      show: () => (element.style.display = 'block'),
      hide: () => (element.style.display = 'none'),
      cleanup: () => element.remove()
    });
  }

  installHandlers() {
    this.disposers.push(this.context?.subscribe?.('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context?.subscribe?.('selectedBorehole', (boreholeId) => {
      if (boreholeId && this.selected?.id !== boreholeId) {
        this.selected = { type: 'borehole', id: boreholeId };
        this.updateHighlight();
        this.updatePanels();
      }
    }));
    this.disposers.push(this.context?.subscribe?.('selectedBoreholeInterval', (intervalId) => {
      if (intervalId && this.selectedInterval?.id !== intervalId) {
        const boreholeId = this.context?.get?.('selectedBorehole') || this.selectedInterval?.boreholeId;
        this.selectedInterval = { id: intervalId, boreholeId };
        this.selected = { type: 'boreholeInterval', id: intervalId, data: { boreholeId } };
        this.updateHighlight();
        this.updatePanels();
      }
    }));
    this.disposers.push(this.context?.subscribe?.('sectionFrame', (frame) => {
      this.sectionFrame = frame;
      if (this.params.autoSelectBoreholesNearSection) this.updatePanels();
    }));
    this.disposers.push(this.context?.subscribe?.('activeGeologicalAttribute', (attribute) => {
      if (attribute && attribute !== this.params.activeAttribute) {
        this.params.activeAttribute = attribute;
        this.updatePanels();
      }
    }));

    const controlHandler = (event) => this.handleCorrelationControlChange(event);
    const clickHandler = (event) => this.handleCorrelationClick(event);
    [this.layerPanel, this.logPanel, this.correlationPanel].forEach((panel) => {
      panel?.addEventListener?.('change', controlHandler);
      panel?.addEventListener?.('input', controlHandler);
      panel?.addEventListener?.('click', clickHandler);
      this.controlDisposers.push(() => {
        panel?.removeEventListener?.('change', controlHandler);
        panel?.removeEventListener?.('input', controlHandler);
        panel?.removeEventListener?.('click', clickHandler);
      });
    });
  }

  renderControls(container) {
    container.innerHTML = this.correlationControlsHtml({ compact: true });
    const handler = (event) => this.handleCorrelationControlChange(event);
    container.addEventListener('change', handler);
    container.addEventListener('input', handler);
    this.controlDisposers.push(() => {
      container.removeEventListener('change', handler);
      container.removeEventListener('input', handler);
    });
  }

  handleCorrelationControlChange(event) {
    const target = event.target;
    const key = target?.dataset?.correlationParam;
    if (!key) return;
    if (target.type === 'checkbox') this.params[key] = target.checked;
    else if (target.type === 'number' || target.type === 'range') this.params[key] = Number(target.value);
    else this.params[key] = target.value;
    if (key === 'activeAttribute') this.context?.set?.('activeGeologicalAttribute', this.params.activeAttribute || null);
    if (key === 'selectedBoreholeIds') {
      const values = Array.from(this.layerPanel?.querySelectorAll?.('[data-borehole-checkbox]:checked') || []).map((item) => item.value);
      this.params.selectedBoreholeIds = values;
    }
    this.updatePanels();
    this.updateLegend();
  }

  handleCorrelationClick(event) {
    const intervalTarget = event.target?.closest?.('[data-borehole-interval]');
    if (intervalTarget) {
      this.selectInterval(intervalTarget.dataset.boreholeId, intervalTarget.dataset.boreholeInterval);
      return;
    }
    const boreholeTarget = event.target?.closest?.('[data-borehole-id]');
    if (boreholeTarget) {
      this.setSelection('borehole', boreholeTarget.dataset.boreholeId, {});
      return;
    }
    const unitTarget = event.target?.closest?.('[data-correlation-unit]');
    if (unitTarget) {
      this.setSelection('geologicalUnit', unitTarget.dataset.correlationUnit, {});
    }
  }

  updatePanels() {
    this.currentBoreholes = this.resolveDisplayedBoreholes();
    if (this.layerPanel) this.layerPanel.querySelector('.panel-body').innerHTML = this.correlationControlsHtml();
    if (this.logPanel) {
      this.logPanel.style.display = this.params.showLogPanel ? '' : 'none';
      this.logPanel.querySelector('.panel-body').innerHTML = this.params.showLogPanel ? this.renderSingleLog() : '';
    }
    if (this.correlationPanel) {
      this.correlationPanel.style.display = this.params.showCorrelationCanvas ? '' : 'none';
      this.correlationPanel.querySelector('.panel-body').innerHTML = this.params.showCorrelationCanvas ? this.renderCorrelationCanvas() : '';
    }
    this.updateDetailPanel();
    this.syncControlValues();
  }

  syncControlValues() {
    [this.layerPanel, this.logPanel, this.correlationPanel].forEach((panel) => {
      panel?.querySelectorAll?.('[data-correlation-param]').forEach((input) => {
        if (input.dataset.boreholeCheckbox != null) return;
        const key = input.dataset.correlationParam;
        if (input.type === 'checkbox') input.checked = !!this.params[key];
        else if (key in this.params && input.value !== String(this.params[key] ?? '')) input.value = this.params[key] ?? '';
      });
    });
  }

  correlationControlsHtml({ compact = false } = {}) {
    const attributes = this.listBoreholeAttributes();
    const boreholes = this.inputs.borehole?.listBoreholes?.() || [];
    const selected = new Set(this.resolveSelectedBoreholeIds());
    const boreholeList = compact ? '' : `
      <div class="geology-detail-subtitle">Borehole selection</div>
      <div class="scroll-list compact-scroll">
        ${boreholes.map((borehole) => {
          const id = borehole.boreholeId;
          return `<label class="checkbox-row"><input type="checkbox" data-correlation-param="selectedBoreholeIds" data-borehole-checkbox value="${escapeHtml(id)}" ${selected.has(id) ? 'checked' : ''}> ${escapeHtml(borehole.boreholeName || id)}</label>`;
        }).join('')}
      </div>`;
    return `
      <div class="field-grid">
        <label>Display mode<select data-correlation-param="displayMode">
          ${['correlation-canvas', 'single-log'].map((value) => `<option value="${value}" ${this.params.displayMode === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Depth reference<select data-correlation-param="depthReference">
          ${['depth', 'elevation'].map((value) => `<option value="${value}" ${this.params.depthReference === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Alignment<select data-correlation-param="alignmentMode">
          ${['depth', 'elevation'].map((value) => `<option value="${value}" ${this.params.alignmentMode === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Order<select data-correlation-param="boreholeOrder">
          ${['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'].map((value) => `<option value="${value}" ${this.params.boreholeOrder === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select></label>
        <label>Active attribute<select data-correlation-param="activeAttribute">
          <option value="">None</option>
          ${attributes.map((name) => `<option value="${escapeHtml(name)}" ${this.params.activeAttribute === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select></label>
        <label>Max boreholes<input type="number" min="1" max="48" data-correlation-param="maxBoreholesInCanvas" value="${escapeHtml(this.params.maxBoreholesInCanvas)}"></label>
      </div>
      <div class="checkbox-grid">
        <label><input type="checkbox" data-correlation-param="show3DLayer" ${this.params.show3DLayer ? 'checked' : ''}> 3D boreholes</label>
        <label><input type="checkbox" data-correlation-param="showLogPanel" ${this.params.showLogPanel ? 'checked' : ''}> log panel</label>
        <label><input type="checkbox" data-correlation-param="showCorrelationCanvas" ${this.params.showCorrelationCanvas ? 'checked' : ''}> correlation canvas</label>
        <label><input type="checkbox" data-correlation-param="showCorrelationLines" ${this.params.showCorrelationLines ? 'checked' : ''}> correlation lines</label>
        <label><input type="checkbox" data-correlation-param="showLithology" ${this.params.showLithology ? 'checked' : ''}> lithology</label>
        <label><input type="checkbox" data-correlation-param="showAssays" ${this.params.showAssays ? 'checked' : ''}> assays</label>
        <label><input type="checkbox" data-correlation-param="showModelIntersections" ${this.params.showModelIntersections ? 'checked' : ''}> model intersections</label>
        <label><input type="checkbox" data-correlation-param="autoSelectBoreholesNearSection" ${this.params.autoSelectBoreholesNearSection ? 'checked' : ''}> auto near section</label>
      </div>
      ${boreholeList}`;
  }

  resolveSelectedBoreholeIds() {
    const ids = Array.isArray(this.params.selectedBoreholeIds)
      ? this.params.selectedBoreholeIds
      : String(this.params.selectedBoreholeIds || '').split(',').map((value) => value.trim()).filter(Boolean);
    const current = this.context?.get?.('selectedBorehole') || (this.selected?.type === 'borehole' ? this.selected.id : null);
    return [...new Set([current, ...ids].filter(Boolean))];
  }

  resolveDisplayedBoreholes() {
    const all = this.inputs.borehole?.listBoreholes?.() || [];
    const byId = new Map(all.map((item) => [item.boreholeId, item]));
    let rows = this.resolveSelectedBoreholeIds().map((id) => byId.get(id)).filter(Boolean);
    if (!rows.length) rows = [...all];
    rows = this.sortBoreholes(rows);
    const limit = Math.max(1, Number(this.params.maxBoreholesInCanvas) || 12);
    return rows.slice(0, limit);
  }

  sortBoreholes(rows) {
    const mode = this.params.boreholeOrder;
    const sorted = [...rows];
    if (mode === 'name') {
      sorted.sort((a, b) => String(a.boreholeName || a.boreholeId).localeCompare(String(b.boreholeName || b.boreholeId)));
    } else if (mode === 'spatial-x') {
      sorted.sort((a, b) => Number(a.position?.x ?? a.collarX ?? 0) - Number(b.position?.x ?? b.collarX ?? 0));
    } else if (mode === 'spatial-y') {
      sorted.sort((a, b) => Number(a.position?.y ?? a.collarY ?? 0) - Number(b.position?.y ?? b.collarY ?? 0));
    } else if (mode === 'section-distance') {
      const frame = this.sectionFrame || this.context?.get?.('sectionFrame');
      if (frame?.projectPoint) {
        sorted.sort((a, b) => {
          const pa = frame.projectPoint(this.resolveBoreholeCollar(a, this.inputs.borehole?.getTrajectory?.(a.boreholeId) || []));
          const pb = frame.projectPoint(this.resolveBoreholeCollar(b, this.inputs.borehole?.getTrajectory?.(b.boreholeId) || []));
          return Number(pa?.x ?? 0) - Number(pb?.x ?? 0);
        });
      } else {
        sorted.sort((a, b) => String(a.boreholeName || a.boreholeId).localeCompare(String(b.boreholeName || b.boreholeId)));
      }
    }
    return sorted;
  }

  selectedBorehole() {
    const id = this.context?.get?.('selectedBorehole') || this.selectedInterval?.boreholeId || (this.selected?.type === 'borehole' ? this.selected.id : null);
    return this.inputs.borehole?.getBorehole?.(id) || this.currentBoreholes[0] || this.inputs.borehole?.listBoreholes?.()[0] || null;
  }

  sortedIntervals(boreholeId) {
    return (this.inputs.borehole?.getIntervals?.(boreholeId) || [])
      .filter((interval) => Number.isFinite(Number(interval.depthFrom)) && Number.isFinite(Number(interval.depthTo)))
      .sort((a, b) => Number(a.depthFrom) - Number(b.depthFrom));
  }

  intervalId(interval, index = 0) {
    return interval?.id || interval?.intervalId || interval?.interval_id || `${interval?.boreholeId || interval?.borehole_id || 'interval'}_${index}`;
  }

  intervalLithology(interval) {
    return interval?.lithology || interval?.rock_type || interval?.unitName || interval?.unitId || interval?.attributeValue || interval?.value || 'unknown';
  }

  intervalUnit(interval) {
    return interval?.unitId || interval?.unit_id || interval?.geologicalUnitId || interval?.seamId || interval?.seam_id || null;
  }

  boreholeDepthExtent(boreholes = this.currentBoreholes) {
    let min = Infinity;
    let max = -Infinity;
    boreholes.forEach((borehole) => {
      const intervals = this.sortedIntervals(borehole.boreholeId);
      intervals.forEach((interval) => {
        min = Math.min(min, Number(interval.depthFrom));
        max = Math.max(max, Number(interval.depthTo));
      });
      if (Number.isFinite(Number(borehole.totalDepth))) {
        min = Math.min(min, 0);
        max = Math.max(max, Number(borehole.totalDepth));
      }
    });
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { min: 0, max: 100 };
    return { min, max };
  }

  listBoreholeAttributes() {
    const names = new Set(this.inputs.attributeModel?.listAttributes?.() || []);
    (this.inputs.borehole?.listBoreholes?.() || []).forEach((borehole) => {
      this.sortedIntervals(borehole.boreholeId).forEach((interval) => {
        ['grade', 'ash', 'sulfur', 'value', 'attributeValue'].forEach((key) => {
          if (interval[key] != null && interval[key] !== '') names.add(key);
        });
      });
    });
    return [...names];
  }

  renderSingleLog() {
    const borehole = this.selectedBorehole();
    if (!borehole) return '<div class="empty-state">No borehole dataset connected.</div>';
    const intervals = this.sortedIntervals(borehole.boreholeId);
    if (!intervals.length) return '<div class="empty-state">No borehole intervals available.</div>';
    const extent = this.boreholeDepthExtent([borehole]);
    const width = 310;
    const top = 36;
    const bottom = 28;
    const trackX = 80;
    const trackW = 96;
    const curveX = 202;
    const height = Math.max(360, (extent.max - extent.min) * 4 + top + bottom);
    const scaleY = (depth) => top + ((Number(depth) - extent.min) / Math.max(1, extent.max - extent.min)) * (height - top - bottom);
    const active = this.params.activeAttribute;
    const values = intervals.map((interval) => Number(interval[active])).filter(Number.isFinite);
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 1;
    const rects = intervals.map((interval, index) => {
      const y0 = scaleY(interval.depthFrom);
      const y1 = scaleY(interval.depthTo);
      const id = this.intervalId(interval, index);
      const lithology = this.intervalLithology(interval);
      const selected = this.selectedInterval?.id === id;
      const color = this.params.showLithology ? this.colorForLithology(lithology, index) : '#9aa5b1';
      const value = Number(interval[active]);
      const point = active && Number.isFinite(value)
        ? `<circle cx="${curveX + ((value - minValue) / Math.max(0.0001, maxValue - minValue)) * 70}" cy="${(y0 + y1) / 2}" r="3.5" fill="#f59e0b" />`
        : '';
      return `
        <g data-borehole-id="${escapeHtml(borehole.boreholeId)}" data-borehole-interval="${escapeHtml(id)}">
          <rect x="${trackX}" y="${y0}" width="${trackW}" height="${Math.max(2, y1 - y0)}" fill="${escapeHtml(color)}" stroke="${selected ? '#facc15' : '#1f2937'}" stroke-width="${selected ? 3 : 0.7}" />
          <text x="${trackX + trackW + 8}" y="${Math.max(y0 + 12, (y0 + y1) / 2)}" font-size="10" fill="#d7dde7">${escapeHtml(lithology)}</text>
          ${point}
        </g>`;
    }).join('');
    return `
      <div class="borehole-log-header"><strong>${escapeHtml(borehole.boreholeName || borehole.boreholeId)}</strong><span class="muted-note">${intervals.length} intervals</span></div>
      <div class="borehole-log-content">
        <svg class="borehole-log-svg" viewBox="0 0 ${width} ${height}" role="img">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#101722" rx="8" />
          <text x="18" y="22" font-size="11" fill="#a7b4c5">Depth (m)</text>
          <line x1="58" y1="${top}" x2="58" y2="${height - bottom}" stroke="#6b7280" stroke-width="1" />
          ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const depth = extent.min + t * (extent.max - extent.min);
            const y = scaleY(depth);
            return `<line x1="52" y1="${y}" x2="176" y2="${y}" stroke="#334155" stroke-width="0.7" /><text x="8" y="${y + 4}" font-size="10" fill="#93a4b8">${formatScalar(depth, 1)}</text>`;
          }).join('')}
          <text x="${trackX}" y="22" font-size="11" fill="#a7b4c5">Lithology</text>
          ${active ? `<text x="${curveX}" y="22" font-size="11" fill="#a7b4c5">${escapeHtml(active)}</text>` : ''}
          ${rects}
        </svg>
      </div>`;
  }

  renderCorrelationCanvas() {
    const boreholes = this.currentBoreholes;
    if (!boreholes.length) return '<div class="empty-state">No boreholes available for correlation.</div>';
    const extent = this.boreholeDepthExtent(boreholes);
    const top = 44;
    const bottom = 28;
    const columnW = 86;
    const gap = 34;
    const left = 54;
    const height = Math.max(420, (extent.max - extent.min) * 3.6 + top + bottom);
    const width = Math.max(520, left + boreholes.length * (columnW + gap) + 40);
    const scaleY = (depth) => top + ((Number(depth) - extent.min) / Math.max(1, extent.max - extent.min)) * (height - top - bottom);
    const markers = new Map();
    const columns = boreholes.map((borehole, columnIndex) => {
      const x = left + columnIndex * (columnW + gap);
      const intervals = this.sortedIntervals(borehole.boreholeId);
      const rects = intervals.map((interval, index) => {
        const y0 = scaleY(interval.depthFrom);
        const y1 = scaleY(interval.depthTo);
        const id = this.intervalId(interval, index);
        const unit = this.intervalUnit(interval) || this.intervalLithology(interval);
        const key = String(unit || '').trim();
        if (key) {
          if (!markers.has(key)) markers.set(key, []);
          markers.get(key).push({ x: x + columnW / 2, y: y0, boreholeId: borehole.boreholeId, intervalId: id });
        }
        const selected = this.selectedInterval?.id === id;
        const color = this.params.showLithology ? this.colorForLithology(this.intervalLithology(interval), index) : '#94a3b8';
        return `
          <g data-borehole-id="${escapeHtml(borehole.boreholeId)}" data-borehole-interval="${escapeHtml(id)}">
            <rect x="${x}" y="${y0}" width="${columnW}" height="${Math.max(2, y1 - y0)}" fill="${escapeHtml(color)}" stroke="${selected ? '#facc15' : '#0f172a'}" stroke-width="${selected ? 3 : 0.7}" />
          </g>`;
      }).join('');
      const selectedBorehole = this.selected?.type === 'borehole' && this.selected.id === borehole.boreholeId;
      return `
        <g data-borehole-id="${escapeHtml(borehole.boreholeId)}">
          <text x="${x + columnW / 2}" y="25" text-anchor="middle" font-size="11" font-weight="${selectedBorehole ? 700 : 500}" fill="${selectedBorehole ? '#facc15' : '#d7dde7'}">${escapeHtml(borehole.boreholeName || borehole.boreholeId)}</text>
          <rect x="${x - 2}" y="${top}" width="${columnW + 4}" height="${height - top - bottom}" fill="none" stroke="${selectedBorehole ? '#facc15' : '#334155'}" stroke-width="${selectedBorehole ? 2 : 1}" />
          ${rects}
        </g>`;
    }).join('');
    const lines = this.params.showCorrelationLines ? [...markers.entries()].map(([unit, points], index) => {
      if (points.length < 2) return '';
      const sorted = points.sort((a, b) => a.x - b.x);
      const d = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      const selected = this.selected?.type === 'geologicalUnit' && this.selected.id === unit;
      return `<path data-correlation-unit="${escapeHtml(unit)}" d="${d}" fill="none" stroke="${escapeHtml(geologyColorForKey(unit, index))}" stroke-width="${selected ? 3.2 : 1.4}" stroke-opacity="${selected ? 0.95 : 0.58}" stroke-linecap="round" stroke-linejoin="round" />`;
    }).join('') : '';
    return `
      <div class="borehole-correlation-content">
        <svg class="borehole-correlation-svg" viewBox="0 0 ${width} ${height}" role="img">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#0f1722" rx="10" />
          <text x="18" y="25" font-size="11" fill="#a7b4c5">Depth (m)</text>
          ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const depth = extent.min + t * (extent.max - extent.min);
            const y = scaleY(depth);
            return `<line x1="46" y1="${y}" x2="${width - 22}" y2="${y}" stroke="#263445" stroke-width="0.7" /><text x="10" y="${y + 4}" font-size="10" fill="#93a4b8">${formatScalar(depth, 1)}</text>`;
          }).join('')}
          ${columns}
          ${lines}
        </svg>
      </div>`;
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const intervals = this.currentBoreholes.flatMap((borehole) => this.sortedIntervals(borehole.boreholeId));
    const lithologies = [...new Set(intervals.map((interval) => this.intervalLithology(interval)).filter(Boolean))].slice(0, 12);
    this.legendPanel.querySelector('.panel-body').innerHTML = `
      <div class="route-legend-list">
        ${lithologies.map((name, index) => `<div class="legend-row"><span class="legend-dot" style="background:${escapeHtml(this.colorForLithology(name, index))}"></span><span>${escapeHtml(name)}</span></div>`).join('')}
        <div class="legend-row"><span class="legend-line" style="background:#facc15"></span><span>Selected borehole / interval</span></div>
        <div class="legend-row"><span class="legend-line" style="background:#60a5fa"></span><span>Correlation line</span></div>
      </div>`;
  }

  handleGeologyPick(entity) {
    if (!entity) return;
    if (entity.type === 'borehole' && entity.intervalId) {
      this.selectInterval(entity.boreholeId || entity.id, entity.intervalId);
      return;
    }
    if (entity.type === 'borehole') {
      this.setSelection('borehole', entity.boreholeId || entity.id, entity);
      return;
    }
    this.setSelection(entity.type, entity.id, entity);
  }

  selectInterval(boreholeId, intervalId) {
    if (!boreholeId || !intervalId) return;
    const interval = this.sortedIntervals(boreholeId).find((item, index) => this.intervalId(item, index) === intervalId);
    this.selectedInterval = { id: intervalId, boreholeId, interval };
    this.selected = { type: 'boreholeInterval', id: intervalId, data: { boreholeId, interval } };
    this.context?.set?.('selectedBorehole', boreholeId);
    this.context?.set?.('selectedBoreholeInterval', intervalId);
    this.context?.set?.('selection', { type: 'boreholeInterval', id: intervalId, data: { boreholeId, interval } });
    this.updateHighlight();
    this.updatePanels();
  }

  setSelection(type, id, extra = {}) {
    if (!id) return;
    this.selected = { type, id, data: extra };
    if (type === 'borehole') {
      this.selectedInterval = null;
      this.context?.set?.('selectedBorehole', id);
      this.context?.set?.('selectedBoreholeInterval', null);
    } else if (type === 'geologicalUnit') {
      this.context?.set?.('selectedGeologicalUnit', id);
    } else if (type === 'geologicalStructure') {
      this.context?.set?.('selectedStructure', id);
    }
    this.context?.set?.('selection', { type, id, data: extra });
    this.updateHighlight();
    this.updatePanels();
  }

  applyContextSelection(selection) {
    if (!selection || !selection.type || !selection.id) {
      this.selected = null;
      this.selectedInterval = null;
      this.updateHighlight();
      this.updatePanels();
      return;
    }
    if (!['borehole', 'boreholeInterval', 'geologicalUnit', 'geologicalStructure'].includes(selection.type)) return;
    this.selected = selection;
    if (selection.type === 'boreholeInterval') {
      this.selectedInterval = { id: selection.id, boreholeId: selection.data?.boreholeId || this.context?.get?.('selectedBorehole'), interval: selection.data?.interval };
    } else if (selection.type === 'borehole') {
      this.selectedInterval = null;
    }
    this.updateHighlight();
    this.updatePanels();
  }

  matchesSelection(pick) {
    if (!this.selected || !pick) return false;
    if (this.selected.type === 'boreholeInterval') {
      return pick.type === 'borehole' && pick.intervalId === this.selected.id;
    }
    if (this.selected.type === 'borehole') {
      return pick.type === 'borehole' && (pick.boreholeId === this.selected.id || pick.id === this.selected.id);
    }
    if (this.selected.type === 'geologicalUnit') return pick.unitId === this.selected.id || pick.id === this.selected.id;
    return GeologicalModelOverviewRuntime.prototype.matchesSelection.call(this, pick);
  }

  updateDetailPanel() {
    if (!this.detailPanel) return;
    this.detailPanel.querySelector('.panel-body').innerHTML = this.detailHtml(this.selected);
  }

  detailHtml(selection) {
    if (!selection) return '<div class="empty-state">Select a borehole, interval, or correlation line to inspect details.</div>';
    if (selection.type === 'borehole') {
      const borehole = this.inputs.borehole?.getBorehole?.(selection.id);
      const intervals = this.sortedIntervals(selection.id);
      return this.rows([
        ['Borehole ID', selection.id],
        ['Name', borehole?.boreholeName],
        ['Collar', borehole?.position ? `${formatScalar(borehole.position.x)}, ${formatScalar(borehole.position.y)}, ${formatScalar(borehole.position.z)}` : null],
        ['Total depth', borehole?.totalDepth],
        ['Interval count', intervals.length],
        ['Sample count', this.inputs.borehole?.getSamples?.(selection.id)?.length ?? 0]
      ]);
    }
    if (selection.type === 'boreholeInterval') {
      const boreholeId = selection.data?.boreholeId || this.selectedInterval?.boreholeId;
      const interval = selection.data?.interval || this.selectedInterval?.interval || this.sortedIntervals(boreholeId).find((item, index) => this.intervalId(item, index) === selection.id);
      const unitId = this.intervalUnit(interval);
      const unit = unitId ? this.inputs.geologicalBody?.getUnit?.(unitId) : null;
      const lithology = this.intervalLithology(interval);
      const mismatch = unit?.lithology && lithology && String(unit.lithology).toLowerCase() !== String(lithology).toLowerCase();
      const active = this.params.activeAttribute;
      return this.rows([
        ['Interval ID', selection.id],
        ['Borehole ID', boreholeId],
        ['Depth from', interval?.depthFrom],
        ['Depth to', interval?.depthTo],
        ['Lithology', lithology],
        ['Unit ID', unitId],
        ['Model match', unit ? (mismatch ? 'Lithology mismatch' : 'Matched') : unitId ? 'Unmatched unit' : 'No unit id'],
        [active || 'Grade / value', active ? interval?.[active] : (interval?.grade ?? interval?.value ?? interval?.attributeValue)]
      ]);
    }
    if (selection.type === 'geologicalUnit') {
      const unit = this.inputs.geologicalBody?.getUnit?.(selection.id);
      const matched = (this.inputs.borehole?.listBoreholes?.() || [])
        .flatMap((borehole) => this.sortedIntervals(borehole.boreholeId))
        .filter((interval) => this.intervalUnit(interval) === selection.id).length;
      return this.rows([
        ['Unit ID', selection.id],
        ['Name', unit?.geologicalUnitName || unit?.unitName],
        ['Type', unit?.geologicalUnitType || unit?.unitType],
        ['Lithology', unit?.lithology],
        ['Matched borehole intervals', matched]
      ]);
    }
    return GeologicalModelOverviewRuntime.prototype.detailHtml.call(this, selection);
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    [this.layerPanel, this.logPanel, this.correlationPanel, this.legendPanel, this.detailPanel, this.attributePanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

composeRuntimePrototype(BoreholeStratigraphyCorrelationRuntime, GeologicalModelOverviewRuntime);
