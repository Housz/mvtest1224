import * as THREE from 'three';
import { cloneObjObject, parseObjAsync } from '../../../../scene/AsyncObjParser.js';
import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import { RuntimeTooltip } from '../../../../ui/RuntimeTooltip.js';
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

import { GeologicalSectionAnalysisInputRequirements } from '../contracts.js';
import { optionalFiniteNumber, clamp01 } from '../runtimeUtils.js';
import { GeologicalModelOverviewRuntime } from '../GeologicalModelOverview/runtime.js';
import { composeRuntimePrototype, initializeRuntimeCapability } from '../../shared/RuntimeComposition.js';

export class GeologicalSectionAnalysisRuntime {
  constructor(nodeModel, inputs = {}) {
    initializeRuntimeCapability(this, GeologicalModelOverviewRuntime, nodeModel, inputs);
    this.label = nodeModel.label || 'Geological Section Analysis';
    this.hasExplicitPosition = nodeModel.params?.position != null && Number(nodeModel.params.position) !== 0;
    this.params = {
      sectionMode: 'axis-aligned',
      axis: 'X',
      position: 0,
      thickness: 5,
      verticalLinePointA: null,
      verticalLinePointB: null,
      showCutaway: true,
      clippingSide: 'positive',
      showSectionPlane: true,
      showGeologicalBody: true,
      showRoadway: true,
      showBoreholes: true,
      showStructures: true,
      showAttributeModel: true,
      geologicalBodyOpacity: 0.28,
      roadwayOpacity: 0.35,
      boreholeOpacity: 1,
      structureOpacity: 0.82,
      attributeModelOpacity: 0.82,
      activeAttribute: null,
      colorMode: 'geological-unit',
      autoUpdate: true,
      maxRenderedBlocksInSection: 5000,
      sectionViewPlacement: 'bottom-panel',
      ...(nodeModel.params || {})
    };
    this.sectionHitItems = [];
    this.sectionResult = null;
    this.sectionFrame = null;
    this.modelBounds = new THREE.Box3();
    this.bodyObjText = '';
    this.structureObjText = '';
    this.bodyObjectTemplate = null;
    this.structureObjectTemplate = null;
    this.recomputeTimer = null;
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    this.createSectionGroups();
    await this.initializeRoadwayContext();
    this.bodyObjText = await this.loadObjText(this.inputs.geologicalBody);
    this.structureObjText = this.inputs.geologicalStructure ? await this.loadObjText(this.inputs.geologicalStructure) : '';
    [this.bodyObjectTemplate, this.structureObjectTemplate] = await Promise.all([
      this.bodyObjText ? parseObjAsync(this.bodyObjText) : null,
      this.structureObjText ? parseObjAsync(this.structureObjText) : null
    ]);
    this.modelBounds = this.computeModelBounds();
    this.applyDefaultSectionPosition();
    this.computeAndRenderSection();
    this.createSectionPanels();
    this.registerSectionContributions();
    this.installSectionHandlers();
    this.updateSectionPanels();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    if (this.params.autoFocusOnSelection && this.rootGroup.children.length) this.sceneManager?.focusOnObject?.(this.rootGroup);
    return { cleanup: () => this.cleanup() };
  }

  validateSemanticInputs() {
    const body = this.inputs.geologicalBody;
    if (!body) throw new Error('Missing semantic dataset input: geologicalBody');
    const actualClass = body.contract?.class || body.semanticClass;
    if (actualClass !== 'GeologicalBody') throw new Error(`Input geologicalBody expects GeologicalBody, got ${actualClass}.`);
    Object.entries(GeologicalSectionAnalysisInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Geological Section Analysis] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  createSectionGroups() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = `${this.id}:geological-section-analysis`;
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.name = 'section-geological-body-context';
    this.sectionGroup = new THREE.Group();
    this.sectionGroup.name = 'geological-section-layer';
    this.boreholeGroup = new THREE.Group();
    this.boreholeGroup.name = 'section-borehole-projections';
    this.structureGroup = new THREE.Group();
    this.structureGroup.name = 'section-structure-projections';
    this.attributeGroup = new THREE.Group();
    this.attributeGroup.name = 'section-attribute-slice';
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'section-selection-highlight';
    this.rootGroup.add(this.bodyGroup, this.sectionGroup, this.attributeGroup, this.boreholeGroup, this.structureGroup, this.highlightGroup);
    this.sceneManager.scene.add(this.rootGroup);
    this.sceneManager.raycaster.params.Line = { threshold: 6 };
    this.sceneManager.raycaster.params.Points = { threshold: 10 };
  }

  applyDefaultSectionPosition() {
    if (this.hasExplicitPosition || this.modelBounds.isEmpty()) return;
    const axis = String(this.params.axis || 'X').toLowerCase();
    this.params.position = this.modelBounds.getCenter(new THREE.Vector3())[axis] ?? 0;
  }

