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

import { GeologicalAttributeDistributionInputRequirements } from '../contracts.js';
import { optionalFiniteNumber, clamp01 } from '../runtimeUtils.js';
import { GeologicalModelOverviewRuntime } from '../GeologicalModelOverview/runtime.js';
import { composeRuntimePrototype, initializeRuntimeCapability } from '../../shared/RuntimeComposition.js';

export class GeologicalAttributeDistributionAnalysisRuntime {
  constructor(nodeModel, inputs = {}) {
    initializeRuntimeCapability(this, GeologicalModelOverviewRuntime, nodeModel, inputs);
    this.label = nodeModel.label || 'Geological Attribute Distribution Analysis';
    this.params = {
      activeAttribute: null,
      colorMode: 'continuous',
      colormap: 'viridis',
      valueRangeMode: 'auto',
      minValue: null,
      maxValue: null,
      filterMode: 'highlight',
      rangeFilter: null,
      categoryFilter: [],
      seamFilter: 'all',
      renderMode: 'interpolated-surface',
      blockRenderMode: 'interpolated-surface',
      maxRenderedElements: 8000,
      showHistogram: true,
      showTargetZone: true,
      showContextElements: true,
      selectedOpacity: 0.95,
      contextOpacity: 0.12,
      attributeLayerOpacity: 0.75,
      attributeModelOpacity: 0.75,
      showRoadwayContext: true,
      showGeologicalBodyContext: true,
      showStructureContext: true,
      showRoadway: true,
      showGeologicalBody: true,
      showStructures: true,
      showBoreholes: false,
      showAttributeModel: true,
      volumeIsoValue: 0.5,
      volumeFilterMin: 0,
      volumeFilterMax: 1,
      volumeClipXMin: 0,
      volumeClipXMax: 1,
      volumeClipYMin: 0,
      volumeClipYMax: 1,
      volumeClipZMin: 0,
      volumeClipZMax: 1,
      volumeOpacity: 0.5,
      volumeRaySteps: 240,
      volumePointSize: 7,
      autoFocusOnSelection: true,
      ...(nodeModel.params || {})
    };
    this.attributeElements = [];
    this.renderedAttributeElements = [];
    this.attributeStats = null;
    this.targetZoneResult = null;
  }

