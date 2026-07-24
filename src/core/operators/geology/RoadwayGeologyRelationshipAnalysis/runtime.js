import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import { resizeCanvasToDisplaySize } from '../../shared/CanvasViewUtils.js';
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

import { RoadwayGeologyRelationshipInputRequirements } from '../contracts.js';
import { optionalFiniteNumber, clamp01 } from '../runtimeUtils.js';
import { GeologicalModelOverviewRuntime } from '../GeologicalModelOverview/runtime.js';
import { composeRuntimePrototype, initializeRuntimeCapability } from '../../shared/RuntimeComposition.js';
import { loadRoadwayDataset } from '../../shared/OperatorRuntimeUtils.js';

export class RoadwayGeologyRelationshipAnalysisRuntime {
  constructor(nodeModel, inputs = {}) {
    initializeRuntimeCapability(this, GeologicalModelOverviewRuntime, nodeModel, inputs);
    this.label = nodeModel.label || 'Roadway-Geology Relationship Analysis';
    this.params = {
      analysisMode: 'risk-level',
      showRoadwayOverlay: true,
      showGeologicalBodyContext: true,
      showStructures: true,
      showBoreholes: false,
      showProfile: true,
      activeAttribute: null,
      structureWarningDistance: 50,
      structureCriticalDistance: 20,
      attributeThreshold: null,
      attributeRiskDirection: 'high',
      colorMode: 'risk-level',
      sampleInterval: 10,
      maxSamplesPerEdge: 20,
      filterRiskLevel: 'all',
      filterGeologicalUnit: 'all',
      filterStructureProximity: 'all',
      roadwayOverlayOpacity: 0.9,
      contextOpacity: 0.2,
      autoCreateSectionFromSelectedRoadway: false,
      showRoadway: true,
      showGeologicalBody: true,
      showAttributeModel: false,
      geologicalBodyOpacity: 0.2,
      structureOpacity: 0.55,
      boreholeOpacity: 0.9,
      ...(nodeModel.params || {})
    };
    this.relationResult = null;
    this.mapHitEdges = [];
  }

