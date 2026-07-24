import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fetchText } from '../core/adaptors/adaptorUtils.js';
import { parseObjAsync } from './AsyncObjParser.js';
import { SceneInteractionRouter } from './SceneInteractionRouter.js';
import {
  createRoadwayFieldLayer,
  createRoadwaySelectionOverlay,
  disposeRoadwayFieldLayer,
  setRoadwayFieldLayerOpacity
} from './RoadwayFieldLayer.js';

const SENSOR_MARKER_RADIUS = 2.0;
const SENSOR_PICK_RADIUS = 3.6;
const SENSOR_MARKER_LIFT = 2.2;
const SENSOR_FOCUS_DISTANCE = 24;
const MAX_SCENE_PIXEL_RATIO = 1.5;
const IDLE_RENDER_INTERVAL_MS = 500;

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    this.renderer.domElement.classList.add('scene-main-canvas');
    this.renderer.localClippingEnabled = true;
    this.renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_SCENE_PIXEL_RATIO));
    container.appendChild(this.renderer.domElement);
    this.ensureOverlayHost();

    this.scene = new THREE.Scene();
    // this.scene.background = new THREE.Color('#434343ff');
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(60, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.1, 50000);
    this.camera.position.set(0, 0, 1000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controlsInteracting = false;
    this.interactiveRenderUntil = 0;
    this.lastRenderAt = 0;
    this.performanceStats = { renderSamples: [], maxRenderMs: 0, totalFrames: 0, roadwayLoads: [] };
    this.handleControlsStart = () => {
      this.controlsInteracting = true;
      this.interactiveRenderUntil = performance.now() + 250;
    };
    this.handleControlsChange = () => {
      this.interactiveRenderUntil = performance.now() + 250;
    };
    this.handleControlsEnd = () => {
      this.controlsInteracting = false;
      this.interactiveRenderUntil = performance.now() + 250;
    };
    this.handleVisualInput = () => {
      this.interactiveRenderUntil = performance.now() + 250;
    };
    this.controls.addEventListener('start', this.handleControlsStart);
    this.controls.addEventListener('change', this.handleControlsChange);
    this.controls.addEventListener('end', this.handleControlsEnd);
    window.addEventListener('input', this.handleVisualInput, true);
    window.addEventListener('change', this.handleVisualInput, true);
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.sensors = new Map();
    this.sensorPickTargets = new Map();
    this.sensorSelectionSprites = new Map();
    this.ventilationSelectionSprites = new Map();
    this.chartPresentationPickTargets = new Map();
    this.interactionRouter = new SceneInteractionRouter();
    this.sensorSignature = null;
    this.edgeMeshes = new Map();
    this.nodeMeshes = new Map();
    this.roadwayMeshIndex = new Map();
    this.edgeEndpointNodes = new Map();
    this.edgeCenterOffsetCache = new Map();
    this.ventilationPickingSources = new Map();
    this.ventilationPickBranches = new Map();
    this.ventilationRoadwayEdgeBranches = new Map();
    this.ventilationRoadwayNodeBranches = new Map();
    this.ventilationGroup = new THREE.Group();
    this.ventilationGroup.name = 'ventilation-overlay';
    this.ventilationBranchObjects = new Map();
    this.ventilationFacilityObjects = new Map();
    this.ventilationBoundaryObjects = new Map();
    this.ventilationMaterials = new Set();
    this.airflowGroup = new THREE.Group();
    this.airflowGroup.name = 'airflow-distribution-overlay';
    this.airflowBranchObjects = new Map();
    this.airflowMaterials = new Set();
    this.anomalyGroup = new THREE.Group();
    this.anomalyGroup.name = 'ventilation-anomaly-overlay';
    this.anomalyBranchObjects = new Map();
    this.anomalyMaterials = new Set();
    this.hazardGroup = new THREE.Group();
    this.hazardGroup.name = 'roadway-hazard-overlay';
    this.hazardMaterials = new Set();
    this.routeGroup = new THREE.Group();
    this.routeGroup.name = 'safe-route-overlay';
    this.routeMaterials = new Set();
    this.routeObjects = new Map();
    this.geologyPickSources = new Map();
    this.roadwaySelectionOverlay = null;
    this.roadwaySelectionKey = '';
    this.topology = null;
    this.roadwayObject = null;
    this.roadwaySignature = null;
    this.roadwayFieldLayers = new Map();
    this.roadwayVisibilityOwners = new Map();
    this.roadwayOpacityOwners = new Map();
    this.sensorVisibilityOwners = new Map();
    this.sensorItemVisibilityOwners = new Map();
    this.sensorOpacityOwners = new Map();
    this.sensorItemOpacityOwners = new Map();
    this.focusAnimationFrame = null;
    this.viewportInsets = {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      safeRect: { x: 0, y: 0, width: container.clientWidth, height: container.clientHeight }
    };
    this.raycaster.params.Line = { threshold: 3 };
    this.scene.add(this.ventilationGroup);
    this.scene.add(this.airflowGroup);
    this.scene.add(this.anomalyGroup);
    this.scene.add(this.hazardGroup);
    this.scene.add(this.routeGroup);

    this.handleWindowResize = () => this.onResize();
    window.addEventListener('resize', this.handleWindowResize);
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.onResize())
      : null;
    this.resizeObserver?.observe(this.container);
    this.pickPointerStart = null;
    this.handlePickPointerDown = (event) => {
      if (event.button !== 0) return;
      this.pickPointerStart = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false
      };
    };
    this.handlePickPointerMove = (event) => {
      if (event.buttons) this.handleVisualInput();
      const start = this.pickPointerStart;
      if (!start || start.pointerId !== event.pointerId || start.moved) return;
      const dx = event.clientX - start.clientX;
      const dy = event.clientY - start.clientY;
      if ((dx * dx) + (dy * dy) > 16) start.moved = true;
    };
    this.handlePickPointerUp = (event) => {
      const start = this.pickPointerStart;
      this.pickPointerStart = null;
      if (!start || start.pointerId !== event.pointerId || start.moved) return;
      this.onPick(event);
    };
    this.handlePickPointerCancel = () => {
      this.pickPointerStart = null;
    };
    this.renderer.domElement.addEventListener('pointerdown', this.handlePickPointerDown, true);
    window.addEventListener('pointermove', this.handlePickPointerMove, true);
    window.addEventListener('pointerup', this.handlePickPointerUp, true);
    window.addEventListener('pointercancel', this.handlePickPointerCancel, true);
    this.animate();
  }

  ensureOverlayHost() {
    const style = window.getComputedStyle(this.container);
    if (style.position === 'static') this.container.style.position = 'relative';
  }

  onResize(size = null) {
    const w = Math.max(1, Number(size?.width) || this.container.clientWidth || 1);
    const h = Math.max(1, Number(size?.height) || this.container.clientHeight || 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_SCENE_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
  }

  setViewportInsets(insets = {}) {
    const width = Math.max(1, this.container.clientWidth || 1);
    const height = Math.max(1, this.container.clientHeight || 1);
    const safe = insets.safeRect || {};
    this.viewportInsets = {
      top: Math.max(0, Number(insets.top) || 0),
      right: Math.max(0, Number(insets.right) || 0),
      bottom: Math.max(0, Number(insets.bottom) || 0),
      left: Math.max(0, Number(insets.left) || 0),
      safeRect: {
        x: Math.max(0, Number(safe.x) || 0),
        y: Math.max(0, Number(safe.y) || 0),
        width: Math.max(1, Math.min(width, Number(safe.width) || width)),
        height: Math.max(1, Math.min(height, Number(safe.height) || height))
      }
    };
  }

  addLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 3);
    this.scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 10);
    dir1.position.set(1000, 1000, 1000);
    this.scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 10);
    dir2.position.set(-600, -600, -600);
    this.scene.add(dir2);
  }

  normalizeMeshMappingTarget(target) {
    if (target === undefined || target === null) return null;
    if (typeof target === 'string' || typeof target === 'number') {
      return { id: String(target), type: null };
    }
    if (typeof target !== 'object') return null;
    const rawType = String(target.type ?? target.kind ?? '').toLowerCase();
    const type = rawType.includes('node') ? 'Node' : rawType.includes('connection') || rawType.includes('edge') ? 'Connection' : null;
    const id =
      target.id ??
      target.topo_ref_id ??
      target.topoRefId ??
      target.graphEntityId ??
      target.target ??
      target.value;
    return id === undefined || id === null ? null : { id: String(id), type };
  }

  buildMeshMappingLookup(mapping) {
    const map = new Map();
    const add = (meshId, target) => {
      if (meshId === undefined || meshId === null) return;
      const normalized = this.normalizeMeshMappingTarget(target);
      if (normalized) map.set(String(meshId), normalized);
    };
    if (Array.isArray(mapping)) {
      mapping.forEach((entry) => {
        add(entry.mesh_part_id ?? entry.meshPartId ?? entry.name, entry.topo_ref_id ?? entry.topoRefId ?? entry.graphEntityId ?? entry.target ?? entry);
      });
    } else if (mapping instanceof Map) {
      mapping.forEach((target, meshId) => add(meshId, target));
    } else if (mapping && typeof mapping === 'object') {
      Object.entries(mapping).forEach(([meshId, target]) => add(meshId, target));
    }
    return map;
  }

  resetRoadwayMeshIndexes() {
    this.edgeMeshes.clear();
    this.nodeMeshes.clear();
    this.roadwayMeshIndex.clear();
    this.edgeEndpointNodes.clear();
    this.edgeCenterOffsetCache.clear();
  }

  hashString(value = '') {
    const text = String(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  roadwayTopologySignature(topo) {
    if (!topo) return 'none';
    const nodes = topo.nodes || [];
    const edges = topo.edges || [];
    const source = topo.source?.topologyPath || topo.topologyPath || '';
    const payload = {
      source,
      nodes: nodes.map((node) => ({
        id: node.id,
        position: node.position || node.coordinate
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source ?? edge.from,
        target: edge.target ?? edge.to,
        path: edge.path
      }))
    };
    return `${source || 'inline'}:${nodes.length}:${edges.length}:${this.hashString(JSON.stringify(payload))}`;
  }

  roadwayModelSignature(url, text, mapping, topo, mode = 'model') {
    const modelKey = url
      ? `url:${url}`
      : text
        ? `text:${text.length}:${this.hashString(text)}`
        : `${mode}:generated`;
    const mappingKey = mapping ? this.hashString(JSON.stringify(mapping)) : 'nomap';
    return `${mode}|${modelKey}|${mappingKey}|${this.roadwayTopologySignature(topo)}`;
  }

  disposeObjectTree(object) {
    const materials = new Set();
    object?.traverse?.((child) => {
      if (child.geometry?.dispose && !child.geometry.userData?.minevisSharedObjGeometry) child.geometry.dispose();
      const childMaterials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      childMaterials.forEach((material) => materials.add(material));
    });
    if (object?.userData?.roadwaySharedMaterial) materials.add(object.userData.roadwaySharedMaterial);
    if (object?.userData?.roadwayPickMaterial) materials.add(object.userData.roadwayPickMaterial);
    materials.forEach((material) => material?.dispose?.());
  }

  removeRoadwayObject() {
    if (!this.roadwayObject) return;
    this.clearRoadwaySelectionOverlay();
    this.scene.remove(this.roadwayObject);
    this.disposeObjectTree(this.roadwayObject);
    this.roadwayObject = null;
    this.roadwaySignature = null;
    this.resetRoadwayMeshIndexes();
  }

  registerRoadwayMesh(type, id, mesh, edge = null) {
    if (!id || !mesh) return;
    const key = String(id);
    if (!this.roadwayMeshIndex.has(key)) this.roadwayMeshIndex.set(key, new Set());
    this.roadwayMeshIndex.get(key).add(mesh);
    if (type === 'Connection') {
      if (!this.edgeMeshes.has(key)) this.edgeMeshes.set(key, mesh);
      const endpoints = this.edgeEndpointIds(edge);
      if (endpoints.length) this.edgeEndpointNodes.set(key, endpoints);
    } else if (type === 'Node') {
      if (!this.nodeMeshes.has(key)) this.nodeMeshes.set(key, new Set());
      this.nodeMeshes.get(key).add(mesh);
    }
  }

  edgeEndpointIds(edge) {
    if (!edge) return [];
    return [edge.from ?? edge.source ?? edge.j1, edge.to ?? edge.target ?? edge.j2].filter(Boolean).map((id) => String(id));
  }

  getTopologyEdge(edgeId) {
    const target = String(edgeId);
    return this.topology?.edgeMap?.get?.(target) || this.topology?.edges?.find?.((edge) => String(edge.id) === target);
  }

  nodeIdsForRoadwayEdges(edgeIds) {
    const nodeIds = new Set();
    for (const edgeId of edgeIds || []) {
      const key = String(edgeId);
      const endpoints = this.edgeEndpointNodes.get(key) || this.edgeEndpointIds(this.getTopologyEdge(key));
      endpoints.forEach((nodeId) => nodeIds.add(String(nodeId)));
    }
    return nodeIds;
  }

  setVentilationPickingBranches(ownerId, branches = []) {
    const key = ownerId || 'default';
    if (!branches?.length) {
      this.ventilationPickingSources.delete(key);
    } else {
      this.ventilationPickingSources.set(key, branches);
    }
    this.rebuildVentilationPickingIndex();
  }

  clearVentilationPickingBranches(ownerId) {
    this.ventilationPickingSources.delete(ownerId || 'default');
    this.rebuildVentilationPickingIndex();
  }

  addToSetMap(map, key, value) {
    if (key === undefined || key === null || value === undefined || value === null) return;
    const normalizedKey = String(key);
    if (!map.has(normalizedKey)) map.set(normalizedKey, new Set());
    map.get(normalizedKey).add(String(value));
  }

  rebuildVentilationPickingIndex() {
    this.ventilationPickBranches.clear();
    this.ventilationRoadwayEdgeBranches.clear();
    this.ventilationRoadwayNodeBranches.clear();
    for (const branches of this.ventilationPickingSources.values()) {
      for (const branch of branches || []) {
        if (!branch?.id) continue;
        const branchId = String(branch.id);
        this.ventilationPickBranches.set(branchId, branch);
        for (const edgeId of branch.roadwayEdgeIds || []) {
          const edgeKey = String(edgeId);
          this.addToSetMap(this.ventilationRoadwayEdgeBranches, edgeKey, branchId);
          const endpoints = this.edgeEndpointNodes.get(edgeKey) || this.edgeEndpointIds(this.getTopologyEdge(edgeKey));
          endpoints.forEach((nodeId) => this.addToSetMap(this.ventilationRoadwayNodeBranches, nodeId, branchId));
        }
      }
    }
  }

  distancePointToSegment(point, start, end) {
    const segment = end.clone().sub(start);
    const lenSq = segment.lengthSq();
    if (lenSq <= 0.0001) return point.distanceTo(start);
    const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(segment) / lenSq));
    return point.distanceTo(start.clone().add(segment.multiplyScalar(t)));
  }

  distancePointToPath(point, path) {
    const points = this.branchPathPoints({ path });
    if (!points.length) return Infinity;
    if (points.length === 1) return point.distanceTo(points[0]);
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i += 1) {
      best = Math.min(best, this.distancePointToSegment(point, points[i], points[i + 1]));
    }
    return best;
  }

  chooseVentilationBranch(candidateIds, point) {
    const ids = Array.from(candidateIds || []);
    if (!ids.length) return null;
    if (ids.length === 1 || !point) return ids[0];
    let bestId = ids[0];
    let bestDistance = Infinity;
    for (const id of ids) {
      const branch = this.ventilationPickBranches.get(String(id));
      const path = branch?.renderPath || branch?.path || branch?.originalPath || branch?._renderPath || [];
      const distance = this.distancePointToPath(point, path);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = id;
      }
    }
    return bestId;
  }

  ventilationBranchFromRoadwayHit(hit) {
    const data = hit?.object?.userData || {};
    const meta = data.heatmap;
    if (!meta) return null;
    if (meta.type === 'Connection') {
      const edgeId = String(meta.data?.id ?? meta.data?.topoId ?? data.topoID ?? '');
      return this.chooseVentilationBranch(this.ventilationRoadwayEdgeBranches.get(edgeId), hit.point);
    }
    if (meta.type === 'Node') {
      const nodeId = String(meta.data?.id ?? data.topoID ?? '');
      return this.chooseVentilationBranch(this.ventilationRoadwayNodeBranches.get(nodeId), hit.point);
    }
    return null;
  }

  pickVentilationBranchFromRoadway() {
    if (!this.roadwayObject || !this.ventilationPickBranches.size) return null;
    const hits = this.raycaster.intersectObjects(this.roadwayObject.children, true);
    for (const hit of hits) {
      const branchId = this.ventilationBranchFromRoadwayHit(hit);
      if (branchId) return branchId;
    }
    return null;
  }

  pickRoadwayEntity() {
    if (!this.roadwayObject) return null;
    const hits = this.raycaster.intersectObjects(this.roadwayObject.children, true);
    for (const hit of hits) {
      const meta = hit.object?.userData?.heatmap;
      if (!meta?.type) continue;
      const id = String(meta.data?.id ?? meta.data?.topoId ?? hit.object.userData?.topoID ?? '');
      if (!id) continue;
      return {
        type: meta.type === 'Node' ? 'node' : 'edge',
        id,
        edgeId: meta.type === 'Node' ? null : id,
        nodeId: meta.type === 'Node' ? id : null,
        point: hit.point
      };
    }
    return null;
  }

  pickVentilationFacilityMarker() {
    const hits = this.raycaster.intersectObjects(this.ventilationGroup.children, true);
    for (const hit of hits) {
      const data = hit.object.userData || {};
      if (data.ventilationType === 'facility' && data.facilityId) return data.facilityId;
    }
    return null;
  }

  createRoadwayRenderProxy(root, material) {
    const sources = [];
    let vertexCount = 0;
    let indexCount = 0;
    let hasCompleteNormals = true;
    root?.traverse?.((mesh) => {
      if (!mesh?.isMesh || mesh.userData?.roadwayRenderProxy) return;
      const position = mesh.geometry?.attributes?.position;
      if (!position?.count) return;
      const normal = mesh.geometry?.attributes?.normal;
      const indices = mesh.geometry?.index;
      sources.push({ position, normal, indices });
      vertexCount += position.count;
      indexCount += indices?.count || position.count;
      if (!normal || normal.count !== position.count) hasCompleteNormals = false;
    });
    if (!sources.length || !vertexCount || !indexCount) return null;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const IndexArray = vertexCount <= 65535 ? Uint16Array : Uint32Array;
    const indices = new IndexArray(indexCount);
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const source of sources) {
      positions.set(source.position.array, vertexOffset * 3);
      if (source.normal?.array) normals.set(source.normal.array, vertexOffset * 3);
      if (source.indices) {
        for (let index = 0; index < source.indices.count; index += 1) {
          indices[indexOffset + index] = source.indices.getX(index) + vertexOffset;
        }
        indexOffset += source.indices.count;
      } else {
        for (let index = 0; index < source.position.count; index += 1) {
          indices[indexOffset + index] = vertexOffset + index;
        }
        indexOffset += source.position.count;
      }
      vertexOffset += source.position.count;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    if (hasCompleteNormals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const proxy = new THREE.Mesh(geometry, material);
    proxy.name = 'roadway-render-proxy';
    proxy.userData.roadwayRenderProxy = true;
    return proxy;
  }

  /**
   * Loads an OBJ model from either a URL or inline text.
   * @param {string|null} url - Source path, when available.
   * @param {string|null} text - Inline OBJ content, when available.
   * @param {Array} mapping - Mesh-part mapping records.
   */
  async loadRoadwayModel(url, text, mapping, topo) {
    const signature = this.roadwayModelSignature(url, text, mapping, topo, 'obj');
    if (this.roadwayObject && this.roadwaySignature === signature) {
      if (topo) this.topology = topo;
      this.applyRoadwayOwnerState();
      return this.roadwayObject;
    }
    if (this.roadwayObject) this.removeRoadwayObject();
    let object = null;
    let sourceLength = Number(text?.length) || 0;
    const loadMetrics = { startedAt: performance.now(), sourceLength, parseMs: 0, configureMs: 0, uploadMs: 0 };
    if (topo) this.topology = topo;

    try {
      const parseStartedAt = performance.now();
      if (url) {
        const sourceText = await fetchText(url);
        sourceLength = sourceText.length;
        object = await parseObjAsync(sourceText);
      } else if (text) {
        object = await parseObjAsync(text);
      }
      loadMetrics.sourceLength = sourceLength;
      loadMetrics.parseMs = performance.now() - parseStartedAt;

      if (!object) return;

      const configureStartedAt = performance.now();
      const map = this.buildMeshMappingLookup(mapping);
      this.resetRoadwayMeshIndexes();
      const roadwaySharedMaterial = new THREE.MeshStandardMaterial({
        color: '#3a4a7a',
        side: THREE.DoubleSide,
        vertexColors: false,
        roughness: 0.78,
        metalness: 0.02
      });
      const roadwayPickMaterial = new THREE.MeshBasicMaterial({ visible: false });
      roadwaySharedMaterial.needsUpdate = true;
      object.userData.roadwaySharedMaterial = roadwaySharedMaterial;
      object.userData.roadwayPickMaterial = roadwayPickMaterial;

      object.traverse((child) => {
        if (!child.isMesh) return;
        const previousMaterials = Array.isArray(child.material) ? child.material : [child.material];
        previousMaterials.filter(Boolean).forEach((material) => material.dispose?.());
        child.material = roadwayPickMaterial;
        child.userData.roadwayPickProxy = true;
        const name = child.name || '';
        const mappingInfo = map.get(name);
        let topoId = mappingInfo?.id || name;
        const mappedType = mappingInfo?.type;
        let edge = mappedType !== 'Node' && topoId ? topo?.edges?.find((e) => String(e.id) === String(topoId)) : null;
        let nodeHeat = null;

        if (!edge && topo && mappedType !== 'Node') {
          edge = topo.edges?.find((e) => String(e.id) === String(name));
          topoId = edge?.id || topoId;
        }

        if (!edge && topo && mappedType !== 'Node') {
          const edgeMatch = name.match(/edge[_-]?(\d+)/i);
          if (edgeMatch) {
            const idx = Number(edgeMatch[1]);
            edge = topo.edges?.[idx];
            topoId = edge?.id;
          }
        }

        if (!edge && topo && mappedType !== 'Connection') {
          const nodeByName = topo.nodes?.find((n) => String(n.id) === String(topoId) || String(n.id) === String(name));
          if (nodeByName) {
            nodeHeat = {
              type: 'Node',
              data: {
                id: nodeByName.id,
                x: Array.isArray(nodeByName.coordinate) ? nodeByName.coordinate[0] : nodeByName.coordinate?.x,
                y: Array.isArray(nodeByName.coordinate) ? nodeByName.coordinate[1] : nodeByName.coordinate?.y,
                z: Array.isArray(nodeByName.coordinate) ? nodeByName.coordinate[2] : nodeByName.coordinate?.z
              }
            };
          }
        }

        if (!edge && topo && !nodeHeat && mappedType !== 'Connection') {
          const nodeMatch = name.match(/node[_-]?(.+)/i);
          if (nodeMatch) {
            const key = nodeMatch[1];
            const nodeById = topo.nodes?.find((n) => String(n.id) === String(key) || String(n.id) === `Node_${key}`);
            const nodeByIdx = topo.nodes?.[Number(key)];
            const node = nodeById || nodeByIdx;
            if (node) {
              nodeHeat = {
                type: 'Node',
                data: {
                  id: node.id,
                  x: Array.isArray(node.coordinate) ? node.coordinate[0] : node.coordinate?.x,
                  y: Array.isArray(node.coordinate) ? node.coordinate[1] : node.coordinate?.y,
                  z: Array.isArray(node.coordinate) ? node.coordinate[2] : node.coordinate?.z
                }
              };
            }
          }
        }

        if (edge) {
          const nodeMap = topo?.nodeMap || new Map(topo?.nodes?.map((n) => [n.id, n]));
          const pathVerts =
            Array.isArray(edge.path) && edge.path.length
              ? edge.path.map((p) => ({
                  x: p.x ?? p[0] ?? 0,
                  y: p.y ?? p[1] ?? 0,
                  z: p.z ?? p[2] ?? 0
                }))
              : [];
          const start = nodeMap.get(edge.from)?.coordinate;
          const end = nodeMap.get(edge.to)?.coordinate;
          const verts =
            pathVerts.length >= 2
              ? pathVerts
              : start && end
                ? [
                    { x: start[0], y: start[1], z: start[2] },
                    { x: end[0], y: end[1], z: end[2] }
                  ]
                : this.guessAxisFromGeometry(child);
          child.userData.heatmap = {
            type: 'Connection',
            data: {
              id: topoId || name,
              topoId,
              j1: edge.from,
              j2: edge.to,
              idx: topo?.edges?.findIndex((e) => e.id === topoId) ?? -1,
              verts
            }
          };
          child.userData.topoID = topoId;
          this.registerRoadwayMesh('Connection', topoId || name, child, edge);
        } else if (nodeHeat) {
          child.userData.heatmap = nodeHeat;
          child.userData.topoID = nodeHeat.data.id;
          this.registerRoadwayMesh('Node', nodeHeat.data.id, child);
        }
      });

      const renderProxy = this.createRoadwayRenderProxy(object, roadwaySharedMaterial);
      if (renderProxy) object.add(renderProxy);
      loadMetrics.configureMs = performance.now() - configureStartedAt;
      this.scene.add(object);
      this.roadwayObject = object;
      this.roadwaySignature = signature;

      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      this.controls.target.copy(center);
      this.camera.position.copy(center).addScalar(maxDim * 1.5);
      this.controls.update();
      this.applyRoadwayOwnerState();
      this.requestRenderBurst(100);
      loadMetrics.totalMs = performance.now() - loadMetrics.startedAt;
      this.performanceStats.roadwayLoads.push(loadMetrics);
      if (this.performanceStats.roadwayLoads.length > 8) this.performanceStats.roadwayLoads.shift();
      return object;
    } catch (err) {
      console.error('Failed to load roadway model:', err);
      return null;
    }
  }

  buildRoadway(topo) {
    const signature = this.roadwayModelSignature(null, null, null, topo, 'generated');
    if (this.roadwayObject && this.roadwaySignature === signature) {
      this.roadwayObject.visible = true;
      return this.roadwayObject;
    }
    if (this.roadwayObject) this.removeRoadwayObject();
    this.topology = topo;
    this.resetRoadwayMeshIndexes();
    const root = new THREE.Group();
    root.name = 'generated-roadway';
    const material = new THREE.MeshStandardMaterial({ color: '#3a4a7a', vertexColors: true });
    const nodeMaterial = new THREE.MeshStandardMaterial({ color: '#8fb9ff', vertexColors: true });
    const edgeGeometryCache = {};
    for (const [idx, edge] of topo.edges.entries()) {
      const aPoint = topo.getNodePosition(edge.from);
      const bPoint = topo.getNodePosition(edge.to);
      const a = new THREE.Vector3(aPoint?.x ?? 0, aPoint?.y ?? 0, aPoint?.z ?? 0);
      const b = new THREE.Vector3(bPoint?.x ?? 0, bPoint?.y ?? 0, bPoint?.z ?? 0);
      const dir = new THREE.Vector3().subVectors(b, a);
      const length = dir.length();
      const cylinderGeo = edgeGeometryCache[length] || new THREE.CylinderGeometry(0.6, 0.6, length, 12, 1, true);
      edgeGeometryCache[length] = cylinderGeo;
      const mesh = new THREE.Mesh(cylinderGeo, material.clone());
      mesh.position.copy(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
      mesh.lookAt(b);
      mesh.rotateX(Math.PI / 2);
      mesh.name = edge.id;
      mesh.userData.heatmap = {
        type: 'Connection',
        data: {
          id: edge.id,
          topoId: edge.id,
          j1: edge.from,
          j2: edge.to,
          idx,
          verts: [
            { x: a.x, y: a.y, z: a.z },
            { x: b.x, y: b.y, z: b.z }
          ]
        }
      };
      root.add(mesh);
      this.registerRoadwayMesh('Connection', edge.id, mesh, edge);
    }

    for (const node of topo.nodes) {
      const geo = new THREE.SphereGeometry(0.9, 16, 16);
      const mesh = new THREE.Mesh(geo, nodeMaterial.clone());
      mesh.position.set(...node.coordinate);
      mesh.name = node.id;
      mesh.userData.heatmap = {
        type: 'Node',
        data: {
          id: node.id,
          x: node.coordinate[0],
          y: node.coordinate[1],
          z: node.coordinate[2]
        }
      };
      mesh.userData.topoID = node.id;
      root.add(mesh);
      this.registerRoadwayMesh('Node', node.id, mesh);
    }
    this.scene.add(root);
    this.roadwayObject = root;
    this.roadwaySignature = signature;

    const box = new THREE.Box3();
    for (const mesh of this.edgeMeshes.values()) box.expandByObject(mesh);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      this.controls.target.copy(center);
      this.camera.position.copy(center).add(new THREE.Vector3(maxDim * 1.2, maxDim * 1.2, maxDim * 1.2));
      this.controls.update();
    }
    return root;
  }

  addSensors(registry) {
    const sensors = Array.from(registry || []);
    const signature = this.sensorRegistrySignature(sensors);
    if (this.sensorSignature !== signature) this.clearSensors();
    else if (this.sensors.size) {
      this.applySensorOwnerState();
      return;
    }
    const mat = new THREE.MeshStandardMaterial({ color: '#ff9f43', emissive: '#ff9f43' });
    this.configureOverlayMaterial(mat);
    const markerGeometry = new THREE.SphereGeometry(SENSOR_MARKER_RADIUS, 16, 12);
    const pickGeometry = new THREE.SphereGeometry(SENSOR_PICK_RADIUS, 10, 8);
    const pickMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      visible: false
    });
    for (const sensor of sensors) {
      const mesh = new THREE.Mesh(markerGeometry, mat.clone());
      this.configureOverlayObject(mesh, 72);
      mesh.position.copy(
        this.positionFromRoadwayAnchor(
          this.topology,
          { edgeId: sensor.edgeId ?? sensor.roadwayEdgeId, nodeId: sensor.nodeId ?? sensor.roadwayNodeId, ratio: sensor.ratio },
          { x: sensor.x, y: sensor.y, z: sensor.z },
          SENSOR_MARKER_LIFT
        )
      );
      mesh.userData.sensorID = sensor.sensorID;
      mesh.name = `sensor-${sensor.sensorID}`;
      this.scene.add(mesh);
      this.sensors.set(sensor.sensorID, mesh);

      const pickTarget = new THREE.Mesh(pickGeometry, pickMaterial);
      pickTarget.position.copy(mesh.position);
      pickTarget.userData.sensorID = sensor.sensorID;
      pickTarget.name = `sensor-pick-${sensor.sensorID}`;
      this.scene.add(pickTarget);
      this.sensorPickTargets.set(sensor.sensorID, pickTarget);
    }
    mat.dispose();
    if (!sensors.length) {
      markerGeometry.dispose();
      pickGeometry.dispose();
      pickMaterial.dispose();
    }
    this.sensorSignature = signature;
    this.applySensorOwnerState();
  }

  sensorRegistrySignature(sensors = []) {
    const payload = sensors.map((sensor) => ({
      id: sensor.sensorID,
      edgeId: sensor.edgeId ?? sensor.roadwayEdgeId,
      nodeId: sensor.nodeId ?? sensor.roadwayNodeId,
      ratio: sensor.ratio,
      x: sensor.x,
      y: sensor.y,
      z: sensor.z
    }));
    return `${sensors.length}:${this.hashString(JSON.stringify(payload))}`;
  }

  clearSensors() {
    this.clearComparisonSprites(this.sensorSelectionSprites);
    this.clearSensorHighlight();
    const geometries = new Set();
    const materials = new Set();
    for (const mesh of this.sensors.values()) {
      this.scene.remove(mesh);
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) materials.add(mesh.material);
    }
    for (const mesh of this.sensorPickTargets.values()) {
      this.scene.remove(mesh);
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) materials.add(mesh.material);
    }
    geometries.forEach((geometry) => geometry?.dispose?.());
    materials.forEach((material) => material?.dispose?.());
    this.sensors.clear();
    this.sensorPickTargets.clear();
    this.sensorSignature = null;
  }

  getSensorObject(sensorID) {
    return this.sensors.get(sensorID);
  }

  setPrimarySensorSelection(sensorID) {
    const next = sensorID == null ? null : this.getSensorObject(String(sensorID));
    if (this.selected === next) return;
    if (this.selected?.material?.emissive) {
      this.selected.material.emissive.set('#000000');
    }
    this.selected = next || null;
  }

  createComparisonRingSprite(color, { primary = false, hovered = false } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 96, 96);
    context.strokeStyle = color || '#38bdf8';
    context.shadowColor = color || '#38bdf8';
    context.shadowBlur = hovered ? 15 : 9;
    context.lineWidth = primary ? 7 : 5;
    context.beginPath();
    context.arc(48, 48, primary ? 35 : 32, 0, Math.PI * 2);
    context.stroke();
    if (primary) {
      context.lineWidth = 2.5;
      context.globalAlpha = 0.88;
      context.beginPath();
      context.arc(48, 48, 42, 0, Math.PI * 2);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 98;
    sprite.userData.comparisonTexture = texture;
    return sprite;
  }

  clearComparisonSprites(collection) {
    for (const sprite of collection.values()) {
      sprite.parent?.remove(sprite);
      sprite.userData.comparisonTexture?.dispose?.();
      sprite.material?.dispose?.();
    }
    collection.clear();
  }

  setSensorSelectionState({
    ids = [],
    primaryId = null,
    hoveredId = null,
    colors = {}
  } = {}) {
    this.clearComparisonSprites(this.sensorSelectionSprites);
    for (const rawId of ids) {
      const id = String(rawId);
      const sensor = this.sensors.get(id);
      if (!sensor) continue;
      const primary = id === String(primaryId || '');
      const hovered = id === String(hoveredId || '');
      const sprite = this.createComparisonRingSprite(colors[id], { primary, hovered });
      sprite.name = 'sensor-comparison-' + id;
      sprite.position.copy(sensor.position);
      sprite.scale.setScalar(primary ? 9.5 : hovered ? 8.5 : 7.5);
      sprite.visible = sensor.visible;
      this.scene.add(sprite);
      this.sensorSelectionSprites.set(id, sprite);
    }
  }

  setVentilationBranchSelectionState({
    ids = [],
    primaryId = null,
    hoveredId = null,
    colors = {}
  } = {}) {
    this.clearComparisonSprites(this.ventilationSelectionSprites);
    for (const rawId of ids) {
      const id = String(rawId);
      const ventilationEntry = this.ventilationBranchObjects.get(id);
      const airflowEntry = this.airflowBranchObjects.get(id);
      const entry = airflowEntry || ventilationEntry;
      if (!entry?.points?.length) continue;
      const primary = id === String(primaryId || '');
      const hovered = id === String(hoveredId || '');
      const sprite = this.createComparisonRingSprite(colors[id], { primary, hovered });
      const midpoint = entry.points[Math.floor((entry.points.length - 1) * 0.5)];
      sprite.name = 'ventilation-comparison-' + id;
      sprite.position.copy(midpoint);
      sprite.scale.setScalar(primary ? 10.5 : hovered ? 9.2 : 8.2);
      (airflowEntry ? this.airflowGroup : this.ventilationGroup).add(sprite);
      this.ventilationSelectionSprites.set(id, sprite);
    }
  }

  highlightSensor(obj) {
    if (this.selected) this.selected.material.emissive.set('#000000');
    this.selected = obj;
    obj.material.emissive.set('#ffffff');
  }

  clearSensorHighlight() {
    if (this.selected) {
      this.selected.material.emissive.set('#000000');
      this.selected = null;
    }
  }

  sensorVisualOwnerIds() {
    return new Set([
      ...this.sensorVisibilityOwners.keys(),
      ...this.sensorItemVisibilityOwners.keys(),
      ...this.sensorOpacityOwners.keys(),
      ...this.sensorItemOpacityOwners.keys()
    ]);
  }

  sensorOwnerValue(ownerId, sensorID, ownerMap, itemMap) {
    const perItem = itemMap.get(ownerId);
    if (perItem?.has(String(sensorID))) return perItem.get(String(sensorID));
    return ownerMap.get(ownerId);
  }

  applySensorOwnerState() {
    const owners = [...this.sensorVisualOwnerIds()];
    for (const [sensorID, mesh] of this.sensors) {
      let hasVisibility = false;
      let visible = false;
      let opacity = 0;
      for (const ownerId of owners) {
        const ownerVisible = this.sensorOwnerValue(
          ownerId,
          sensorID,
          this.sensorVisibilityOwners,
          this.sensorItemVisibilityOwners
        );
        if (ownerVisible == null) continue;
        hasVisibility = true;
        if (!ownerVisible) continue;
        visible = true;
        const ownerOpacity = this.sensorOwnerValue(
          ownerId,
          sensorID,
          this.sensorOpacityOwners,
          this.sensorItemOpacityOwners
        );
        opacity = Math.max(opacity, Number.isFinite(Number(ownerOpacity)) ? Number(ownerOpacity) : 1);
      }
      if (!hasVisibility) {
        visible = true;
        opacity = 1;
      }
      mesh.visible = visible;
      const pickTarget = this.sensorPickTargets.get(sensorID);
      if (pickTarget) pickTarget.visible = visible;
      const selectionSprite = this.sensorSelectionSprites.get(String(sensorID));
      if (selectionSprite) selectionSprite.visible = visible;
      const value = Math.max(0, Math.min(1, opacity));
      const transparent = value < 1;
      if (mesh.material.transparent !== transparent) {
        mesh.material.transparent = transparent;
        mesh.material.needsUpdate = true;
      }
      mesh.material.opacity = value;
    }
  }

  setSensorsVisibleForOwner(ownerId, flag) {
    this.sensorVisibilityOwners.set(String(ownerId), Boolean(flag));
    this.applySensorOwnerState();
  }

  setSensorVisibleForOwner(ownerId, sensorID, flag) {
    const key = String(ownerId);
    if (!this.sensorItemVisibilityOwners.has(key)) this.sensorItemVisibilityOwners.set(key, new Map());
    this.sensorItemVisibilityOwners.get(key).set(String(sensorID), Boolean(flag));
    this.applySensorOwnerState();
  }

  setSensorOpacityForOwner(ownerId, opacity) {
    this.sensorOpacityOwners.set(String(ownerId), Math.max(0, Math.min(1, Number(opacity))));
    this.applySensorOwnerState();
  }

  setSingleSensorOpacityForOwner(ownerId, sensorID, opacity) {
    const key = String(ownerId);
    if (!this.sensorItemOpacityOwners.has(key)) this.sensorItemOpacityOwners.set(key, new Map());
    this.sensorItemOpacityOwners.get(key).set(String(sensorID), Math.max(0, Math.min(1, Number(opacity))));
    this.applySensorOwnerState();
  }

  clearSensorOwnerState(ownerId) {
    const key = String(ownerId);
    this.sensorVisibilityOwners.delete(key);
    this.sensorItemVisibilityOwners.delete(key);
    this.sensorOpacityOwners.delete(key);
    this.sensorItemOpacityOwners.delete(key);
    this.applySensorOwnerState();
  }

  setSensorsVisible(flag) {
    for (const mesh of this.sensors.values()) {
      mesh.visible = flag;
    }
    for (const mesh of this.sensorPickTargets.values()) mesh.visible = flag;
    for (const sprite of this.sensorSelectionSprites.values()) sprite.visible = flag;
  }

  setSensorVisible(sensorID, flag) {
    const mesh = this.sensors.get(sensorID);
    if (mesh) mesh.visible = flag;
    const pickTarget = this.sensorPickTargets.get(sensorID);
    if (pickTarget) pickTarget.visible = flag;
    const selectionSprite = this.sensorSelectionSprites.get(String(sensorID));
    if (selectionSprite) selectionSprite.visible = flag;
  }

  setSensorOpacity(opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    for (const mesh of this.sensors.values()) {
      mesh.material.transparent = value < 1;
      mesh.material.opacity = value;
      mesh.material.needsUpdate = true;
    }
  }

  setSingleSensorOpacity(sensorID, opacity) {
    const mesh = this.sensors.get(sensorID);
    if (!mesh) return;
    const value = Math.max(0, Math.min(1, Number(opacity)));
    mesh.material.transparent = value < 1;
    mesh.material.opacity = value;
    mesh.material.needsUpdate = true;
  }

  applyRoadwayOpacityDirect(opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    const root = this.roadwayObject;
    if (!root) return;
    const materials = new Set();
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((material) => materials.add(material));
    });
    materials.forEach((material) => {
      const transparent = value < 1;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = value;
    });
  }

  applyRoadwayOwnerState() {
    if (!this.roadwayObject) return;
    if (!this.roadwayVisibilityOwners.size) {
      this.roadwayObject.visible = true;
      this.applyRoadwayOpacityDirect(1);
      return;
    }
    const visibleOwners = [...this.roadwayVisibilityOwners.entries()]
      .filter(([, visible]) => visible)
      .map(([ownerId]) => ownerId);
    this.roadwayObject.visible = visibleOwners.length > 0;
    if (!visibleOwners.length) return;
    const opacity = Math.max(...visibleOwners.map((ownerId) => (
      Number.isFinite(Number(this.roadwayOpacityOwners.get(ownerId)))
        ? Number(this.roadwayOpacityOwners.get(ownerId))
        : 1
    )));
    this.applyRoadwayOpacityDirect(opacity);
  }

  setRoadwayVisibleForOwner(ownerId, flag) {
    this.roadwayVisibilityOwners.set(String(ownerId), Boolean(flag));
    this.applyRoadwayOwnerState();
  }

  setRoadwayOpacityForOwner(ownerId, opacity) {
    this.roadwayOpacityOwners.set(String(ownerId), Math.max(0, Math.min(1, Number(opacity))));
    this.applyRoadwayOwnerState();
  }

  clearRoadwayOwnerState(ownerId) {
    const key = String(ownerId);
    this.roadwayVisibilityOwners.delete(key);
    this.roadwayOpacityOwners.delete(key);
    this.applyRoadwayOwnerState();
  }

  setRoadwayVisible(flag) {
    if (this.roadwayObject) this.roadwayObject.visible = flag;
  }

  ensureRoadwayFieldLayer(ownerId, roadway, options = {}) {
    const key = String(ownerId || 'default');
    const existing = this.roadwayFieldLayers.get(key);
    if (existing) return existing;
    const root = createRoadwayFieldLayer(roadway, {
      name: `roadway-field-${key}`,
      sourceObject: this.roadwayObject,
      ...options
    });
    root.visible = true;
    this.roadwayFieldLayers.set(key, root);
    this.scene.add(root);
    return root;
  }

  getRoadwayFieldLayer(ownerId) {
    return this.roadwayFieldLayers.get(String(ownerId || 'default')) || null;
  }

  setRoadwayFieldLayerVisible(ownerId, visible) {
    const root = this.getRoadwayFieldLayer(ownerId);
    if (root) root.visible = Boolean(visible);
  }

  setRoadwayFieldLayerOpacity(ownerId, opacity) {
    setRoadwayFieldLayerOpacity(this.getRoadwayFieldLayer(ownerId), opacity);
  }

  removeRoadwayFieldLayer(ownerId) {
    const key = String(ownerId || 'default');
    const root = this.roadwayFieldLayers.get(key);
    if (!root) return false;
    disposeRoadwayFieldLayer(root);
    this.roadwayFieldLayers.delete(key);
    return true;
  }

  setRoadwayOpacity(opacity) {
    this.applyRoadwayOpacityDirect(opacity);
  }

  setRoadwayBaseColor(color = '#3a4a7a') {
    const base = new THREE.Color(color);
    const root = this.roadwayObject || this.scene;
    root.traverse((mesh) => {
      if (!mesh?.isMesh || !mesh.material || mesh.userData?.roadwayPickProxy) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (!material?.color) return;
        material.color.copy(base);
        material.vertexColors = true;
        material.needsUpdate = true;
      });
      const colors = this.ensureMeshVertexColors(mesh);
      if (!colors) return;
      for (let i = 0; i < colors.count; i += 1) colors.setXYZ(i, base.r, base.g, base.b);
      colors.needsUpdate = true;
      delete mesh.userData.hazardBaseColors;
    });
  }

  highlightRoadwayEdges(edgeIds = []) {
    const activeIds = new Set((edgeIds || []).filter(Boolean).map((id) => String(id)));
    const activeNodeIds = this.nodeIdsForRoadwayEdges(activeIds);
    const selectionKey = [...activeIds].sort().join('|');
    if (selectionKey === this.roadwaySelectionKey && (!selectionKey || this.roadwaySelectionOverlay)) return;
    this.clearRoadwaySelectionOverlay();
    this.roadwaySelectionKey = selectionKey;
    if (!activeIds.size || !this.roadwayObject) return;
    this.roadwaySelectionOverlay = createRoadwaySelectionOverlay(this.roadwayObject, {
      edgeIds: [...activeIds],
      nodeIds: [...activeNodeIds]
    });
    if (this.roadwaySelectionOverlay) this.scene.add(this.roadwaySelectionOverlay);
  }

  clearRoadwaySelectionOverlay() {
    if (this.roadwaySelectionOverlay) {
      this.roadwaySelectionOverlay.geometry?.dispose?.();
      const materials = Array.isArray(this.roadwaySelectionOverlay.material)
        ? this.roadwaySelectionOverlay.material
        : [this.roadwaySelectionOverlay.material];
      materials.filter(Boolean).forEach((material) => material.dispose?.());
      this.roadwaySelectionOverlay.removeFromParent();
    }
    this.roadwaySelectionOverlay = null;
    this.roadwaySelectionKey = '';
  }

  setHeatmapOpacity(opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    const root = this.roadwayObject || this.scene;
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.userData?.heatmap || !mesh.material) return;
      mesh.material.transparent = value < 1;
      mesh.material.opacity = value;
      mesh.material.needsUpdate = true;
    });
  }

  normalizePoint(point) {
    if (!point) return new THREE.Vector3();
    if (point.isVector3) return point.clone();
    if (Array.isArray(point)) return new THREE.Vector3(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
    return new THREE.Vector3(Number(point.x) || 0, Number(point.y) || 0, Number(point.z) || 0);
  }

  rawEdgePathPointsFromRoadway(roadway, edgeId) {
    const edge = roadway?.edgeMap?.get?.(String(edgeId)) || roadway?.getEdges?.().find((item) => String(item.id) === String(edgeId));
    const path = edge?.path?.length ? edge.path : edge?.verts;
    if (path?.length >= 2) return path.map((point) => this.normalizePoint(point));
    const from = roadway?.getNodePosition?.(edge?.from ?? edge?.source);
    const to = roadway?.getNodePosition?.(edge?.to ?? edge?.target);
    return [from, to].filter(Boolean).map((point) => this.normalizePoint(point));
  }

  edgeVisualCenterOffset(edgeId, basePoints = []) {
    const key = String(edgeId);
    if (this.edgeCenterOffsetCache.has(key)) return this.edgeCenterOffsetCache.get(key).clone();
    const meshes = [...(this.roadwayMeshIndex.get(key) || [])];
    if (!meshes.length && this.edgeMeshes.has(key)) meshes.push(this.edgeMeshes.get(key));
    const box = new THREE.Box3();
    meshes.forEach((mesh) => {
      if (mesh?.isMesh) box.expandByObject(mesh);
    });
    let offset = new THREE.Vector3();
    if (!box.isEmpty() && basePoints.length) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const avgZ = basePoints.reduce((sum, point) => sum + point.z, 0) / basePoints.length;
      // Mine roadway models use -Z as gravity/down. Raw centerlines are often near the floor,
      // so lift overlays toward the geometric middle of the edge mesh, but only along Z.
      const lift = Math.max(0, Math.min(size.z * 0.78, center.z - avgZ));
      offset = new THREE.Vector3(0, 0, lift);
    }
    this.edgeCenterOffsetCache.set(key, offset.clone());
    return offset;
  }

  tunnelCenterlinePathForEdge(roadway, edgeId, options = {}) {
    const points = this.rawEdgePathPointsFromRoadway(roadway, edgeId);
    if (options.visualCenter === false || points.length < 2) return points;
    const offset = this.edgeVisualCenterOffset(edgeId, points);
    return points.map((point) => point.clone().add(offset));
  }

  edgePathPointsFromRoadway(roadway, edgeId, options = {}) {
    return this.tunnelCenterlinePathForEdge(roadway, edgeId, options);
  }

  tunnelCenterlinePathForEdges(roadway, edgeIds = [], referencePoints = []) {
    const result = [];
    const reference = referencePoints.map((point) => this.normalizePoint(point));
    for (const edgeId of edgeIds || []) {
      let segment = this.edgePathPointsFromRoadway(roadway || this.topology, edgeId);
      if (segment.length < 2) continue;
      if (!result.length && reference.length) {
        const refStart = reference[0];
        if (refStart.distanceTo(segment[0]) > refStart.distanceTo(segment[segment.length - 1])) segment = [...segment].reverse();
      } else if (result.length) {
        const prev = result[result.length - 1];
        if (prev.distanceTo(segment[0]) > prev.distanceTo(segment[segment.length - 1])) segment = [...segment].reverse();
      }
      if (result.length && result[result.length - 1].distanceTo(segment[0]) < 0.1) result.push(...segment.slice(1));
      else result.push(...segment);
    }
    return result;
  }

  tunnelCenterlinePathForBranch(branch, rawPoints = []) {
    if (branch?.roadwayEdgeIds?.length) {
      const points = this.tunnelCenterlinePathForEdges(this.topology, branch.roadwayEdgeIds, rawPoints);
      if (points.length >= 2) return points;
    }
    return rawPoints.map((point) => this.normalizePoint(point));
  }

  positionFromRoadwayAnchor(roadway, anchor, fallbackPosition, lift = 0) {
    if (anchor?.edgeId || anchor?.roadwayEdgeId) {
      const points = this.edgePathPointsFromRoadway(roadway || this.topology, anchor.edgeId ?? anchor.roadwayEdgeId);
      if (points.length >= 2) return this.pointAtPathRatio(points, anchor.ratio ?? 0.5).add(new THREE.Vector3(0, 0, lift));
    }
    if (anchor?.nodeId || anchor?.roadwayNodeId) {
      const nodePosition = roadway?.getNodePosition?.(anchor.nodeId ?? anchor.roadwayNodeId);
      if (nodePosition) return this.normalizePoint(nodePosition).add(new THREE.Vector3(0, 0, lift));
    }
    const position = fallbackPosition ? this.normalizePoint(fallbackPosition) : this.normalizePoint(anchor?.position);
    return position.add(new THREE.Vector3(0, 0, lift));
  }

  disposeOverlayGroup(group, materialRegistry = null) {
    const geometries = new Set();
    const materials = new Set(materialRegistry || []);
    group?.traverse?.((child) => {
      if (child.geometry) geometries.add(child.geometry);
      const childMaterials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      childMaterials.forEach((material) => materials.add(material));
    });
    group?.clear?.();
    geometries.forEach((geometry) => geometry?.dispose?.());
    materials.forEach((material) => material?.dispose?.());
    materialRegistry?.clear?.();
  }

  clearVentilationOverlay() {
    this.clearComparisonSprites(this.ventilationSelectionSprites);
    this.disposeOverlayGroup(this.ventilationGroup, this.ventilationMaterials);
    this.ventilationBranchObjects.clear();
    this.ventilationFacilityObjects.clear();
    this.ventilationBoundaryObjects.clear();
  }

  branchColor(branch, mode = 'type') {
    if (branch.renderColor) return new THREE.Color(branch.renderColor).getHex();
    if (mode === 'uniform') return 0x62d7ff;
    const type = String(branch.branchType || '').toLowerCase();
    if (type.includes('intake')) return 0x42a5ff;
    if (type.includes('return')) return 0xff6b6b;
    if (type.includes('working')) return 0xffc857;
    if (type.includes('bypass')) return 0x8bd3a7;
    return 0x76d7c4;
  }

  facilityColor(type) {
    const key = String(type || '').toLowerCase();
    if (key === 'fan') return 0x66d9ef;
    if (key === 'door') return 0xf7c948;
    if (key === 'regulator') return 0xb28dff;
    if (key === 'stopping') return 0xff6b6b;
    return 0xd8dee9;
  }

  interpolatePath(path, ratio = 0.5) {
    const points = (path || []).map((point) => this.normalizePoint(point));
    if (!points.length) return new THREE.Vector3();
    if (points.length === 1) return points[0].clone();
    const lengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const length = points[i].distanceTo(points[i + 1]);
      lengths.push(length);
      total += length;
    }
    if (total <= 0) return points[0].clone();
    const target = Math.max(0, Math.min(1, Number(ratio))) * total;
    let traveled = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      if (traveled + lengths[i] >= target) {
        const local = (target - traveled) / (lengths[i] || 1);
        return points[i].clone().lerp(points[i + 1], local);
      }
      traveled += lengths[i];
    }
    return points[points.length - 1].clone();
  }

  branchPathPoints(branch, keys = ['renderPath', 'path', '_renderPath', 'originalPath']) {
    for (const key of keys) {
      const source = branch?.[key];
      if (Array.isArray(source) && source.length >= 2) return source.map((point) => this.normalizePoint(point));
    }
    return [];
  }

  configureOverlayMaterial(material, options = {}) {
    if (!material) return material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((item) => {
      if (!item) return;
      item.transparent = true;
      if (options.opacity != null) item.opacity = options.opacity;
      item.depthTest = false;
      item.depthWrite = false;
      item.needsUpdate = true;
    });
    return material;
  }

  configureOverlayObject(object, renderOrder = 40) {
    if (!object) return object;
    object.renderOrder = renderOrder;
    object.traverse?.((child) => {
      child.renderOrder = renderOrder;
      if (child.material) this.configureOverlayMaterial(child.material);
    });
    return object;
  }

  setOverlayMaterialsOpacity(materials, opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    materials.forEach((material) => this.configureOverlayMaterial(material, { opacity: value }));
    return value;
  }

  createSegmentTubeGeometry(start, end, radius) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0.0001) return null;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize()
    );
    geometry.applyMatrix4(new THREE.Matrix4().compose(midpoint, quaternion, new THREE.Vector3(1, 1, 1)));
    return geometry;
  }

  createSegmentTube(start, end, radius, material, userData = {}) {
    const geometry = this.createSegmentTubeGeometry(start, end, radius);
    if (!geometry) return null;
    this.configureOverlayMaterial(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = userData.renderOrder ?? 40;
    Object.assign(mesh.userData, userData);
    return mesh;
  }

  addPolylineTube(group, points, radius, material, userData = {}) {
    const geometries = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const geometry = this.createSegmentTubeGeometry(points[index], points[index + 1], radius);
      if (geometry) geometries.push(geometry);
    }
    if (!geometries.length) return [];
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!geometry) {
      geometries.forEach((item) => item.dispose());
      return [];
    }
    if (geometries.length > 1) geometries.forEach((item) => item.dispose());
    this.configureOverlayMaterial(material);
    const tube = new THREE.Mesh(geometry, material);
    tube.name = `${userData.namePrefix || 'branch-segment'}-${userData.branchId || userData.routeId || ''}`;
    tube.renderOrder = userData.renderOrder ?? 40;
    Object.assign(tube.userData, userData);
    group.add(tube);
    return [tube];
  }

  addDirectionArrow(group, points, color, materialSet, userData = {}, options = {}) {
    const start = this.interpolatePath(points, options.startRatio ?? 0.46);
    const end = this.interpolatePath(points, options.endRatio ?? 0.72);
    const dir = end.clone().sub(start);
    if (dir.lengthSq() <= 0.0001) return null;
    const arrow = new THREE.ArrowHelper(
      dir.normalize(),
      start,
      Math.max(options.minLength ?? 10, start.distanceTo(end)),
      color.getHex ? color.getHex() : color,
      options.headLength ?? 5,
      options.headWidth ?? 3
    );
    arrow.name = `${userData.namePrefix || 'branch-arrow'}-${userData.branchId || ''}`;
    arrow.traverse((child) => {
      Object.assign(child.userData, userData);
      child.renderOrder = options.renderOrder ?? userData.renderOrder ?? 42;
      if (child.material) {
        this.configureOverlayMaterial(child.material, { opacity: options.opacity });
        materialSet?.add?.(child.material);
      }
    });
    arrow.renderOrder = options.renderOrder ?? userData.renderOrder ?? 42;
    group.add(arrow);
    return arrow;
  }

  addDirectionArrowsBatch(group, entries = [], materialSet = null) {
    const prepared = entries.map((entry) => {
      const start = this.interpolatePath(entry.points, entry.options?.startRatio ?? 0.46);
      const sampledEnd = this.interpolatePath(entry.points, entry.options?.endRatio ?? 0.72);
      const direction = sampledEnd.clone().sub(start);
      const sampledLength = direction.length();
      if (sampledLength <= 0.0001) return null;
      direction.normalize();
      const length = Math.max(entry.options?.minLength ?? 10, sampledLength);
      const headLength = Math.min(length * 0.72, entry.options?.headLength ?? 5);
      const headWidth = entry.options?.headWidth ?? 3;
      const end = start.clone().addScaledVector(direction, length);
      const shaftEnd = end.clone().addScaledVector(direction, -headLength * 0.82);
      return {
        ...entry,
        start,
        direction,
        end,
        shaftEnd,
        headLength,
        headWidth,
        color: entry.color?.isColor ? entry.color : new THREE.Color(entry.color)
      };
    }).filter(Boolean);
    if (!prepared.length) return null;

    const positions = new Float32Array(prepared.length * 6);
    const colors = new Float32Array(prepared.length * 6);
    prepared.forEach((entry, index) => {
      positions.set(entry.start.toArray(), index * 6);
      positions.set(entry.shaftEnd.toArray(), index * 6 + 3);
      colors.set(entry.color.toArray(), index * 6);
      colors.set(entry.color.toArray(), index * 6 + 3);
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    lineGeometry.computeBoundingSphere();
    const opacity = prepared[0].options?.opacity ?? 0.92;
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity,
      toneMapped: false
    });
    this.configureOverlayMaterial(lineMaterial);
    materialSet?.add?.(lineMaterial);
    const shafts = new THREE.LineSegments(lineGeometry, lineMaterial);
    shafts.name = 'direction-arrow-shafts';
    shafts.renderOrder = prepared[0].options?.renderOrder ?? 42;
    group.add(shafts);

    const coneGeometry = new THREE.ConeGeometry(1, 1, 12);
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity,
      toneMapped: false
    });
    this.configureOverlayMaterial(coneMaterial);
    materialSet?.add?.(coneMaterial);
    const heads = new THREE.InstancedMesh(coneGeometry, coneMaterial, prepared.length);
    heads.name = 'direction-arrow-heads';
    heads.renderOrder = prepared[0].options?.renderOrder ?? 42;
    const transform = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    prepared.forEach((entry, index) => {
      transform.position.copy(entry.end).addScaledVector(entry.direction, -entry.headLength * 0.5);
      transform.quaternion.setFromUnitVectors(up, entry.direction);
      transform.scale.set(entry.headWidth, entry.headLength, entry.headWidth);
      transform.updateMatrix();
      heads.setMatrixAt(index, transform.matrix);
      heads.setColorAt(index, entry.color);
    });
    heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    heads.material.needsUpdate = true;
    heads.userData.arrowColorHexes = prepared.map((entry) => entry.color.getHex());
    heads.computeBoundingSphere?.();
    group.add(heads);
    return { shafts, heads };
  }

  addVentilationBranches(branches = [], options = {}) {
    this.clearVentilationOverlay();
    const showDirection = options.showDirection !== false;
    const showFacilities = options.showFacilities !== false;
    const showIntakeReturn = options.showIntakeReturn !== false;
    const colorMode = options.branchColorMode || 'type';
    const directionEntries = [];

    const branchPositions = [];
    const branchColors = [];
    for (const branch of branches) {
      const rawPoints = this.branchPathPoints(branch, ['path', 'renderPath', '_renderPath', 'originalPath']);
      const points = this.tunnelCenterlinePathForBranch(branch, rawPoints);
      if (points.length < 2) continue;
      const baseColor = new THREE.Color(this.branchColor(branch, colorMode));
      const vertexOffset = branchPositions.length / 3;
      for (let index = 1; index < points.length; index += 1) {
        branchPositions.push(...points[index - 1].toArray(), ...points[index].toArray());
        branchColors.push(...baseColor.toArray(), ...baseColor.toArray());
      }
      const vertexCount = (points.length - 1) * 2;

      if (showDirection) {
        directionEntries.push({
          points,
          color: baseColor.clone(),
          userData: { ventilationType: 'branch', branchId: branch.id },
          options: { startRatio: 0.42, endRatio: 0.68, minLength: 12, headLength: 7, headWidth: 4, opacity: options.opacity ?? 0.92, renderOrder: 34 }
        });
      }

      this.ventilationBranchObjects.set(branch.id, {
        branch,
        points,
        baseColor: baseColor.clone(),
        vertexOffset,
        vertexCount,
        line: null,
        material: null
      });
    }

    if (branchPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(branchPositions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(branchColors, 3));
      geometry.computeBoundingSphere();
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: options.opacity ?? 0.92
      });
      this.configureOverlayMaterial(material);
      this.ventilationMaterials.add(material);
      const line = new THREE.LineSegments(geometry, material);
      line.renderOrder = 32;
      line.name = 'ventilation-branches';
      line.userData.ventilationType = 'branch-collection';
      this.ventilationGroup.add(line);
      this.ventilationBranchObjects.forEach((entry) => {
        entry.line = line;
        entry.material = material;
      });
    }

    if (directionEntries.length) {
      this.addDirectionArrowsBatch(this.ventilationGroup, directionEntries, this.ventilationMaterials);
    }

    if (showFacilities) {
      for (const facility of options.facilities || []) {
        const branchEntry = this.ventilationBranchObjects.get(facility.branchId);
        if (!branchEntry) continue;
        const position = this.interpolatePath(branchEntry.points, facility.ratio ?? 0.5);
        const type = String(facility.type || '').toLowerCase();
        const color = this.facilityColor(type);
        const geometry =
          type === 'door'
            ? new THREE.BoxGeometry(4.1, 4.1, 4.1)
            : type === 'stopping'
              ? new THREE.BoxGeometry(5.0, 5.0, 2.0)
              : type === 'regulator'
                ? new THREE.OctahedronGeometry(3.1)
                : new THREE.SphereGeometry(2.8, 18, 18);
        const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.95 });
        this.configureOverlayMaterial(material);
        this.ventilationMaterials.add(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 38;
        mesh.position.copy(position);
        mesh.name = `ventilation-facility-${facility.id}`;
        mesh.userData.ventilationType = 'facility';
        mesh.userData.facilityId = facility.id;
        mesh.userData.branchId = facility.branchId;
        this.ventilationGroup.add(mesh);
        this.ventilationFacilityObjects.set(facility.id, mesh);
      }
    }

    if (showIntakeReturn) {
      const makeBoundary = (entry, kind) => {
        const node = options.nodeById?.get?.(entry.nodeId);
        const position = this.normalizePoint(node?.position);
        const color = kind === 'intake' ? 0x42a5ff : 0xff6b6b;
        const geometry = kind === 'intake' ? new THREE.ConeGeometry(2.8, 6.2, 20) : new THREE.ConeGeometry(2.8, 6.2, 20);
        const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, transparent: true, opacity: 0.96 });
        this.configureOverlayMaterial(material);
        this.ventilationMaterials.add(material);
        const marker = new THREE.Mesh(geometry, material);
        marker.renderOrder = 38;
        marker.position.copy(position).add(new THREE.Vector3(0, 0, kind === 'intake' ? 4 : -4));
        marker.rotation.x = kind === 'intake' ? Math.PI / 2 : -Math.PI / 2;
        marker.name = `ventilation-${kind}-${entry.nodeId}`;
        marker.userData.ventilationType = 'boundary';
        marker.userData.boundaryKind = kind;
        marker.userData.nodeId = entry.nodeId;
        this.ventilationGroup.add(marker);
        this.ventilationBoundaryObjects.set(`${kind}:${entry.nodeId}`, marker);
      };
      (options.boundaryConditions?.intakes || []).forEach((entry) => makeBoundary(entry, 'intake'));
      (options.boundaryConditions?.returns || []).forEach((entry) => makeBoundary(entry, 'return'));
    }
  }

  setVentilationOverlayVisible(flag) {
    this.ventilationGroup.visible = flag;
  }

  setVentilationOverlayOpacity(opacity) {
    this.setOverlayMaterialsOpacity(this.ventilationMaterials, opacity);
  }

  clearAirflowOverlay() {
    this.disposeOverlayGroup(this.airflowGroup, this.airflowMaterials);
    this.airflowBranchObjects.clear();
  }

  addAirflowBranches(branches = [], options = {}) {
    this.clearAirflowOverlay();
    const opacity = options.opacity ?? 0.85;
    const showDirection = options.showDirection !== false;
    const showAnomaly = options.showAnomalyHighlight !== false;
    const directionEntries = [];
    for (const branch of branches) {
      const rawPoints = this.branchPathPoints(branch, ['renderPath', 'path', '_renderPath', 'originalPath']);
      const points = this.tunnelCenterlinePathForBranch(branch, rawPoints);
      if (points.length < 2) continue;
      const color = new THREE.Color(branch.renderColor || '#62d7ff');
      const radius = Math.max(0.22, Number(branch.renderRadius) || 0.42);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: branch.isAnomaly && showAnomaly ? 0.35 : 0.08,
        transparent: true,
        opacity
      });
      this.configureOverlayMaterial(material);
      this.airflowMaterials.add(material);
      const group = new THREE.Group();
      group.name = `airflow-branch-group-${branch.id}`;
      const tubes = this.addPolylineTube(group, points, radius, material, {
        ventilationType: 'branch',
        airflowType: 'branch',
        branchId: branch.id,
        namePrefix: 'airflow-branch',
        renderOrder: 42
      });

      if (showDirection) {
        directionEntries.push({
          points,
          color: color.clone(),
          userData: { ventilationType: 'branch', airflowType: 'branch', branchId: branch.id },
          options: {
            startRatio: 0.46,
            endRatio: 0.72,
            minLength: 10,
            headLength: Math.max(5, radius * 7),
            headWidth: Math.max(3, radius * 4),
            opacity,
            renderOrder: 44
          }
        });
      }

      if (branch.isAnomaly && showAnomaly) {
        const markerMaterial = new THREE.MeshStandardMaterial({
          color: 0xff4d4d,
          emissive: 0xff4d4d,
          emissiveIntensity: 0.55,
          transparent: true,
          opacity: Math.min(1, opacity + 0.1)
        });
        this.configureOverlayMaterial(markerMaterial);
        this.airflowMaterials.add(markerMaterial);
        const marker = new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(1.6, radius * 4.5)), markerMaterial);
        marker.renderOrder = 48;
        marker.position.copy(this.interpolatePath(points, 0.5));
        marker.name = `airflow-anomaly-${branch.id}`;
        marker.userData.ventilationType = 'branch';
        marker.userData.airflowType = 'anomaly';
        marker.userData.branchId = branch.id;
        group.add(marker);
      }

      this.airflowBranchObjects.set(branch.id, { group, tube: tubes[0] || null, tubes, branch, points, material });
      this.airflowGroup.add(group);
    }
    if (directionEntries.length) {
      this.addDirectionArrowsBatch(this.airflowGroup, directionEntries, this.airflowMaterials);
    }
  }

  setAirflowOverlayVisible(flag) {
    this.airflowGroup.visible = flag;
  }

  setAirflowOverlayOpacity(opacity) {
    this.setOverlayMaterialsOpacity(this.airflowMaterials, opacity);
  }

  highlightAirflowBranch(branchId) {
    for (const [id, entry] of this.airflowBranchObjects) {
      const active = String(id) === String(branchId);
      entry.material.emissiveIntensity = active ? 0.72 : entry.branch.isAnomaly ? 0.35 : 0.08;
      entry.material.opacity = active ? 1 : 0.58;
      entry.material.needsUpdate = true;
    }
  }

  focusAirflowBranch(branchId) {
    const entry = this.airflowBranchObjects.get(branchId);
    if (entry?.group) this.focusOnObject(entry.group);
  }

  clearAnomalyOverlay() {
    this.disposeOverlayGroup(this.anomalyGroup, this.anomalyMaterials);
    this.anomalyBranchObjects.clear();
  }

  addAnomalyBranches(branches = [], options = {}) {
    this.clearAnomalyOverlay();
    const opacity = options.opacity ?? 0.9;
    for (const branch of branches) {
      const rawPoints = this.branchPathPoints(branch, ['renderPath', 'path', 'originalPath', '_renderPath']);
      const points = this.tunnelCenterlinePathForBranch(branch, rawPoints);
      if (points.length < 2) continue;
      const color = new THREE.Color(branch.renderColor || '#ff4d4d');
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.58,
        transparent: true,
        opacity
      });
      this.configureOverlayMaterial(material);
      this.anomalyMaterials.add(material);
      const group = new THREE.Group();
      group.name = `anomaly-branch-group-${branch.id}`;
      const tubes = this.addPolylineTube(group, points, 0.72, material, {
        ventilationType: 'branch',
        anomalyType: 'branch',
        branchId: branch.id,
        namePrefix: 'anomaly-branch',
        renderOrder: 56
      });

      const markerMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.88,
        transparent: true,
        opacity: Math.min(1, opacity + 0.08)
      });
      this.configureOverlayMaterial(markerMaterial);
      this.anomalyMaterials.add(markerMaterial);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(3.2), markerMaterial);
      marker.renderOrder = 58;
      marker.position.copy(this.interpolatePath(points, 0.5));
      marker.name = `anomaly-marker-${branch.id}`;
      marker.userData.ventilationType = 'branch';
      marker.userData.anomalyType = 'marker';
      marker.userData.branchId = branch.id;

      group.add(marker);
      this.anomalyBranchObjects.set(branch.id, { group, tube: tubes[0] || null, tubes, marker, branch, material, markerMaterial });
      this.anomalyGroup.add(group);
    }
  }

  setAnomalyOverlayVisible(flag) {
    this.anomalyGroup.visible = flag;
  }

  setAnomalyOverlayOpacity(opacity) {
    this.setOverlayMaterialsOpacity(this.anomalyMaterials, opacity);
  }

  highlightAnomalyBranch(branchId) {
    for (const [id, entry] of this.anomalyBranchObjects) {
      const active = String(id) === String(branchId);
      entry.material.emissiveIntensity = active ? 1.05 : 0.58;
      entry.material.opacity = active ? 1 : 0.74;
      entry.markerMaterial.emissiveIntensity = active ? 1.25 : 0.88;
      entry.marker.scale.setScalar(active ? 1.65 : 1);
      entry.material.needsUpdate = true;
      entry.markerMaterial.needsUpdate = true;
    }
  }

  ensureMeshVertexColors(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.attributes?.position;
    if (!geometry || !position) return null;
    if (!geometry.attributes.color || geometry.attributes.color.count !== position.count) {
      const base = mesh.material?.color?.clone?.() || new THREE.Color(0x3a4a7a);
      const colors = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i += 1) {
        colors[i * 3] = base.r;
        colors[i * 3 + 1] = base.g;
        colors[i * 3 + 2] = base.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) return;
      material.vertexColors = true;
      material.needsUpdate = true;
    });
    return geometry.attributes.color;
  }

  captureHazardBaseColors(mesh) {
    const colors = this.ensureMeshVertexColors(mesh);
    if (!colors) return null;
    if (!mesh.userData.hazardBaseColors || mesh.userData.hazardBaseColors.length !== colors.array.length) {
      mesh.userData.hazardBaseColors = new Float32Array(colors.array);
    }
    return colors;
  }

  resetRoadwayHazardColoring() {
    const root = this.roadwayObject || this.scene;
    root.traverse((mesh) => {
      if (!mesh?.isMesh || !mesh.userData?.hazardBaseColors || !mesh.geometry?.attributes?.color) return;
      mesh.geometry.attributes.color.array.set(mesh.userData.hazardBaseColors);
      mesh.geometry.attributes.color.needsUpdate = true;
      delete mesh.userData.hazardBaseColors;
    });
  }

  blendHazardColor(base, hazard, amount) {
    return base.clone().lerp(hazard, Math.max(0, Math.min(1, amount * (this.hazardColorOpacity ?? 0.85))));
  }

  hazardColorForRatio(fillRatio = 0, passability = 'passable', flowRegime = 'open', style = this.hazardVisualStyle || 'water') {
    const ratio = Math.max(0, Math.min(1.2, Number(fillRatio) || 0));
    if (style === 'fire_smoke') {
      if (passability === 'blocked' || ratio >= 0.9) return new THREE.Color(0xff2f1f);
      if (passability === 'risky' || ratio >= 0.45) return new THREE.Color(0xff8a2a);
      return new THREE.Color(0x545c68);
    }
    if (flowRegime === 'surcharged') return new THREE.Color(0x1420ff);
    if (flowRegime === 'full' || ratio >= 0.95 || passability === 'blocked') return new THREE.Color(0x0b5dff);
    if (passability === 'risky' || ratio >= 0.35) return new THREE.Color(0x1597ff);
    return new THREE.Color(0x58d7ff);
  }

  nearestPathRatio(points, target) {
    if (points.length < 2) return 0;
    const total = this.pathLength(points);
    if (total <= 0) return 0;
    let bestS = 0;
    let bestDistance = Infinity;
    let traveled = 0;
    const point = target.isVector3 ? target : this.normalizePoint(target);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const ab = b.clone().sub(a);
      const lenSq = Math.max(ab.lengthSq(), 1e-9);
      const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(ab) / lenSq));
      const projected = a.clone().lerp(b, t);
      const dist = projected.distanceTo(point);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestS = traveled + Math.sqrt(lenSq) * t;
      }
      traveled += Math.sqrt(lenSq);
    }
    return Math.max(0, Math.min(1, bestS / total));
  }

  hazardValueAtRatio(state, ratio) {
    const segments = Array.isArray(state?.wetSegments) ? state.wetSegments : [];
    for (const segment of segments) {
      const s0 = Number(segment.s0Ratio ?? 0);
      const s1 = Number(segment.s1Ratio ?? 1);
      if (ratio >= s0 && ratio <= s1) {
        return {
          fillRatio: Number(segment.fillRatio ?? state.maxFillRatio ?? 0),
          depth: Number(segment.depth ?? state.maxDepth ?? state.hazardValue ?? 0),
          flowRegime: segment.flowRegime || state.flowRegime || 'open'
        };
      }
    }
    return { fillRatio: 0, depth: 0, flowRegime: 'dry' };
  }

  buildHazardNodeValues(stateMap, roadway) {
    const nodeValues = new Map();
    (roadway?.getEdges?.() || []).forEach((edge) => {
      const state = stateMap.get(String(edge.id));
      if (!state || Number(state.hazardValue) <= 0) return;
      const [from, to] = this.edgeEndpointIds(edge);
      const segments = Array.isArray(state.wetSegments) ? state.wetSegments : [];
      const startWet = segments.some((segment) => Number(segment.s0Ratio ?? 0) <= 0.08);
      const endWet = segments.some((segment) => Number(segment.s1Ratio ?? 1) >= 0.92);
      const value = {
        fillRatio: Number(state.maxFillRatio ?? 0),
        passability: state.passability,
        flowRegime: state.flowRegime
      };
      if (from && startWet) {
        const prev = nodeValues.get(from);
        if (!prev || value.fillRatio > prev.fillRatio) nodeValues.set(from, value);
      }
      if (to && endWet) {
        const prev = nodeValues.get(to);
        if (!prev || value.fillRatio > prev.fillRatio) nodeValues.set(to, value);
      }
    });
    return nodeValues;
  }

  applyRoadwayHazardColoring(roadway, states = []) {
    const root = this.roadwayObject || this.scene;
    const stateMap = new Map((states || []).filter((state) => state?.roadwayEdgeId).map((state) => [String(state.roadwayEdgeId), state]));
    const nodeValues = this.buildHazardNodeValues(stateMap, roadway || this.topology);
    const baseColor = new THREE.Color(0x3a4a7a);
    root.traverse((mesh) => {
      const meta = mesh.userData?.heatmap;
      if (!mesh?.isMesh || !meta) return;
      const colors = this.captureHazardBaseColors(mesh);
      const position = mesh.geometry?.attributes?.position;
      if (!colors || !position) return;
      mesh.updateMatrixWorld();
      const world = new THREE.Vector3();
      if (meta.type === 'Connection') {
        const edgeId = String(meta.data?.id ?? meta.data?.topoId ?? mesh.userData?.topoID ?? '');
        const state = stateMap.get(edgeId);
        if (!state || Number(state.hazardValue) <= 0) return;
        const points = (meta.data?.verts || this.edgePathPointsFromRoadway(roadway || this.topology, edgeId)).map((point) => this.normalizePoint(point));
        for (let i = 0; i < colors.count; i += 1) {
          world.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
          const ratio = this.nearestPathRatio(points, world);
          const value = this.hazardValueAtRatio(state, ratio);
          if (value.fillRatio <= 0) continue;
          const previous = new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i));
          const hazard = this.hazardColorForRatio(value.fillRatio, state.passability, value.flowRegime, state.hazardType === 'fire_smoke' ? 'fire_smoke' : this.hazardVisualStyle);
          const amount = Math.max(0.35, Math.min(1, value.fillRatio * 1.35));
          const color = this.blendHazardColor(previous, hazard, amount);
          colors.setXYZ(i, color.r, color.g, color.b);
        }
      } else if (meta.type === 'Node') {
        const nodeId = String(meta.data?.id ?? mesh.userData?.topoID ?? '');
        const value = nodeValues.get(nodeId);
        if (!value || value.fillRatio <= 0) return;
        const hazard = this.hazardColorForRatio(value.fillRatio, value.passability, value.flowRegime, this.hazardVisualStyle);
        const amount = Math.max(0.28, Math.min(0.85, value.fillRatio * 1.15));
        for (let i = 0; i < colors.count; i += 1) {
          const previous = new THREE.Color(colors.getX(i), colors.getY(i), colors.getZ(i));
          const color = this.blendHazardColor(previous.equals(new THREE.Color(0, 0, 0)) ? baseColor : previous, hazard, amount);
          colors.setXYZ(i, color.r, color.g, color.b);
        }
      }
      colors.needsUpdate = true;
    });
  }

  pathLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i += 1) length += points[i - 1].distanceTo(points[i]);
    return length;
  }

  pointAtPathRatio(points, ratio = 0.5) {
    if (!points.length) return new THREE.Vector3();
    if (points.length === 1) return points[0].clone();
    const total = this.pathLength(points);
    const target = Math.max(0, Math.min(1, Number(ratio))) * total;
    let traveled = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const segmentLength = a.distanceTo(b);
      if (traveled + segmentLength >= target) {
        const local = segmentLength > 0 ? (target - traveled) / segmentLength : 0;
        return a.clone().lerp(b, local);
      }
      traveled += segmentLength;
    }
    return points[points.length - 1].clone();
  }

  slicePathByRatio(points, startRatio = 0, endRatio = 1) {
    if (points.length < 2) return points;
    const total = this.pathLength(points);
    if (total <= 0) return points;
    const startValue = Math.max(0, Math.min(1, Number(startRatio)));
    const endValue = Math.min(1, Math.max(startValue + 0.001, Math.min(1, Number(endRatio))));
    const start = startValue * total;
    const end = endValue * total;
    const sliced = [this.pointAtPathRatio(points, start / total)];
    let traveled = 0;
    for (let i = 1; i < points.length; i += 1) {
      const segmentLength = points[i - 1].distanceTo(points[i]);
      const next = traveled + segmentLength;
      if (next > start && next < end) sliced.push(points[i].clone());
      traveled = next;
    }
    sliced.push(this.pointAtPathRatio(points, end / total));
    return sliced;
  }

  clearHazardOverlay() {
    this.hazardGroup.traverse((child) => child.geometry?.dispose?.());
    this.hazardMaterials.forEach((material) => material?.dispose?.());
    this.hazardGroup.clear();
    this.hazardMaterials.clear();
    this.resetRoadwayHazardColoring();
  }

  addHazardEdges(roadway, states = [], options = {}) {
    this.clearHazardOverlay();
    const opacity = Math.max(0, Math.min(1, Number(options.opacity ?? 0.65)));
    this.hazardColorOpacity = opacity;
    this.hazardVisualStyle = options.hazardStyle || 'water';
    this.lastHazardColoring = { roadway, states };
    const materialCache = new Map();
    const materialFor = (color) => {
      const key = color.getHexString();
      if (materialCache.has(key)) return materialCache.get(key);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color.clone().multiplyScalar(0.28),
        emissiveIntensity: 0.72,
        transparent: opacity < 1,
        opacity,
        roughness: 0.62,
        metalness: 0.02,
        depthWrite: opacity >= 0.98
      });
      this.configureOverlayMaterial(material);
      this.hazardMaterials.add(material);
      materialCache.set(key, material);
      return material;
    };
    for (const state of states || []) {
      const edgeId = state?.roadwayEdgeId ?? state?.edgeId;
      if (!edgeId || Number(state.hazardValue ?? state.maxFillRatio ?? 0) <= 0) continue;
      const points = this.edgePathPointsFromRoadway(roadway, edgeId);
      if (points.length < 2) continue;
      const segments = Array.isArray(state.wetSegments) && state.wetSegments.length
        ? state.wetSegments
        : [{ s0Ratio: 0, s1Ratio: 1, fillRatio: state.maxFillRatio ?? state.hazardValue, depth: state.maxDepth, flowRegime: state.flowRegime }];
      for (const segment of segments) {
        const fillRatio = Number(segment.fillRatio ?? state.maxFillRatio ?? state.hazardValue ?? 0);
        if (!(fillRatio > 0)) continue;
        const segmentPoints = this.slicePathByRatio(points, segment.s0Ratio ?? 0, segment.s1Ratio ?? 1);
        if (segmentPoints.length < 2) continue;
        const color = this.hazardColorForRatio(
          fillRatio,
          state.passability,
          segment.flowRegime || state.flowRegime,
          state.hazardType === 'fire_smoke' ? 'fire_smoke' : this.hazardVisualStyle
        );
        const curve = new THREE.CatmullRomCurve3(segmentPoints, false, 'centripetal');
        const tubularSegments = Math.max(2, Math.min(40, (segmentPoints.length - 1) * 5));
        const radius = Math.max(1.35, Math.min(2.8, 1.55 + fillRatio * 1.05));
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, tubularSegments, radius, 6, false),
          materialFor(color)
        );
        mesh.renderOrder = 62;
        mesh.name = `hazard-${edgeId}`;
        mesh.userData.roadwayHazardType = state.hazardType || this.hazardVisualStyle;
        mesh.userData.roadwayEdgeId = String(edgeId);
        mesh.userData.hazardState = state;
        this.hazardGroup.add(mesh);
      }
    }
    const source =
      (states || []).find((state) => state?.sourceId) ||
      (options.sourceEdgeId ? { sourceId: options.sourceEdgeId, sourceRatio: options.sourceRatio ?? 0.5 } : null);
    if (source?.sourceId) {
      const points = this.edgePathPointsFromRoadway(roadway, source.sourceId);
      if (points.length >= 2) {
        const sourceMaterial = new THREE.MeshStandardMaterial({
          color: options.sourceColor ?? 0x3bdcff,
          emissive: options.sourceEmissive ?? 0x1e90ff,
          emissiveIntensity: 0.8,
          transparent: true,
          opacity: 0.95
        });
        this.configureOverlayMaterial(sourceMaterial);
        this.hazardMaterials.add(sourceMaterial);
        const marker = new THREE.Mesh(new THREE.SphereGeometry(3.0, 16, 16), sourceMaterial);
        marker.renderOrder = 64;
        marker.position.copy(this.pointAtPathRatio(points, source.sourceRatio ?? 0.5).add(new THREE.Vector3(0, 0, 1.2)));
        marker.name = `hazard-source-${source.sourceId}`;
        marker.userData.roadwayHazardType = 'source';
        marker.userData.roadwayEdgeId = source.sourceId;
        this.hazardGroup.add(marker);
      }
    }
    this.requestRenderBurst?.(120);
  }

  setHazardOverlayVisible(flag) {
    this.hazardGroup.visible = Boolean(flag);
    this.requestRenderBurst?.(80);
  }

  setHazardOverlayOpacity(opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    this.hazardColorOpacity = value;
    this.setOverlayMaterialsOpacity(this.hazardMaterials, value);
    this.requestRenderBurst?.(80);
  }

  clearSafeRouteOverlay() {
    this.disposeOverlayGroup(this.routeGroup, this.routeMaterials);
    this.routeObjects.clear();
  }

  routeStatusColor(status) {
    if (status === 'noRoute') return 0xff4d4d;
    if (status === 'risky') return 0xf2a51a;
    return 0x4ade80;
  }

  addEmergencyPersonMarkers(roadway, people = []) {
    if (!people.length) return;
    const geometry = new THREE.SphereGeometry(3.9, 16, 12);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.96
    });
    this.configureOverlayMaterial(material);
    this.routeMaterials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, people.length);
    mesh.name = 'person-markers';
    mesh.renderOrder = 72;
    mesh.userData.emergencyInstances = [];
    const matrix = new THREE.Matrix4();
    people.forEach((person, index) => {
      const color = new THREE.Color(
        person.routeStatus === 'noRoute'
          ? 0xff4d4d
          : person.routeStatus === 'risky'
            ? 0xf2a51a
            : 0x4ade80
      );
      const position = this.positionFromRoadwayAnchor(roadway, person.roadwayAnchor, person.position, 1.8);
      matrix.makeTranslation(position.x, position.y, position.z);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color);
      mesh.userData.emergencyInstances[index] = { type: 'person', id: person.personId };
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.routeGroup.add(mesh);
  }

  addEmergencyResourceMarkers(roadway, resources = []) {
    if (!resources.length) return;
    const geometry = new THREE.ConeGeometry(4.2, 9, 18);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.98
    });
    this.configureOverlayMaterial(material);
    this.routeMaterials.add(material);
    const mesh = new THREE.InstancedMesh(geometry, material, resources.length);
    mesh.name = 'emergency-resource-markers';
    mesh.renderOrder = 72;
    mesh.userData.emergencyInstances = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const scale = new THREE.Vector3(1, 1, 1);
    resources.forEach((resource, index) => {
      const position = this.positionFromRoadwayAnchor(roadway, resource.roadwayAnchor, resource.position, 4.2);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, new THREE.Color(0x42d392));
      mesh.userData.emergencyInstances[index] = { type: 'resource', id: resource.resourceId };
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.routeGroup.add(mesh);
  }

  addSafeRoutes({ roadway, routes = [], people = [], resources = [], selectedRouteId = null, opacity = 0.95 } = {}) {
    this.clearSafeRouteOverlay();
    for (const route of routes || []) {
      if (!route.edgePath?.length && !route.segments?.length) continue;
      const color = new THREE.Color(this.routeStatusColor(route.status));
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: route.routeId === selectedRouteId ? 0.7 : 0.22,
        transparent: true,
        opacity: route.routeId === selectedRouteId ? 1 : opacity
      });
      this.configureOverlayMaterial(material);
      this.routeMaterials.add(material);
      const group = new THREE.Group();
      group.name = `safe-route-${route.routeId}`;
      const segments = route.segments?.length
        ? route.segments
        : (route.edgePath || []).map((edgeId) => ({ edgeId, startRatio: 0, endRatio: 1 }));
      const routeParts = [];
      segments.forEach((segment) => {
        const points = this.edgePathPointsFromRoadway(roadway, segment.edgeId);
        if (points.length < 2) return;
        const startRatio = Math.max(0, Math.min(1, Number(segment.startRatio ?? 0)));
        const endRatio = Math.max(0, Math.min(1, Number(segment.endRatio ?? 1)));
        const routePoints =
          startRatio <= endRatio
            ? this.slicePathByRatio(points, startRatio, endRatio)
            : this.slicePathByRatio(points, endRatio, startRatio).reverse();
        if (routePoints.length < 2) return;
        const current = routeParts[routeParts.length - 1];
        if (current?.length && current[current.length - 1].distanceTo(routePoints[0]) <= 3) {
          current.push(...routePoints.slice(1));
        } else {
          routeParts.push([...routePoints]);
        }
      });
      routeParts.forEach((routePoints) => {
        if (routePoints.length >= 2) this.addPolylineTube(group, routePoints, route.routeId === selectedRouteId ? 0.72 : 0.46, material, {
          routeId: route.routeId,
          personId: route.personId,
          roadwayEdgeId: route.edgePath?.[0],
          namePrefix: 'safe-route',
          renderOrder: route.routeId === selectedRouteId ? 68 : 62
        });
      });
      this.routeObjects.set(route.routeId, { group, route, material });
      this.routeGroup.add(group);
    }

    this.addEmergencyPersonMarkers(roadway, people || []);
    this.addEmergencyResourceMarkers(roadway, resources || []);
  }

  setSafeRouteOverlayVisible(flag) {
    this.routeGroup.visible = flag;
  }

  setSafeRouteOverlayOpacity(opacity) {
    this.setOverlayMaterialsOpacity(this.routeMaterials, opacity);
  }

  pickEmergencyResponseObject() {
    if (!this.routeGroup?.visible) return null;
    const hits = this.raycaster.intersectObjects(this.routeGroup.children, true);
    if (!hits.length) return null;
    for (const hit of hits) {
      const instance = Number.isInteger(hit.instanceId)
        ? hit.object?.userData?.emergencyInstances?.[hit.instanceId]
        : null;
      if (instance) return instance;
      let object = hit.object;
      while (object) {
        const data = object.userData || {};
        if (data.personId) return { type: 'person', id: data.personId };
        if (data.resourceId) return { type: 'resource', id: data.resourceId };
        if (data.routeId) return { type: 'route', id: data.routeId, personId: data.personId };
        object = object.parent;
      }
    }
    return null;
  }

  setGeologicalPickables(ownerId, objects = [], handler = null) {
    if (!ownerId) return;
    const pickables = Array.isArray(objects) ? objects.filter(Boolean) : [objects].filter(Boolean);
    this.geologyPickSources.set(String(ownerId), { objects: pickables, handler });
  }

  clearGeologicalPickables(ownerId) {
    if (ownerId) this.geologyPickSources.delete(String(ownerId));
  }

  pickGeologicalObject() {
    if (!this.geologyPickSources.size) return null;
    const objects = [];
    this.geologyPickSources.forEach((source) => objects.push(...source.objects));
    const hits = this.raycaster.intersectObjects(objects, true);
    const candidates = [];
    for (const hit of hits) {
      let object = hit.object;
      while (object && !object.userData?.geologyPick) object = object.parent;
      if (!object?.userData?.geologyPick) continue;
      let ownerId = null;
      let handler = null;
      this.geologyPickSources.forEach((source, key) => {
        if (handler) return;
        const belongs = source.objects.some((root) => {
          let current = object;
          while (current) {
            if (current === root) return true;
            current = current.parent;
          }
          return false;
        });
        if (belongs) {
          ownerId = key;
          handler = source.handler;
        }
      });
      const resolvedPick = object.userData.resolveGeologyPick?.(hit) || object.userData.geologyPick;
      candidates.push({
        ...resolvedPick,
        ownerId,
        object,
        index: hit.instanceId ?? hit.index,
        point: hit.point,
        handler
      });
    }
    return candidates.find((candidate) => candidate.type === 'geologicalVolume') || candidates[0] || null;
  }

  focusAnomalyBranch(branchId) {
    const entry = this.anomalyBranchObjects.get(branchId);
    if (entry?.group) this.focusOnObject(entry.group);
  }

  highlightVentilationBranch(branchId) {
    const first = this.ventilationBranchObjects.values().next().value;
    const colorAttribute = first?.line?.geometry?.attributes?.color;
    if (!colorAttribute) return;
    const hasSelection = branchId != null && branchId !== '';
    for (const [id, entry] of this.ventilationBranchObjects) {
      const active = hasSelection && String(id) === String(branchId);
      const color = active
        ? new THREE.Color(0xffffff)
        : entry.baseColor.clone().multiplyScalar(hasSelection ? 0.55 : 1);
      for (let index = 0; index < entry.vertexCount; index += 1) {
        colorAttribute.setXYZ(entry.vertexOffset + index, color.r, color.g, color.b);
      }
    }
    colorAttribute.needsUpdate = true;
  }

  highlightVentilationFacility(facilityId) {
    for (const [id, mesh] of this.ventilationFacilityObjects) {
      const active = String(id) === String(facilityId);
      mesh.scale.setScalar(active ? 1.7 : 1);
      mesh.material.emissiveIntensity = active ? 0.85 : 0.2;
    }
  }

  focusVentilationBranch(branchId) {
    const entry = this.ventilationBranchObjects.get(branchId);
    if (!entry?.points?.length) return;
    const box = new THREE.Box3().setFromPoints(entry.points);
    const target = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const direction = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (direction.lengthSq() < 0.0001) direction.set(1, 1, 1);
    const distance = maxDim * 1.45;
    const framedTarget = this.frameTargetForViewport(target, distance);
    this.animateCameraTo(framedTarget, framedTarget.clone().add(direction.setLength(distance)), 0.5);
  }

  focusVentilationFacility(facilityId) {
    const mesh = this.ventilationFacilityObjects.get(facilityId);
    if (mesh) this.focusOn(mesh);
  }

  frameTargetForViewport(target, distance) {
    const width = Math.max(1, this.container.clientWidth || 1);
    const height = Math.max(1, this.container.clientHeight || 1);
    const safe = this.viewportInsets?.safeRect || { x: 0, y: 0, width, height };
    const offsetX = safe.x + safe.width / 2 - width / 2;
    const offsetY = safe.y + safe.height / 2 - height / 2;
    if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) return target.clone();
    const worldPerPixel = (2 * Math.max(0.1, distance) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5))) / height;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    return target.clone()
      .addScaledVector(right, -offsetX * worldPerPixel)
      .addScaledVector(up, offsetY * worldPerPixel);
  }

  focusOnObject(obj) {
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) {
      this.focusOn(obj);
      return;
    }
    const target = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const camStart = this.camera.position.clone();
    const direction = new THREE.Vector3().subVectors(camStart, this.controls.target);
    if (direction.lengthSq() < 0.0001) direction.set(1, 1, 1);
    const distance = maxDim * 1.45;
    const framedTarget = this.frameTargetForViewport(target, distance);
    const camEnd = framedTarget.clone().add(direction.setLength(distance));
    this.animateCameraTo(framedTarget, camEnd, 0.5);
  }

  focusOnRoadway() {
    this.focusOnObject(this.roadwayObject);
  }

  focusOnSensor(sensorID) {
    const sensor = this.getSensorObject(sensorID);
    if (sensor) this.focusOn(sensor, SENSOR_FOCUS_DISTANCE);
  }

  focusOn(obj, distance = 8) {
    if (!obj) return;
    const target = obj.getWorldPosition ? obj.getWorldPosition(new THREE.Vector3()) : obj.position.clone();
    const camStart = this.camera.position.clone();
    const dir = new THREE.Vector3().subVectors(camStart, this.controls.target);
    if (dir.lengthSq() < 0.0001) dir.set(1, 1, 1);
    const framedTarget = this.frameTargetForViewport(target, distance);
    const camEnd = framedTarget.clone().add(dir.setLength(distance));
    this.animateCameraTo(framedTarget, camEnd, 0.5);
  }

  animateCameraTo(target, cameraPosition, duration = 0.5) {
    if (this.focusAnimationFrame) cancelAnimationFrame(this.focusAnimationFrame);
    const targetStart = this.controls.target.clone();
    const cameraStart = this.camera.position.clone();
    const startTime = performance.now();
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    const animateFocus = (now) => {
      const progress = Math.min(1, (now - startTime) / (duration * 1000));
      const t = easeInOut(progress);
      this.controls.target.lerpVectors(targetStart, target, t);
      this.camera.position.lerpVectors(cameraStart, cameraPosition, t);
      this.controls.update();
      if (progress < 1) {
        this.focusAnimationFrame = requestAnimationFrame(animateFocus);
      } else {
        this.focusAnimationFrame = null;
      }
    };
    this.focusAnimationFrame = requestAnimationFrame(animateFocus);
  }

  applyEdgeValues(edgeValues) {
    this.edgeValues = edgeValues;
  }

  colorEdges(edgeValues, colorFn) {
    for (const [edgeId, mesh] of this.edgeMeshes.entries()) {
      const v = edgeValues.get(edgeId) ?? 0;
      mesh.material.color = new THREE.Color(colorFn(v));
    }
  }

  guessAxisFromGeometry(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const half = size[axis] / 2;
    const p1 = center.clone();
    const p2 = center.clone();
    p1[axis] -= half;
    p2[axis] += half;
    return [
      { x: p1.x, y: p1.y, z: p1.z },
      { x: p2.x, y: p2.y, z: p2.z }
    ];
  }

  registerChartPresentationPick(ownerId, objects, handler) {
    this.chartPresentationPickTargets.set(String(ownerId), {
      objects: (Array.isArray(objects) ? objects : [objects]).filter(Boolean),
      handler
    });
  }

  unregisterChartPresentationPick(ownerId) {
    this.chartPresentationPickTargets.delete(String(ownerId));
  }

  registerInteractionHandler(type, ownerId, handler, options = {}) {
    return this.interactionRouter.register(type, ownerId, handler, options);
  }

  setActiveInteractionOwner(ownerId) {
    this.interactionRouter.setActiveOwner(ownerId);
  }

  clearInteractionOwner(ownerId) {
    this.interactionRouter.clearOwner(ownerId);
  }

  dispatchInteraction(type, legacyHandler, ...args) {
    if (this.interactionRouter.dispatch(type, ...args)) return true;
    legacyHandler?.(...args);
    return typeof legacyHandler === 'function';
  }

  pickChartPresentation() {
    const candidates = [];
    for (const entry of this.chartPresentationPickTargets.values()) {
      const visibleObjects = entry.objects.filter((object) => object?.visible);
      if (!visibleObjects.length) continue;
      const hit = this.raycaster.intersectObjects(visibleObjects, true)[0];
      if (hit) candidates.push({ ...entry, hit });
    }
    candidates.sort((left, right) => left.hit.distance - right.hit.distance);
    return candidates[0] || null;
  }

  onPick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const chartPresentation = this.pickChartPresentation();
    if (chartPresentation) {
      chartPresentation.handler?.(chartPresentation.hit, event);
      return;
    }
    const facilityId = this.pickVentilationFacilityMarker();
    if (facilityId) {
      this.dispatchInteraction('ventilation-facility', this.onVentilationFacilityPick, facilityId, event);
      return;
    }
    const branchId = this.pickVentilationBranchFromRoadway();
    if (branchId) {
      this.dispatchInteraction('ventilation-branch', this.onVentilationBranchPick, branchId, event);
      return;
    }
    const emergencyObject = this.pickEmergencyResponseObject();
    if (emergencyObject) {
      if (emergencyObject.type === 'person') {
        this.dispatchInteraction('person', this.onPersonPick, emergencyObject.id);
      } else if (emergencyObject.type === 'resource') {
        this.dispatchInteraction('emergency-resource', this.onEmergencyResourcePick, emergencyObject.id);
      } else if (emergencyObject.type === 'route') {
        this.dispatchInteraction('safe-route', this.onSafeRoutePick, emergencyObject.id, emergencyObject.personId);
      }
      return;
    }
    const geologicalObject = this.pickGeologicalObject();
    if (geologicalObject) {
      geologicalObject.handler?.(geologicalObject);
      this.onGeologicalObjectPick?.(geologicalObject);
      return;
    }
    const roadwayEntity = this.pickRoadwayEntity();
    if (roadwayEntity && this.dispatchInteraction('roadway', this.onRoadwayPick, roadwayEntity, event)) {
      return;
    }
    const sensorPickObjects = this.sensorPickTargets.size
      ? Array.from(this.sensorPickTargets.values())
      : Array.from(this.sensors.values());
    const intersects = this.raycaster.intersectObjects(sensorPickObjects);
    if (intersects.length > 0) {
      const sensorID = intersects[0].object.userData.sensorID;
      this.dispatchInteraction('sensor', this.onSensorPick, sensorID, event);
      return;
    }
    this.onBlankPick?.({ event });
  }

  requestRenderBurst(durationMs = 250) {
    this.interactiveRenderUntil = Math.max(this.interactiveRenderUntil, performance.now() + Math.max(0, Number(durationMs) || 0));
  }

  animate(timestamp = performance.now()) {
    this.animationFrame = requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
    if (document.hidden) return;
    const active = this.controlsInteracting ||
      Boolean(this.focusAnimationFrame) ||
      timestamp < this.interactiveRenderUntil;
    if (!active && timestamp - this.lastRenderAt < IDLE_RENDER_INTERVAL_MS) return;
    this.controls.update();
    const renderStartedAt = performance.now();
    this.renderer.render(this.scene, this.camera);
    const renderDurationMs = performance.now() - renderStartedAt;
    this.performanceStats.totalFrames += 1;
    this.performanceStats.maxRenderMs = Math.max(this.performanceStats.maxRenderMs, renderDurationMs);
    if (renderDurationMs >= 40) {
      this.performanceStats.renderSamples.push({
        startedAt: renderStartedAt,
        durationMs: renderDurationMs,
        triangles: this.renderer.info.render.triangles,
        calls: this.renderer.info.render.calls
      });
      if (this.performanceStats.renderSamples.length > 60) this.performanceStats.renderSamples.shift();
    }
    this.lastRenderAt = performance.now();
  }

  dispose() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.clearComparisonSprites(this.sensorSelectionSprites);
    this.clearComparisonSprites(this.ventilationSelectionSprites);
    for (const ownerId of [...this.roadwayFieldLayers.keys()]) this.removeRoadwayFieldLayer(ownerId);
    this.clearRoadwaySelectionOverlay();
    this.chartPresentationPickTargets.clear();
    this.interactionRouter.clear();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleWindowResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePickPointerDown, true);
    window.removeEventListener('pointermove', this.handlePickPointerMove, true);
    window.removeEventListener('pointerup', this.handlePickPointerUp, true);
    window.removeEventListener('pointercancel', this.handlePickPointerCancel, true);
    this.controls.removeEventListener('start', this.handleControlsStart);
    this.controls.removeEventListener('change', this.handleControlsChange);
    this.controls.removeEventListener('end', this.handleControlsEnd);
    window.removeEventListener('input', this.handleVisualInput, true);
    window.removeEventListener('change', this.handleVisualInput, true);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
