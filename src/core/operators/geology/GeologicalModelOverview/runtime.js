import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parseObjAsync } from '../../../../scene/AsyncObjParser.js';
import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import { legendEmptyState, legendGradient, legendList } from '../../../../ui/RuntimeLegends.js';
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

import { GeologicalModelOverviewInputRequirements } from '../contracts.js';
import { optionalFiniteNumber, clamp01 } from '../runtimeUtils.js';
import { loadRoadwayDataset } from '../../shared/OperatorRuntimeUtils.js';
import { nowMs, yieldToMainThread } from '../../../runtime/CooperativeTaskScheduler.js';

export class GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.params = {
      showGeologicalBody: true,
      showRoadway: true,
      showBoreholes: true,
      showStructures: true,
      showAttributeModel: false,
      geologicalBodyOpacity: 0.55,
      roadwayOpacity: 0.25,
      boreholeOpacity: 1,
      structureOpacity: 0.7,
      attributeModelOpacity: 0.65,
      colorMode: 'geological-unit',
      activeAttribute: null,
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
      volumePointSize: 7,
      showLabels: false,
      showSelectedLabel: true,
      autoFocusOnSelection: true,
      ...(nodeModel.params || {})
    };
    if (this.params.blockRenderMode === 'sampled-boxes') this.params.blockRenderMode = 'volume';
    this.disposers = [];
    this.controlDisposers = [];
    this.pickables = [];
    this.selected = null;
    this.materialOriginals = new WeakMap();
    this.label = nodeModel.label || 'Geological Model Overview';
    this.performancePhases = [];
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    this.createSceneGroups();
    await this.initializeRoadwayContext();
    await this.renderAllLayers();
    await this.measurePerformancePhase('panels-and-handlers', () => {
      this.createPanels();
      this.registerVisualContributions();
      this.installHandlers();
      this.updatePanels();
      this.updateLegend();
      this.updateDetailPanel();
      this.applyLayerState();
      this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    });
    await this.measurePerformancePhase('initial-focus', () => {
      if (this.params.autoFocusOnSelection && this.rootGroup.children.length) this.sceneManager?.focusOnObject?.(this.rootGroup);
    });
    return { cleanup: () => this.cleanup() };
  }

  validateSemanticInputs() {
    const body = this.inputs.geologicalBody;
    if (!body) throw new Error('Missing semantic dataset input: geologicalBody');
    const actualClass = body.contract?.class || body.semanticClass;
    if (actualClass !== 'GeologicalBody') throw new Error(`Input geologicalBody expects GeologicalBody, got ${actualClass}.`);
    if (body.validation?.errors?.length) {
      console.warn('[MineVis Geological Model Overview] Geological body validation errors:', body.validation.errors);
    }
    Object.entries(GeologicalModelOverviewInputRequirements).forEach(([key, requirement]) => {
      if (!requirement.optional || !this.inputs[key]) return;
      const actual = this.inputs[key].contract?.class || this.inputs[key].semanticClass;
      if (actual !== requirement.class) {
        console.warn(`[MineVis Geological Model Overview] Optional input ${key} expects ${requirement.class}, got ${actual}.`);
      }
    });
  }

  createSceneGroups() {
    this.pickables = [];
    this.selected = null;
    this.materialOriginals = new WeakMap();
    this.performancePhases = [];
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = `${this.id}:geological-model-overview`;
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.name = 'geological-body-layer';
    this.geologicalSurfaceMeshIndex = new Map();
    this.boreholeGroup = new THREE.Group();
    this.boreholeGroup.name = 'borehole-layer';
    this.structureGroup = new THREE.Group();
    this.structureGroup.name = 'geological-structure-layer';
    this.attributeGroup = new THREE.Group();
    this.attributeGroup.name = 'geological-attribute-layer';
    this.highlightGroup = new THREE.Group();
    this.highlightGroup.name = 'geological-selection-highlight';
    this.rootGroup.add(this.bodyGroup, this.boreholeGroup, this.structureGroup, this.attributeGroup, this.highlightGroup);
    this.sceneManager.scene.add(this.rootGroup);
    this.sceneManager.raycaster.params.Points = { threshold: 8 };
  }

  async initializeRoadwayContext() {
    const roadway = this.inputs.roadway;
    if (!roadway || !this.params.showRoadway) return;
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayVisibleForOwner?.(this.id, true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacityForOwner?.(this.id, this.params.roadwayOpacity);
  }

  async measurePerformancePhase(name, task) {
    const startedAt = performance.now();
    const result = await task();
    this.performancePhases.push({ name, startedAt, durationMs: performance.now() - startedAt });
    return result;
  }

  async renderAllLayers() {
    await this.measurePerformancePhase('geological-body', () => this.renderGeologicalBodyLayer());
    await this.measurePerformancePhase('boreholes', () => this.renderBoreholeLayer());
    await this.measurePerformancePhase('structures', () => this.renderStructureLayer());
    if (this.params.showAttributeModel || this.params.colorMode === 'attribute') {
      await this.measurePerformancePhase('attributes', () => this.renderAttributeLayer());
    } else {
      this.performancePhases.push({ name: 'attributes-deferred', startedAt: performance.now(), durationMs: 0 });
    }
  }

  async loadObjText(dataset) {
    return dataset?.getRenderSupport?.()?.objText ||
      dataset?.getGeometrySupport?.()?.objText ||
      '';
  }

  unitForSurface(surface) {
    const unitId = surface?.geologicalUnitId ?? surface?.unitId ?? surface?.bodyId;
    return this.inputs.geologicalBody?.getUnit?.(unitId) || this.inputs.geologicalBody?.getBody?.(surface?.bodyId) || null;
  }

  colorForSurface(surface, index = 0) {
    const body = this.inputs.geologicalBody;
    const unit = this.unitForSurface(surface);
    if (this.params.colorMode === 'uniform') return '#8fb5ff';
    if (this.params.colorMode === 'lithology') {
      return geologyColorForKey(unit?.lithology ?? unit?.geologicalUnitType ?? surface?.surfaceType, index);
    }
    const explicit = unit?.color || surface?.color || body?.getBody?.(surface?.bodyId)?.color;
    if (explicit) return explicit;
    return geologyColorForKey(unit?.geologicalUnitId ?? surface?.bodyId ?? surface?.surfaceId, index);
  }

  colorForLithology(lithology, index = 0) {
    const key = String(lithology ?? '').toLowerCase();
    if (!key) return GEOLOGY_PALETTE[index % GEOLOGY_PALETTE.length];
    const body = this.inputs.geologicalBody;
    const units = body?.listUnits?.() || [];
    const unit = units.find((item) => {
      const candidates = [
        item.lithology,
        item.geologicalUnitType,
        item.unitType,
        item.unit_type,
        item.geologicalUnitId,
        item.unitId,
        item.geologicalUnitName
      ];
      return candidates.filter(Boolean).some((value) => String(value).toLowerCase() === key || String(value).toLowerCase().includes(key));
    });
    if (unit?.color) return unit.color;
    return geologyColorForKey(key, index);
  }

  geologicalDisplayColor(color) {
    const display = new THREE.Color(color || '#8fb5ff');
    const hsl = {};
    display.getHSL(hsl);
    if (hsl.l > 0.74) hsl.l = 0.66;
    else if (hsl.l > 0.62) hsl.l = 0.58;
    if (hsl.s < 0.16 && hsl.l > 0.2) hsl.s = 0.2;
    display.setHSL(hsl.h, hsl.s, hsl.l);
    return display;
  }

  createGeologicalBodyMaterial(color, opacity = Number(this.params.geologicalBodyOpacity)) {
    const bodyOpacity = Number(opacity);
    const material = new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor(color),
      transparent: bodyOpacity < 0.98,
      opacity: bodyOpacity,
      side: THREE.DoubleSide,
      depthWrite: bodyOpacity >= 0.98
    });
    material.forceSinglePass = true;
    return material;
  }

  configureGeologicalBodyMesh(mesh, opacity = Number(this.params.geologicalBodyOpacity)) {
    const bodyOpacity = Number(opacity);
    mesh.renderOrder = bodyOpacity >= 0.98 ? 0 : 24;
    mesh.userData.opacityRenderOrder = { opaque: 0, transparent: 24 };
  }

  async renderGeologicalBodyLayer() {
    const body = this.inputs.geologicalBody;
    const objText = await this.loadObjText(body);
    const surfaces = body?.listSurfaces?.() || [];
    this.geologicalSurfaceMeshIndex = new Map();
    const surfaceByMesh = new Map();
    surfaces.forEach((surface, index) => {
      const keys = [surface.meshPartId, surface.mesh_part_id, surface.name, surface.surfaceId].filter(Boolean).map(String);
      keys.forEach((key) => surfaceByMesh.set(key, { surface, index }));
    });
    if (objText) {
      const parseStartedAt = performance.now();
      const object = await parseObjAsync(objText);
      this.performancePhases.push({
        name: 'geological-body-obj-parse',
        startedAt: parseStartedAt,
        durationMs: performance.now() - parseStartedAt
      });
      const layeredSurfaceMeshes = new Map();
      const progressiveMeshes = [];
      const largeLayeredModel = objText.length >= 5 * 1024 * 1024;
      const progressive = largeLayeredModel && object.userData.minevisObjFirstUse;
      let fallbackIndex = 0;
      const meshIndexStartedAt = performance.now();
      object.traverse((child) => {
        if (!child.isMesh) return;
        if (!child.geometry?.getAttribute?.('normal')) child.geometry?.computeVertexNormals?.();
        child.material?.dispose?.();
        const matched = geometryObjectNames(child).map((name) => surfaceByMesh.get(name)).find(Boolean);
        const surface = matched?.surface || surfaces[fallbackIndex] || {
          surfaceId: child.name || `SURF_${fallbackIndex + 1}`,
          meshPartId: child.name || null,
          surfaceType: 'surface'
        };
        const index = matched?.index ?? fallbackIndex;
        fallbackIndex += 1;
        const bodyOpacity = Number(this.params.geologicalBodyOpacity);
        child.material = this.createGeologicalBodyMaterial(this.colorForSurface(surface, index), bodyOpacity);
        this.configureGeologicalBodyMesh(child, bodyOpacity);
        if (progressive) {
          child.visible = false;
          progressiveMeshes.push(child);
        }
        child.userData.geologyPick = {
          type: 'geologicalSurface',
          id: surface.surfaceId,
          surfaceId: surface.surfaceId,
          unitId: surface.geologicalUnitId ?? surface.unitId,
          bodyId: surface.bodyId,
          label: surface.surfaceId
        };
        const unitId = String(surface.geologicalUnitId ?? surface.unitId ?? surface.bodyId ?? surface.surfaceId);
        const entry = layeredSurfaceMeshes.get(unitId) || { unitId, roof: [], floor: [], closure: [], surfaces: [] };
        const surfaceType = String(surface.surfaceType ?? surface.surface_type ?? '').toLowerCase();
        if (surfaceType.includes('roof') || surfaceType.includes('top')) entry.roof.push({ mesh: child, surface, index });
        else if (surfaceType.includes('floor') || surfaceType.includes('bottom')) entry.floor.push({ mesh: child, surface, index });
        else if (surfaceType.includes('side') || surfaceType.includes('cut') || surfaceType.includes('closure')) entry.closure.push({ mesh: child, surface, index });
        entry.surfaces.push({ mesh: child, surface, index });
        layeredSurfaceMeshes.set(unitId, entry);
        this.pickables.push(child);
      });
      this.performancePhases.push({
        name: 'geological-body-mesh-index',
        startedAt: meshIndexStartedAt,
        durationMs: performance.now() - meshIndexStartedAt
      });
      if (largeLayeredModel) {
        const floors = [...layeredSurfaceMeshes.values()].flatMap((entry) => entry.floor || []);
        floors.slice(0, -1).forEach(({ mesh }) => { mesh.visible = false; });
        layeredSurfaceMeshes.forEach((entry) => {
          entry.roof?.forEach(({ mesh }) => {
            if (mesh.material) mesh.material.side = THREE.FrontSide;
          });
        });
        const hiddenFloors = new Set(floors.slice(0, -1).map(({ mesh }) => mesh));
        for (let index = progressiveMeshes.length - 1; index >= 0; index -= 1) {
          if (hiddenFloors.has(progressiveMeshes[index])) progressiveMeshes.splice(index, 1);
        }
      }
      this.geologicalSurfaceMeshIndex = layeredSurfaceMeshes;
      object.updateMatrixWorld(true);
      const sidewallStartedAt = performance.now();
      const sideWallGroup = this.createLayeredShellSideWallGroup(layeredSurfaceMeshes);
      this.performancePhases.push({
        name: 'geological-body-sidewalls',
        startedAt: sidewallStartedAt,
        durationMs: performance.now() - sidewallStartedAt
      });
      this.bodyGroup.add(object);
      if (sideWallGroup?.children?.length) {
        this.bodyGroup.add(sideWallGroup);
      }
      if (progressiveMeshes.length) {
        const revealStartedAt = performance.now();
        await this.revealMeshesProgressively(progressiveMeshes);
        this.performancePhases.push({
          name: 'geological-body-progressive-reveal',
          startedAt: revealStartedAt,
          durationMs: performance.now() - revealStartedAt
        });
      }
    }
    this.renderGeologicalBlocksFromBody();
  }

  async revealMeshesProgressively(meshes = [], triangleBudget = 20000) {
    let triangles = 0;
    for (const mesh of meshes) {
      mesh.visible = true;
      const geometry = mesh.geometry;
      triangles += Math.floor((geometry?.index?.count || geometry?.attributes?.position?.count || 0) / 3);
      if (triangles < triangleBudget) continue;
      triangles = 0;
      this.sceneManager?.requestRenderBurst?.(48);
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    }
    this.sceneManager?.requestRenderBurst?.(120);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  createLayeredShellSideWallGroup(surfaceMeshEntries = new Map()) {
    const body = this.inputs.geologicalBody;
    const profile = body?.getRepresentationProfile?.() || body?.representationProfile;
    const hasRoofFloorPairs = [...surfaceMeshEntries.values()].some((entry) => entry.roof?.length && entry.floor?.length);
    if (profile !== 'layered-surface' && !hasRoofFloorPairs) return null;
    const bodyOpacity = Number(this.params.geologicalBodyOpacity);
    const sideWallGroup = new THREE.Group();
    sideWallGroup.name = 'layered-geological-body-sidewalls';
    surfaceMeshEntries.forEach((entry) => {
      if (entry.closure?.length) return;
      if (!entry.roof.length || !entry.floor.length) return;
      const floorIndex = this.buildFloorVertexIndex(entry.floor.map((item) => item.mesh));
      entry.roof.forEach((roofItem) => {
        roofItem.mesh.updateMatrixWorld?.(true);
        const geometry = this.buildLayerSideWallGeometry(roofItem.mesh.geometry, floorIndex, roofItem.mesh.matrixWorld);
        if (!geometry) return;
        geometry.computeVertexNormals();
        const color = this.colorForSurface(roofItem.surface, roofItem.index);
        const material = this.createGeologicalBodyMaterial(color, Math.min(1, Math.max(bodyOpacity, 0.72)));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${entry.unitId}:generated-side-and-cut-closure`;
        this.configureGeologicalBodyMesh(mesh, Math.min(1, Math.max(bodyOpacity, 0.72)));
        const unit = this.unitForSurface(roofItem.surface);
        mesh.userData.geologyPick = {
          type: 'geologicalUnit',
          id: entry.unitId,
          unitId: entry.unitId,
          surfaceId: roofItem.surface.surfaceId,
          bodyId: roofItem.surface.bodyId,
          label: unit?.geologicalUnitName ?? roofItem.surface.bodyId ?? entry.unitId
        };
        sideWallGroup.add(mesh);
        this.pickables.push(mesh);
      });
    });
    return sideWallGroup;
  }

  buildFloorVertexIndex(floorMeshes = []) {
    const index = new Map();
    const vertices = [];
    floorMeshes.forEach((mesh) => {
      mesh.updateMatrixWorld?.(true);
      geometryUniqueVertices(mesh.geometry, mesh.matrixWorld).forEach((point) => {
        vertices.push(point);
        const key = geologyHorizontalKey(point);
        if (!index.has(key)) index.set(key, point);
      });
    });
    index.vertices = vertices;
    return index;
  }

  findMatchingFloorVertex(point, floorVertexIndex) {
    const exact = floorVertexIndex.get(geologyHorizontalKey(point));
    if (exact) return exact;
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of floorVertexIndex.vertices || []) {
      const dx = candidate.x - point.x;
      const dz = candidate.z - point.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return bestDistance <= 30 * 30 ? best : null;
  }

  buildLayerSideWallGeometry(roofGeometry, floorVertexIndex, roofMatrix = null) {
    const positions = [];
    const pushTriangle = (a, b, c) => {
      if (!a || !b || !c) return;
      if (a.distanceToSquared(b) < 1e-8 || b.distanceToSquared(c) < 1e-8 || c.distanceToSquared(a) < 1e-8) return;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    geometryBoundaryEdges(roofGeometry, roofMatrix).forEach((edge) => {
      const topA = edge.a.point;
      const topB = edge.b.point;
      const floorA = this.findMatchingFloorVertex(topA, floorVertexIndex);
      const floorB = this.findMatchingFloorVertex(topB, floorVertexIndex);
      if (!floorA || !floorB) return;
      pushTriangle(topA, floorA, topB);
      pushTriangle(topB, floorA, floorB);
    });
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }

  renderGeologicalBlocksFromBody() {
    const blocks = this.inputs.geologicalBody?.listBlocks?.() || [];
    if (!blocks.length) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const bodyOpacity = Number(this.params.geologicalBodyOpacity);
    const material = new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor('#6f92d8'),
      transparent: bodyOpacity < 0.98,
      opacity: bodyOpacity,
      depthWrite: bodyOpacity >= 0.98
    });
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
    mesh.name = 'geological-body-blocks';
    mesh.renderOrder = bodyOpacity >= 0.98 ? 0 : 24;
    mesh.userData.opacityRenderOrder = { opaque: 0, transparent: 24 };
    const transform = new THREE.Matrix4();
    blocks.forEach((block, index) => {
      const center = geologyPoint(block.centroid);
      const size = block.size || {};
      transform.compose(center, new THREE.Quaternion(), new THREE.Vector3(Number(size.x) || 8, Number(size.y) || 8, Number(size.z) || 8));
      mesh.setMatrixAt(index, transform);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.geologyPick = { type: 'geologicalBlockCollection', id: 'geological-body-blocks', elements: blocks };
    this.pickables.push(mesh);
    this.bodyGroup.add(mesh);
  }

  async renderBoreholeLayer() {
    const boreholeDataset = this.inputs.borehole;
    if (!boreholeDataset) return;
    const segmentRecords = [];
    const collars = [];
    let sliceStartedAt = nowMs();
    for (const borehole of boreholeDataset.listBoreholes()) {
      const rawPoints = boreholeDataset.getTrajectory(borehole.boreholeId);
      const points = rawPoints.map(geologyPoint);
      const intervals = (boreholeDataset.getIntervals?.(borehole.boreholeId) || [])
        .filter((interval) => Number.isFinite(Number(interval.depthFrom)) && Number.isFinite(Number(interval.depthTo)) && Number(interval.depthTo) > Number(interval.depthFrom))
        .sort((a, b) => Number(a.depthFrom) - Number(b.depthFrom));
      const segments = intervals.map((interval, index) => {
        const lithology = interval.lithology ?? interval.attributeValue ?? interval.attribute_value ?? interval.rock_type ?? interval.value ?? interval.grade;
        return {
          points: sliceBoreholePathByMeasure(rawPoints, interval.depthFrom, interval.depthTo),
          color: this.colorForLithology(lithology, index),
          interval
        };
      });
      if (!segments.length && points.length >= 2) {
        segments.push({ points, color: '#66d9ef', interval: null });
      }
      segmentRecords.push(...this.buildBoreholeSegmentGeometryRecords(segments, borehole));
      collars.push({ collar: this.resolveBoreholeCollar(borehole, rawPoints, points), borehole });
      if (nowMs() - sliceStartedAt >= 8) {
        await yieldToMainThread();
        sliceStartedAt = nowMs();
      }
    }
    this.addBoreholeSegmentBatch(segmentRecords);
    this.addBoreholeCollarBatch(collars);
  }

  resolveBoreholeCollar(borehole = {}, rawPoints = [], renderedPoints = []) {
    const asVector = (value) => {
      if (!value) return null;
      const point = value?.isVector3 ? value.clone() : geologyPoint(value);
      return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) ? point : null;
    };
    const collar = asVector(borehole.collar ?? borehole.position ?? borehole);
    const firstRaw = asVector(rawPoints?.[0]);
    const firstRendered = asVector(renderedPoints?.[0]);
    const first = firstRaw || firstRendered;
    if (collar) {
      const collarLooksDefault = collar.lengthSq() < 1e-8 && first && first.lengthSq() > 1e-8;
      if (!collarLooksDefault) return collar;
    }
    return first || collar || new THREE.Vector3();
  }

  addBoreholeCollarBatch(records = []) {
    if (!records.length) return false;
    const coneMaterial = new THREE.MeshLambertMaterial({
      color: '#ef4444',
      side: THREE.DoubleSide,
      transparent: Number(this.params.boreholeOpacity) < 0.98,
      opacity: Number(this.params.boreholeOpacity),
      depthTest: false,
      depthWrite: false
    });
    coneMaterial.userData.alwaysTransparent = true;
    coneMaterial.userData.keepDepthWrite = false;
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(4.4, 9.5, 18), coneMaterial, records.length);
    const transform = new THREE.Matrix4();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const scale = new THREE.Vector3(1, 1, 1);
    const offset = new THREE.Vector3(0, 7, 0);
    const picks = records.map(({ collar, borehole }, index) => {
      transform.compose(collar.clone().add(offset), rotation, scale);
      cone.setMatrixAt(index, transform);
      return {
        type: 'borehole',
        id: borehole.boreholeId,
        boreholeId: borehole.boreholeId,
        label: borehole.boreholeName
      };
    });
    cone.instanceMatrix.needsUpdate = true;
    cone.renderOrder = 39;
    cone.userData.geologyPick = picks[0] || { type: 'boreholeCollection', id: 'borehole-collars' };
    cone.userData.resolveGeologyPick = (hit) => picks[Number(hit?.instanceId)] || cone.userData.geologyPick;
    this.pickables.push(cone);
    this.boreholeGroup.add(cone);
    return true;
  }

  buildBoreholeSegmentGeometryRecords(segments = [], borehole = {}) {
    const records = [];
    segments.forEach(({ points = [], color = '#66d9ef', interval = null }) => {
      const compact = points
        .map((point) => (point?.isVector3 ? point.clone() : geologyPoint(point)))
        .filter((point, index, list) => index === 0 || point.distanceToSquared(list[index - 1]) > 1e-6);
      if (compact.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(compact);
      const geometry = new THREE.TubeGeometry(curve, Math.max(2, compact.length * 3), 1.05, 8, false);
      const vertexCount = geometry.getAttribute('position')?.count || 0;
      const segmentColor = new THREE.Color(color);
      const colors = new Float32Array(vertexCount * 3);
      for (let index = 0; index < vertexCount; index += 1) {
        colors[index * 3] = segmentColor.r;
        colors[index * 3 + 1] = segmentColor.g;
        colors[index * 3 + 2] = segmentColor.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      records.push({
        geometry,
        triangleCount: Math.floor((geometry.index?.count || vertexCount) / 3),
        pick: {
          type: 'borehole',
          id: borehole.boreholeId,
          boreholeId: borehole.boreholeId,
          intervalId: interval?.id ?? interval?.intervalId ?? interval?.interval_id,
          lithology: interval?.lithology ?? interval?.attributeValue ?? interval?.attribute_value,
          label: borehole.boreholeName
        }
      });
    });
    return records;
  }

  addBoreholeSegmentBatch(records = []) {
    const geometries = records.map((record) => record.geometry);
    if (!geometries.length) return false;
    const pickRanges = [];
    let triangleOffset = 0;
    records.forEach((record) => {
      pickRanges.push({
        start: triangleOffset,
        end: triangleOffset + record.triangleCount,
        pick: record.pick
      });
      triangleOffset += record.triangleCount;
    });
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!geometry) {
      geometries.forEach((item) => item.dispose());
      return false;
    }
    if (geometries.length > 1) geometries.forEach((item) => item.dispose());
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.58,
      metalness: 0.02,
      transparent: true,
      opacity: Number(this.params.boreholeOpacity),
      depthTest: false,
      depthWrite: false
    });
    material.userData.alwaysTransparent = true;
    material.userData.keepDepthWrite = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 36;
    mesh.userData.geologyPick = pickRanges[0]?.pick || { type: 'boreholeCollection', id: 'borehole-trajectories' };
    mesh.userData.resolveGeologyPick = (hit) => {
      const faceIndex = Number(hit?.faceIndex);
      if (!Number.isInteger(faceIndex)) return mesh.userData.geologyPick;
      return pickRanges.find((range) => faceIndex >= range.start && faceIndex < range.end)?.pick ||
        mesh.userData.geologyPick;
    };
    this.pickables.push(mesh);
    this.boreholeGroup.add(mesh);
    return true;
  }

  async renderStructureLayer() {
    const structureDataset = this.inputs.geologicalStructure;
    if (!structureDataset) return;
    const structures = structureDataset.listStructures?.() || [];
    const structureByMesh = new Map();
    structures.forEach((structure, index) => {
      [structure.meshPartId, structure.mesh_part_id, structure.structureId, structure.name].filter(Boolean).forEach((key) => {
        structureByMesh.set(String(key), { structure, index });
      });
    });
    const objText = await this.loadObjText(structureDataset);
    if (objText) {
      const object = await parseObjAsync(objText);
      let fallbackIndex = 0;
      object.traverse((child) => {
        if (!child.isMesh) return;
        if (!child.geometry?.getAttribute?.('normal')) child.geometry?.computeVertexNormals?.();
        child.material?.dispose?.();
        const matched = geometryObjectNames(child).map((name) => structureByMesh.get(name)).find(Boolean);
        const structure = matched?.structure || structures[fallbackIndex] || { structureId: child.name || `GS_${fallbackIndex + 1}`, structureType: 'structure' };
        fallbackIndex += 1;
        child.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(geologyColorForKey(structure.structureType || 'fault', fallbackIndex + 3)),
          transparent: true,
          opacity: Number(this.params.structureOpacity),
          roughness: 0.6,
          metalness: 0.02,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        child.renderOrder = 28;
        child.userData.geologyPick = {
          type: 'geologicalStructure',
          id: structure.structureId,
          structureId: structure.structureId,
          label: structure.structureName
        };
        this.pickables.push(child);
      });
      this.structureGroup.add(object);
    }
  }

  renderAttributeLayer() {
    const dataset = this.inputs.attributeModel;
    if (!dataset) return;
    this.attributeLayerInitialized = true;
    const active = this.params.activeAttribute || this.context?.get?.('activeGeologicalAttribute') || dataset.getPrimaryAttribute?.();
    this.params.activeAttribute = active;
    if (!active) return;
    this.attributeGroup.clear();
    const grid = dataset.grid;
    const binaryKey = this.resolveBinaryAttributeKey(dataset, active);
    const mode = this.getVolumeRenderMode();
    if (grid && binaryKey) {
      if (mode === 'points') this.renderAttributeGridPoints(dataset, active, binaryKey);
      else if (mode !== 'boundary-only') this.renderAttributeVolume(dataset, active, binaryKey);
      return;
    }
    if (mode === 'boundary-only') return;
    const blocks = dataset.listBlocks?.() || [];
    if (mode === 'points') this.renderAttributeElementPoints(dataset, active, blocks);
    else this.renderAttributeElementBoxes(dataset, active, blocks);
  }

  getVolumeRenderMode() {
    const mode = String(this.params.blockRenderMode || 'volume');
    if (mode === 'sampled-boxes' || mode === 'boxes') return 'volume';
    if (mode === 'isosurface' || mode === 'points' || mode === 'boundary-only') return mode;
    return 'volume';
  }

  rerenderAttributeLayer({ updatePanels = true } = {}) {
    this.pickables = this.pickables.filter((object) => {
      let current = object;
      while (current) {
        if (current === this.attributeGroup) return false;
        current = current.parent;
      }
      return true;
    });
    disposeThreeObject(this.attributeGroup);
    this.attributeGroup.clear();
    this.renderAttributeLayer();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    this.updateLegend();
    if (updatePanels) this.updatePanels();
    else this.updateAttributePanel();
  }

  resolveBinaryAttributeKey(dataset, active) {
    return resolveVolumeBinaryAttributeKey(dataset, active);
  }

  gridDimensions(grid = {}) {
    return sharedVolumeGridDimensions(grid);
  }

  gridBounds(grid = {}) {
    return sharedVolumeGridBounds(grid);
  }

  volumeAttributeMeta(dataset, active, values) {
    return sharedVolumeAttributeMeta(dataset, active, values);
  }

  normalizedVolumeTextureData(values, total, meta) {
    return sharedNormalizedVolumeTextureData(values, total, meta);
  }

  effectiveVolumeOpacity() {
    return Math.max(0, Math.min(1, Number(this.params.attributeModelOpacity) || 0)) * Math.max(0, Math.min(1, Number(this.params.volumeOpacity) || 0));
  }

  renderAttributeVolume(dataset, active, binaryKey = active) {
    const mesh = createVolumeRenderingMesh({
      dataset,
      active,
      binaryKey,
      params: this.params,
      mode: this.getVolumeRenderMode(),
      group: this.attributeGroup,
      pickables: this.pickables,
      type: 'geologicalVolume',
      id: `volume:${active}`,
      renderOrder: 18
    });
    if (!mesh) this.renderAttributeGridPoints(dataset, active, binaryKey);
    else this.activeVolumeMeta = mesh.userData.geologyPick.volumeData.meta;
  }

  renderAttributeGridPoints(dataset, active, binaryKey = active) {
    return renderVolumePointsLayer({
      dataset,
      active,
      binaryKey,
      params: this.params,
      group: this.attributeGroup,
      pickables: this.pickables,
      type: 'geologicalBlockCollection',
      id: 'attribute-points',
      renderOrder: 18
    });
  }

  renderAttributeElementPoints(dataset, active, elements = []) {
    const valid = elements.filter((element) => element?.centroid);
    const values = valid.map((element) => Number(dataset.getValue?.(element.elementId, active)));
    const range = geologyNumericRange(values);
    const positions = [];
    const colors = [];
    const valueNorms = [];
    const span = range.max - range.min || 1;
    valid.forEach((element, index) => {
      const center = geologyPoint(element.centroid);
      const value = Number(dataset.getValue?.(element.elementId, active));
      positions.push(center.x, center.y, center.z);
      const valueNorm = Number.isFinite(value) ? clamp01((value - range.min) / span) : 0;
      const color = new THREE.Color(Number.isFinite(value) ? sampleColor('viridis', valueNorm) : GEOLOGY_PALETTE[index % GEOLOGY_PALETTE.length]);
      colors.push(color.r, color.g, color.b);
      valueNorms.push(valueNorm);
    });
    this.addAttributePoints(positions, colors, valid, 5, valueNorms);
  }

  renderAttributeElementBoxes(dataset, active, elements = []) {
    const valid = elements.filter((element) => element?.centroid);
    if (!valid.length) return;
    const values = valid.map((element) => Number(dataset.getValue?.(element.elementId, active)));
    const range = geologyNumericRange(values);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = createAttributeBoxMaterial({
      ...this.params,
      selectedOpacity: this.params.attributeModelOpacity,
      contextOpacity: 0.04
    });
    const mesh = new THREE.InstancedMesh(geometry, material, valid.length);
    mesh.renderOrder = 18;
    const transform = new THREE.Matrix4();
    const color = new THREE.Color();
    const instanceColors = new Float32Array(valid.length * 3);
    const instanceValues = new Float32Array(valid.length);
    const span = range.max - range.min || 1;
    valid.forEach((element, index) => {
      const center = geologyPoint(element.centroid);
      const size = element.size || {};
      transform.compose(center, new THREE.Quaternion(), new THREE.Vector3(Number(size.x) || 8, Number(size.y) || 8, Number(size.z) || 8));
      mesh.setMatrixAt(index, transform);
      const value = Number(dataset.getValue?.(element.elementId, active));
      const valueNorm = Number.isFinite(value) ? clamp01((value - range.min) / span) : 0;
      color.set(Number.isFinite(value) ? sampleColor('viridis', valueNorm) : GEOLOGY_PALETTE[index % GEOLOGY_PALETTE.length]);
      instanceColors.set([color.r, color.g, color.b], index * 3);
      instanceValues[index] = valueNorm;
    });
    mesh.instanceMatrix.needsUpdate = true;
    geometry.setAttribute('instanceBaseColor', new THREE.InstancedBufferAttribute(instanceColors, 3));
    geometry.setAttribute('instanceValueNorm', new THREE.InstancedBufferAttribute(instanceValues, 1));
    mesh.userData.geologyPick = { type: 'geologicalBlockCollection', id: 'attribute-blocks', elements: valid, activeAttribute: active };
    this.pickables.push(mesh);
    this.attributeGroup.add(mesh);
  }

  addAttributePoints(positions, colors, elements, size = 5, valueNorms = null) {
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('valueNorm', new THREE.Float32BufferAttribute(valueNorms || Array.from({ length: positions.length / 3 }, () => 1), 1));
    const material = createAttributePointsMaterial({
      ...this.params,
      volumePointSize: Number(this.params.volumePointSize) || size,
      selectedOpacity: this.params.attributeModelOpacity,
      contextOpacity: 0.04
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 18;
    points.userData.geologyPick = { type: 'geologicalBlockCollection', id: 'attribute-points', elements, activeAttribute: this.params.activeAttribute };
    this.pickables.push(points);
    this.attributeGroup.add(points);
  }

  renderControls(container) {
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.controlContainer = container;
    container.innerHTML = `
      <div class="panel-title">${escapeHtml(this.label)}</div>
      <div class="geology-quick-note">Use the floating Geological Model Panel for layer visibility, object lists, and volume rendering parameters.</div>
      <div class="geology-quick-actions">
        <button type="button" data-show-geology-model-panel>Show Model Panel</button>
        <button type="button" data-focus-geology-model>Focus model</button>
      </div>
    `;
    const onClick = (event) => this.handlePanelClick(event);
    container.addEventListener('click', onClick);
    this.controlDisposers.push(() => container.removeEventListener('click', onClick));
  }

  updateVolumeUniforms() {
    updateVolumeLayerUniforms(this.attributeGroup, this.params, this.getVolumeRenderMode());
    updateAttributeGlyphLayerUniforms(this.attributeGroup, this.params);
  }

  attributeRange(dataset, active, fallbackValues = []) {
    return volumeAttributeRange(dataset, active, fallbackValues);
  }

  createPanels() {
    this.layerPanel = createWorkspacePanel('Geological Model Panel', 'geological-layer-panel', '<div class="geology-layer-content"></div>');
    this.legendPanel = createWorkspacePanel('Geological Legend', 'geological-legend-panel', '<div class="geology-legend-content"></div>');
    this.detailPanel = createWorkspacePanel('Selected Geological Object Detail', 'geological-detail-panel', '<div class="geology-detail-content"></div>');
    this.attributePanel = createWorkspacePanel('Attribute Summary', 'geological-attribute-panel', '<div class="geology-attribute-content"></div>');
    Object.assign(this.layerPanel.style, { left: '18px', top: '92px', width: '420px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '520px', width: '260px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '92px', width: '310px' });
    Object.assign(this.attributePanel.style, { right: '330px', top: '430px', width: '310px' });
    if (!this.inputs.attributeModel) this.attributePanel.style.display = 'none';
  }

  registerVisualContributions() {
    const registerAll = () => {
      this.applyLayerState();
    this.registerSceneContribution('geological-body-layer', 'Geological Body Layer', this.bodyGroup, 'geologicalBody', 'structure', this.params.geologicalBodyOpacity);
    if (this.inputs.roadway) {
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
        composition: { mergePolicy: 'reuse', focusBehavior: 'context', defaultOpacity: this.params.roadwayOpacity, canPin: true },
        visible: this.params.showRoadway,
        opacity: this.params.roadwayOpacity,
        show: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, true),
        hide: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, false),
        setOpacity: (value) => {
          this.params.roadwayOpacity = Number(value);
          this.sceneManager.setRoadwayOpacityForOwner?.(this.id, Number(value));
        },
        focus: () => this.sceneManager.focusOnRoadway?.(),
        cleanup: () => this.sceneManager.setRoadwayVisibleForOwner?.(this.id, false)
      });
    }
    if (this.inputs.borehole) this.registerSceneContribution('borehole-layer', 'Borehole Layer', this.boreholeGroup, 'borehole', 'structure', this.params.boreholeOpacity);
    if (this.inputs.geologicalStructure) {
      this.registerSceneContribution('geological-structure-layer', 'Geological Structure Layer', this.structureGroup, 'geologicalStructure', 'structure', this.params.structureOpacity, {
        visualChannels: { color: 'structureType', opacity: 'confidence' },
        composition: { mergePolicy: 'compose', focusBehavior: 'annotation', defaultOpacity: this.params.structureOpacity, canPin: true }
      });
    }
    if (this.inputs.attributeModel) {
      this.registerSceneContribution('geological-attribute-layer', 'Geological Attribute Layer', this.attributeGroup, 'geologicalAttributeModel', 'state', this.params.attributeModelOpacity, {
        visualChannels: { color: 'activeGeologicalAttribute' }
      });
    }
    [
      ['layer-panel', 'Geological Model Panel', this.layerPanel, 'panel', 'control'],
      ['legend', 'Geological Legend', this.legendPanel, 'legend', 'legend'],
      ['detail-panel', 'Selected Geological Object Detail', this.detailPanel, 'panel', 'detail'],
      ['attribute-summary', 'Attribute Summary', this.attributePanel, 'panel', 'detail']
    ].forEach(([suffix, label, panel, type, semanticRole]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        host: type === 'legend' ? 'legend' : 'right-panel',
        contributionKind: type,
        semanticRole,
        objectSystem: 'geologicalModel',
        element: panel,
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
    };
    if (typeof this.contributionRegistry.transaction === 'function') {
      this.contributionRegistry.transaction(registerAll);
    } else {
      registerAll();
    }
  }

  registerSceneContribution(suffix, label, group, objectSystem, semanticRole, opacity, overrides = {}) {
    this.contributionRegistry.register({
      id: `${this.id}:${suffix}`,
      label,
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      contributionKind: 'layer',
      semanticRole,
      objectSystem,
      visualChannels: { color: 'geologicalUnit', opacity: 'layerOpacity', ...(overrides.visualChannels || {}) },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: opacity, canPin: true, ...(overrides.composition || {}) },
      visible: group.visible,
      opacity,
      show: () => (group.visible = true),
      hide: () => (group.visible = false),
      setOpacity: (value) => {
        setGroupOpacity(group, value);
        if (suffix.includes('body')) this.params.geologicalBodyOpacity = Number(value);
        if (suffix.includes('borehole')) this.params.boreholeOpacity = Number(value);
        if (suffix.includes('structure')) this.params.structureOpacity = Number(value);
        if (suffix.includes('attribute')) this.params.attributeModelOpacity = Number(value);
      },
      focus: () => this.sceneManager.focusOnObject?.(group),
      cleanup: () => {
        group.visible = false;
      }
    });
  }

  installHandlers() {
    this.disposers.push(this.context.subscribe('selection', (selection) => this.applyContextSelection(selection)));
    this.disposers.push(this.context.subscribe('activeGeologicalAttribute', (attribute) => {
      this.params.activeAttribute = attribute;
      this.rerenderAttributeLayer();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
    }));
    this.disposers.push(this.context.subscribe('attributeRangePreview', (range) => this.applyExternalAttributeRange(range, false)));
    this.disposers.push(this.context.subscribe('attributeRangeFilter', (range) => this.applyExternalAttributeRange(range, true)));
    this.layerPanel.addEventListener('change', (event) => this.handlePanelChange(event));
    this.layerPanel.addEventListener('click', (event) => this.handlePanelClick(event));
    this.layerPanel.addEventListener('input', (event) => {
      const target = event.target;
      if (target?.matches?.('input[data-volume-setting], input[data-opacity]')) this.handlePanelChange(event);
    });
    this.layerPanel.addEventListener('pointerdown', (event) => {
      this.handleVolumeRangePointerDown(event, (final) => {
        this.updateVolumeUniforms();
        this.syncGeologyControls();
        if (final) {
          this.updateAttributePanel();
          this.updateLegend();
        }
      });
    });
  }

  handlePanelChange(event) {
    const target = event.target;
    if (target.matches('[data-toggle-layer]')) {
      this.params[target.dataset.toggleLayer] = target.checked;
      if (target.dataset.toggleLayer === 'showAttributeModel' && target.checked && !this.attributeLayerInitialized) {
        this.renderAttributeLayer();
        this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
      }
      this.applyLayerState();
      this.updateLegend();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    if (target.matches('[data-opacity]')) {
      const value = this.readBoundedNumber(target, 0);
      this.params[target.dataset.opacity] = value;
      if (target.dataset.opacity === 'geologicalBodyOpacity') setGroupOpacity(this.bodyGroup, value);
      if (target.dataset.opacity === 'boreholeOpacity') setGroupOpacity(this.boreholeGroup, value);
      if (target.dataset.opacity === 'structureOpacity') setGroupOpacity(this.structureGroup, value);
      if (target.dataset.opacity === 'attributeModelOpacity') setGroupOpacity(this.attributeGroup, value);
      if (target.dataset.opacity === 'roadwayOpacity') this.sceneManager.setRoadwayOpacityForOwner?.(this.id, value);
      this.syncGeologyControls();
      return;
    }
    if (target.matches('[data-volume-setting]')) {
      const key = target.dataset.volumeSetting;
      const previousMode = this.getVolumeRenderMode();
      this.params[key] = target.type === 'number' || target.type === 'range' ? this.readBoundedNumber(target, this.params[key]) : target.value;
      this.normalizeVolumeSettings(key);
      const nextMode = this.getVolumeRenderMode();
      if (key === 'blockRenderMode' && previousMode !== nextMode) {
        this.rerenderAttributeLayer();
        this.updatePanels();
        if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      }
      else {
        this.updateVolumeUniforms();
        this.syncGeologyControls();
        this.updateAttributePanel();
        this.updateLegend();
      }
      return;
    }
    if (target.matches('[data-color-mode]')) {
      this.params.colorMode = target.value;
      this.recolorBodyLayer();
      this.updateLegend();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    if (target.matches('[data-active-attribute]')) {
      this.context.set('activeGeologicalAttribute', target.value);
    }
  }

  handlePanelClick(event) {
    if (event.target.closest('[data-show-geology-model-panel]')) {
      if (!this.layerPanel) return;
      this.layerPanel.style.display = 'block';
      this.layerPanel.classList.remove('panel-collapsed');
      const toggle = this.layerPanel.querySelector?.('.panel-collapse-toggle');
      if (toggle) toggle.textContent = '-';
      return;
    }
    if (event.target.closest('[data-focus-geology-model]')) {
      const target = this.attributeGroup?.visible && this.attributeGroup.children.length ? this.attributeGroup : this.bodyGroup;
      this.sceneManager.focusOnObject?.(target);
      return;
    }
    if (event.target.closest('[data-volume-reset]')) {
      Object.assign(this.params, {
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
      this.rerenderAttributeLayer();
      this.updatePanels();
      if (this.controlContainer?.isConnected) this.renderControls(this.controlContainer);
      return;
    }
    const row = event.target.closest('[data-select-type]');
    if (!row) return;
    this.setSelection(row.dataset.selectType, row.dataset.selectId);
  }

  readBoundedNumber(target, fallback = 0) {
    const raw = Number(target.value);
    const min = Number(target.min);
    const max = Number(target.max);
    let value = Number.isFinite(raw) ? raw : Number(fallback) || 0;
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);
    return value;
  }

  applyExternalAttributeRange(range, commit = false) {
    if (!range || range.ownerId === this.id || !this.inputs.attributeModel) return;
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    if (range.attribute && active && String(range.attribute) !== String(active)) return;
    const normalizedMin = optionalFiniteNumber(range.normalizedMin);
    const normalizedMax = optionalFiniteNumber(range.normalizedMax);
    if (normalizedMin == null || normalizedMax == null) return;
    this.params.volumeFilterMin = clamp01(Math.min(normalizedMin, normalizedMax));
    this.params.volumeFilterMax = clamp01(Math.max(normalizedMin, normalizedMax));
    this.updateVolumeUniforms();
    this.syncGeologyControls();
    if (commit) {
      this.updateAttributePanel();
      this.updateLegend();
    }
  }

  handleVolumeRangePointerDown(event, onChange = null) {
    const range = event.target?.closest?.('[data-volume-range]');
    if (!range || (event.button != null && event.button !== 0)) return false;
    const [minKey, maxKey] = String(range.dataset.volumeRange || '').split(':');
    if (!minKey || !maxKey) return false;

    const valueFromPointer = (pointerEvent) => {
      const rect = range.getBoundingClientRect();
      return clamp01((pointerEvent.clientX - rect.left) / Math.max(1, rect.width));
    };
    const handle = event.target?.closest?.('[data-volume-range-handle]')?.dataset?.volumeRangeHandle || null;
    let activeKey = handle === 'min' ? minKey : handle === 'max' ? maxKey : null;
    if (!activeKey) {
      const value = valueFromPointer(event);
      const min = Number(this.params[minKey]) || 0;
      const max = Number(this.params[maxKey]) || 1;
      activeKey = Math.abs(value - min) <= Math.abs(value - max) ? minKey : maxKey;
    }

    return startRangeBrushDrag(event, {
      update: (pointerEvent, phase) => {
        this.params[activeKey] = valueFromPointer(pointerEvent);
        this.normalizeVolumeSettings(activeKey);
        this.syncGeologyControls();
        return {
          minKey,
          maxKey,
          activeKey,
          min: this.params[minKey],
          max: this.params[maxKey],
          normalizedMin: this.params[minKey],
          normalizedMax: this.params[maxKey],
          phase
        };
      },
      preview: (payload) => onChange?.(false, payload.activeKey, payload),
      commit: (payload) => onChange?.(true, payload.activeKey, payload)
    });
  }

  normalizeVolumeSettings(changedKey = null) {
    const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : fallback));
    [
      ['volumeIsoValue', 0.5],
      ['volumeFilterMin', 0],
      ['volumeFilterMax', 1],
      ['volumeClipXMin', 0],
      ['volumeClipXMax', 1],
      ['volumeClipYMin', 0],
      ['volumeClipYMax', 1],
      ['volumeClipZMin', 0],
      ['volumeClipZMax', 1],
      ['volumeOpacity', 0.5]
    ].forEach(([key, fallback]) => {
      this.params[key] = clamp01(this.params[key], fallback);
    });
    [['volumeFilterMin', 'volumeFilterMax'], ['volumeClipXMin', 'volumeClipXMax'], ['volumeClipYMin', 'volumeClipYMax'], ['volumeClipZMin', 'volumeClipZMax']].forEach(([minKey, maxKey]) => {
      if (Number(this.params[minKey]) > Number(this.params[maxKey])) {
        if (changedKey === minKey) this.params[minKey] = this.params[maxKey];
        else if (changedKey === maxKey) this.params[maxKey] = this.params[minKey];
        else {
          const temp = this.params[minKey];
          this.params[minKey] = this.params[maxKey];
          this.params[maxKey] = temp;
        }
      }
    });
    this.params.volumeRaySteps = Math.max(50, Math.min(500, Math.round(Number(this.params.volumeRaySteps) || 200)));
    this.params.volumePointSize = Math.max(1, Math.min(32, Number(this.params.volumePointSize) || 7));
  }

  syncGeologyControls() {
    const roots = [this.layerPanel, this.controlContainer].filter((root) => root?.isConnected);
    const sync = (selector, value, digits = 2) => {
      roots.forEach((root) => {
        root.querySelectorAll(selector).forEach((input) => {
          const numeric = Number(value);
          if (input === document.activeElement && input.type === 'range') return;
          input.value = Number.isFinite(numeric) ? numeric.toFixed(digits).replace(/\.?0+$/, '') : String(value ?? '');
        });
      });
    };
    ['geologicalBodyOpacity', 'roadwayOpacity', 'boreholeOpacity', 'structureOpacity', 'attributeModelOpacity'].forEach((key) => {
      if (key in this.params) sync(`[data-opacity="${key}"]`, this.params[key], 2);
    });
    [
      ['volumeIsoValue', 2],
      ['volumeFilterMin', 2],
      ['volumeFilterMax', 2],
      ['volumeClipXMin', 2],
      ['volumeClipXMax', 2],
      ['volumeClipYMin', 2],
      ['volumeClipYMax', 2],
      ['volumeClipZMin', 2],
      ['volumeClipZMax', 2],
      ['volumeOpacity', 2],
      ['volumeRaySteps', 0],
      ['volumePointSize', 0]
    ].forEach(([key, digits]) => {
      if (key in this.params) sync(`[data-volume-setting="${key}"]`, this.params[key], digits);
    });
    roots.forEach((root) => {
      root.querySelectorAll('[data-volume-pair]').forEach((row) => {
        const [minKey, maxKey] = String(row.dataset.volumePair || '').split(':');
        const min = Number(this.params[minKey]);
        const max = Number(this.params[maxKey]);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return;
        const minPct = `${min * 100}%`;
        const maxPct = `${max * 100}%`;
        row.style.setProperty('--min-pct', minPct);
        row.style.setProperty('--max-pct', maxPct);
        const range = row.querySelector('[data-volume-range]');
        if (range) {
          range.style.setProperty('--min-pct', minPct);
          range.style.setProperty('--max-pct', maxPct);
          range.setAttribute('aria-valuetext', `${min.toFixed(2)} - ${max.toFixed(2)}`);
        }
      });
    });
  }

  applyLayerState() {
    this.bodyGroup.visible = !!this.params.showGeologicalBody;
    this.boreholeGroup.visible = !!this.params.showBoreholes;
    this.structureGroup.visible = !!this.params.showStructures;
    this.attributeGroup.visible = !!this.params.showAttributeModel;
    this.sceneManager?.setRoadwayVisibleForOwner?.(this.id, !!this.params.showRoadway && !!this.inputs.roadway);
  }

  recolorBodyLayer() {
    const surfaces = this.inputs.geologicalBody?.listSurfaces?.() || [];
    const byId = new Map(surfaces.map((surface, index) => [String(surface.surfaceId), { surface, index }]));
    this.bodyGroup.traverse((child) => {
      if (!child.isMesh || !child.userData?.geologyPick?.surfaceId) return;
      const entry = byId.get(String(child.userData.geologyPick.surfaceId));
      if (!entry) return;
      child.material.color.copy(this.geologicalDisplayColor(this.colorForSurface(entry.surface, entry.index)));
    });
  }

  updatePanels() {
    const body = this.inputs.geologicalBody;
    const bodySummary = body.getSummary?.() || {};
    const attributes = this.inputs.attributeModel?.listAttributes?.() || [];
    const units = body.listUnits?.() || [];
    const surfaces = body.listSurfaces?.() || [];
    const structures = this.inputs.geologicalStructure?.listStructures?.() || [];
    const boreholes = this.inputs.borehole?.listBoreholes?.() || [];
    const profile = body.getRepresentationProfile?.() || body.representationProfile || 'generic';
    const activeAttribute = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.() || '';
    this.layerPanel.querySelector('.geology-layer-content').innerHTML = `
      <div class="geology-panel-summary">
        <span>${escapeHtml(profile)}</span><span>${bodySummary.unitCount || 0} units</span><span>${bodySummary.surfaceCount || 0} surfaces</span><span>${bodySummary.blockCount || 0} blocks</span>
      </div>
      <div class="control-grid geology-controls">
        ${this.layerToggle('showGeologicalBody', 'Geological body')}
        ${this.inputs.roadway ? this.layerToggle('showRoadway', 'Roadway context') : ''}
        ${this.inputs.borehole ? this.layerToggle('showBoreholes', 'Boreholes') : ''}
        ${this.inputs.geologicalStructure ? this.layerToggle('showStructures', 'Structures') : ''}
        ${this.inputs.attributeModel ? this.layerToggle('showAttributeModel', 'Attribute model') : ''}
      </div>
      <div class="geology-control-stack">
        ${this.opacityRow('geologicalBodyOpacity', 'Body opacity')}
        ${this.inputs.roadway ? this.opacityRow('roadwayOpacity', 'Roadway opacity') : ''}
        ${this.inputs.borehole ? this.opacityRow('boreholeOpacity', 'Borehole opacity') : ''}
        ${this.inputs.geologicalStructure ? this.opacityRow('structureOpacity', 'Structure opacity') : ''}
        ${this.inputs.attributeModel ? this.opacityRow('attributeModelOpacity', 'Attribute opacity') : ''}
      </div>
      <label class="field-row">Color mode
        <select data-color-mode>
          ${['geological-unit', 'lithology', 'attribute', 'uniform']
            .map((mode) => `<option value="${mode}" ${this.params.colorMode === mode ? 'selected' : ''}>${mode}</option>`)
            .join('')}
        </select>
      </label>
      ${
        this.inputs.attributeModel
          ? `<label class="field-row">Active attribute
              <select data-active-attribute>${attributes
                .map((attribute) => `<option value="${escapeHtml(attribute)}" ${String(activeAttribute) === String(attribute) ? 'selected' : ''}>${escapeHtml(attribute)}</option>`)
                .join('')}</select>
            </label>`
          : ''
      }
      ${this.inputs.attributeModel ? this.volumeControlsHtml() : ''}
      <details class="geology-object-section geology-collapsible-section">
        <summary><strong>Geological Units</strong><span>${units.length}</span></summary>
        <div class="geology-object-list">${units
          .slice(0, 40)
          .map((unit) => `<button data-select-type="geologicalUnit" data-select-id="${escapeHtml(unit.geologicalUnitId)}"><span>${escapeHtml(unit.geologicalUnitName)}</span><small>${escapeHtml(unit.geologicalUnitType)}</small></button>`)
          .join('') || '<div class="muted-note">No units</div>'}</div>
      </details>
      <details class="geology-object-section geology-collapsible-section">
        <summary><strong>Surfaces</strong><span>${surfaces.length}</span></summary>
        <div class="geology-object-list compact">${surfaces
          .slice(0, 24)
          .map((surface) => `<button data-select-type="geologicalSurface" data-select-id="${escapeHtml(surface.surfaceId)}"><span>${escapeHtml(surface.surfaceId)}</span><small>${escapeHtml(surface.surfaceType)}</small></button>`)
          .join('') || '<div class="muted-note">No surfaces</div>'}</div>
      </details>
      ${
        boreholes.length
          ? `<div class="geology-object-section"><strong>Boreholes</strong><div class="geology-object-list compact">${boreholes
              .slice(0, 28)
              .map((item) => `<button data-select-type="borehole" data-select-id="${escapeHtml(item.boreholeId)}"><span>${escapeHtml(item.boreholeId)}</span><small>${escapeHtml(item.boreholeName)}</small></button>`)
              .join('')}</div></div>`
          : ''
      }
      ${
        structures.length
          ? `<div class="geology-object-section"><strong>Structures</strong><div class="geology-object-list compact">${structures
              .slice(0, 28)
              .map((item) => `<button data-select-type="geologicalStructure" data-select-id="${escapeHtml(item.structureId)}"><span>${escapeHtml(item.structureId)}</span><small>${escapeHtml(item.structureType)}</small></button>`)
              .join('')}</div></div>`
          : ''
      }
    `;
    this.updateAttributePanel();
  }

  layerToggle(key, label) {
    return `<label class="checkbox-row"><span>${label}</span><input data-toggle-layer="${key}" type="checkbox" ${this.params[key] ? 'checked' : ''}></label>`;
  }

  opacityRow(key, label) {
    return this.compactSliderRow({ key, label, min: 0, max: 1, step: 0.05, digits: 2, dataAttr: 'data-opacity' });
  }

  volumeControlsHtml() {
    const grid = this.inputs.attributeModel?.grid;
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    const hasVolume = !!(grid && this.resolveBinaryAttributeKey(this.inputs.attributeModel, active));
    if (!hasVolume) {
      return '<div class="geology-volume-controls"><div class="muted-note">Volume controls are available for grid-backed resource block models.</div></div>';
    }
    const mode = this.getVolumeRenderMode();
    return `
      <div class="geology-volume-controls">
        <div class="geology-volume-header">
          <strong>Attribute Volume Rendering</strong>
          <button type="button" data-volume-reset>Reset</button>
        </div>
        <label class="field-row">Render mode
          <select data-volume-setting="blockRenderMode">
            ${['volume', 'isosurface', 'points']
              .map((value) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${value === 'volume' ? 'Volumetric' : value === 'isosurface' ? 'Isosurface' : 'Points'}</option>`)
              .join('')}
          </select>
        </label>
        ${
          mode === 'points'
            ? `${this.volumeSliderRow('volumePointSize', 'Point size', 1, 32, 1, 0)}`
            : `
              <div class="geology-volume-stack">
                ${this.volumePairRow('volumeFilterMin', 'volumeFilterMax', 'Volume filtering')}
                ${mode === 'isosurface' ? this.volumeSliderRow('volumeIsoValue', 'Isosurface value', 0, 1, 0.01, 2) : ''}
                ${this.volumeSliderRow('volumeOpacity', 'Opacity', 0, 1, 0.01, 2)}
              </div>
              <div class="geology-volume-section-title">Spatial slicing</div>
              <div class="geology-volume-stack">
                ${this.volumePairRow('volumeClipXMin', 'volumeClipXMax', 'X range')}
                ${this.volumePairRow('volumeClipYMin', 'volumeClipYMax', 'Y range')}
                ${this.volumePairRow('volumeClipZMin', 'volumeClipZMax', 'Z range')}
                ${mode === 'volume' ? this.volumeSliderRow('volumeRaySteps', 'Ray steps', 50, 500, 10, 0) : ''}
              </div>
            `
        }
      </div>
    `;
  }

  volumeSliderRow(key, label, min = 0, max = 1, step = 0.01, digits = 2) {
    return this.compactSliderRow({ key, label, min, max, step, digits, dataAttr: 'data-volume-setting' });
  }

  compactSliderRow({ key, label, min, max, step, digits = 2, dataAttr = 'data-volume-setting', valueOverride = null }) {
    const sourceValue = valueOverride ?? this.params[key];
    const value = Number.isFinite(Number(sourceValue)) ? Number(sourceValue) : Number(min) || 0;
    const display = value.toFixed(digits).replace(/\.?0+$/, '');
    return `
      <label class="geology-slider-row">
        <span class="geology-slider-label">${escapeHtml(label)}</span>
        <input class="geology-slider" ${dataAttr}="${escapeHtml(key)}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        <input class="geology-value-input" ${dataAttr}="${escapeHtml(key)}" type="number" min="${min}" max="${max}" step="${step}" value="${display}" inputmode="decimal">
      </label>
    `;
  }

  volumePairRow(minKey, maxKey, label) {
    const minValue = Math.max(0, Math.min(1, Number(this.params[minKey]) || 0));
    const maxValue = Math.max(0, Math.min(1, Number(this.params[maxKey]) || 0));
    return `
      <div class="geology-range-pair" data-volume-pair="${escapeHtml(minKey)}:${escapeHtml(maxKey)}" style="--min-pct:${minValue * 100}%; --max-pct:${maxValue * 100}%">
        <span class="geology-slider-label">${escapeHtml(label)}</span>
        <div class="geology-dual-range" data-volume-range="${escapeHtml(minKey)}:${escapeHtml(maxKey)}" role="slider" tabindex="0" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="1" aria-valuetext="${minValue.toFixed(2)} - ${maxValue.toFixed(2)}">
          <div class="geology-dual-range-track"></div>
          <div class="geology-dual-range-selection"></div>
          <button type="button" class="geology-dual-range-handle min" data-volume-range-handle="min" aria-label="${escapeHtml(label)} min"></button>
          <button type="button" class="geology-dual-range-handle max" data-volume-range-handle="max" aria-label="${escapeHtml(label)} max"></button>
        </div>
        <div class="geology-range-values">
          <input class="geology-value-input" data-volume-setting="${escapeHtml(minKey)}" type="number" min="0" max="1" step="0.01" value="${formatScalar(minValue, 2)}" inputmode="decimal" title="${escapeHtml(label)} min" aria-label="${escapeHtml(label)} min">
          <input class="geology-value-input" data-volume-setting="${escapeHtml(maxKey)}" type="number" min="0" max="1" step="0.01" value="${formatScalar(maxValue, 2)}" inputmode="decimal" title="${escapeHtml(label)} max" aria-label="${escapeHtml(label)} max">
        </div>
      </div>
    `;
  }

  updateLegend() {
    const body = this.inputs.geologicalBody;
    const units = body?.listUnits?.() || [];
    const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
    const binaryKey = this.resolveBinaryAttributeKey(this.inputs.attributeModel, active);
    const showAttribute = (this.params.colorMode === 'attribute' || this.params.showAttributeModel) &&
      this.inputs.attributeModel && active;
    const volumeMeta = showAttribute && binaryKey
      ? this.volumeAttributeMeta(this.inputs.attributeModel, active, this.inputs.attributeModel.binaryAttributes?.[binaryKey])
      : null;
    const primaryLegend = showAttribute
      ? legendGradient({
          label: volumeMeta?.name || active,
          gradient: volumeMeta?.isDiscrete
            ? 'linear-gradient(90deg,#2b8cff,#2dd4bf,#a3e635,#facc15,#fb7185,#c084fc)'
            : 'linear-gradient(90deg,#0a5bff,#00a9ff,#35d35d,#f4df38,#f97316,#ef4444)',
          range: volumeMeta
            ? `${formatScalar(volumeMeta.min)} - ${formatScalar(volumeMeta.max)}${volumeMeta.unit ? ` ${volumeMeta.unit}` : ''}`
            : ''
        })
      : units.length
        ? `${legendList(
            units.slice(0, 12).map((unit, index) => ({
              label: unit.geologicalUnitName || unit.geologicalUnitId || `Unit ${index + 1}`,
              color: unit.color || geologyColorForKey(unit.geologicalUnitType ?? unit.geologicalUnitId, index)
            })),
            { title: 'Geological units' }
          )}${units.length > 12 ? `<div class="muted-note">${units.length - 12} additional units are hidden.</div>` : ''}`
        : legendEmptyState();
    const contextItems = [
      this.inputs.borehole
        ? { label: 'Borehole trajectory', color: '#66d9ef', marker: 'line' }
        : null,
      this.inputs.geologicalStructure
        ? { label: 'Geological structure / fault', color: '#ff6f61', marker: 'line' }
        : null,
      this.inputs.roadway
        ? { label: 'Roadway context', color: '#8f9398', marker: 'line' }
        : null
    ].filter(Boolean);
    this.legendPanel.querySelector('.geology-legend-content').innerHTML = `
      ${primaryLegend}
      ${contextItems.length ? legendList(contextItems, { title: 'Context' }) : ''}
    `;
  }

  updateAttributePanel() {
    if (!this.inputs.attributeModel || !this.attributePanel) return;
    const active = this.params.activeAttribute || this.inputs.attributeModel.getPrimaryAttribute?.();
    const summary = this.inputs.attributeModel.getSummary?.(active) || {};
    const binaryKey = this.resolveBinaryAttributeKey(this.inputs.attributeModel, active);
    const values = binaryKey ? this.inputs.attributeModel.binaryAttributes?.[binaryKey] : null;
    const range = values ? this.attributeRange(this.inputs.attributeModel, active, values) : summary.valueRange;
    const grid = this.inputs.attributeModel.grid;
    const { nx, ny, nz } = grid ? this.gridDimensions(grid) : { nx: 0, ny: 0, nz: 0 };
    const gridCount = nx * ny * nz;
    this.attributePanel.querySelector('.geology-attribute-content').innerHTML = `
      <div class="detail-row"><span>Active attribute</span><strong>${escapeHtml(active || '-')}</strong></div>
      <div class="detail-row"><span>Elements</span><strong>${formatScalar(summary.elementCount || summary.blockCount || gridCount || 0, 0)}</strong></div>
      <div class="detail-row"><span>Blocks</span><strong>${formatScalar(summary.blockCount ?? 0, 0)}</strong></div>
      <div class="detail-row"><span>Grid</span><strong>${escapeHtml(summary.gridSize || '-')}</strong></div>
      <div class="detail-row"><span>Range</span><strong>${
        range ? `${formatScalar(range.min)} - ${formatScalar(range.max)}` : '-'
      }</strong></div>
      <div class="detail-row"><span>Render mode</span><strong>${binaryKey && this.params.blockRenderMode !== 'points' ? 'volume' : this.params.blockRenderMode}</strong></div>
    `;
  }

  handleGeologyPick(entity) {
    if (entity.type === 'geologicalBlockCollection' && entity.elements?.length && Number.isInteger(entity.index)) {
      const block = entity.elements[entity.index] || entity.elements[0];
      if (block) this.setSelection('geologicalBlock', block.elementId ?? block.blockId, block);
      else this.clearGeologicalSelection();
      return;
    }
    if (entity.type === 'geologicalVolume') {
      const voxel = this.pickVolumeVoxel(entity);
      if (voxel) {
        this.setSelection('geologicalBlock', voxel.elementId, voxel);
        return;
      }
      this.clearGeologicalSelection();
      return;
    }
    this.setSelection(entity.type, entity.id, entity);
  }

  pickVolumeVoxel(entity) {
    const object = entity.object;
    const volume = entity.volumeData || object?.userData?.geologyPick?.volumeData;
    const material = object?.material;
    const ray = this.sceneManager?.raycaster?.ray;
    if (!object || !volume || !ray || !material?.uniforms?.map) return null;
    const inverseMatrix = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const localOrigin = ray.origin.clone().applyMatrix4(inverseMatrix);
    const localDir = ray.direction.clone().transformDirection(inverseMatrix).normalize();
    const boxMin = new THREE.Vector3(-0.5, -0.5, -0.5);
    const boxMax = new THREE.Vector3(0.5, 0.5, 0.5);
    const invDir = new THREE.Vector3(
      localDir.x === 0 ? 1e12 : 1 / localDir.x,
      localDir.y === 0 ? 1e12 : 1 / localDir.y,
      localDir.z === 0 ? 1e12 : 1 / localDir.z
    );
    const tMinVec = boxMin.clone().sub(localOrigin).multiply(invDir);
    const tMaxVec = boxMax.clone().sub(localOrigin).multiply(invDir);
    const t1 = tMinVec.clone().min(tMaxVec);
    const t2 = tMinVec.clone().max(tMaxVec);
    const tNear = Math.max(t1.x, t1.y, t1.z);
    const tFar = Math.min(t2.x, t2.y, t2.z);
    if (tNear > tFar || tFar < 0) return null;

    const { nx, ny, nz, values, meta, active } = volume;
    const stepSize = 0.25 / Math.max(nx, ny, nz);
    const maxIterations = Math.max(800, Math.min(5000, Math.ceil((Math.max(tFar, 0) - Math.max(tNear, 0)) / stepSize) + 4));
    const filterMin = material.uniforms.uFilterMin.value;
    const filterMax = material.uniforms.uFilterMax.value;
    const iso = material.uniforms.uIsoThreshold.value;
    const mode = material.uniforms.uRenderMode.value;
    const clipMin = material.uniforms.uClipMin.value;
    const clipMax = material.uniforms.uClipMax.value;
    const range = meta.max - meta.min || 1;
    let t = Math.max(tNear, 0);
    for (let iteration = 0; iteration < maxIterations && t <= tFar; iteration += 1) {
      const p = localOrigin.clone().add(localDir.clone().multiplyScalar(t));
      const tex = p.clone().addScalar(0.5);
      if (tex.x < clipMin.x || tex.y < clipMin.y || tex.z < clipMin.z || tex.x > clipMax.x || tex.y > clipMax.y || tex.z > clipMax.z) {
        t += stepSize;
        continue;
      }
      const ix = Math.max(0, Math.min(nx - 1, Math.floor(tex.x * nx)));
      const iy = Math.max(0, Math.min(ny - 1, Math.floor(tex.y * ny)));
      const iz = Math.max(0, Math.min(nz - 1, Math.floor(tex.z * nz)));
      const index = iz * nx * ny + iy * nx + ix;
      const rawValue = Number(values[index]);
      const normalized = Math.max(0, Math.min(1, (rawValue - meta.min) / range));
      const visible = mode === 1 ? normalized >= iso : normalized >= filterMin && normalized <= filterMax;
      if (Number.isFinite(rawValue) && visible) {
        material.uniforms.uPickedCoord.value.set(ix, iy, iz);
        const bounds = this.gridBounds(volume.grid);
        const size = bounds.max.clone().sub(bounds.min);
        const center = new THREE.Vector3(
          bounds.min.x + ((ix + 0.5) / nx) * size.x,
          bounds.min.y + ((iy + 0.5) / ny) * size.y,
          bounds.min.z + ((iz + 0.5) / nz) * size.z
        );
        const attributeValues = this.volumeAttributeValuesAt(index);
        return {
          elementId: `VOX_${ix}_${iy}_${iz}`,
          blockId: `VOX_${ix}_${iy}_${iz}`,
          centroid: { x: center.x, y: center.y, z: center.z },
          gridIndex: [ix, iy, iz],
          activeAttribute: active,
          value: rawValue,
          attributeValues,
          normalizedValue: normalized,
          size: { x: size.x / nx, y: size.y / ny, z: size.z / nz }
        };
      }
      t += stepSize;
    }
    material.uniforms.uPickedCoord.value.set(-1, -1, -1);
    return null;
  }

  volumeAttributeValuesAt(index) {
    const dataset = this.inputs.attributeModel;
    if (!dataset?.binaryAttributes) return null;
    const result = {};
    (dataset.listAttributes?.() || Object.keys(dataset.binaryAttributes)).forEach((attribute) => {
      const key = this.resolveBinaryAttributeKey(dataset, attribute);
      const value = key ? Number(dataset.binaryAttributes[key]?.[index]) : NaN;
      if (Number.isFinite(value)) result[attribute] = value;
    });
    return result;
  }

  setSelection(type, id, extra = null) {
    const value = id == null ? null : String(id);
    if (type === 'geologicalUnit') this.context.set('selectedGeologicalUnit', value);
    if (type === 'geologicalSurface') {
      this.context.set('selectedSurface', value);
      const surface = this.inputs.geologicalBody?.surfaceMap?.get?.(value);
      if (surface?.geologicalUnitId || surface?.unitId) this.context.set('selectedGeologicalUnit', surface.geologicalUnitId ?? surface.unitId);
    }
    if (type === 'borehole') this.context.set('selectedBorehole', value);
    if (type === 'geologicalStructure') this.context.set('selectedStructure', value);
    if (type === 'geologicalBlock') this.context.set('selectedBlock', value);
    this.context.set('selection', { type, id: value, data: extra || undefined });
  }

  clearGeologicalSelection() {
    [
      'selectedGeologicalUnit',
      'selectedGeologicalBody',
      'selectedSurface',
      'selectedBorehole',
      'selectedStructure',
      'selectedBlock'
    ].forEach((key) => this.context.set(key, null));
    this.context.set('selection', null);
    this.resetVolumePick();
  }

  applyContextSelection(selection) {
    if (!selection || (!(String(selection.type || '').startsWith('geological')) && selection.type !== 'borehole')) {
      this.selected = null;
      this.resetVolumePick();
      this.updateHighlight();
      this.updateDetailPanel();
      return;
    }
    this.selected = selection;
    this.updateHighlight();
    this.updateDetailPanel();
  }

  updateHighlight() {
    this.highlightGroup.clear();
    [this.bodyGroup, this.boreholeGroup, this.structureGroup].forEach((group) => {
      group.traverse((child) => {
        if (!child.userData?.geologyPick) return;
        this.restoreMaterial(child);
        if (this.matchesSelection(child.userData.geologyPick)) this.highlightMaterial(child);
      });
    });
  }

  resetVolumePick() {
    this.attributeGroup?.traverse?.((child) => {
      const materials = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
      materials.forEach((material) => {
        if (material?.uniforms?.uPickedCoord) material.uniforms.uPickedCoord.value.set(-1, -1, -1);
      });
    });
  }

  matchesSelection(pick = {}) {
    const type = this.selected?.type;
    const id = String(this.selected?.id ?? '');
    if (!id) return false;
    if (type === 'geologicalUnit') return String(pick.unitId ?? pick.geologicalUnitId) === id;
    if (type === 'geologicalSurface') return String(pick.surfaceId ?? pick.id) === id;
    if (type === 'borehole') return String(pick.boreholeId ?? pick.id) === id;
    if (type === 'geologicalStructure') return String(pick.structureId ?? pick.id) === id;
    return false;
  }

  restoreMaterial(object) {
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    materials.forEach((material) => {
      const original = this.materialOriginals.get(material);
      if (!original) return;
      material.color?.copy?.(original.color);
      if ('emissive' in material) material.emissive.copy(original.emissive);
      if ('emissiveIntensity' in material) material.emissiveIntensity = original.emissiveIntensity;
    });
  }

  highlightMaterial(object) {
    const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
    materials.forEach((material) => {
      if (!this.materialOriginals.has(material)) {
        this.materialOriginals.set(material, {
          color: material.color?.clone?.() || new THREE.Color('#ffffff'),
          emissive: material.emissive?.clone?.() || new THREE.Color('#000000'),
          emissiveIntensity: material.emissiveIntensity || 0
        });
      }
      material.color?.set?.('#ffd54f');
      if ('emissive' in material) material.emissive.set('#ffd54f');
      if ('emissiveIntensity' in material) material.emissiveIntensity = 0.28;
    });
  }

  selectedObjectCenter() {
    const selected = this.selected;
    if (!selected) return null;
    const box = new THREE.Box3();
    const matches = [];
    this.rootGroup.traverse((child) => {
      if (!child.userData?.geologyPick || !this.matchesSelection(child.userData.geologyPick)) return;
      matches.push(child);
    });
    matches.forEach((object) => box.expandByObject(object));
    if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
    if (selected.type === 'geologicalBlock' && selected.data?.centroid) return geologyPoint(selected.data.centroid);
    return null;
  }

  updateDetailPanel() {
    const content = this.detailPanel?.querySelector('.geology-detail-content');
    if (!content) return;
    if (!this.selected) {
      content.innerHTML = '<div class="empty-state">Select a geological object to inspect details.</div>';
      return;
    }
    content.innerHTML = this.detailHtml(this.selected);
  }

  detailHtml(selection) {
    const id = String(selection.id ?? '');
    if (selection.type === 'geologicalUnit') {
      const unit = this.inputs.geologicalBody.getUnit?.(id) || this.inputs.geologicalBody.getBody?.(id);
      return this.rows([
        ['Unit ID', id],
        ['Name', unit?.geologicalUnitName ?? unit?.bodyName],
        ['Type', unit?.geologicalUnitType ?? unit?.bodyType],
        ['Lithology', unit?.lithology],
        ['Layer order', unit?.layerOrder ?? unit?.layer_order],
        ['Color', unit?.color]
      ]);
    }
    if (selection.type === 'geologicalSurface') {
      const surface = this.inputs.geologicalBody.surfaceMap?.get?.(id);
      return this.rows([
        ['Surface ID', id],
        ['Unit ID', surface?.geologicalUnitId ?? surface?.unitId],
        ['Body ID', surface?.bodyId],
        ['Surface type', surface?.surfaceType],
        ['Mesh part', surface?.meshPartId ?? surface?.mesh_part_id],
        ['Role', surface?.role]
      ]);
    }
    if (selection.type === 'borehole') {
      const borehole = this.inputs.borehole?.getBorehole?.(id);
      const intervals = this.inputs.borehole?.getIntervals?.(id) || [];
      return this.rows([
        ['Borehole ID', id],
        ['Label', borehole?.boreholeName],
        ['Collar', borehole?.collar ? `${formatScalar(borehole.collar.x)}, ${formatScalar(borehole.collar.y)}, ${formatScalar(borehole.collar.z)}` : '-'],
        ['Total depth', borehole?.totalDepth ?? borehole?.total_depth],
        ['Interval count', intervals.length],
        ['Sample count', this.inputs.borehole?.getSamples?.(id)?.length ?? 0]
      ]);
    }
    if (selection.type === 'geologicalStructure') {
      const structure = this.inputs.geologicalStructure?.getStructure?.(id);
      return this.rows([
        ['Structure ID', id],
        ['Name', structure?.structureName],
        ['Type', structure?.structureType],
        ['Strike', structure?.strike],
        ['Dip', structure?.dip],
        ['Throw', structure?.throw],
        ['Width', structure?.width],
        ['Risk level', structure?.riskLevel ?? structure?.risk_level],
        ['Confidence', structure?.confidence]
      ]);
    }
    if (selection.type === 'geologicalBlock') {
      const block = selection.data || this.inputs.attributeModel?.getBlock?.(id);
      const active = this.params.activeAttribute || this.inputs.attributeModel?.getPrimaryAttribute?.();
      const baseRows = [
        ['Block / element ID', id],
        ['Grid index', Array.isArray(block?.gridIndex) ? block.gridIndex.join(', ') : null],
        ['Centroid', block?.centroid ? `${formatScalar(block.centroid.x)}, ${formatScalar(block.centroid.y)}, ${formatScalar(block.centroid.z)}` : '-'],
        ['Size', block?.size ? `${formatScalar(block.size.x)}, ${formatScalar(block.size.y)}, ${formatScalar(block.size.z)}` : '-'],
        ['Lithology', block?.lithology],
        ['Orebody ID', block?.orebodyId ?? block?.bodyId],
        [block?.activeAttribute || active || 'Value', this.inputs.attributeModel?.getValue?.(id, active) ?? block?.value],
        ['Normalized value', block?.normalizedValue],
        ['Resource category', block?.resourceCategory]
      ];
      const attributeRows = Object.entries(block?.attributeValues || {}).map(([name, value]) => [name, formatScalar(value, 4)]);
      return this.rows(baseRows) + (attributeRows.length ? `<div class="geology-detail-subtitle">Voxel attributes</div>${this.rows(attributeRows)}` : '');
    }
    return '<div class="empty-state">No detail available for this selection.</div>';
  }

  rows(rows) {
    return rows
      .filter(([, value]) => value != null && value !== '')
      .map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join('');
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    this.sceneManager?.clearRoadwayOwnerState?.(this.id);
    [this.layerPanel, this.legendPanel, this.detailPanel, this.attributePanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}