  computeModelBounds() {
    const box = new THREE.Box3();
    const expand = (point) => box.expandByPoint(geologyPoint(point));
    if (this.bodyObjectTemplate) {
      this.bodyObjectTemplate.updateMatrixWorld(true);
      box.expandByObject(this.bodyObjectTemplate);
    }
    (this.inputs.attributeModel?.listBlocks?.() || []).slice(0, 10000).forEach((block) => expand(block.centroid ?? block));
    const grid = this.inputs.attributeModel?.grid;
    if (grid) {
      const min = Array.isArray(grid.bounds?.min) ? grid.bounds.min : grid.origin || [0, 0, 0];
      const max = Array.isArray(grid.bounds?.max) ? grid.bounds.max : null;
      expand({ x: min[0], y: min[1], z: min[2] });
      if (max) expand({ x: max[0], y: max[1], z: max[2] });
    }
    (this.inputs.borehole?.listBoreholes?.() || []).forEach((borehole) => {
      (this.inputs.borehole.getTrajectory?.(borehole.boreholeId) || []).forEach(expand);
    });
    (this.inputs.roadway?.getEdges?.() || []).forEach((edge) => roadwayEdgePath(this.inputs.roadway, edge).forEach(expand));
    if (box.isEmpty()) box.expandByPoint(new THREE.Vector3(-500, -500, -500)).expandByPoint(new THREE.Vector3(500, 500, 500));
    return box;
  }

  computeAndRenderSection() {
    const activeAttribute = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || this.inputs.attributeModel?.getPrimaryAttribute?.();
    this.params.activeAttribute = activeAttribute || null;
    this.sectionFrame = createSectionFrame(this.params);
    this.sectionResult = buildGeologicalSectionResult({
      geologicalBody: this.inputs.geologicalBody,
      roadway: this.inputs.roadway,
      borehole: this.inputs.borehole,
      geologicalStructure: this.inputs.geologicalStructure,
      attributeModel: this.inputs.attributeModel,
      sectionFrame: this.sectionFrame,
      activeAttribute,
      maxRenderedBlocksInSection: this.params.maxRenderedBlocksInSection,
      geologicalBodyObjText: this.bodyObjText,
      structureObjText: this.structureObjText,
      geologicalBodyObject: this.bodyObjectTemplate,
      structureObject: this.structureObjectTemplate
    });
    this.context?.set?.('sectionFrame', this.sectionFrame.toPlainObject());
    this.render3DSection();
    this.updateSectionPanels();
  }

  scheduleSectionUpdate({ immediate = false } = {}) {
    window.clearTimeout(this.recomputeTimer);
    const update = () => this.computeAndRenderSection();
    if (immediate) update();
    else if (this.params.autoUpdate) this.recomputeTimer = window.setTimeout(update, 90);
    else this.updateSectionPanels();
  }

  render3DSection() {
    [this.bodyGroup, this.sectionGroup, this.attributeGroup, this.boreholeGroup, this.structureGroup, this.highlightGroup].forEach((group) => {
      disposeThreeObject(group);
      group.clear();
    });
    this.pickables = [];
    this.renderCutawayBodyContext();
    this.renderSectionPlane();
    this.renderSectionIntersections3D();
    this.applySectionLayerState();
    this.updateHighlight();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
  }