  validateSemanticInputs() {
    const roadway = this.inputs.roadway;
    if (!roadway) throw new Error('Missing semantic dataset input: roadway');
    const actualClass = roadway.contract?.class || roadway.semanticClass;
    if (actualClass !== 'Roadway') throw new Error(`Input roadway expects Roadway, got ${actualClass}.`);
    Object.entries(RoadwayGeologyRelationshipInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Roadway-Geology Relationship] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  async renderAllLayers() {
    await this.initializeRoadwayContext();
    this.computeRelations();
    if (this.inputs.geologicalBody && this.params.showGeologicalBodyContext) await this.renderGeologicalBodyLayer();
    if (this.inputs.geologicalStructure && this.params.showStructures) await this.renderStructureLayer();
    if (this.inputs.borehole && this.params.showBoreholes) this.renderBoreholeLayer();
    this.renderRelationshipOverlay();
  }

  async initializeRoadwayContext() {
    const roadway = this.inputs.roadway;
    if (!roadway) return;
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayVisibleForOwner?.(this.id, true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacityForOwner?.(this.id, 0.16);
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Roadway-Geology Controls', 'geology-panel roadway-geology-control-panel', '<div class="panel-body"></div>');
    this.correlationPanel = createWorkspacePanel('Roadway-Geology Map View', 'geology-panel roadway-geology-map-panel', '<canvas class="roadway-geology-map" width="680" height="360"></canvas>');
    this.attributePanel = createWorkspacePanel('Roadway Geological Profile', 'geology-panel roadway-geology-profile-panel', '<div class="panel-body"></div>');
    this.detailPanel = createWorkspacePanel('Roadway-Geology Relation Table', 'geology-panel roadway-geology-table-panel', '<div class="panel-body"></div>');
    this.legendPanel = createWorkspacePanel('Roadway-Geology Legend / Summary', 'geology-panel roadway-geology-legend-panel', '<div class="panel-body"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '340px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '548px', width: '320px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '92px', width: '420px' });
    Object.assign(this.attributePanel.style, { right: '330px', top: '540px', width: '420px' });
    Object.assign(this.correlationPanel.style, { left: '380px', bottom: '28px', top: 'auto', width: '700px', maxHeight: '430px' });
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-context-layer`,
      label: 'Roadway Context Layer',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      contributionKind: 'layer',
      semanticRole: 'context',
      objectSystem: 'roadway',
      visualChannels: { opacity: 'contextOpacity' },
      composition: { mergePolicy: 'reuse', focusBehavior: 'context', defaultOpacity: 0.16, canPin: true },
      visible: true,
      opacity: 0.16,
      show: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner?.(this.id, Number(value)),
      focus: () => this.sceneManager.focusOnRoadway?.(),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, false)
    });
    this.registerSceneContribution('roadway-geology-overlay', '3D Roadway-Geology Relationship Overlay', this.attributeGroup, 'roadway', 'diagnostic', this.params.roadwayOverlayOpacity, {
      visualChannels: { color: 'roadwayGeologyRelation', halo: 'riskLevel' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: this.params.roadwayOverlayOpacity, canPin: true }
    });
    if (this.inputs.geologicalBody && this.params.showGeologicalBodyContext) this.registerSceneContribution('roadway-geology-body-context', 'Geological Body Context', this.bodyGroup, 'geologicalBody', 'context', this.params.contextOpacity);
    if (this.inputs.geologicalStructure && this.params.showStructures) this.registerSceneContribution('roadway-geology-structure-context', 'Geological Structure Context', this.structureGroup, 'geologicalStructure', 'context', this.params.contextOpacity);
    [
      ['controls', 'Control Panel', this.layerPanel, 'panel', 'control', 'right-panel'],
      ['map', 'Roadway-Geology Topology / Map View', this.correlationPanel, 'topology-view', 'detail', 'bottom-panel'],
      ['profile', 'Roadway Geological Profile Panel', this.attributePanel, 'panel', 'detail', 'bottom-panel'],
      ['table', 'Roadway-Geology Relation Table', this.detailPanel, 'panel', 'detail', 'right-panel'],
      ['legend', 'Legend / Summary', this.legendPanel, 'legend', 'legend', 'legend']
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
        objectSystem: 'roadwayGeologyRelation',
        element: panel,
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        onResize: () => {
          if (panel === this.correlationPanel) this.drawMap();
        },
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context?.subscribe?.('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context?.subscribe?.('activeGeologicalAttribute', (attribute) => {
      if (attribute && attribute !== this.params.activeAttribute) {
        this.params.activeAttribute = attribute;
        this.recomputeAndRender();
      }
    }));
    const changeHandler = (event) => this.handleRelationshipControlChange(event);
    const clickHandler = (event) => this.handleRelationshipClick(event);
    [this.layerPanel, this.detailPanel, this.correlationPanel].forEach((panel) => {
      panel?.addEventListener?.('change', changeHandler);
      panel?.addEventListener?.('input', changeHandler);
      panel?.addEventListener?.('click', clickHandler);
      this.controlDisposers.push(() => {
        panel?.removeEventListener?.('change', changeHandler);
        panel?.removeEventListener?.('input', changeHandler);
        panel?.removeEventListener?.('click', clickHandler);
      });
    });
  }

  renderControls(container) {
    container.innerHTML = `
      <div class="panel-title">Roadway-Geology Relationship</div>
      <div class="muted-note">Use the floating Roadway-Geology Controls panel for analysis mode, thresholds, filters, and section handoff.</div>
      <div class="geology-quick-actions">
        <button type="button" data-action="show-roadway-geology-controls">Show Controls</button>
      </div>
    `;
    const onClick = (event) => {
      if (event.target?.dataset?.action !== 'show-roadway-geology-controls') return;
      if (!this.layerPanel) return;
      this.layerPanel.style.display = 'block';
      this.layerPanel.classList.remove('panel-collapsed');
      const toggle = this.layerPanel.querySelector?.('.panel-collapse-toggle');
      if (toggle) toggle.textContent = '-';
    };
    container.addEventListener('click', onClick);
    this.controlDisposers.push(() => container.removeEventListener('click', onClick));
  }

  activeAttribute() {
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const active = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || this.inputs.attributeModel?.getPrimaryAttribute?.() || attributes[0] || null;
    this.params.activeAttribute = active;
    return active;
  }

  computeRelations() {
    this.relationResult = buildRoadwayGeologyRelationResult({
      roadway: this.inputs.roadway,
      geologicalBody: this.inputs.geologicalBody,
      geologicalStructure: this.inputs.geologicalStructure,
      attributeModel: this.inputs.attributeModel,
      borehole: this.inputs.borehole,
      activeAttribute: this.activeAttribute(),
      params: this.params
    });
    return this.relationResult;
  }

  recomputeAndRender() {
    this.computeRelations();
    this.renderRelationshipOverlay();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updatePanels();
    this.updateLegend();
  }

  renderRelationshipOverlay() {
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
    if (!this.params.showRoadwayOverlay) return;
    const relations = this.filteredRelations();
    relations.forEach((relation) => {
      if (!relation.path?.length || relation.path.length < 2) return;
      const points = relation.path.map((point) => new THREE.Vector3(point.x, point.y + 1.5, point.z));
      const curve = new THREE.CatmullRomCurve3(points);
      const radius = relation.riskLevel === 'high' ? 2.4 : relation.riskLevel === 'medium' ? 1.9 : 1.45;
      const geometry = new THREE.TubeGeometry(curve, Math.max(4, points.length * 6), radius, 8, false);
      const selected = this.selected?.type === 'roadwaySegment' && this.selected.id === relation.edgeId;
      const material = new THREE.MeshBasicMaterial({
        color: selected ? '#facc15' : this.colorForRelation(relation),
        transparent: true,
        opacity: Number(this.params.roadwayOverlayOpacity) || 0.9,
        depthTest: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = selected ? 55 : 40;
      mesh.userData.geologyPick = { type: 'roadwaySegment', id: relation.edgeId, edgeId: relation.edgeId, relation };
      this.pickables.push(mesh);
      this.attributeGroup.add(mesh);
    });
  }

  colorForRelation(relation) {
    const mode = this.params.colorMode || this.params.analysisMode;
    if (mode === 'geological-unit') return relation.dominantGeologicalUnit ? geologyColorForKey(relation.dominantGeologicalUnit) : '#94a3b8';
    if (mode === 'structure-distance') {
      const d = Number(relation.distanceToStructure);
      if (!Number.isFinite(d)) return '#94a3b8';
      if (d < Number(this.params.structureCriticalDistance)) return '#ef4444';
      if (d < Number(this.params.structureWarningDistance)) return '#f59e0b';
      return '#22c55e';
    }
    if (mode === 'active-attribute') {
      const values = this.relationResult?.relations?.map((item) => Number(item.activeAttributeValue)).filter(Number.isFinite) || [];
      const range = geologyNumericRange(values);
      const value = Number(relation.activeAttributeValue);
      return Number.isFinite(value) ? sampleColor('viridis', (value - range.min) / (range.max - range.min || 1)) : '#94a3b8';
    }
    if (mode === 'uniform') return '#38bdf8';
    return relation.riskLevel === 'high' ? '#ef4444' : relation.riskLevel === 'medium' ? '#f59e0b' : '#22c55e';
  }

  filteredRelations() {
    const rows = this.relationResult?.relations || [];
    return rows.filter((relation) => {
      if (this.params.filterRiskLevel !== 'all' && relation.riskLevel !== this.params.filterRiskLevel) return false;
      if (this.params.filterGeologicalUnit !== 'all' && relation.dominantGeologicalUnit !== this.params.filterGeologicalUnit) return false;
      if (this.params.filterStructureProximity === 'near' && !(relation.distanceToStructure < Number(this.params.structureWarningDistance))) return false;
      if (this.params.filterStructureProximity === 'critical' && !(relation.distanceToStructure < Number(this.params.structureCriticalDistance))) return false;
      return true;
    });
  }

  updatePanels() {
    if (!this.relationResult) this.computeRelations();
    if (this.layerPanel) this.layerPanel.querySelector('.panel-body').innerHTML = this.controlsHtml();
    if (this.detailPanel) this.detailPanel.querySelector('.panel-body').innerHTML = this.tableHtml();
    if (this.attributePanel) {
      this.attributePanel.style.display = this.params.showProfile ? '' : 'none';
      this.attributePanel.querySelector('.panel-body').innerHTML = this.profileHtml();
    }
    this.drawMap();
    this.updateLegend();
  }

  controlsHtml({ compact = false } = {}) {
    return roadwayGeologyControlsHtml(this, { compact });
  }

  tableHtml() {
    return roadwayGeologyTableHtml(this);
  }

  detailRowsHtml(edgeId) {
    const relation = this.relationResult?.edgeRelations?.get(edgeId);
    if (!relation) return '';
    return `<div class="geology-detail-subtitle">Selected Segment</div>${this.rows([
      ['Edge ID', relation.edgeId],
      ['Length', `${formatScalar(relation.length, 1)} m`],
      ['Dominant geological unit', relation.dominantGeologicalUnit],
      ['Nearest structure', relation.nearestStructureId],
      ['Structure type', relation.nearestStructureType],
      ['Distance to structure', relation.distanceToStructure == null ? null : `${formatScalar(relation.distanceToStructure, 1)} m`],
      [`${this.params.activeAttribute || 'Attribute'} mean`, relation.activeAttributeValue == null ? null : formatScalar(relation.activeAttributeValue, 4)],
      ['Risk level', relation.riskLevel],
      ['Nearby boreholes', relation.nearbyBoreholes.map((item) => item.boreholeId).join(', ')],
      ['Recommendation', relation.recommendation]
    ])}`;
  }

  profileHtml() {
    const relation = this.relationResult?.edgeRelations?.get(this.selected?.id) || this.filteredRelations()[0];
    if (!relation) return '<div class="empty-state">No roadway relation profile available.</div>';
    const width = 390;
    const height = 180;
    const left = 42;
    const right = 16;
    const top = 18;
    const bottom = 28;
    const samples = relation.samplePoints || [];
    const values = samples.map((sample) => Number(sample.attributeValue)).filter(Number.isFinite);
    const range = geologyNumericRange(values);
    const points = samples
      .filter((sample) => Number.isFinite(Number(sample.attributeValue)))
      .map((sample) => {
        const x = left + (sample.distance / Math.max(1, relation.length)) * (width - left - right);
        const t = (Number(sample.attributeValue) - range.min) / (range.max - range.min || 1);
        const y = top + (1 - t) * (height - top - bottom);
        return `${x},${y}`;
      })
      .join(' ');
    return `
      <div><strong>${escapeHtml(relation.edgeId)}</strong> <span class="muted-note">${escapeHtml(relation.riskLevel)}</span></div>
      <svg viewBox="0 0 ${width} ${height}" role="img">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#101722" />
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#64748b" />
        <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#64748b" />
        ${points ? `<polyline points="${points}" fill="none" stroke="#38bdf8" stroke-width="2.5" />` : ''}
        ${relation.distanceToStructure != null ? `<line x1="${left}" y1="${top + 10}" x2="${width - right}" y2="${top + 10}" stroke="#f59e0b" stroke-dasharray="5 4" />` : ''}
        <text x="${left}" y="${height - 8}" fill="#a7b4c5" font-size="11">Distance along roadway</text>
        <text x="${left + 4}" y="${top + 12}" fill="#a7b4c5" font-size="11">${escapeHtml(this.params.activeAttribute || 'attribute')}</text>
      </svg>`;
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const summary = this.relationResult?.summary || {};
    this.legendPanel.querySelector('.panel-body').innerHTML = `
      <div class="route-legend-list">
        <div class="legend-row"><span class="legend-dot" style="background:#22c55e"></span><span>Low risk</span></div>
        <div class="legend-row"><span class="legend-dot" style="background:#f59e0b"></span><span>Medium risk / warning</span></div>
        <div class="legend-row"><span class="legend-dot" style="background:#ef4444"></span><span>High risk / critical</span></div>
        <div class="legend-row"><span class="legend-line" style="background:#facc15"></span><span>Selected roadway segment</span></div>
      </div>
      ${this.rows([
        ['Total length', summary.totalLength == null ? null : `${formatScalar(summary.totalLength, 1)} m`],
        ['High-risk length', summary.highRiskLength == null ? null : `${formatScalar(summary.highRiskLength, 1)} m`],
        ['Medium-risk length', summary.mediumRiskLength == null ? null : `${formatScalar(summary.mediumRiskLength, 1)} m`],
        ['Edges near structures', summary.nearStructureCount],
        ['Attribute threshold exceeded', summary.thresholdExceededCount]
      ])}`;
  }

  drawMap() {
    const canvas = this.correlationPanel?.querySelector?.('canvas.roadway-geology-map');
    if (!canvas || !this.relationResult) return;
    const { ctx, width, height } = resizeCanvasToDisplaySize(canvas, 680, 360);
    const relations = this.filteredRelations();
    const points = relations.flatMap((relation) => relation.path || []);
    if (!points.length) return;
    const xs = points.map((point) => point.x);
    const zs = points.map((point) => point.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const pad = 26;
    const sx = (width - pad * 2) / Math.max(1, maxX - minX);
    const sz = (height - pad * 2) / Math.max(1, maxZ - minZ);
    const scale = Math.min(sx, sz);
    const map = (point) => ({ x: pad + (point.x - minX) * scale, y: height - pad - (point.z - minZ) * scale });
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0f1722';
    ctx.fillRect(0, 0, width, height);
    this.mapHitEdges = [];
    relations.forEach((relation) => {
      const mapped = relation.path.map(map);
      ctx.beginPath();
      mapped.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.strokeStyle = relation.edgeId === this.selected?.id ? '#facc15' : this.colorForRelation(relation);
      ctx.lineWidth = relation.edgeId === this.selected?.id ? 5 : 3;
      ctx.lineCap = 'round';
      ctx.stroke();
      this.mapHitEdges.push({ edgeId: relation.edgeId, points: mapped });
    });
  }

  handleRelationshipControlChange(event) {
    const target = event.target;
    const key = target?.dataset?.rgParam;
    if (!key) return;
    if (target.type === 'checkbox') this.params[key] = target.checked;
    else if (target.type === 'number' || target.type === 'range') this.params[key] = target.value === '' ? null : Number(target.value);
    else this.params[key] = target.value;
    if (key === 'activeAttribute') this.context?.set?.('activeGeologicalAttribute', this.params.activeAttribute || null);
    if (key === 'analysisMode') this.context?.set?.('roadwayGeologyAnalysisMode', this.params.analysisMode);
    if (['showGeologicalBodyContext', 'showStructures', 'showBoreholes'].includes(key)) {
      if (this.bodyGroup) this.bodyGroup.visible = !!this.params.showGeologicalBodyContext;
      if (this.structureGroup) this.structureGroup.visible = !!this.params.showStructures;
      if (this.boreholeGroup) this.boreholeGroup.visible = !!this.params.showBoreholes;
    }
    this.recomputeAndRender();
  }

  handleRelationshipClick(event) {
    const row = event.target?.closest?.('[data-rg-edge]');
    if (row) {
      this.setSelection('roadwaySegment', row.dataset.rgEdge, {});
      return;
    }
    if (event.target?.closest?.('[data-rg-create-section]')) this.createSectionNearSelectedRoadway();
    if (event.currentTarget === this.correlationPanel && event.target?.matches?.('canvas.roadway-geology-map')) this.handleMapClick(event);
  }

  handleMapClick(event) {
    const rect = event.target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    this.mapHitEdges.forEach((entry) => {
      for (let i = 1; i < entry.points.length; i += 1) {
        const d = pointToCanvasSegmentDistance({ x, y }, entry.points[i - 1], entry.points[i]);
        if (!best || d < best.distance) best = { edgeId: entry.edgeId, distance: d };
      }
    });
    if (best && best.distance < 10) this.setSelection('roadwaySegment', best.edgeId, {});
    else this.applyContextSelection(null);
  }

  handleGeologyPick(entity) {
    if (entity.type === 'roadwaySegment') {
      this.setSelection('roadwaySegment', entity.edgeId || entity.id, entity);
      return;
    }
    GeologicalModelOverviewRuntime.prototype.handleGeologyPick.call(this, entity);
  }

  setSelection(type, id, extra = {}) {
    if (!id) return;
    this.selected = { type, id, data: extra };
    if (type === 'roadwaySegment') this.context?.set?.('selectedRoadwaySegment', id);
    this.context?.set?.('selection', { type, id, data: extra });
    this.renderRelationshipOverlay();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updatePanels();
  }

  applyContextSelection(selection) {
    if (!selection || !selection.type || !selection.id) {
      this.selected = null;
      this.renderRelationshipOverlay();
      this.updatePanels();
      return;
    }
    if (!['roadwaySegment', 'roadwayHazardSegment'].includes(selection.type)) return;
    this.selected = { type: 'roadwaySegment', id: selection.id, data: selection.data };
    this.renderRelationshipOverlay();
    this.updatePanels();
  }

  createSectionNearSelectedRoadway() {
    const relation = this.relationResult?.edgeRelations?.get(this.selected?.id);
    const path = relation?.path || [];
    if (path.length < 2) return;
    const frame = createSectionFrame({
      sectionMode: 'vertical-two-point',
      verticalLinePointA: path[0],
      verticalLinePointB: path[path.length - 1],
      thickness: Math.max(5, Number(this.params.sampleInterval) || 10)
    });
    this.context?.set?.('sectionFrame', frame);
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

function pointToCanvasSegmentDistance(point, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const denom = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / denom));
  return Math.hypot(point.x - (a.x + vx * t), point.y - (a.y + vy * t));
}

composeRuntimePrototype(RoadwayGeologyRelationshipAnalysisRuntime, GeologicalModelOverviewRuntime);
