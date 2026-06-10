import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { createWorkspacePanel } from '../../../ui/RuntimePanels.js';
import { generateCssGradient, sampleColor } from '../../../utils/colors.js';
import { appPath } from '../../../utils/appPath.js';
import { createSectionFrame } from '../../geometry/SectionFrame.js';
import { buildGeologicalSectionResult } from '../../geology/GeologicalSectionBuilder.js';
import { buildRoadwayGeologyRelationResult } from '../../geology/RoadwayGeologyRelationBuilder.js';
import {
  attributeDistributionControlsHtml,
  attributeHistogramHtml,
  roadwayGeologyControlsHtml,
  roadwayGeologyTableHtml
} from './GeologyAnalysisPanels.js';
import { startRangeBrushDrag } from './RangeBrushController.js';
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
} from './GeologyVolumeRenderer.js';
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
} from '../shared/OperatorRuntimeUtils.js';

function optionalFiniteNumber(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

class GeologicalModelOverviewRuntime {
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
    this.createPanels();
    this.registerVisualContributions();
    this.installHandlers();
    this.updatePanels();
    this.updateLegend();
    this.updateDetailPanel();
    this.applyLayerState();
    this.sceneManager?.setGeologicalPickables?.(this.id, this.pickables, (entity) => this.handleGeologyPick(entity));
    if (this.params.autoFocusOnSelection && this.rootGroup.children.length) this.sceneManager?.focusOnObject?.(this.rootGroup);
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
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping?.(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping?.(), roadway);
    else this.sceneManager.buildRoadway?.(roadway);
    this.sceneManager.setRoadwayVisible?.(true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacity?.(this.params.roadwayOpacity);
  }

  async renderAllLayers() {
    await this.renderGeologicalBodyLayer();
    this.renderBoreholeLayer();
    await this.renderStructureLayer();
    this.renderAttributeLayer();
  }

  async loadObjText(dataset, sourceKey = 'geometryPath') {
    const raw = dataset?.adaptorResults?.geometry?.raw?.text;
    if (raw) return raw;
    const path = dataset?.source?.[sourceKey] || dataset?.source?.geometryPath;
    if (!path) return '';
    try {
      const response = await fetch(appPath(path));
      return response.ok ? response.text() : '';
    } catch (error) {
      console.warn('[MineVis Geological Model Overview] Failed to load OBJ geometry:', path, error);
      return '';
    }
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
    return new THREE.MeshLambertMaterial({
      color: this.geologicalDisplayColor(color),
      transparent: bodyOpacity < 0.98,
      opacity: bodyOpacity,
      side: THREE.DoubleSide,
      depthWrite: bodyOpacity >= 0.98
    });
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
      const object = new OBJLoader().parse(objText);
      const layeredSurfaceMeshes = new Map();
      let fallbackIndex = 0;
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.computeVertexNormals?.();
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
      this.geologicalSurfaceMeshIndex = layeredSurfaceMeshes;
      object.updateMatrixWorld(true);
      const sideWallGroup = this.createLayeredShellSideWallGroup(layeredSurfaceMeshes);
      this.bodyGroup.add(object);
      if (sideWallGroup?.children?.length) {
        this.bodyGroup.add(sideWallGroup);
      }
    }
    this.renderGeologicalBlocksFromBody();
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

  renderBoreholeLayer() {
    const boreholeDataset = this.inputs.borehole;
    if (!boreholeDataset) return;
    boreholeDataset.listBoreholes().forEach((borehole) => {
      const rawPoints = boreholeDataset.getTrajectory(borehole.boreholeId);
      const points = rawPoints.map(geologyPoint);
      const intervals = (boreholeDataset.getIntervals?.(borehole.boreholeId) || [])
        .filter((interval) => Number.isFinite(Number(interval.depthFrom)) && Number.isFinite(Number(interval.depthTo)) && Number(interval.depthTo) > Number(interval.depthFrom))
        .sort((a, b) => Number(a.depthFrom) - Number(b.depthFrom));
      let renderedSegments = 0;
      intervals.forEach((interval, index) => {
        const segment = sliceBoreholePathByMeasure(rawPoints, interval.depthFrom, interval.depthTo);
        const lithology = interval.lithology ?? interval.attributeValue ?? interval.attribute_value ?? interval.rock_type ?? interval.value ?? interval.grade;
        if (this.addBoreholeSegmentTube(segment, this.colorForLithology(lithology, index), borehole, interval)) renderedSegments += 1;
      });
      if (!renderedSegments && points.length >= 2) {
        this.addBoreholeSegmentTube(points, '#66d9ef', borehole, null);
      }
      const collar = this.resolveBoreholeCollar(borehole, rawPoints, points);
      this.addBoreholeCollarCone(collar, borehole);
    });
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

  addBoreholeCollarCone(collar, borehole = {}) {
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
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4.4, 9.5, 18), coneMaterial);
    cone.position.copy(collar).add(new THREE.Vector3(0, 7, 0));
    cone.rotation.x = Math.PI;
    cone.renderOrder = 39;
    cone.userData.geologyPick = {
      type: 'borehole',
      id: borehole.boreholeId,
      boreholeId: borehole.boreholeId,
      label: borehole.boreholeName
    };
    this.pickables.push(cone);
    this.boreholeGroup.add(cone);
  }

  addBoreholeSegmentTube(points = [], color = '#66d9ef', borehole = {}, interval = null) {
    const compact = points
      .map((point) => (point?.isVector3 ? point.clone() : geologyPoint(point)))
      .filter((point, index, list) => index === 0 || point.distanceToSquared(list[index - 1]) > 1e-6);
    if (compact.length < 2) return false;
    const curve = new THREE.CatmullRomCurve3(compact);
    const geometry = new THREE.TubeGeometry(curve, Math.max(2, compact.length * 3), 1.05, 8, false);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
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
    mesh.userData.geologyPick = {
      type: 'borehole',
      id: borehole.boreholeId,
      boreholeId: borehole.boreholeId,
      intervalId: interval?.id ?? interval?.intervalId ?? interval?.interval_id,
      lithology: interval?.lithology ?? interval?.attributeValue ?? interval?.attribute_value,
      label: borehole.boreholeName
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
      const object = new OBJLoader().parse(objText);
      let fallbackIndex = 0;
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.computeVertexNormals?.();
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
        show: () => this.sceneManager.setRoadwayVisible?.(true),
        hide: () => this.sceneManager.setRoadwayVisible?.(false),
        setOpacity: (value) => {
          this.params.roadwayOpacity = Number(value);
          this.sceneManager.setRoadwayOpacity?.(Number(value));
        },
        focus: () => this.sceneManager.focusOnRoadway?.(),
        cleanup: () => this.sceneManager.setRoadwayVisible?.(false)
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
        visible: panel.style.display !== 'none',
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        cleanup: () => panel.remove()
      });
    });
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
      if (target.dataset.opacity === 'roadwayOpacity') this.sceneManager.setRoadwayOpacity?.(value);
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
    this.sceneManager?.setRoadwayVisible?.(!!this.params.showRoadway && !!this.inputs.roadway);
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
    const volumeMeta = binaryKey ? this.volumeAttributeMeta(this.inputs.attributeModel, active, this.inputs.attributeModel.binaryAttributes?.[binaryKey]) : null;
    const rows =
      (this.params.colorMode === 'attribute' || this.params.showAttributeModel) && this.inputs.attributeModel && active
        ? `<div class="geology-gradient"><span>${escapeHtml(volumeMeta?.name || active)}</span><div style="background:${
            volumeMeta?.isDiscrete
              ? 'linear-gradient(90deg,#2b8cff,#2dd4bf,#a3e635,#facc15,#fb7185,#c084fc)'
              : 'linear-gradient(90deg,#0a5bff,#00a9ff,#35d35d,#f4df38,#f97316,#ef4444)'
          }"></div><small>${volumeMeta ? `${formatScalar(volumeMeta.min)} - ${formatScalar(volumeMeta.max)}${volumeMeta.unit ? ` ${escapeHtml(volumeMeta.unit)}` : ''}` : ''}</small></div>`
        : units
            .slice(0, 12)
            .map((unit, index) => `<div><span class="legend-dot" style="background:${escapeHtml(unit.color || geologyColorForKey(unit.geologicalUnitType ?? unit.geologicalUnitId, index))}"></span>${escapeHtml(unit.geologicalUnitName)}</div>`)
            .join('');
    this.legendPanel.querySelector('.geology-legend-content').innerHTML = `
      <div class="route-legend-list">${rows || '<div class="muted-note">No legend entries</div>'}</div>
      <div class="geology-symbols">
        ${this.inputs.borehole ? '<div><span class="legend-dot" style="background:#66d9ef"></span>Borehole trajectory</div>' : ''}
        ${this.inputs.geologicalStructure ? '<div><span class="legend-dot" style="background:#ff6f61"></span>Structure / fault</div>' : ''}
        ${this.inputs.roadway ? '<div><span class="legend-dot" style="background:#8f9398"></span>Roadway context</div>' : ''}
      </div>
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
    [this.layerPanel, this.legendPanel, this.detailPanel, this.attributePanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

class BoreholeStratigraphyCorrelationRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
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
    return super.matchesSelection(pick);
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
    return super.detailHtml(selection);
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

class GeologicalAttributeDistributionAnalysisRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
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
      this.sceneManager?.setRoadwayVisible?.(false);
      return;
    }
    return super.initializeRoadwayContext();
  }

  applyLayerState() {
    this.bodyGroup.visible = !!(this.params.showContextElements && this.params.showGeologicalBodyContext && this.inputs.geologicalBody);
    this.boreholeGroup.visible = !!this.params.showBoreholes;
    this.structureGroup.visible = !!(this.params.showContextElements && this.params.showStructureContext && this.inputs.geologicalStructure);
    this.attributeGroup.visible = !!this.params.showAttributeModel;
    this.sceneManager?.setRoadwayVisible?.(!!(this.inputs.roadway && this.params.showContextElements && this.params.showRoadwayContext));
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
        show: () => this.sceneManager.setRoadwayVisible?.(true),
        hide: () => this.sceneManager.setRoadwayVisible?.(false),
        setOpacity: (value) => this.sceneManager.setRoadwayOpacity?.(Number(value)),
        focus: () => this.sceneManager.focusOnRoadway?.(),
        cleanup: () => this.sceneManager.setRoadwayVisible?.(false)
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
      this.sceneManager?.setRoadwayVisible?.(!!(this.inputs.roadway && this.params.showContextElements && this.params.showRoadwayContext));
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
    return super.matchesSelection(pick);
  }

  updateHighlight() {
    super.updateHighlight();
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
    return super.detailHtml(selection);
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.controlDisposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearGeologicalPickables?.(this.id);
    [this.layerPanel, this.correlationPanel, this.attributePanel, this.detailPanel, this.legendPanel].forEach((panel) => panel?.remove?.());
    if (this.rootGroup) {
      this.sceneManager?.scene?.remove?.(this.rootGroup);
      disposeThreeObject(this.rootGroup);
    }
  }
}

class RoadwayGeologyRelationshipAnalysisRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
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
    if (roadway?.objText) await this.sceneManager.loadRoadwayModel(null, roadway.objText, roadway.getMeshPartsMapping?.(), roadway);
    else if (roadway?.modelPath) await this.sceneManager.loadRoadwayModel(roadway.modelPath, null, roadway.getMeshPartsMapping?.(), roadway);
    else this.sceneManager.buildRoadway?.(roadway);
    this.sceneManager.setRoadwayVisible?.(true);
    this.sceneManager.setRoadwayBaseColor?.('#8f9398');
    this.sceneManager.setRoadwayOpacity?.(0.16);
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
      show: () => this.sceneManager.setRoadwayVisible?.(true),
      hide: () => this.sceneManager.setRoadwayVisible?.(false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacity?.(Number(value)),
      focus: () => this.sceneManager.focusOnRoadway?.(),
      cleanup: () => this.sceneManager.setRoadwayVisible?.(false)
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
    const ctx = canvas.getContext('2d');
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
    const sx = (canvas.width - pad * 2) / Math.max(1, maxX - minX);
    const sz = (canvas.height - pad * 2) / Math.max(1, maxZ - minZ);
    const scale = Math.min(sx, sz);
    const map = (point) => ({ x: pad + (point.x - minX) * scale, y: canvas.height - pad - (point.z - minZ) * scale });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f1722';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    const x = ((event.clientX - rect.left) / rect.width) * event.target.width;
    const y = ((event.clientY - rect.top) / rect.height) * event.target.height;
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
    super.handleGeologyPick(entity);
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

class GeologicalSectionAnalysisRuntime extends GeologicalModelOverviewRuntime {
  constructor(nodeModel, inputs = {}) {
    super(nodeModel, inputs);
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
    if (this.bodyObjText) {
      try {
        const object = new OBJLoader().parse(this.bodyObjText);
        object.updateMatrixWorld(true);
        box.expandByObject(object);
      } catch (error) {
        console.warn('[MineVis Geological Section Analysis] Failed to compute body bounds:', error);
      }
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
      structureObjText: this.structureObjText
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
    if (!this.params.showGeologicalBody || !this.bodyObjText) return;
    let object = null;
    try {
      object = new OBJLoader().parse(this.bodyObjText);
    } catch (error) {
      console.warn('[MineVis Geological Section Analysis] Failed to render cutaway body:', error);
      return;
    }
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
    this.sceneManager?.setRoadwayVisible?.(!!this.params.showRoadway && !!this.inputs.roadway);
  }

  createSectionPanels() {
    this.sectionViewPanel = createWorkspacePanel('2D Geological Section View', 'geological-section-view-panel', '<canvas class="geological-section-canvas" width="720" height="390"></canvas><div class="geological-section-tooltip"></div>');
    this.layerPanel = createWorkspacePanel('Section Control Panel', 'geological-section-control-panel', '<div class="geological-section-control-content"></div>');
    this.legendPanel = createWorkspacePanel('Section Legend', 'geological-section-legend-panel', '<div class="geology-legend-content"></div>');
    this.detailPanel = createWorkspacePanel('Section Summary / Detail', 'geological-section-detail-panel', '<div class="geology-detail-content"></div>');
    this.attributePanel = null;
    Object.assign(this.sectionViewPanel.style, { left: '18px', bottom: '24px', width: '760px' });
    Object.assign(this.layerPanel.style, { right: '330px', top: '92px', width: '360px' });
    Object.assign(this.legendPanel.style, { left: '18px', top: '92px', width: '280px' });
    Object.assign(this.detailPanel.style, { right: '330px', top: '520px', width: '330px' });
    this.sectionCanvas = this.sectionViewPanel.querySelector('.geological-section-canvas');
    this.sectionTooltip = this.sectionViewPanel.querySelector('.geological-section-tooltip');
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
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
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
      if (this.sectionTooltip) this.sectionTooltip.style.display = 'none';
      this.renderSectionCanvas();
    };
    this.sectionCanvas.addEventListener('pointermove', pointer);
    this.sectionCanvas.addEventListener('click', click);
    this.sectionCanvas.addEventListener('pointerleave', leave);
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('pointermove', pointer));
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('click', click));
    this.disposers.push(() => this.sectionCanvas?.removeEventListener('pointerleave', leave));
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
      this.sectionTooltip.style.display = 'none';
      return;
    }
    this.sectionTooltip.style.display = 'block';
    this.sectionTooltip.style.left = `${event.clientX + 12}px`;
    this.sectionTooltip.style.top = `${event.clientY + 12}px`;
    this.sectionTooltip.innerHTML = this.tooltipHtml(hit.element);
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
    return super.matchesSelection(pick);
  }

  cleanup() {
    window.clearTimeout(this.recomputeTimer);
    super.cleanup();
    this.sectionViewPanel?.remove?.();
  }
}


const GeologicalModelOverviewInputRequirements = {
  geologicalBody: {
    class: 'GeologicalBody',
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  }
};

const GeologicalSectionAnalysisInputRequirements = {
  geologicalBody: {
    class: 'GeologicalBody',
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  }
};

const BoreholeStratigraphyCorrelationInputRequirements = {
  borehole: {
    class: 'Borehole',
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  }
};

const GeologicalAttributeDistributionInputRequirements = {
  attributeModel: {
    class: 'GeologicalAttributeModel',
    requiredTemplates: ['Geometry', 'Field']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  roadway: {
    class: 'Roadway',
    optional: true,
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  }
};

const RoadwayGeologyRelationshipInputRequirements = {
  roadway: {
    class: 'Roadway',
    requiredTemplates: ['Geometry', 'Graph', 'Relation']
  },
  geologicalBody: {
    class: 'GeologicalBody',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  geologicalStructure: {
    class: 'GeologicalStructure',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Relation']
  },
  attributeModel: {
    class: 'GeologicalAttributeModel',
    optional: true,
    requiredTemplates: ['Geometry', 'Field']
  },
  borehole: {
    class: 'Borehole',
    optional: true,
    requiredTemplates: ['Registry', 'Geometry', 'Field', 'Relation']
  }
};

const GeologicalModelOverviewDefinition = {
  typeId: 'GeologicalModelOverviewOperator',
  label: 'Geological Model Overview',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'resource',
      'overview',
      '3d-scene',
      'layer-control',
      'selection-linked',
      'borehole',
      'fault',
      'attribute-model'
    ]
  },
  inputRequirements: GeologicalModelOverviewInputRequirements,
  ports: [
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset' },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
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
    autoFocusOnSelection: true
  },
  paramSchema: [
    { key: 'showGeologicalBody', label: 'Show geological body', type: 'boolean' },
    { key: 'showRoadway', label: 'Show roadway', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showAttributeModel', label: 'Show attribute model', type: 'boolean' },
    { key: 'geologicalBodyOpacity', label: 'Body opacity', type: 'number' },
    { key: 'roadwayOpacity', label: 'Roadway opacity', type: 'number' },
    { key: 'boreholeOpacity', label: 'Borehole opacity', type: 'number' },
    { key: 'structureOpacity', label: 'Structure opacity', type: 'number' },
    { key: 'attributeModelOpacity', label: 'Attribute opacity', type: 'number' },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { key: 'blockRenderMode', label: 'Block render mode', type: 'select', options: ['volume', 'points', 'isosurface'] },
    { key: 'volumeIsoValue', label: 'Default isosurface value', type: 'number' },
    { key: 'volumeFilterMin', label: 'Default volume filter min', type: 'number' },
    { key: 'volumeFilterMax', label: 'Default volume filter max', type: 'number' },
    { key: 'volumeOpacity', label: 'Default volume opacity', type: 'number' },
    { key: 'volumeRaySteps', label: 'Default ray steps', type: 'number' },
    { key: 'volumePointSize', label: 'Default point size', type: 'number' },
    { key: 'showLabels', label: 'Show labels', type: 'boolean' },
    { key: 'showSelectedLabel', label: 'Show selected label', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'colorMode', label: 'Color', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { type: 'checkbox', key: 'showGeologicalBody', label: 'Body' },
    { type: 'checkbox', key: 'showBoreholes', label: 'Boreholes' },
    { type: 'checkbox', key: 'showStructures', label: 'Structures' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new GeologicalModelOverviewRuntime(nodeModel, inputs);
      }
    };
  }
};

const GeologicalSectionAnalysisDefinition = {
  typeId: 'GeologicalSectionAnalysisOperator',
  label: 'Geological Section Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'section',
      'slice',
      'cutaway',
      'clipping',
      'mesh',
      'volume',
      'block-model',
      'borehole',
      'fault',
      'roadway',
      'linked-view',
      'produces-dataset'
    ]
  },
  inputRequirements: GeologicalSectionAnalysisInputRequirements,
  ports: [
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset' },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    sectionMode: 'axis-aligned',
    axis: 'X',
    position: 0,
    thickness: 5,
    showCutaway: true,
    clippingSide: 'positive',
    showSectionPlane: true,
    showGeologicalBody: true,
    showRoadway: true,
    showBoreholes: true,
    showStructures: true,
    showAttributeModel: true,
    activeAttribute: null,
    colorMode: 'geological-unit',
    autoUpdate: true,
    maxRenderedBlocksInSection: 5000
  },
  paramSchema: [
    { key: 'sectionMode', label: 'Section mode', type: 'select', options: ['axis-aligned', 'vertical-two-point'] },
    { key: 'axis', label: 'Axis', type: 'select', options: ['X', 'Y', 'Z'] },
    { key: 'position', label: 'Position', type: 'number' },
    { key: 'thickness', label: 'Thickness', type: 'number' },
    { key: 'showCutaway', label: 'Show cutaway', type: 'boolean' },
    { key: 'clippingSide', label: 'Clipping side', type: 'select', options: ['positive', 'negative', 'both'] },
    { key: 'showGeologicalBody', label: 'Show geological body', type: 'boolean' },
    { key: 'showRoadway', label: 'Show roadway', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showAttributeModel', label: 'Show attribute model', type: 'boolean' },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'lithology', 'attribute', 'uniform'] },
    { key: 'maxRenderedBlocksInSection', label: 'Max section blocks', type: 'number' },
    { key: 'autoUpdate', label: 'Auto update', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'axis', label: 'Axis', options: ['X', 'Y', 'Z'] },
    { type: 'number', key: 'position', label: 'Position' },
    { type: 'number', key: 'thickness', label: 'Thickness' },
    { type: 'checkbox', key: 'showCutaway', label: 'Cutaway' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new GeologicalSectionAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const BoreholeStratigraphyCorrelationDefinition = {
  typeId: 'BoreholeStratigraphyCorrelationOperator',
  label: 'Borehole & Stratigraphy Correlation',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'borehole',
      'stratigraphy',
      'correlation',
      'well-log',
      'section',
      'linked-view',
      'model-validation',
      'attribute',
      'interpretation'
    ]
  },
  inputRequirements: BoreholeStratigraphyCorrelationInputRequirements,
  ports: [
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
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
    activeAttribute: null,
    maxBoreholesInCanvas: 12,
    autoSelectBoreholesNearSection: true,
    sectionDistanceTolerance: 20,
    boreholeOpacity: 1,
    logPanelWidth: 160
  },
  paramSchema: [
    { key: 'displayMode', label: 'Display mode', type: 'select', options: ['single-log', 'correlation-canvas'] },
    { key: 'depthReference', label: 'Depth reference', type: 'select', options: ['depth', 'elevation'] },
    { key: 'alignmentMode', label: 'Alignment mode', type: 'select', options: ['depth', 'elevation'] },
    { key: 'boreholeOrder', label: 'Borehole order', type: 'select', options: ['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'] },
    { key: 'show3DLayer', label: 'Show 3D layer', type: 'boolean' },
    { key: 'showLogPanel', label: 'Show log panel', type: 'boolean' },
    { key: 'showCorrelationCanvas', label: 'Show correlation canvas', type: 'boolean' },
    { key: 'showCorrelationLines', label: 'Show correlation lines', type: 'boolean' },
    { key: 'showLithology', label: 'Show lithology', type: 'boolean' },
    { key: 'showAssays', label: 'Show assays', type: 'boolean' },
    { key: 'showModelIntersections', label: 'Show model intersections', type: 'boolean' },
    { key: 'maxBoreholesInCanvas', label: 'Max boreholes in canvas', type: 'number' },
    { key: 'autoSelectBoreholesNearSection', label: 'Auto select near section', type: 'boolean' },
    { key: 'boreholeOpacity', label: 'Borehole opacity', type: 'number' }
  ],
  inlineControls: [
    { type: 'select', key: 'displayMode', label: 'Mode', options: ['single-log', 'correlation-canvas'] },
    { type: 'select', key: 'boreholeOrder', label: 'Order', options: ['user-selection', 'name', 'section-distance', 'spatial-x', 'spatial-y'] },
    { type: 'checkbox', key: 'showCorrelationLines', label: 'Correlation lines' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new BoreholeStratigraphyCorrelationRuntime(nodeModel, inputs);
      }
    };
  }
};

const GeologicalAttributeDistributionAnalysisDefinition = {
  typeId: 'GeologicalAttributeDistributionAnalysisOperator',
  label: 'Geological Attribute Distribution Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'resource',
      'attribute-field',
      'block-model',
      'volume',
      'surface-attribute',
      'threshold',
      'histogram',
      'linked-brushing',
      'target-zone',
      'resource-evaluation',
      'risk-analysis'
    ]
  },
  inputRequirements: GeologicalAttributeDistributionInputRequirements,
  ports: [
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
    activeAttribute: null,
    colorMode: 'continuous',
    colormap: 'viridis',
    valueRangeMode: 'auto',
    minValue: null,
    maxValue: null,
    filterMode: 'highlight',
    renderMode: 'volume',
    blockRenderMode: 'volume',
    maxRenderedElements: 8000,
    showHistogram: true,
    showTargetZone: true,
    showContextElements: true,
    selectedOpacity: 0.95,
    contextOpacity: 0.12,
    attributeLayerOpacity: 0.75,
    showRoadwayContext: true,
    showGeologicalBodyContext: true,
    showStructureContext: true
  },
  paramSchema: [
    { key: 'activeAttribute', label: 'Active attribute', type: 'text' },
    { key: 'colormap', label: 'Colormap', type: 'select', options: ['viridis', 'heat', 'rainbow'] },
    { key: 'filterMode', label: 'Filter mode', type: 'select', options: ['highlight', 'selected-only', 'hide-filtered'] },
    { key: 'blockRenderMode', label: 'Render mode', type: 'select', options: ['volume', 'isosurface', 'points'] },
    { key: 'maxRenderedElements', label: 'Max rendered elements', type: 'number' },
    { key: 'showHistogram', label: 'Show histogram', type: 'boolean' },
    { key: 'showTargetZone', label: 'Show target zone', type: 'boolean' },
    { key: 'showContextElements', label: 'Show context elements', type: 'boolean' },
    { key: 'attributeLayerOpacity', label: 'Attribute opacity', type: 'number' },
    { key: 'showRoadwayContext', label: 'Show roadway context', type: 'boolean' },
    { key: 'showGeologicalBodyContext', label: 'Show geological body context', type: 'boolean' },
    { key: 'showStructureContext', label: 'Show structure context', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'colormap', label: 'Colormap', options: ['viridis', 'heat', 'rainbow'] },
    { type: 'select', key: 'filterMode', label: 'Filter', options: ['highlight', 'selected-only', 'hide-filtered'] },
    { type: 'checkbox', key: 'showHistogram', label: 'Histogram' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new GeologicalAttributeDistributionAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

const RoadwayGeologyRelationshipAnalysisDefinition = {
  typeId: 'RoadwayGeologyRelationshipAnalysisOperator',
  label: 'Roadway-Geology Relationship Analysis',
  kind: 'operator',
  category: 'Operator',
  libraryCategory: 'Spatial',
  color: '#f2a51a',
  taxonomy: {
    primaryClass: 'Spatial',
    auxiliaryTags: [
      'geology',
      'roadway',
      'relationship',
      'fault-proximity',
      'attribute-sampling',
      'risk',
      'section',
      'profile',
      'topological-context',
      'linked-view',
      'diagnostic'
    ]
  },
  inputRequirements: RoadwayGeologyRelationshipInputRequirements,
  ports: [
    { id: 'roadway', name: 'Roadway', direction: 'in', type: 'RoadwayDataset' },
    { id: 'geologicalBody', name: 'Geological Body', direction: 'in', type: 'GeologicalBodyDataset', optional: true },
    { id: 'geologicalStructure', name: 'Geological Structure', direction: 'in', type: 'GeologicalStructureDataset', optional: true },
    { id: 'attributeModel', name: 'Geological Attribute Model', direction: 'in', type: 'GeologicalAttributeModelDataset', optional: true },
    { id: 'borehole', name: 'Borehole', direction: 'in', type: 'BoreholeDataset', optional: true },
    { id: 'operator', name: 'Function', direction: 'out', type: 'OperatorRef' }
  ],
  defaultParams: {
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
    autoCreateSectionFromSelectedRoadway: false
  },
  paramSchema: [
    { key: 'analysisMode', label: 'Analysis mode', type: 'select', options: ['geological-unit', 'structure-proximity', 'attribute-sampling', 'risk-level'] },
    { key: 'colorMode', label: 'Color mode', type: 'select', options: ['geological-unit', 'structure-distance', 'active-attribute', 'risk-level', 'uniform'] },
    { key: 'activeAttribute', label: 'Active attribute', type: 'text' },
    { key: 'structureWarningDistance', label: 'Structure warning distance', type: 'number' },
    { key: 'structureCriticalDistance', label: 'Structure critical distance', type: 'number' },
    { key: 'attributeThreshold', label: 'Attribute threshold', type: 'number' },
    { key: 'attributeRiskDirection', label: 'Attribute risk direction', type: 'select', options: ['high', 'low'] },
    { key: 'sampleInterval', label: 'Sample interval', type: 'number' },
    { key: 'maxSamplesPerEdge', label: 'Max samples per edge', type: 'number' },
    { key: 'filterRiskLevel', label: 'Risk filter', type: 'select', options: ['all', 'low', 'medium', 'high'] },
    { key: 'showRoadwayOverlay', label: 'Show roadway overlay', type: 'boolean' },
    { key: 'showGeologicalBodyContext', label: 'Show geological body context', type: 'boolean' },
    { key: 'showStructures', label: 'Show structures', type: 'boolean' },
    { key: 'showBoreholes', label: 'Show boreholes', type: 'boolean' },
    { key: 'showProfile', label: 'Show profile', type: 'boolean' }
  ],
  inlineControls: [
    { type: 'select', key: 'analysisMode', label: 'Mode', options: ['risk-level', 'geological-unit', 'structure-proximity', 'attribute-sampling'] },
    { type: 'select', key: 'colorMode', label: 'Color', options: ['risk-level', 'geological-unit', 'structure-distance', 'active-attribute', 'uniform'] },
    { type: 'checkbox', key: 'showProfile', label: 'Profile' }
  ],
  createRuntime() {
    return {
      createOperator(nodeModel, inputs) {
        return new RoadwayGeologyRelationshipAnalysisRuntime(nodeModel, inputs);
      }
    };
  }
};

export const GeologyOperatorNodeDefinitions = [
  GeologicalModelOverviewDefinition,
  GeologicalSectionAnalysisDefinition,
  BoreholeStratigraphyCorrelationDefinition,
  GeologicalAttributeDistributionAnalysisDefinition,
  RoadwayGeologyRelationshipAnalysisDefinition
];