  renderCutawayBodyContext() {
    if (!this.params.showGeologicalBody || !this.bodyObjectTemplate) return;
    const object = cloneObjObject(this.bodyObjectTemplate);
    object.updateMatrixWorld(true);
    const surfaces = this.inputs.geologicalBody?.listSurfaces?.() || [];
    const surfaceByMesh = new Map();
    surfaces.forEach((surface, index) => {
      [surface.meshPartId, surface.mesh_part_id, surface.name, surface.surfaceId].filter(Boolean).forEach((key) => surfaceByMesh.set(String(key), { surface, index }));
    });
    const clipPlane = this.sectionFrame?.plane?.();
    if (clipPlane && this.params.clippingSide === 'negative') clipPlane.negate();
    const capGroup = new THREE.Group();
    capGroup.name = 'section-stencil-caps';
    let fallbackIndex = 0;
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.computeVertexNormals?.();
      const matched = geometryObjectNames(child).map((name) => surfaceByMesh.get(name)).find(Boolean);
      const surface = matched?.surface || surfaces[fallbackIndex] || { surfaceId: child.name || `SURF_${fallbackIndex + 1}`, surfaceType: 'surface' };
      const index = matched?.index ?? fallbackIndex;
      fallbackIndex += 1;
      const surfaceColor = this.colorForSurface(surface, index);
      const material = this.createGeologicalBodyMaterial(this.colorForSurface(surface, index), Number(this.params.geologicalBodyOpacity));
      const pickData = {
        type: 'geologicalSurface',
        id: surface.surfaceId,
        surfaceId: surface.surfaceId,
        unitId: surface.geologicalUnitId ?? surface.unitId,
        bodyId: surface.bodyId,
        label: surface.surfaceId
      };
      child.userData.geologyPick = pickData;
      if (this.params.showCutaway && this.params.clippingSide !== 'both' && clipPlane) {
        material.clippingPlanes = [clipPlane];
        material.clipShadows = true;
        this.createStencilCapForMesh(child, surfaceColor, clipPlane, 30 + index * 3).forEach((mesh) => capGroup.add(mesh));
      }
      child.material = material;
      this.configureGeologicalBodyMesh(child, Number(this.params.geologicalBodyOpacity));
      this.pickables.push(child);
    });
    this.bodyGroup.add(object);
    if (capGroup.children.length) this.bodyGroup.add(capGroup);
  }

  createStencilCapForMesh(sourceMesh, color, clipPlane, renderOrder = 30) {
    if (!sourceMesh?.geometry || !this.sectionFrame) return [];
    const geometry = sourceMesh.geometry.clone();
    sourceMesh.updateMatrixWorld?.(true);
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    const makeStencilMaterial = (side, op) => {
      const material = new THREE.MeshBasicMaterial({
        depthWrite: false,
        depthTest: false,
        colorWrite: false,
        side,
        clippingPlanes: [clipPlane],
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op
      });
      return material;
    };
    const back = new THREE.Mesh(geometry, makeStencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp));
    const front = new THREE.Mesh(geometry.clone(), makeStencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp));
    back.renderOrder = renderOrder;
    front.renderOrder = renderOrder + 1;
    const bounds = this.sectionViewBounds();
    const spanU = Math.max(120, bounds.maxX - bounds.minX + 120);
    const spanV = Math.max(120, bounds.maxY - bounds.minY + 120);
    const capGeometry = this.createSectionPlaneGeometry(spanU, spanV);
    const capMaterial = new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: Math.min(0.92, Math.max(0.55, Number(this.params.geologicalBodyOpacity) + 0.25)),
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp
    });
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.renderOrder = renderOrder + 2;
    cap.userData.geologyPick = {
      type: sourceMesh.userData?.geologyPick?.type || 'geologicalSurface',
      id: sourceMesh.userData?.geologyPick?.id,
      surfaceId: sourceMesh.userData?.geologyPick?.surfaceId,
      unitId: sourceMesh.userData?.geologyPick?.unitId,
      label: sourceMesh.userData?.geologyPick?.label
    };
    this.pickables.push(cap);
    return [back, front, cap];
  }

  createSectionPlaneGeometry(spanU = 500, spanV = 500) {
    const origin = this.sectionFrame.origin;
    const u = this.sectionFrame.u;
    const v = this.sectionFrame.v;
    const corners = [
      origin.clone().addScaledVector(u, -spanU / 2).addScaledVector(v, -spanV / 2),
      origin.clone().addScaledVector(u, spanU / 2).addScaledVector(v, -spanV / 2),
      origin.clone().addScaledVector(u, spanU / 2).addScaledVector(v, spanV / 2),
      origin.clone().addScaledVector(u, -spanU / 2).addScaledVector(v, spanV / 2)
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    return geometry;
  }

  sectionViewBounds() {
    const points = [];
    const add = (item) => (item.points || []).forEach((point) => {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
    });
    (this.sectionResult?.geologicalIntersections || []).forEach(add);
    (this.sectionResult?.boreholeProjections || []).forEach(add);
    (this.sectionResult?.structureIntersections || []).forEach(add);
    (this.sectionResult?.roadwayProjections || []).forEach(add);
    (this.sectionResult?.blockSliceElements || []).forEach((block) => points.push({ x: block.x, y: block.y }));
    if (!points.length) return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    return {
      minX: Math.min(...points.map((point) => point.x)),
      maxX: Math.max(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)),
      maxY: Math.max(...points.map((point) => point.y))
    };
  }

  renderSectionPlane() {
    if (!this.params.showSectionPlane || !this.sectionFrame) return;
    const bounds = this.sectionViewBounds();
    const spanU = Math.max(120, bounds.maxX - bounds.minX + 120);
    const spanV = Math.max(120, bounds.maxY - bounds.minY + 120);
    const geometry = this.createSectionPlaneGeometry(spanU, spanV);
    const material = new THREE.MeshBasicMaterial({
      color: '#67e8f9',
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.name = 'geological-section-plane';
    plane.renderOrder = 48;
    this.sectionGroup.add(plane);
    const position = geometry.attributes.position;
    const corners = [0, 1, 2, 3, 0].map((index) => new THREE.Vector3().fromBufferAttribute(position, index));
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(corners);
    const edge = new THREE.Line(edgeGeometry, new THREE.LineBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.76, depthTest: false }));
    edge.renderOrder = 49;
    this.sectionGroup.add(edge);
  }

  renderLine3D(group, points3D = [], color = '#ffffff', userData = {}, width = 1) {
    const points = points3D.map(geologyPoint);
    if (points.length < 2) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 54 + width;
    line.userData.geologyPick = userData;
    group.add(line);
    this.pickables.push(line);
    return line;
  }

  render3DBlockMarker(block) {
    const center = geologyPoint(block.centroid);
    const size = block.size || {};
    const radius = Math.max(2, Math.min(8, Math.max(Number(size.x) || 4, Number(size.y) || 4, Number(size.z) || 4) * 0.18));
    const color = block.normalizedValue != null ? sampleColor('viridis', block.normalizedValue) : '#35d0ff';
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(radius, radius, radius), material);
    mesh.position.copy(center);
    mesh.renderOrder = 58;
    mesh.userData.geologyPick = { type: 'geologicalBlock', id: block.id, blockId: block.blockId, label: block.id, data: block };
    this.attributeGroup.add(mesh);
    this.pickables.push(mesh);
  }

  renderSectionIntersections3D() {
    (this.sectionResult?.geologicalIntersections || []).forEach((line, index) => {
      const surface = this.inputs.geologicalBody?.surfaceMap?.get?.(String(line.surfaceId));
      this.renderLine3D(this.sectionGroup, line.points3D, this.colorForSurface(surface || line, index), {
        type: 'geologicalSurface',
        id: line.surfaceId || line.id,
        surfaceId: line.surfaceId || line.id,
        unitId: line.unitId,
        label: line.surfaceId || line.id
      });
    });
    (this.sectionResult?.blockSliceElements || []).slice(0, Number(this.params.maxRenderedBlocksInSection) || 5000).forEach((block) => this.render3DBlockMarker(block));
    (this.sectionResult?.boreholeProjections || []).forEach((item) => {
      this.renderLine3D(this.boreholeGroup, item.points3D, '#66d9ef', { type: 'borehole', id: item.boreholeId, boreholeId: item.boreholeId, label: item.label }, 2);
    });
    (this.sectionResult?.structureIntersections || []).forEach((item, index) => {
      this.renderLine3D(this.structureGroup, item.points3D, geologyColorForKey(item.structureType || 'fault', index + 4), {
        type: 'geologicalStructure',
        id: item.structureId || item.id,
        structureId: item.structureId || item.id,
        label: item.label
      });
    });
    (this.sectionResult?.roadwayProjections || []).forEach((item) => {
      this.renderLine3D(this.sectionGroup, item.points3D, '#b5b9bf', { type: 'roadwaySegment', id: item.roadwayEdgeId, roadwayEdgeId: item.roadwayEdgeId, label: item.roadwayEdgeId });
    });
  }

  applySectionLayerState() {
    this.bodyGroup.visible = !!this.params.showGeologicalBody;
    this.attributeGroup.visible = !!this.params.showAttributeModel;
    this.boreholeGroup.visible = !!this.params.showBoreholes;
    this.structureGroup.visible = !!this.params.showStructures;
    this.sectionGroup.visible = true;
    this.sceneManager?.setRoadwayVisibleForOwner?.(this.id, !!this.params.showRoadway && !!this.inputs.roadway);
  }

  createSectionPanels() {
    this.sectionTooltip?.dispose?.();
    this.sectionViewPanel = createWorkspacePanel('2D Geological Section View', 'geological-section-view-panel', '<canvas class="geological-section-canvas" width="720" height="390"></canvas>');
    this.layerPanel = createWorkspacePanel('Section Control Panel', 'geological-section-control-panel', '<div class="geological-section-control-content"></div>');
    this.legendPanel = createWorkspacePanel('Section Legend', 'geological-section-legend-panel', '<div class="geology-legend-content"></div>');
    this.detailPanel = createWorkspacePanel('Section Summary / Detail', 'geological-section-detail-panel', '<div class="geology-detail-content"></div>');
    this.attributePanel = null;
    Object.assign(this.sectionViewPanel.style, { left: '18px', bottom: '24px', width: '760px' });
    Object.assign(this.layerPanel.style, { right: '330px', top: '92px', width: '360px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '92px', width: '280px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '520px', width: '330px' });
    this.sectionCanvas = this.sectionViewPanel.querySelector('.geological-section-canvas');
    this.sectionTooltip = new RuntimeTooltip({ className: 'geological-section-runtime-tooltip' });
  }

  registerSectionContributions() {
    this.registerSceneContribution('section-layer', '3D Geological Section Layer', this.sectionGroup, 'geologicalSection', 'analysis', 0.8, {
      visualChannels: { color: 'geologicalUnitOrAttribute', opacity: 'sectionOpacity' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: 0.8, canPin: true }
    });
    this.registerSceneContribution('section-body-context', 'Section Geological Body Context', this.bodyGroup, 'geologicalBody', 'context', this.params.geologicalBodyOpacity, {
      composition: { mergePolicy: 'compose', focusBehavior: 'context', defaultOpacity: this.params.geologicalBodyOpacity, canPin: true }
    });
    if (this.inputs.borehole) this.registerSceneContribution('section-boreholes', 'Section Borehole Projection Layer', this.boreholeGroup, 'borehole', 'context', this.params.boreholeOpacity);
    if (this.inputs.geologicalStructure) this.registerSceneContribution('section-structures', 'Section Structure Projection Layer', this.structureGroup, 'geologicalStructure', 'annotation', this.params.structureOpacity);
    if (this.inputs.attributeModel) this.registerSceneContribution('section-attributes', 'Section Attribute Slice Layer', this.attributeGroup, 'geologicalAttributeModel', 'state', this.params.attributeModelOpacity);
    [
      ['section-view', '2D Geological Section View', this.sectionViewPanel, 'panel', 'detail', 'bottom-panel'],
      ['section-controls', 'Section Control Panel', this.layerPanel, 'control', 'control', 'right-panel'],
      ['section-legend', 'Section Legend', this.legendPanel, 'legend', 'legend', 'legend'],
      ['section-detail', 'Section Summary / Detail Panel', this.detailPanel, 'panel', 'detail', 'right-panel']
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
        objectSystem: 'geologicalSection',
        element: panel,
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        onResize: () => {
          if (panel === this.sectionViewPanel) this.renderSectionCanvas();
        },
        cleanup: () => panel.remove()
      });
    });
  }

  installSectionHandlers() {
    this.disposers.push(this.context.subscribe('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context.subscribe('activeGeologicalAttribute', (attribute) => {
      this.params.activeAttribute = attribute;
      this.scheduleSectionUpdate({ immediate: true });
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
    }));
    const change = (event) => this.handleSectionControlChange(event);
    const click = (event) => this.handleSectionControlClick(event);
    this.layerPanel.addEventListener('change', change);
    this.layerPanel.addEventListener('input', change);
    this.layerPanel.addEventListener('click', click);
    this.installSectionCanvasHandlers();
  }

  installSectionCanvasHandlers() {
    if (!this.sectionCanvas) return;
    const pointer = (event) => {
      const hit = this.findSectionCanvasHit(event);
      this.updateSectionTooltip(event, hit);
      this.renderSectionCanvas(hit);
    };
    const click = (event) => {
      const hit = this.findSectionCanvasHit(event);
      if (!hit) {
        this.clearGeologicalSelection();
        return;
      }
      this.setSectionSelection(hit.element);
    };
    const leave = () => {
      this.sectionTooltip?.hide?.();
      this.renderSectionCanvas();
    };
    const deactivate = () => this.sectionTooltip?.hide?.();
    this.sectionCanvas.addEventListener('pointermove', pointer);
    this.sectionCanvas.addEventListener('click', click);
    this.sectionCanvas.addEventListener('pointerleave', leave);
    this.sectionViewPanel.addEventListener('minevis:panel-deactivate', deactivate);
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('pointermove', pointer));
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('click', click));
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('pointerleave', leave));
    this.disposers.push(() => this.sectionViewPanel?.removeEventListener('minevis:panel-deactivate', deactivate));
  }

  positionRangeForAxis() {
    const axis = String(this.params.axis || 'X').toLowerCase();
    if (!this.modelBounds || this.modelBounds.isEmpty()) return { min: -500, max: 500 };
    return { min: this.modelBounds.min[axis] ?? -500, max: this.modelBounds.max[axis] ?? 500 };
  }

  sectionControlsHtml() {
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.() || '';
    const range = this.positionRangeForAxis();
    return `
      <div class="geology-panel-summary">
        <span>${escapeHtml(this.sectionFrame?.mode || this.params.sectionMode)}</span>
        <span>${escapeHtml(this.params.axis)}</span>
        <span>${formatScalar(this.params.position)}</span>
      </div>
      <label class="field-row">Mode
        <select data-section-param="sectionMode">
          ${['axis-aligned', 'vertical-two-point'].map((mode) => `<option value="${mode}" ${this.params.sectionMode === mode ? 'selected' : ''}>${mode === 'axis-aligned' ? 'Axis-aligned' : 'Vertical two-point'}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Axis
        <select data-section-param="axis" ${this.params.sectionMode === 'vertical-two-point' ? 'disabled' : ''}>
          ${['X', 'Y', 'Z'].map((axis) => `<option value="${axis}" ${this.params.axis === axis ? 'selected' : ''}>${axis}</option>`).join('')}
        </select>
      </label>
      ${this.compactSliderRow({ key: 'position', label: 'Position', min: Math.floor(range.min), max: Math.ceil(range.max), step: 1, digits: 1, dataAttr: 'data-section-param' })}
      ${this.compactSliderRow({ key: 'thickness', label: 'Thickness', min: 1, max: 120, step: 1, digits: 1, dataAttr: 'data-section-param' })}
      <div class="geology-control-stack">
        ${this.layerToggle('showGeologicalBody', 'Geological body')}
        ${this.inputs.roadway ? this.layerToggle('showRoadway', 'Roadway') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute model') : ''}
        ${this.layerToggle('showSectionPlane', 'Section plane')}
        ${this.layerToggle('showCutaway', 'Cutaway body')}
        ${this.layerToggle('autoUpdate', 'Auto update')}
      </div>
      <label class="field-row">Cutaway side
        <select data-section-param="clippingSide">
          ${['positive', 'negative', 'both'].map((side) => `<option value="${side}" ${this.params.clippingSide === side ? 'selected' : ''}>${side}</option>`).join('')}
        </select>
      </label>
      <label class="field-row">Color by
        <select data-color-mode>
          ${['geological-unit', 'lithology', 'attribute', 'uniform'].map((mode) => `<option value="${mode}" ${this.params.colorMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}
        </select>
      </label>
      ${this.inputs.attributeModel ? `<label class="field-row">Active attribute
        <select data-active-attribute>${attributes.map((attribute) => `<option value="${escapeHtml(attribute)}" ${String(active) === String(attribute) ? 'selected' : ''}>${escapeHtml(attribute)}</option>`).join('')}</select>
      </label>` : ''}
      ${this.inputs.attributeModel ? this.compactSliderRow({ key: 'maxRenderedBlocksInSection', label: 'Max section blocks', min: 100, max: 50000, step: 100, digits: 0, dataAttr: 'data-section-param' }) : ''}
      ${this.params.sectionMode === 'vertical-two-point' ? this.verticalPointControlsHtml() : ''}
      <div class="geology-quick-actions">
        <button type="button" data-section-recompute>Recompute section</button>
        <button type="button" data-focus-geology-model>Focus section</button>
      </div>
      ${this.params.sectionMode === 'vertical-two-point' ? '<div class="muted-note">3D pick Point A/B is reserved for a later update; numeric points are active now.</div>' : ''}
    `;
  }

  verticalPointControlsHtml() {
    const pointA = this.params.verticalLinePointA || { x: -100, y: 0, z: 0 };
    const pointB = this.params.verticalLinePointB || { x: 100, y: 0, z: 0 };
    const field = (key, axis, value) => `<label class="field-row">${axis.toUpperCase()}<input data-section-point="${key}:${axis}" type="number" step="1" value="${formatScalar(value, 2)}"></label>`;
    return `
      <div class="geology-volume-controls">
        <div class="geology-volume-header"><strong>Vertical Section Points</strong></div>
        <div class="geology-volume-grid">
          ${field('verticalLinePointA', 'x', pointA.x)}
          ${field('verticalLinePointA', 'y', pointA.y)}
          ${field('verticalLinePointA', 'z', pointA.z)}
          ${field('verticalLinePointB', 'x', pointB.x)}
          ${field('verticalLinePointB', 'y', pointB.y)}
          ${field('verticalLinePointB', 'z', pointB.z)}
        </div>
      </div>
    `;
  }

  updateSectionPanels() {
    if (this.layerPanel?.isConnected) {
      this.layerPanel.querySelector('.geological-section-control-content').innerHTML = this.sectionControlsHtml();
      this.syncSectionControls();
    }
    this.updateLegend();
    this.updateDetailPanel();
    this.renderSectionCanvas();
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlContainer = container;
    container.innerHTML = `
      <div class="panel-title">${escapeHtml(this.label)}</div>
      <div class="geology-quick-note">Adjust the section frame and inspect the generated 2D geological section.</div>
      <div class="control-grid geology-quick-fields">
        <label class="field-row">Axis
          <select data-section-param="axis">${['X', 'Y', 'Z'].map((axis) => `<option value="${axis}" ${this.params.axis === axis ? 'selected' : ''}>${axis}</option>`).join('')}</select>
        </label>
        <label class="field-row">Thickness
          <input data-section-param="thickness" type="number" min="1" step="1" value="${formatScalar(this.params.thickness, 1)}">
        </label>
      </div>
      <div class="geology-quick-toggles">
        ${this.layerToggle('showGeologicalBody', 'Body')}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
      </div>
      <div class="geology-quick-actions"><button type="button" data-section-recompute>Recompute section</button></div>
    `;
    const change = (event) => this.handleSectionControlChange(event);
    const click = (event) => this.handleSectionControlClick(event);
    container.addEventListener('change', change);
    container.addEventListener('input', change);
    container.addEventListener('click', click);
    this.controlDisposers.push(() => container.removeEventListener('change', change));
    this.controlDisposers.push(() => container.removeEventListener('input', change));
    this.controlDisposers.push(() => container.removeEventListener('click', click));
  }

  handleSectionControlChange(event) {
    const target = event.target;
    if (target.matches('[data-toggle-layer]')) {
      this.params[target.dataset.toggleLayer] = target.checked;
      this.applySectionLayerState();
      this.renderSectionCanvas();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    if (target.matches('[data-section-param]')) {
      const key = target.dataset.sectionParam;
      this.params[key] = target.type === 'number' || target.type === 'range' ? this.readBoundedNumber(target, this.params[key]) : target.value;
      if (key === 'axis' && !this.hasExplicitPosition) this.applyDefaultSectionPosition();
      this.scheduleSectionUpdate();
      return;
    }
    if (target.matches('[data-section-point]')) {
      const [key, axis] = String(target.dataset.sectionPoint || '').split(':');
      if (!key || !axis) return;
      const nextPoint = { ...(this.params[key] || (key.endsWith('A') ? { x: -100, y: 0, z: 0 } : { x: 100, y: 0, z: 0 })) };
      nextPoint[axis] = this.readBoundedNumber(target, nextPoint[axis]);
      this.params[key] = nextPoint;
      this.scheduleSectionUpdate();
      return;
    }
    if (target.matches('[data-color-mode]')) {
      this.params.colorMode = target.value;
      this.computeAndRenderSection();
      return;
    }
    if (target.matches('[data-active-attribute]')) {
      this.context.set('activeGeologicalAttribute', target.value);
    }
  }

  handleSectionControlClick(event) {
    if (event.target.closest('[data-section-recompute]')) {
      this.computeAndRenderSection();
      return;
    }
    if (event.target.closest('[data-focus-geology-model]')) {
      this.sceneManager.focusOnObject?.(this.rootGroup);
    }
  }

  syncSectionControls() {
    const roots = [this.layerPanel, this.controlContainer].filter((root) => root?.isConnected);
    roots.forEach((root) => {
      root.querySelectorAll('[data-section-param="position"]').forEach((input) => {
        if (input === document.activeElement && input.type === 'range') return;
        input.value = formatScalar(this.params.position, 1);
      });
      root.querySelectorAll('[data-section-param="thickness"]').forEach((input) => {
        if (input === document.activeElement && input.type === 'range') return;
        input.value = formatScalar(this.params.thickness, 1);
      });
      root.querySelectorAll('[data-section-param="maxRenderedBlocksInSection"]').forEach((input) => {
        input.value = Math.round(Number(this.params.maxRenderedBlocksInSection) || 5000);
      });
    });
  }

  canvasTransform(width, height) {
    const bounds = this.sectionViewBounds();
    const padding = 28;
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
    const offsetX = (width - spanX * scale) * 0.5;
    const offsetY = (height - spanY * scale) * 0.5;
    return (point) => ({
      x: offsetX + (point.x - bounds.minX) * scale,
      y: height - (offsetY + (point.y - bounds.minY) * scale)
    });
  }

  renderSectionCanvas(hover = null) {
    if (!this.sectionCanvas) return;
    const canvas = this.sectionCanvas;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(560, Math.round(rect.width || canvas.clientWidth || 720));
    const height = Math.max(300, Math.round(rect.height || canvas.clientHeight || 390));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#071018';
    ctx.fillRect(0, 0, width, height);
    const toCanvas = this.canvasTransform(width, height);
    this.sectionHitItems = [];
    this.drawSectionGrid(ctx, width, height);
    (this.params.showAttributeModel ? this.sectionResult?.blockSliceElements || [] : []).forEach((block) => this.drawSectionBlock(ctx, toCanvas, block));
    (this.params.showGeologicalBody ? this.sectionResult?.geologicalIntersections || [] : []).forEach((line, index) => this.drawSectionPolyline(ctx, toCanvas, line, this.colorForCanvasSurface(line, index), 2.2));
    (this.params.showRoadway ? this.sectionResult?.roadwayProjections || [] : []).forEach((line) => this.drawSectionPolyline(ctx, toCanvas, line, '#b5b9bf', 2.5, [6, 4]));
    (this.params.showStructures ? this.sectionResult?.structureIntersections || [] : []).forEach((line, index) => this.drawSectionPolyline(ctx, toCanvas, line, geologyColorForKey(line.structureType || 'fault', index + 4), 3, [8, 4]));
    (this.params.showBoreholes ? this.sectionResult?.boreholeProjections || [] : []).forEach((line) => this.drawSectionPolyline(ctx, toCanvas, line, '#66d9ef', 3.4));
    if (hover?.element) this.drawSectionHover(ctx, toCanvas, hover.element);
    if (this.selected) this.drawSelectedSectionElement(ctx, toCanvas);
  }

  drawSectionGrid(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
    ctx.lineWidth = 1;
    for (let x = 24; x < width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 24; y < height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(226,232,240,0.72)';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${this.params.sectionMode} ${this.params.axis} @ ${formatScalar(this.params.position, 1)}, thickness ${formatScalar(this.params.thickness, 1)}`, 16, 22);
    ctx.restore();
  }

  colorForCanvasSurface(line, index) {
    const surface = this.inputs.geologicalBody?.surfaceMap?.get?.(String(line.surfaceId));
    return this.colorForSurface(surface || line, index);
  }

  drawSectionPolyline(ctx, toCanvas, element, color, width = 2, dash = []) {
    const points = (element.points || []).map(toCanvas);
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
    ctx.restore();
    this.sectionHitItems.push({ kind: 'polyline', points, element });
  }

  drawSectionBlock(ctx, toCanvas, block) {
    if (!Number.isFinite(block.x) || !Number.isFinite(block.y)) return;
    const point = toCanvas(block);
    const size = 5;
    const color = block.normalizedValue != null ? sampleColor('viridis', block.normalizedValue) : '#38bdf8';
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.fillRect(point.x - size * 0.5, point.y - size * 0.5, size, size);
    ctx.restore();
    this.sectionHitItems.push({ kind: 'point', x: point.x, y: point.y, radius: 7, element: block });
  }

  drawSectionHover(ctx, toCanvas, element) {
    ctx.save();
    ctx.strokeStyle = '#facc15';
    ctx.fillStyle = 'rgba(250,204,21,0.14)';
    ctx.lineWidth = 3;
    if (element.points?.length >= 2) {
      const points = element.points.map(toCanvas);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
    } else if (Number.isFinite(element.x) && Number.isFinite(element.y)) {
      const point = toCanvas(element);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSelectedSectionElement(ctx, toCanvas) {
    const selectedId = String(this.selected?.id ?? '');
    if (!selectedId) return;
    const elements = [
      ...(this.sectionResult?.geologicalIntersections || []),
      ...(this.sectionResult?.blockSliceElements || []),
      ...(this.sectionResult?.boreholeProjections || []),
      ...(this.sectionResult?.structureIntersections || []),
      ...(this.sectionResult?.roadwayProjections || [])
    ];
    elements
      .filter((item) => [item.id, item.surfaceId, item.boreholeId, item.structureId, item.blockId, item.roadwayEdgeId].some((value) => String(value ?? '') === selectedId))
      .forEach((item) => this.drawSectionHover(ctx, toCanvas, item));
  }

  findSectionCanvasHit(event) {
    const rect = this.sectionCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = null;
    let bestDistance = Infinity;
    this.sectionHitItems.forEach((item) => {
      const distance = item.kind === 'point' ? Math.hypot(item.x - x, item.y - y) : this.distanceToPolyline(x, y, item.points);
      const threshold = item.kind === 'point' ? item.radius : 8;
      if (distance <= threshold && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    });
    return best;
  }

  distanceToPolyline(x, y, points = []) {
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq));
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
    }
    return best;
  }

  updateSectionTooltip(event, hit) {
    if (!this.sectionTooltip) return;
    if (!hit) {
      this.sectionTooltip.hide();
      return;
    }
    this.sectionTooltip.showHtml(this.tooltipHtml(hit.element), event.clientX, event.clientY);
  }

  tooltipHtml(element) {
    const rows = [
      ['Type', element.type],
      ['ID', element.id || element.surfaceId || element.blockId || element.boreholeId || element.structureId || element.roadwayEdgeId],
      ['Unit', element.unitId],
      ['Surface', element.surfaceType],
      ['Attribute', element.activeAttribute],
      ['Value', element.value != null ? formatScalar(element.value, 4) : null]
    ].filter(([, value]) => value != null && value !== '');
    return rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  }

  setSectionSelection(element) {
    const type = element.type === 'roadwaySegment' ? 'roadwaySegment' : element.type;
    const id = element.surfaceId || element.boreholeId || element.structureId || element.blockId || element.roadwayEdgeId || element.id;
    if (type === 'roadwaySegment') {
      this.context.set('selectedRoadwaySegment', String(id));
      this.context.set('selection', { type: 'roadwaySegment', id: String(id), data: element });
      return;
    }
    this.context.set('selectedSectionElement', { type, id: String(id), data: element });
    this.setSelection(type, id, element);
  }

  updateLegend() {
    if (!this.legendPanel) return;
    const units = this.inputs.geologicalBody?.listUnits?.() || [];
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    const rows = this.params.colorMode === 'attribute' && active
      ? `<div class="geology-gradient"><span>${escapeHtml(active)}</span><div style="background:linear-gradient(90deg,#0a5bff,#00a9ff,#35d35d,#f4df38,#f97316,#ef4444)"></div><small>section attribute values</small></div>`
      : units
          .slice(0, 12)
          .map((unit, index) => `<div><span class="legend-dot" style="background:${escapeHtml(unit.color || geologyColorForKey(unit.geologicalUnitType ?? unit.geologicalUnitId, index))}"></span>${escapeHtml(unit.geologicalUnitName)}</div>`)
          .join('');
    this.legendPanel.querySelector('.geology-legend-content').innerHTML = `
      <div class="route-legend-list">${rows || '<div class="muted-note">No legend entries</div>'}</div>
      <div class="geology-symbols">
        <div><span class="legend-dot" style="background:#67e8f9"></span>Section plane / borehole</div>
        <div><span class="legend-dot" style="background:#ff6f61"></span>Structure / fault</div>
        <div><span class="legend-dot" style="background:#b5b9bf"></span>Roadway</div>
      </div>
    `;
  }

  updateDetailPanel() {
    const content = this.detailPanel?.querySelector('.geology-detail-content');
    if (!content) return;
    const summary = this.sectionResult?.summary || {};
    const summaryHtml = this.rows([
      ['Mode', this.sectionFrame?.mode],
      ['Axis', this.params.axis],
      ['Position', formatScalar(this.params.position, 2)],
      ['Thickness', formatScalar(this.params.thickness, 2)],
      ['Geological lines', summary.geologicalLineCount],
      ['Blocks in section', summary.blockCount],
      ['Boreholes', summary.boreholeCount],
      ['Structures', summary.structureCount],
      ['Roadway crossings', summary.roadwayCount],
      ['Active attribute', summary.activeAttribute]
    ]);
    if (!this.selected) {
      content.innerHTML = `<div class="geology-detail-subtitle">Section Summary</div>${summaryHtml}<div class="empty-state">Click a section element to inspect details.</div>`;
      return;
    }
    content.innerHTML = `<div class="geology-detail-subtitle">Selected Element</div>${this.detailHtml(this.selected)}<div class="geology-detail-subtitle">Section Summary</div>${summaryHtml}`;
  }

  applyContextSelection(selection) {
    if (!selection || (!(String(selection.type || '').startsWith('geological')) && selection.type !== 'borehole' && selection.type !== 'roadwaySegment')) {
      this.selected = null;
      this.updateHighlight();
      this.updateDetailPanel();
      this.renderSectionCanvas();
      return;
    }
    this.selected = selection;
    this.updateHighlight();
    this.updateDetailPanel();
    this.renderSectionCanvas();
  }

  updateHighlight() {
    this.highlightGroup?.clear?.();
    [this.bodyGroup, this.sectionGroup, this.attributeGroup, this.boreholeGroup, this.structureGroup].forEach((group) => {
      group?.traverse?.((child) => {
        if (!child.userData?.geologyPick) return;
        this.restoreMaterial(child);
        if (this.matchesSelection(child.userData.geologyPick)) this.highlightMaterial(child);
      });
    });
  }

  matchesSelection(pick = {}) {
    if (this.selected?.type === 'roadwaySegment') return String(pick.roadwayEdgeId ?? pick.id) === String(this.selected.id);
    if (this.selected?.type === 'geologicalBlock') return String(pick.blockId ?? pick.id) === String(this.selected.id);
    return GeologicalModelOverviewRuntime.prototype.matchesSelection.call(this, pick);
  }

  cleanup() {
    window.clearTimeout(this.recomputeTimer);
    this.sectionTooltip?.dispose?.();
    this.sectionTooltip = null;
    GeologicalModelOverviewRuntime.prototype.cleanup.call(this);
    this.sectionViewPanel?.remove?.();
  }
}

composeRuntimePrototype(GeologicalSectionAnalysisRuntime, GeologicalModelOverviewRuntime);