  validateSemanticInputs() {
    const attributeModel = this.inputs.attributeModel;
    if (!attributeModel) throw new Error('Missing semantic dataset input: attributeModel');
    const actualClass = attributeModel.contract?.class || attributeModel.semanticClass;
    if (actualClass !== 'GeologicalAttributeModel') throw new Error(`Input attributeModel expects GeologicalAttributeModel, got ${actualClass}.`);
    if (attributeModel.validation?.errors?.length) {
      console.warn('[MineVis Geological Attribute Distribution] Attribute model validation errors:', attributeModel.validation.errors);
    }
    Object.entries(GeologicalAttributeDistributionInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Geological Attribute Distribution] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  async initializeRoadwayContext() {
    if (!this.inputs.roadway || !this.params.showContextElements || !this.params.showRoadwayContext) {
      this.sceneManager?.setRoadwayVisibleForOwner?.(this.id, false);
      return;
    }
    return GeologicalModelOverviewRuntime.prototype.initializeRoadwayContext.call(this);
  }

  applyLayerState() {
    this.bodyGroup.visible = !!(this.params.showContextElements && this.params.showGeologicalBodyContext && this.inputs.geologicalBody);
    this.boreholeGroup.visible = !!this.params.showBoreholes;
    this.structureGroup.visible = !!(this.params.showContextElements && this.params.showStructureContext && this.inputs.geologicalStructure);
    this.attributeGroup.visible = !!this.params.showAttributeModel;
    this.sceneManager?.setRoadwayVisibleForOwner?.(this.id, !!(this.inputs.roadway && this.params.showContextElements && this.params.showRoadwayContext));
    this.applyAttributeBodyLayerFilter();
  }

  applyAttributeBodyLayerFilter() {
    const filter = String(this.params.seamFilter || 'all');
    this.bodyGroup?.traverse?.((child) => {
      if (!child.userData?.geologyPick) return;
      if (filter === 'all') {
        child.visible = true;
        return;
      }
      const pick = child.userData.geologyPick;
      const ids = [pick.unitId, pick.geologicalUnitId, pick.bodyId, pick.id, pick.surfaceId].filter(Boolean).map(String);
      child.visible = ids.includes(filter);
    });
  }

  async renderAllLayers() {
    const needsBodySurface =
      !this.inputs.attributeModel?.grid &&
      ['interpolated-surface', 'surface', 'surface-samples'].includes(String(this.params.renderMode || this.params.blockRenderMode || ''));
    if (this.inputs.geologicalBody && ((this.params.showContextElements && this.params.showGeologicalBodyContext) || needsBodySurface)) await this.renderGeologicalBodyLayer();
    if (this.inputs.geologicalStructure && this.params.showContextElements && this.params.showStructureContext) await this.renderStructureLayer();
    this.renderDistributionLayer();
    this.applyAttributeBodyLayerFilter();
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Attribute Distribution Controls', 'geology-panel geology-control-panel attribute-distribution-control-panel', '<div class="panel-body"></div>');
    this.correlationPanel = createWorkspacePanel('Attribute Histogram / Distribution', 'geology-panel attribute-histogram-panel', '<div class="panel-body"></div>');
    this.attributePanel = createWorkspacePanel('Attribute Summary', 'geology-panel geological-attribute-panel attribute-summary-panel', '<div class="panel-body"></div>');
    this.detailPanel = createWorkspacePanel('Attribute Element Detail', 'geology-panel geology-detail-panel attribute-detail-panel', '<div class="panel-body"></div>');
    this.legendPanel = createWorkspacePanel('Attribute Legend', 'geology-panel geology-legend-panel attribute-legend-panel', '<div class="panel-body"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '340px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '520px', width: '300px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '92px', width: '330px' });
    Object.assign(this.attributePanel.style, { right: '330px', top: '450px', width: '330px' });
    Object.assign(this.correlationPanel.style, { left: '380px', bottom: '28px', top: 'auto', width: '760px', maxHeight: '420px' });
  }

  registerVisualContributions() {
    this.registerSceneContribution('attribute-distribution-layer', '3D Attribute Distribution Layer', this.attributeGroup, 'geologicalAttributeModel', 'state', this.params.attributeLayerOpacity, {
      visualChannels: { color: 'activeGeologicalAttribute', opacity: 'filterState', halo: 'targetZone' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: this.params.attributeLayerOpacity, canPin: true }
    });
    if (this.inputs.geologicalBody && this.params.showContextElements && this.params.showGeologicalBodyContext) {
      this.registerSceneContribution('attribute-geological-context', 'Geological Body Context', this.bodyGroup, 'geologicalBody', 'context', this.params.contextOpacity);
    }
    if (this.inputs.geologicalStructure && this.params.showContextElements && this.params.showStructureContext) {
      this.registerSceneContribution('attribute-structure-context', 'Geological Structure Context', this.structureGroup, 'geologicalStructure', 'context', this.params.contextOpacity);
    }
    if (this.inputs.roadway && this.params.showContextElements && this.params.showRoadwayContext) {
      this.contributionRegistry.register({
        id: `${this.id}:attribute-roadway-context`,
        label: 'Roadway Context Layer',
        ownerId: this.id,
        functionId: this.functionId,
        type: 'scene-layer',
        host: 'main-3d-scene',
        contributionKind: 'layer',
        semanticRole: 'context',
        objectSystem: 'roadway',
        visible: true,
        opacity: this.params.contextOpacity,
        show: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, true),
        hide: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, false),
        setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner?.(this.id, Number(value)),
        focus: () => this.sceneManager.focusOnRoadway?.(),
        cleanup: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, false)
      });
    }
    [
      ['controls', 'Attribute Control Panel', this.layerPanel, 'panel', 'control', 'right-panel'],
      ['histogram', 'Attribute Histogram / Distribution View', this.correlationPanel, 'chart', 'detail', 'bottom-panel'],
      ['summary', 'Attribute Summary Panel', this.attributePanel, 'panel', 'detail', 'right-panel'],
      ['detail', 'Attribute Detail Panel', this.detailPanel, 'panel', 'detail', 'right-panel'],
      ['legend', 'Attribute Legend', this.legendPanel, 'legend', 'legend', 'legend']
    ].forEach(([suffix, label, panel, type, semanticRole, host]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        host,
        contributionKind: type,
        semanticRole,
        objectSystem: 'geologicalAttributeModel',
        element: panel,
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context?.subscribe?.('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context?.subscribe?.('activeGeologicalAttribute', (attribute) => {
      if (attribute && attribute !== this.params.activeAttribute) {
        this.params.activeAttribute = attribute;
        this.rerenderDistribution();
      }
    }));
    this.disposers.push(this.context?.subscribe?.('attributeRangeFilter', (filter) => {
      if (this.suppressAttributeRangeFilter) return;
      if (filter?.ownerId === this.id) return;
      if (!filter || filter.attribute !== this.params.activeAttribute) return;
      this.params.minValue = filter.min;
      this.params.maxValue = filter.max;
      this.params.valueRangeMode = 'manual';
      this.rerenderDistribution();
    }));
    this.disposers.push(this.context?.subscribe?.('attributeRangePreview', (filter) => {
      if (!filter || filter.ownerId === this.id || filter.attribute !== this.params.activeAttribute) return;
      this.params.minValue = filter.min;
      this.params.maxValue = filter.max;
      this.params.valueRangeMode = 'manual';
      this.params.volumeFilterMin = clamp01(filter.normalizedMin);
      this.params.volumeFilterMax = clamp01(filter.normalizedMax);
      this.updateVolumeUniforms();
      this.syncAttributeControls();
      this.syncGeologyControls?.();
    }));
    const changeHandler = (event) => this.handleAttributeControlChange(event);
    const clickHandler = (event) => this.handleAttributePanelClick(event);
    const volumeRangePointerHandler = (event) => {
      this.handleVolumeRangePointerDown(event, (final) => {
        this.updateVolumeUniforms();
        this.syncGeologyControls();
        if (final) {
          this.updateLegend();
          this.updateAttributeSummary();
        }
      });
    };
    const histogramPointerHandler = (event) => this.handleAttributeHistogramPointerDown(event);
    const histogramDoubleClickHandler = (event) => this.handleAttributeHistogramDoubleClick(event);
    [this.layerPanel, this.correlationPanel].forEach((panel) => {
      panel?.addEventListener?.('change', changeHandler);
      panel?.addEventListener?.('input', changeHandler);
      panel?.addEventListener?.('click', clickHandler);
      panel?.addEventListener?.('pointerdown', volumeRangePointerHandler);
      panel?.addEventListener?.('pointerdown', histogramPointerHandler);
      panel?.addEventListener?.('dblclick', histogramDoubleClickHandler);
      this.controlDisposers.push(() => {
        panel?.removeEventListener?.('change', changeHandler);
        panel?.removeEventListener?.('input', changeHandler);
        panel?.removeEventListener?.('click', clickHandler);
        panel?.removeEventListener?.('pointerdown', volumeRangePointerHandler);
        panel?.removeEventListener?.('pointerdown', histogramPointerHandler);
        panel?.removeEventListener?.('dblclick', histogramDoubleClickHandler);
      });
    });
  }

  renderControls(container) {
    container.innerHTML = `
      <div class="panel-title">Geological Attribute Distribution</div>
      <div class="muted-note">Use the floating Attribute Distribution Controls panel for filters, rendering mode, and linked histogram controls.</div>
      <div class="geology-quick-actions">
        <button type="button" data-action="show-attribute-controls">Show Controls</button>
      </div>
    `;
    const onClick = (event) => {
      if (event.target?.dataset?.action !== 'show-attribute-controls') return;
      if (!this.layerPanel) return;
      this.layerPanel.style.display = 'block';
      this.layerPanel.classList.remove('panel-collapsed');
      const toggle = this.layerPanel.querySelector?.('.panel-collapse-toggle');
      if (toggle) toggle.textContent = '-';
    };
    container.addEventListener('click', onClick);
    this.controlDisposers.push(() => container.removeEventListener('click', onClick));
  }

  getActiveAttribute() {
    const dataset = this.inputs.attributeModel;
    const attributes = dataset?.listAttributes?.() || [];
    let active = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || dataset?.getPrimaryAttribute?.() || attributes[0] || null;
    if (active && !attributes.includes(active)) active = attributes[0] || active;
    this.params.activeAttribute = active;
    return active;
  }

  collectAttributeElements(active, { forRender = false } = {}) {
    const dataset = this.inputs.attributeModel;
    if (!dataset || !active) return [];
    const grid = dataset.grid;
    const binaryKey = this.resolveBinaryAttributeKey(dataset, active);
    if (grid && binaryKey && dataset.binaryAttributes?.[binaryKey]?.length) {
      const values = dataset.binaryAttributes[binaryKey];
      const { nx, ny, nz } = this.gridDimensions(grid);
      const total = Math.max(0, nx * ny * nz);
      const origin = grid.origin || grid.bounds?.min || [0, 0, 0];
      const cell = grid.cellSize || [1, 1, 1];
      const max = Math.max(1, Number(this.params.maxRenderedElements) || 8000);
      const step = forRender ? Math.max(1, Math.ceil(total / max)) : Math.max(1, Math.ceil(total / 200000));
      const elements = [];
      for (let index = 0; index < total; index += step) {
        const value = Number(values[index]);
        if (!Number.isFinite(value)) continue;
        const ix = index % nx;
        const iy = Math.floor(index / nx) % ny;
        const iz = Math.floor(index / (nx * ny));
        const size = {
          x: Number(cell[0] ?? cell ?? 1),
          y: Number(cell[1] ?? cell ?? 1),
          z: Number(cell[2] ?? cell ?? 1)
        };
        elements.push({
          elementId: `VOX_${ix}_${iy}_${iz}`,
          blockId: `VOX_${ix}_${iy}_${iz}`,
          gridIndex: [ix, iy, iz],
          centroid: {
            x: Number(origin[0] || 0) + (ix + 0.5) * size.x,
            y: Number(origin[1] || 0) + (iy + 0.5) * size.y,
            z: Number(origin[2] || 0) + (iz + 0.5) * size.z
          },
          size,
          [active]: value,
          value,
          activeAttribute: active
        });
      }
      return elements;
    }
    const source = dataset.listBlocks?.()?.length ? dataset.listBlocks() : dataset.elements || [];
    const max = Math.max(1, Number(this.params.maxRenderedElements) || 8000);
    const step = forRender ? Math.max(1, Math.ceil(source.length / max)) : 1;
    return source.filter((_, index) => index % step === 0).map((element) => ({
      ...element,
      value: Number(dataset.getValue?.(element.elementId ?? element.blockId, active)),
      activeAttribute: active
    }));
  }

  attributeElementLayerId(element = {}) {
    return element.seamId ?? element.seam_id ?? element.geologicalUnitId ?? element.unitId ?? element.unit_id ?? element.orebodyId ?? element.bodyId ?? element.surfaceId ?? null;
  }

  attributeLayerFilterOptions() {
    const dataset = this.inputs.attributeModel;
    const elements = dataset?.elements || dataset?.listBlocks?.() || [];
    const ids = [...new Set(elements.map((element) => this.attributeElementLayerId(element)).filter(Boolean).map(String))];
    if (!ids.length) return [];
    const body = this.inputs.geologicalBody;
    const labelFor = (id) => {
      const unit = body?.getUnit?.(id) || body?.getUnit?.(`GU_${id}`) || body?.getBody?.(id);
      if (unit) return unit.geologicalUnitName || unit.unitName || unit.bodyName || id;
      const interval = String(id).match(/^(\d+)_(\d+)$/);
      if (interval) return `Layer interval ${interval[1]}-${interval[2]}`;
      return id;
    };
    return [
      { value: 'all', label: 'All layers / seams' },
      ...ids.map((id) => ({ value: id, label: labelFor(id) }))
    ];
  }

  attributeElementMatchesLayerFilter(element) {
    const filter = this.params.seamFilter || 'all';
    if (filter === 'all') return true;
    return String(this.attributeElementLayerId(element) ?? '') === String(filter);
  }

  sampleAttributeElements(elements = [], limit = Number(this.params.maxRenderedElements) || 8000) {
    const max = Math.max(1, Number(limit) || 8000);
    if (elements.length <= max) return elements.slice();
    const step = Math.max(1, Math.ceil(elements.length / max));
    return elements.filter((_, index) => index % step === 0).slice(0, max);
  }

  mergeAttributeRenderSamples(contextElements = [], selectedElements = [], limit = Number(this.params.maxRenderedElements) || 8000) {
    const max = Math.max(1, Number(limit) || 8000);
    const selectedBudget = this.params.filterMode === 'highlight' ? Math.max(1, Math.floor(max * 0.65)) : max;
    const selectedSample = this.sampleAttributeElements(selectedElements, selectedBudget);
    if (this.params.filterMode !== 'highlight') return selectedSample;

    const merged = [];
    const seen = new Set();
    const add = (element) => {
      const id = String(element.elementId ?? element.blockId ?? element.id ?? merged.length);
      if (seen.has(id)) return;
      seen.add(id);
      merged.push(element);
    };
    selectedSample.forEach(add);
    const contextBudget = Math.max(0, max - merged.length);
    this.sampleAttributeElements(contextElements, contextBudget).forEach(add);
    return merged.slice(0, max);
  }

  computeAttributeState() {
    const active = this.getActiveAttribute();
    const all = this.collectAttributeElements(active, { forRender: false }).filter((element) => this.attributeElementMatchesLayerFilter(element));
    const baseRenderSource = this.collectAttributeElements(active, { forRender: true }).filter((element) => this.attributeElementMatchesLayerFilter(element));
    const values = all.map((element) => Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active))).filter(Number.isFinite);
    const range = geologyNumericRange(values);
    const explicitMin = optionalFiniteNumber(this.params.minValue);
    const explicitMax = optionalFiniteNumber(this.params.maxValue);
    const useManualRange = this.params.valueRangeMode === 'manual' && (explicitMin != null || explicitMax != null);
    const minValue = useManualRange ? explicitMin ?? range.min : range.min;
    const maxValue = useManualRange ? explicitMax ?? range.max : range.max;
    const filterMin = Math.min(minValue, maxValue);
    const filterMax = Math.max(minValue, maxValue);
    const isInRange = (element) => {
      const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
      return Number.isFinite(value) && value >= filterMin && value <= filterMax;
    };
    const selectedElements = all.filter(isInRange);
    const selectedValues = selectedElements.map((element) => Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active))).filter(Number.isFinite);
    const renderSource = baseRenderSource;
    this.attributeElements = all;
    this.attributeStats = {
      active,
      values,
      range,
      filterMin,
      filterMax,
      count: all.length,
      renderedCount: renderSource.length,
      filteredCount: selectedElements.length,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      filteredMean: selectedValues.length ? selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length : null
    };
    this.targetZoneResult = this.buildTargetZoneResult(selectedElements, this.attributeStats);
    this.renderedAttributeElements = renderSource;
    return { active, renderSource, isInRange, stats: this.attributeStats };
  }

  buildTargetZoneResult(elements, stats) {
    const active = stats.active;
    let volume = 0;
    let tonnage = 0;
    const bounds = new THREE.Box3();
    elements.forEach((element) => {
      const center = geologyPoint(element.centroid);
      if (Number.isFinite(center.x)) bounds.expandByPoint(center);
      const size = element.size || {};
      const cellVolume = Math.max(0, Number(size.x) || 0) * Math.max(0, Number(size.y) || 0) * Math.max(0, Number(size.z) || 0);
      volume += cellVolume;
      const density = Number(element.density ?? this.inputs.attributeModel?.getValue?.(element.elementId, 'density'));
      if (Number.isFinite(density)) tonnage += cellVolume * density;
    });
    return {
      attribute: active,
      min: stats.filterMin,
      max: stats.filterMax,
      elementIds: elements.map((element) => element.elementId ?? element.blockId),
      count: elements.length,
      volume,
      meanValue: stats.filteredMean,
      estimatedTonnage: tonnage || null,
      bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() }
    };
  }

    renderDistributionLayer() {
    if (!this.inputs.attributeModel) return;
    disposeThreeObject(this.attributeGroup);
    this.attributeGroup.clear();
    this.pickables = this.pickables.filter((object) => {
      let current = object;
      while (current) {
        if (current === this.attributeGroup) return false;
        current = current.parent;
      }
      return true;
    });
    const dataset = this.inputs.attributeModel;
    const active = this.getActiveAttribute();
    const binaryKey = this.resolveBinaryAttributeKey(dataset, active);
    const volumeMode = this.getVolumeRenderMode();
    if (dataset?.grid && binaryKey && volumeMode !== 'boundary-only') {
      const { stats } = this.computeAttributeState();
      if (this.params.valueRangeMode === 'manual') {
        const span = stats.range.max - stats.range.min || 1;
        this.params.volumeFilterMin = Math.max(0, Math.min(1, (stats.filterMin - stats.range.min) / span));
        this.params.volumeFilterMax = Math.max(0, Math.min(1, (stats.filterMax - stats.range.min) / span));
      }
      if (volumeMode === 'points') this.renderAttributeGridPoints(dataset, active, binaryKey);
      else this.renderAttributeVolume(dataset, active, binaryKey);
      return;
    }
    const { renderSource, isInRange, stats } = this.computeAttributeState();
    if (!active || !renderSource.length) return;
    const mode = this.resolveAttributeRenderMode(renderSource);
    if (mode === 'interpolated-surface') {
      this.renderAttributeInterpolatedSurface(active, renderSource, isInRange, stats);
      this.renderAttributeDistributionPoints(active, renderSource, isInRange, stats);
    } else if (mode === 'points') this.renderAttributeDistributionPoints(active, renderSource, isInRange, stats);
    else this.renderAttributeDistributionBoxes(active, renderSource, isInRange, stats);
  }

  resolveAttributeRenderMode(elements) {
    const mode = String(this.params.renderMode || this.params.blockRenderMode || 'auto');
    if (mode === 'interpolated-surface' || mode === 'surface' || mode === 'surface-samples') return 'interpolated-surface';
    if (mode === 'points' || mode === 'surface-samples') return 'points';
    if (mode === 'sampled-boxes' || mode === 'boxes') return 'sampled-boxes';
    if (mode === 'boundary-only') return 'points';
    if (this.inputs.attributeModel?.grid && Object.keys(this.inputs.attributeModel?.binaryAttributes || {}).length) return 'points';
    if (mode === 'volume' && !elements.some((element) => {
      const size = element.size || {};
      return Number(size.x) > 0 && Number(size.y) > 0 && Number(size.z) > 0;
    })) return 'interpolated-surface';
    return elements.some((element) => {
      const size = element.size || {};
      return Number(size.x) > 0 && Number(size.y) > 0 && Number(size.z) > 0;
    }) && elements.length <= Math.max(12000, Number(this.params.maxRenderedElements) || 8000)
      ? 'sampled-boxes'
      : 'points';
  }

  colorForAttributeValue(value, stats, inRange) {
    if (!Number.isFinite(value)) return new THREE.Color('#64748b');
    const colorRange = inRange && this.params.valueRangeMode === 'manual'
      ? { min: stats.filterMin, max: stats.filterMax }
      : stats.range;
    const t = (value - colorRange.min) / (colorRange.max - colorRange.min || 1);
    const color = new THREE.Color(sampleColor(this.params.colormap || 'viridis', t));
    if (!inRange && this.params.filterMode === 'highlight') {
      return color.lerp(new THREE.Color('#475569'), 0.72);
    }
    return color;
  }

  splitAttributeRenderElements(elements, isInRange) {
    const selected = [];
    const context = [];
    elements.forEach((element) => {
      if (isInRange(element)) selected.push(element);
      else context.push(element);
    });
    if (this.params.filterMode === 'highlight') {
      return {
        selected,
        context: this.params.showContextElements ? context : []
      };
    }
    return { selected, context: [] };
  }

  attributeRenderOpacity(kind) {
    if (kind === 'context') {
      const contextOpacity = Number(this.params.contextOpacity);
      return Number.isFinite(contextOpacity) ? Math.max(0.02, Math.min(0.5, contextOpacity)) : 0.12;
    }
    if (this.params.valueRangeMode !== 'manual') {
      const layerOpacity = Number(this.params.attributeLayerOpacity);
      return Number.isFinite(layerOpacity) ? Math.max(0.12, Math.min(0.72, layerOpacity)) : 0.68;
    }
    const selectedOpacity = Number(this.params.selectedOpacity);
    if (Number.isFinite(selectedOpacity)) return Math.max(0.05, Math.min(1, selectedOpacity));
    const layerOpacity = Number(this.params.attributeLayerOpacity);
    return Number.isFinite(layerOpacity) ? Math.max(0.05, Math.min(1, layerOpacity)) : 0.75;
  }

  attributeSurfaceSamples(active, elements) {
    const valid = elements
      .map((element) => {
        const center = geologyPoint(element.centroid);
        const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
        const layerId = this.attributeElementLayerId(element);
        return { element, center, value, layerId: layerId == null ? null : String(layerId) };
      })
      .filter((item) => Number.isFinite(item.center.x) && Number.isFinite(item.center.y) && Number.isFinite(item.center.z) && Number.isFinite(item.value));
    return valid;
  }

  attributeSurfaceEntriesForLayer(layerId) {
    if (!layerId || !this.geologicalSurfaceMeshIndex?.size) return [];
    const entry = this.geologicalSurfaceMeshIndex.get(String(layerId));
    if (!entry) return [];
    const seen = new Set();
    const addUnique = (items = [], output = []) => {
      items.forEach((item) => {
        if (!item?.mesh?.geometry) return;
        const key = item.mesh.uuid || `${item.surface?.surfaceId}:${item.index}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push(item);
      });
      return output;
    };
    const preferred = [];
    addUnique(entry.roof, preferred);
    addUnique(entry.surfaces?.filter((item) => {
      const type = String(item.surface?.surfaceType ?? item.surface?.surface_type ?? '').toLowerCase();
      return type.includes('roof') || type.includes('top');
    }), preferred);
    addUnique(entry.floor, preferred);
    addUnique(entry.surfaces?.filter((item) => {
      const type = String(item.surface?.surfaceType ?? item.surface?.surface_type ?? '').toLowerCase();
      return !type.includes('side') && !type.includes('cut') && !type.includes('closure');
    }), preferred);
    return preferred;
  }

  interpolateAttributeValueAtXZ(x, z, samples = [], k = 12) {
    const nearest = [];
    for (const sample of samples) {
      const dx = x - sample.center.x;
      const dz = z - sample.center.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1e-8) return sample.value;
      const item = { value: sample.value, d2 };
      let inserted = false;
      for (let i = 0; i < nearest.length; i += 1) {
        if (d2 < nearest[i].d2) {
          nearest.splice(i, 0, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) nearest.push(item);
      if (nearest.length > k) nearest.length = k;
    }
    let wSum = 0;
    let vSum = 0;
    nearest.forEach((sample) => {
      const weight = 1 / Math.max(1e-6, sample.d2);
      wSum += weight;
      vSum += sample.value * weight;
    });
    return wSum ? vSum / wSum : null;
  }

  createAttributeSurfaceDrapeMesh(active, surfaceEntry, samples, stats) {
    const sourceMesh = surfaceEntry?.mesh;
    if (!sourceMesh?.geometry) return null;
    sourceMesh.updateMatrixWorld?.(true);
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    geometry.computeVertexNormals();
    const position = geometry.attributes.position;
    if (!position?.count) {
      geometry.dispose?.();
      return null;
    }
    const span = stats.range.max - stats.range.min || 1;
    const colors = new Float32Array(position.count * 3);
    const valueNorms = new Float32Array(position.count);
    const color = new THREE.Color();
    const normal = geometry.attributes.normal;
    const bounds = new THREE.Box3().setFromBufferAttribute(position);
    const boundsSize = bounds.getSize(new THREE.Vector3());
    const normalOffset = Math.max(0.06, Math.min(1.2, boundsSize.length() * 0.0005));
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const value = this.interpolateAttributeValueAtXZ(x, z, samples);
      const valueNorm = Number.isFinite(value) ? clamp01((value - stats.range.min) / span) : 0;
      valueNorms[i] = valueNorm;
      color.set(Number.isFinite(value) ? sampleColor(this.params.colormap || 'viridis', valueNorm) : '#64748b');
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      if (normal) {
        position.setXYZ(
          i,
          position.getX(i) + normal.getX(i) * normalOffset,
          position.getY(i) + normal.getY(i) * normalOffset,
          position.getZ(i) + normal.getZ(i) * normalOffset
        );
      }
    }
    position.needsUpdate = true;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('valueNorm', new THREE.BufferAttribute(valueNorms, 1));
    const material = createAttributeSurfaceMaterial({
      ...this.params,
      selectedOpacity: Math.max(0.22, Math.min(0.86, Number(this.params.attributeLayerOpacity) || 0.62)),
      contextOpacity: this.attributeRenderOpacity('context')
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    const mesh = new THREE.Mesh(geometry, material);
    const unitId = surfaceEntry.surface?.geologicalUnitId ?? surfaceEntry.surface?.unitId ?? surfaceEntry.surface?.bodyId ?? 'surface';
    mesh.name = `attribute-interpolated-surface:${active}:${unitId}`;
    mesh.renderOrder = 26;
    mesh.userData.geologyPick = {
      type: 'geologicalAttributeSurface',
      id: `${unitId}:${active}`,
      unitId,
      surfaceId: surfaceEntry.surface?.surfaceId,
      activeAttribute: active
    };
    return mesh;
  }

  renderAttributeSurfaceDrapes(active, valid, stats) {
    if (!this.geologicalSurfaceMeshIndex?.size || valid.length < 3) return false;
    const filter = String(this.params.seamFilter || 'all');
    const groups = new Map();
    valid.forEach((sample) => {
      const layerId = filter === 'all' ? sample.layerId : filter;
      if (!layerId) return;
      if (!groups.has(layerId)) groups.set(layerId, []);
      groups.get(layerId).push(sample);
    });
    let rendered = 0;
    groups.forEach((groupSamples, layerId) => {
      if (groupSamples.length < 3) return;
      const surfaceEntry = this.attributeSurfaceEntriesForLayer(layerId)[0];
      if (!surfaceEntry) return;
      const samples = this.sampleAttributeElements(groupSamples, 2200);
      const mesh = this.createAttributeSurfaceDrapeMesh(active, surfaceEntry, samples, stats);
      if (!mesh) return;
      this.attributeGroup.add(mesh);
      rendered += 1;
    });
    return rendered > 0;
  }

  renderAttributeInterpolatedSurface(active, elements, isInRange, stats) {
    const valid = this.attributeSurfaceSamples(active, elements);
    if (this.renderAttributeSurfaceDrapes(active, valid, stats)) return;
    if (valid.length < 3) return;
    const samples = this.sampleAttributeElements(valid, 1800);
    const bounds = new THREE.Box2();
    samples.forEach((item) => bounds.expandByPoint(new THREE.Vector2(item.center.x, item.center.z)));
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector2());
    if (size.x <= 0 || size.y <= 0) return;
    const nx = Math.max(12, Math.min(58, Math.ceil(Math.sqrt(samples.length) * 1.6)));
    const ny = nx;
    const positions = [];
    const colors = [];
    const valueNorms = [];
    const indices = [];
    const span = stats.range.max - stats.range.min || 1;
    const influence = Math.max(size.x, size.y) * 0.18 || 1;
    const influence2 = influence * influence;
    const color = new THREE.Color();
    for (let iy = 0; iy < ny; iy += 1) {
      const z = bounds.min.y + (iy / (ny - 1)) * size.y;
      for (let ix = 0; ix < nx; ix += 1) {
        const x = bounds.min.x + (ix / (nx - 1)) * size.x;
        let wSum = 0;
        let ySum = 0;
        let vSum = 0;
        samples.forEach((sample) => {
          const dx = x - sample.center.x;
          const dz = z - sample.center.z;
          const d2 = dx * dx + dz * dz;
          const weight = Math.exp(-d2 / Math.max(1, influence2)) / Math.max(1e-4, d2 + 1);
          wSum += weight;
          ySum += sample.center.y * weight;
          vSum += sample.value * weight;
        });
        const y = wSum ? ySum / wSum : samples[0].center.y;
        const value = wSum ? vSum / wSum : samples[0].value;
        const valueNorm = clamp01((value - stats.range.min) / span);
        positions.push(x, y, z);
        color.set(sampleColor(this.params.colormap || 'viridis', valueNorm));
        colors.push(color.r, color.g, color.b);
        valueNorms.push(valueNorm);
      }
    }
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const a = iy * nx + ix;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('valueNorm', new THREE.Float32BufferAttribute(valueNorms, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = createAttributeSurfaceMaterial({
      ...this.params,
      selectedOpacity: Math.max(0.22, Math.min(0.8, Number(this.params.attributeLayerOpacity) || 0.58)),
      contextOpacity: this.attributeRenderOpacity('context')
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `attribute-interpolated-surface:${active}`;
    mesh.renderOrder = 20;
    this.attributeGroup.add(mesh);
  }

  renderAttributeDistributionPoints(active, elements, isInRange, stats) {
    const positions = [];
    const colors = [];
    const valueNorms = [];
    const plotted = [];
    const span = stats.range.max - stats.range.min || 1;
    elements.forEach((element) => {
      const center = geologyPoint(element.centroid);
      if (!Number.isFinite(center.x)) return;
      const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
      const valueNorm = Number.isFinite(value) ? clamp01((value - stats.range.min) / span) : 0;
      const color = new THREE.Color(Number.isFinite(value) ? sampleColor(this.params.colormap || 'viridis', valueNorm) : '#64748b');
      positions.push(center.x, center.y, center.z);
      colors.push(color.r, color.g, color.b);
      valueNorms.push(valueNorm);
      plotted.push(element);
    });
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('valueNorm', new THREE.Float32BufferAttribute(valueNorms, 1));
    const material = createAttributePointsMaterial({
      ...this.params,
      volumePointSize: Math.max(5, Math.min(18, Number(this.params.volumePointSize) || 10)),
      selectedOpacity: this.attributeRenderOpacity('selected'),
      contextOpacity: this.attributeRenderOpacity('context')
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 24;
    points.userData.geologyPick = { type: 'geologicalAttributeElementCollection', id: 'attribute-points', elements: plotted, activeAttribute: active };
    this.pickables.push(points);
    this.attributeGroup.add(points);
  }

  renderAttributeDistributionBoxes(active, elements, isInRange, stats) {
    const plotted = elements.filter((element) => Number.isFinite(geologyPoint(element.centroid).x));
    if (!plotted.length) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = createAttributeBoxMaterial({
      ...this.params,
      selectedOpacity: Math.min(this.attributeRenderOpacity('selected'), this.params.valueRangeMode === 'manual' ? 0.78 : 0.42),
      contextOpacity: this.attributeRenderOpacity('context')
    });
    const mesh = new THREE.InstancedMesh(geometry, material, plotted.length);
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();
    const instanceColors = new Float32Array(plotted.length * 3);
    const instanceValues = new Float32Array(plotted.length);
    const span = stats.range.max - stats.range.min || 1;
    plotted.forEach((element, index) => {
      const center = geologyPoint(element.centroid);
      const size = element.size || {};
      const scale = new THREE.Vector3(Number(size.x) || 6, Number(size.y) || 6, Number(size.z) || 6);
      transform.compose(center, new THREE.Quaternion(), scale);
      mesh.setMatrixAt(index, transform);
      const value = Number(element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active));
      const valueNorm = Number.isFinite(value) ? clamp01((value - stats.range.min) / span) : 0;
      color.set(Number.isFinite(value) ? sampleColor(this.params.colormap || 'viridis', valueNorm) : '#64748b');
      instanceColors.set([color.r, color.g, color.b], index * 3);
      instanceValues[index] = valueNorm;
    });
    mesh.instanceMatrix.needsUpdate = true;
    geometry.setAttribute('instanceBaseColor', new THREE.InstancedBufferAttribute(instanceColors, 3));
    geometry.setAttribute('instanceValueNorm', new THREE.InstancedBufferAttribute(instanceValues, 1));
    mesh.renderOrder = 24;
    mesh.userData.geologyPick = { type: 'geologicalAttributeElementCollection', id: 'attribute-boxes', elements: plotted, activeAttribute: active };
    this.pickables.push(mesh);
    this.attributeGroup.add(mesh);
  }

  rerenderDistribution({ panels = true } = {}) {
    this.renderDistributionLayer();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updateLegend();
    if (panels) this.updatePanels();
  }

  updatePanels() {
    if (!this.attributeStats) this.computeAttributeState();
    if (this.layerPanel) this.layerPanel.querySelector('.panel-body').innerHTML = this.attributeControlsHtml();
    if (this.correlationPanel) {
      this.correlationPanel.style.display = this.params.showHistogram ? '' : 'none';
      this.correlationPanel.querySelector('.panel-body').innerHTML = this.params.showHistogram ? this.histogramHtml() : '';
    }
    this.updateAttributeSummary();
    this.updateDetailPanel();
    this.syncAttributeControls();
    this.syncGeologyControls?.();
  }

  attributeControlsHtml({ compact = false } = {}) {
    return attributeDistributionControlsHtml(this, { compact });
  }

  histogramHtml() {
    return attributeHistogramHtml(this);
  }

  updateAttributeSummary() {
    if (!this.attributePanel) return;
    const stats = this.attributeStats || this.computeAttributeState().stats;
    const target = this.targetZoneResult;
    this.attributePanel.querySelector('.panel-body').innerHTML = `
      ${this.rows([
        ['Active attribute', stats.active],
        ['Total elements', formatScalar(stats.count, 0)],
        ['Rendered elements', formatScalar(stats.renderedCount, 0)],
        ['Filtered elements', formatScalar(stats.filteredCount, 0)],
        ['Min / max', `${formatScalar(stats.range.min)} - ${formatScalar(stats.range.max)}`],
        ['Mean', stats.mean == null ? null : formatScalar(stats.mean, 4)]
      ])}
      ${this.params.showTargetZone && target ? `<div class="geology-detail-subtitle">Target Zone</div>${this.rows([
        ['Range', `${formatScalar(target.min)} - ${formatScalar(target.max)}`],
        ['Elements', formatScalar(target.count, 0)],
        ['Mean value', target.meanValue == null ? null : formatScalar(target.meanValue, 4)],
        ['Volume', target.volume ? `${formatScalar(target.volume, 1)} m3` : null],
        ['Estimated tonnage', target.estimatedTonnage ? formatScalar(target.estimatedTonnage, 1) : null]
      ])}<button type="button" disabled>Save Target Zone (future)</button>` : ''}`;
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const stats = this.attributeStats || this.computeAttributeState().stats;
    this.legendPanel.querySelector('.panel-body').innerHTML = `
      <div class="geology-gradient">
        <span>${escapeHtml(stats.active || 'Attribute')}</span>
        <div style="background:${generateCssGradient(this.params.colormap || 'viridis')}"></div>
        <small>${formatScalar(stats.range.min)} - ${formatScalar(stats.range.max)}</small>
      </div>
      <div class="route-legend-list">
        <div class="legend-row"><span class="legend-line" style="background:#facc15"></span><span>Filtered target range</span></div>
        <div class="legend-row"><span class="legend-dot" style="background:#475569"></span><span>Context / outside range</span></div>
      </div>`;
  }

  histogramValueFromPointer(svg, event, stats) {
    const rect = svg.getBoundingClientRect?.();
    if (!rect || rect.width <= 0) return stats.filterMin ?? stats.range?.min ?? 0;
    const viewWidth = Number(svg.dataset.viewWidth) || rect.width;
    const chartLeft = Number(svg.dataset.chartLeft) || 0;
    const chartWidth = Number(svg.dataset.chartWidth) || viewWidth;
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewWidth;
    const t = clamp01((x - chartLeft) / Math.max(1, chartWidth));
    const min = Number(stats.range?.min);
    const max = Number(stats.range?.max);
    const span = Number.isFinite(max - min) ? max - min : 0;
    return (Number.isFinite(min) ? min : 0) + t * (span || 1);
  }

  updateHistogramBrushDom(svg, minValue, maxValue, stats) {
    if (!svg || !stats?.range) return;
    const min = Number(stats.range.min);
    const max = Number(stats.range.max);
    const span = max - min || 1;
    const lo = Math.max(Math.min(minValue, maxValue), min);
    const hi = Math.min(Math.max(minValue, maxValue), max);
    const chartLeft = Number(svg.dataset.chartLeft) || 0;
    const chartWidth = Number(svg.dataset.chartWidth) || Number(svg.dataset.viewWidth) || 1;
    const minT = clamp01((lo - min) / span);
    const maxT = clamp01((hi - min) / span);
    const minX = chartLeft + minT * chartWidth;
    const maxX = chartLeft + maxT * chartWidth;
    const selection = svg.querySelector('[data-histogram-selection]');
    if (selection) {
      selection.setAttribute('x', String(Math.min(minX, maxX)));
      selection.setAttribute('width', String(Math.max(1, Math.abs(maxX - minX))));
    }
    ['min', 'max'].forEach((kind) => {
      const x = kind === 'min' ? minX : maxX;
      const line = svg.querySelector(`[data-histogram-handle-line="${kind}"]`);
      if (line) {
        line.setAttribute('x1', String(x));
        line.setAttribute('x2', String(x));
      }
      const handle = svg.querySelector(`[data-histogram-handle="${kind}"]`);
      if (handle) handle.setAttribute('x', String(x - 5));
    });
    const rangeLabel = svg.querySelector('[data-histogram-range-label]');
    if (rangeLabel) rangeLabel.textContent = `${stats.active}: ${formatScalar(lo)} - ${formatScalar(hi)}`;
    const filteredLabel = svg.querySelector('[data-histogram-filtered-label]');
    if (filteredLabel) {
      const values = stats.values || [];
      const count = values.reduce((total, value) => total + (value >= lo && value <= hi ? 1 : 0), 0);
      filteredLabel.textContent = `Filtered ${count} / ${stats.count}`;
    }
  }

  isGridVolumeRenderActive() {
    const dataset = this.inputs.attributeModel;
    const active = this.params.activeAttribute || this.getActiveAttribute();
    const mode = this.getVolumeRenderMode();
    return !!(dataset?.grid && this.resolveBinaryAttributeKey(dataset, active) && mode !== 'points' && mode !== 'boundary-only');
  }

  applyHistogramRangeToVolumeFilter(minValue, maxValue, stats = this.attributeStats) {
    const range = stats?.range;
    if (!range) return false;
    const rangeMin = Number(range.min);
    const rangeMax = Number(range.max);
    if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) return false;
    const explicitMin = optionalFiniteNumber(minValue);
    const explicitMax = optionalFiniteNumber(maxValue);
    const lowInput = explicitMin ?? rangeMin;
    const highInput = explicitMax ?? rangeMax;
    const lo = Math.max(Math.min(lowInput, highInput), rangeMin);
    const hi = Math.min(Math.max(lowInput, highInput), rangeMax);
    const span = rangeMax - rangeMin || 1;
    this.params.volumeFilterMin = clamp01((lo - rangeMin) / span);
    this.params.volumeFilterMax = clamp01((hi - rangeMin) / span);
    return true;
  }

  applyLiveHistogramRange(minValue, maxValue, stats = this.attributeStats) {
    this.params.minValue = minValue;
    this.params.maxValue = maxValue;
    this.params.valueRangeMode = 'manual';
    if (!this.applyHistogramRangeToVolumeFilter(minValue, maxValue, stats)) return;
    this.updateVolumeUniforms();
    this.context?.set?.('attributeRangePreview', {
      ownerId: this.id,
      attribute: this.params.activeAttribute,
      min: minValue,
      max: maxValue,
      normalizedMin: this.params.volumeFilterMin,
      normalizedMax: this.params.volumeFilterMax,
      phase: 'preview'
    });
  }

  setHistogramRange(minValue, maxValue, { commit = false, panels = false } = {}) {
    this.params.minValue = minValue;
    this.params.maxValue = maxValue;
    this.params.valueRangeMode = 'manual';
    if (commit) {
      this.applyHistogramRangeToVolumeFilter(minValue, maxValue, this.attributeStats);
      this.suppressAttributeRangeFilter = true;
      try {
        this.context?.set?.('attributeRangeFilter', {
          ownerId: this.id,
          attribute: this.params.activeAttribute,
          min: minValue,
          max: maxValue,
          normalizedMin: this.params.volumeFilterMin,
          normalizedMax: this.params.volumeFilterMax,
          phase: 'commit'
        });
      } finally {
        this.suppressAttributeRangeFilter = false;
      }
      if (this.isGridVolumeRenderActive()) {
        const { stats } = this.computeAttributeState();
        this.applyHistogramRangeToVolumeFilter(stats.filterMin, stats.filterMax, stats);
        this.updateVolumeUniforms();
        this.updateLegend();
        this.updatePanels();
        return;
      }
      this.rerenderDistribution({ panels: true });
      return;
    }
    this.applyLiveHistogramRange(minValue, maxValue, this.attributeStats);
    if (panels) this.updatePanels();
  }

  handleAttributeHistogramPointerDown(event) {
    const svg = event.target?.closest?.('[data-attribute-histogram]');
    if (!svg || (event.button != null && event.button !== 0)) return;
    const stats = this.attributeStats || this.computeAttributeState().stats;
    if (!stats?.values?.length) return;
    const handle = event.target?.closest?.('[data-histogram-handle]')?.dataset?.histogramHandle || null;
    const anchor = this.histogramValueFromPointer(svg, event, stats);
    let nextMin = Number(stats.filterMin);
    let nextMax = Number(stats.filterMax);
    if (!Number.isFinite(nextMin)) nextMin = stats.range.min;
    if (!Number.isFinite(nextMax)) nextMax = stats.range.max;
    startRangeBrushDrag(event, {
      stopPropagation: false,
      update: (pointerEvent, phase) => {
        const value = this.histogramValueFromPointer(svg, pointerEvent, stats);
        if (handle === 'min') {
          nextMin = Math.min(value, nextMax);
        } else if (handle === 'max') {
          nextMax = Math.max(value, nextMin);
        } else {
          nextMin = Math.min(anchor, value);
          nextMax = Math.max(anchor, value);
        }
        nextMin = Math.max(stats.range.min, Math.min(stats.range.max, nextMin));
        nextMax = Math.max(stats.range.min, Math.min(stats.range.max, nextMax));
        this.updateHistogramBrushDom(svg, nextMin, nextMax, stats);
        return { min: nextMin, max: nextMax, phase };
      },
      preview: (payload) => this.applyLiveHistogramRange(payload.min, payload.max, stats),
      commit: (payload) => this.setHistogramRange(payload.min, payload.max, { commit: true })
    });
  }

  handleAttributeHistogramDoubleClick(event) {
    const svg = event.target?.closest?.('[data-attribute-histogram]');
    if (!svg) return;
    event.preventDefault();
    this.params.minValue = null;
    this.params.maxValue = null;
    this.params.valueRangeMode = 'auto';
    this.context?.set?.('attributeRangeFilter', null);
    this.rerenderDistribution({ panels: true });
  }

  handleAttributeControlChange(event) {
    const target = event.target;
    if (target?.matches?.('[data-volume-setting]')) {
      const key = target.dataset.volumeSetting;
      const previousMode = this.getVolumeRenderMode();
      const previousBlockMode = this.params.blockRenderMode;
      this.params[key] = target.type === 'number' || target.type === 'range' ? this.readBoundedNumber(target, this.params[key]) : target.value;
      if (key === 'blockRenderMode') this.params.renderMode = target.value;
      this.normalizeVolumeSettings(key);
      const nextMode = this.getVolumeRenderMode();
      if (key === 'blockRenderMode' && (previousMode !== nextMode || String(previousBlockMode) !== String(this.params.blockRenderMode))) this.rerenderDistribution();
      else {
        this.updateVolumeUniforms();
        this.updateLegend();
        this.updateAttributeSummary();
      }
      this.syncGeologyControls();
      return;
    }
    const key = target?.dataset?.attributeParam;
    if (!key) return;
    if (target.type === 'checkbox') this.params[key] = target.checked;
    else if (target.type === 'number' || target.type === 'range') this.params[key] = target.value === '' ? null : Number(target.value);
    else this.params[key] = target.value;
    if (key === 'activeAttribute') {
      this.params.minValue = null;
      this.params.maxValue = null;
      this.params.valueRangeMode = 'auto';
      this.context?.set?.('activeGeologicalAttribute', this.params.activeAttribute || null);
    }
    if (key === 'seamFilter') {
      this.applyAttributeBodyLayerFilter();
    }
    if (['showContextElements', 'showGeologicalBodyContext', 'showStructureContext', 'showRoadwayContext'].includes(key)) {
      if (this.bodyGroup) this.bodyGroup.visible = !!(this.params.showContextElements && this.params.showGeologicalBodyContext);
      if (this.structureGroup) this.structureGroup.visible = !!(this.params.showContextElements && this.params.showStructureContext);
      this.sceneManager?.setRoadwayVisibleForOwner?.(this.id, !!(this.inputs.roadway && this.params.showContextElements && this.params.showRoadwayContext));
      this.applyAttributeBodyLayerFilter();
    }
    if (['minValue', 'maxValue'].includes(key)) {
      this.setHistogramRange(this.params.minValue, this.params.maxValue, { commit: true });
      return;
    }
    this.rerenderDistribution();
  }

  handleAttributePanelClick(event) {
    if (event.target?.closest?.('[data-volume-reset]')) {
      Object.assign(this.params, {
        renderMode: 'volume',
        blockRenderMode: 'volume',
        volumeIsoValue: 0.5,
        volumeFilterMin: 0,
        volumeFilterMax: 1,
        volumeClipXMin: 0,
        volumeClipXMax: 1,
        volumeClipYMin: 0,
        volumeClipYMax: 1,
        volumeClipZMin: 0,
        volumeClipZMax: 1,
        volumeOpacity: 0.5,
        volumeRaySteps: 200,
        volumePointSize: 7
      });
      this.rerenderDistribution();
      return;
    }
    if (event.target?.closest?.('[data-attribute-reset-range]')) {
      this.params.minValue = null;
      this.params.maxValue = null;
      this.params.valueRangeMode = 'auto';
      this.rerenderDistribution();
    }
  }

  syncAttributeControls() {
    [this.layerPanel, this.correlationPanel].forEach((panel) => {
      panel?.querySelectorAll?.('[data-attribute-param]').forEach((input) => {
        const key = input.dataset.attributeParam;
        if (input.type === 'checkbox') input.checked = !!this.params[key];
        else if (key in this.params && this.params[key] != null && input.value !== String(this.params[key])) input.value = this.params[key];
      });
    });
  }

  handleGeologyPick(entity) {
    if (entity.type === 'geologicalVolume') {
      const voxel = this.pickVolumeVoxel(entity);
      if (voxel) this.setSelection('geologicalAttributeElement', voxel.elementId, voxel);
      else this.clearAttributeSelection();
      return;
    }
    if (entity.type === 'geologicalAttributeElementCollection' && entity.elements?.length && Number.isInteger(entity.index)) {
      const element = entity.elements[entity.index] || entity.elements[0];
      if (element) this.setSelection('geologicalAttributeElement', element.elementId ?? element.blockId, element);
      return;
    }
    if (entity.type === 'geologicalBlockCollection' && entity.elements?.length && Number.isInteger(entity.index)) {
      const element = entity.elements[entity.index] || entity.elements[0];
      if (element) this.setSelection('geologicalAttributeElement', element.elementId ?? element.blockId, element);
      return;
    }
    this.setSelection(entity.type, entity.id, entity);
  }

  clearAttributeSelection() {
    this.selected = null;
    this.context?.set?.('selectedAttributeElement', null);
    this.context?.set?.('selectedBlock', null);
    this.context?.set?.('selection', null);
    this.resetVolumePick?.();
    this.updateHighlight();
    this.updateDetailPanel();
  }

  setSelection(type, id, extra = {}) {
    if (!id) return;
    this.selected = { type, id, data: extra };
    if (type === 'geologicalAttributeElement') {
      this.context?.set?.('selectedAttributeElement', id);
      this.context?.set?.('selectedBlock', id);
    }
    this.context?.set?.('selection', { type, id, data: extra });
    this.updateHighlight();
    this.updateDetailPanel();
  }

  applyContextSelection(selection) {
    if (!selection || !selection.type || !selection.id) {
      this.selected = null;
      this.resetVolumePick?.();
      this.updateHighlight();
      this.updateDetailPanel();
      return;
    }
    if (!['geologicalAttributeElement', 'geologicalBlock', 'geologicalUnit', 'geologicalSurface'].includes(selection.type)) return;
    this.selected = selection.type === 'geologicalBlock' ? { ...selection, type: 'geologicalAttributeElement' } : selection;
    this.updateHighlight();
    this.updateDetailPanel();
  }

  matchesSelection(pick) {
    if (!this.selected || !pick) return false;
    if (this.selected.type === 'geologicalAttributeElement') {
      return pick.elementId === this.selected.id || pick.blockId === this.selected.id || pick.id === this.selected.id;
    }
    return GeologicalModelOverviewRuntime.prototype.matchesSelection.call(this, pick);
  }

  updateHighlight() {
    GeologicalModelOverviewRuntime.prototype.updateHighlight.call(this);
    if (!this.selected || this.selected.type !== 'geologicalAttributeElement') return;
    const element = this.selected.data || this.attributeElements.find((item) => String(item.elementId ?? item.blockId) === String(this.selected.id));
    if (!element?.centroid) return;
    const center = geologyPoint(element.centroid);
    const size = element.size || {};
    const radius = Math.max(Number(size.x) || 6, Number(size.y) || 6, Number(size.z) || 6, 6) * 0.75;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 18, 10),
      new THREE.MeshBasicMaterial({ color: '#facc15', wireframe: true, transparent: true, opacity: 0.95, depthTest: false })
    );
    marker.position.copy(center);
    marker.renderOrder = 60;
    this.highlightGroup.add(marker);
  }

  updateDetailPanel() {
    if (!this.detailPanel) return;
    this.detailPanel.querySelector('.panel-body').innerHTML = this.detailHtml(this.selected);
  }

  detailHtml(selection) {
    if (!selection) return '<div class="empty-state">Select an attribute element to inspect values.</div>';
    if (selection.type === 'geologicalAttributeElement') {
      const element = selection.data || this.attributeElements.find((item) => String(item.elementId ?? item.blockId) === String(selection.id));
      const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
      const active = this.getActiveAttribute();
      const rows = [
        ['Element ID', selection.id],
        ['Position', element?.centroid ? `${formatScalar(element.centroid.x)}, ${formatScalar(element.centroid.y)}, ${formatScalar(element.centroid.z)}` : null],
        ['Size', element?.size ? `${formatScalar(element.size.x)}, ${formatScalar(element.size.y)}, ${formatScalar(element.size.z)}` : null],
        ['Active attribute', active],
        ['Active value', element ? (element.value ?? this.inputs.attributeModel?.getValue?.(element.elementId, active)) : null],
        ['Lithology', element?.lithology],
        ['Orebody / unit', element?.orebodyId ?? element?.bodyId ?? element?.seamId],
        ['Resource category', element?.resourceCategory ?? element?.category]
      ];
      const valueRows = attributes
        .map((name) => [name, element ? (element[name] ?? this.inputs.attributeModel?.getValue?.(element.elementId, name)) : null])
        .filter(([, value]) => value != null && value !== '');
      return `${this.rows(rows)}${valueRows.length ? `<div class="geology-detail-subtitle">All attributes</div>${this.rows(valueRows)}` : ''}`;
    }
    return GeologicalModelOverviewRuntime.prototype.detailHtml.call(this, selection);
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    this.sceneManager?.clearRoadwayOwnerState?.(this.id);
    [this.layerPanel, this.correlationPanel, this.attributePanel, this.detailPanel, this.legendPanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

composeRuntimePrototype(GeologicalAttributeDistributionAnalysisRuntime, GeologicalModelOverviewRuntime);
