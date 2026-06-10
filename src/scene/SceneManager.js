import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { appPath } from '../utils/appPath.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.ensureOverlayHost();

    this.scene = new THREE.Scene();
    // this.scene.background = new THREE.Color('#434343ff');
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 50000);
    this.camera.position.set(0, 0, 1000);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.sensors = new Map();
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
    this.roadwayHighlightMaterials = new Map();
    this.topology = null;
    this.roadwayObject = null;
    this.roadwaySignature = null;
    this.focusAnimationFrame = null;
    this.raycaster.params.Line = { threshold: 3 };
    this.scene.add(this.ventilationGroup);
    this.scene.add(this.airflowGroup);
    this.scene.add(this.anomalyGroup);
    this.scene.add(this.hazardGroup);
    this.scene.add(this.routeGroup);
    this.createViewHelper();

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPick(e));
    this.animate();
  }

  ensureOverlayHost() {
    const style = window.getComputedStyle(this.container);
    if (style.position === 'static') this.container.style.position = 'relative';
  }

  createViewHelper() {
    this.viewHelperSize = 128;
    this.viewHelperRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.viewHelperRenderer.setPixelRatio(window.devicePixelRatio);
    this.viewHelperRenderer.setSize(this.viewHelperSize, this.viewHelperSize);
    this.viewHelperRenderer.setClearColor(0x000000, 0);
    this.viewHelperRenderer.domElement.className = 'scene-view-helper';
    Object.assign(this.viewHelperRenderer.domElement.style, {
      position: 'absolute',
      left: '14px',
      bottom: '14px',
      width: `${this.viewHelperSize}px`,
      height: `${this.viewHelperSize}px`,
      zIndex: '18',
      borderRadius: '12px',
      background: 'rgba(8, 12, 24, 0.34)',
      border: '1px solid rgba(255,255,255,0.12)',
      pointerEvents: 'auto'
    });
    this.container.appendChild(this.viewHelperRenderer.domElement);
    this.viewHelper = new ViewHelper(this.camera, this.viewHelperRenderer.domElement);
    this.viewHelperRenderer.domElement.addEventListener('pointerdown', (event) => {
      this.viewHelper.center.copy(this.controls.target);
      if (this.viewHelper.handleClick(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.viewHelperRenderer?.setPixelRatio(window.devicePixelRatio);
    this.viewHelperRenderer?.setSize(this.viewHelperSize, this.viewHelperSize);
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
    object?.traverse?.((child) => {
      if (child.geometry?.dispose) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      materials.forEach((material) => material?.dispose?.());
    });
  }

  removeRoadwayObject() {
    if (!this.roadwayObject) return;
    this.scene.remove(this.roadwayObject);
    this.disposeObjectTree(this.roadwayObject);
    this.roadwayObject = null;
    this.roadwaySignature = null;
    this.resetRoadwayMeshIndexes();
    this.roadwayHighlightMaterials.clear();
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

  /**
   * 加载 OBJ 模型 (支持 URL 或 纯文本)
   * @param {string|null} url - 文件路径 (若有)
   * @param {string|null} text - 文件内容 (若为 inline)
   * @param {Array} mapping - 部件映射表
   */
  async loadRoadwayModel(url, text, mapping, topo) {
    const signature = this.roadwayModelSignature(url, text, mapping, topo, 'obj');
    if (this.roadwayObject && this.roadwaySignature === signature) {
      if (topo) this.topology = topo;
      this.roadwayObject.visible = true;
      return this.roadwayObject;
    }
    if (this.roadwayObject) this.removeRoadwayObject();
    const loader = new OBJLoader();
    let object = null;
    if (topo) this.topology = topo;

    try {
      if (url) {
        object = await loader.loadAsync(appPath(url));
      } else if (text) {
        object = loader.parse(text);
      }

      if (!object) return;

      const map = this.buildMeshMappingLookup(mapping);
      this.resetRoadwayMeshIndexes();

      object.traverse((child) => {
        if (!child.isMesh) return;
        child.material = new THREE.MeshStandardMaterial({
          color: '#3a4a7a',
          side: THREE.DoubleSide,
          vertexColors: true
        });
        child.material.needsUpdate = true;

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
    else if (this.sensors.size) return;
    const mat = new THREE.MeshStandardMaterial({ color: '#ff9f43', emissive: '#ff9f43' });
    this.configureOverlayMaterial(mat);
    for (const sensor of sensors) {
      const geo = new THREE.SphereGeometry(0.75, 16, 16);
      const mesh = new THREE.Mesh(geo, mat.clone());
      this.configureOverlayObject(mesh, 72);
      mesh.position.copy(
        this.positionFromRoadwayAnchor(
          this.topology,
          { edgeId: sensor.edgeId ?? sensor.roadwayEdgeId, nodeId: sensor.nodeId ?? sensor.roadwayNodeId, ratio: sensor.ratio },
          { x: sensor.x, y: sensor.y, z: sensor.z },
          0.8
        )
      );
      mesh.userData.sensorID = sensor.sensorID;
      mesh.name = `sensor-${sensor.sensorID}`;
      this.scene.add(mesh);
      this.sensors.set(sensor.sensorID, mesh);
    }
    this.sensorSignature = signature;
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
    this.clearSensorHighlight();
    for (const mesh of this.sensors.values()) {
      this.scene.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    this.sensors.clear();
    this.sensorSignature = null;
  }

  getSensorObject(sensorID) {
    return this.sensors.get(sensorID);
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

  setSensorsVisible(flag) {
    for (const mesh of this.sensors.values()) {
      mesh.visible = flag;
    }
  }

  setSensorVisible(sensorID, flag) {
    const mesh = this.sensors.get(sensorID);
    if (mesh) mesh.visible = flag;
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

  setRoadwayVisible(flag) {
    if (this.roadwayObject) this.roadwayObject.visible = flag;
  }

  setRoadwayOpacity(opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    const root = this.roadwayObject || this.scene;
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.material) return;
      mesh.material.transparent = value < 1;
      mesh.material.opacity = value;
      mesh.material.needsUpdate = true;
    });
  }

  setRoadwayBaseColor(color = '#3a4a7a') {
    const base = new THREE.Color(color);
    const root = this.roadwayObject || this.scene;
    root.traverse((mesh) => {
      if (!mesh?.isMesh || !mesh.material) return;
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
    const root = this.roadwayObject || this.scene;
    root.traverse((mesh) => {
      if (!mesh?.isMesh || !mesh.material) return;
      const meta = mesh.userData?.heatmap;
      const entityId = String(meta?.data?.id ?? mesh.userData?.topoID ?? '');
      const topoId = String(meta?.data?.topoId ?? mesh.userData?.topoID ?? entityId);
      const active =
        meta?.type === 'Connection'
          ? activeIds.has(entityId) || activeIds.has(topoId)
          : meta?.type === 'Node'
            ? activeNodeIds.has(entityId) || activeNodeIds.has(topoId)
            : false;
      if (!mesh.userData.roadwayHighlightMaterialUnique) {
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((material) => material.clone()) : mesh.material.clone();
        mesh.userData.roadwayHighlightMaterialUnique = true;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        if (!this.roadwayHighlightMaterials.has(material.uuid)) {
          this.roadwayHighlightMaterials.set(material.uuid, {
            emissive: material.emissive?.clone?.() || null,
            emissiveIntensity: material.emissiveIntensity
          });
        }
        const base = this.roadwayHighlightMaterials.get(material.uuid);
        if (material.emissive) {
          material.emissive.copy(active ? new THREE.Color(0xffd166) : base.emissive || new THREE.Color(0x000000));
        }
        if (typeof material.emissiveIntensity === 'number') {
          material.emissiveIntensity = active ? 0.85 : (base.emissiveIntensity ?? 1);
        }
        material.needsUpdate = true;
      }
    });
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

  clearVentilationOverlay() {
    this.ventilationGroup.clear();
    this.ventilationBranchObjects.clear();
    this.ventilationFacilityObjects.clear();
    this.ventilationBoundaryObjects.clear();
    this.ventilationMaterials.clear();
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

  createSegmentTube(start, end, radius, material, userData = {}) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0.0001) return null;
    this.configureOverlayMaterial(material);
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = userData.renderOrder ?? 40;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    Object.assign(mesh.userData, userData);
    return mesh;
  }

  addPolylineTube(group, points, radius, material, userData = {}) {
    const tubes = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const tube = this.createSegmentTube(points[i], points[i + 1], radius, material, userData);
      if (!tube) continue;
      tube.name = `${userData.namePrefix || 'branch-segment'}-${userData.branchId}-${i}`;
      tubes.push(tube);
      group.add(tube);
    }
    return tubes;
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

  addVentilationBranches(branches = [], options = {}) {
    this.clearVentilationOverlay();
    const showDirection = options.showDirection !== false;
    const showFacilities = options.showFacilities !== false;
    const showIntakeReturn = options.showIntakeReturn !== false;
    const colorMode = options.branchColorMode || 'type';

    for (const branch of branches) {
      const rawPoints = this.branchPathPoints(branch, ['path', 'renderPath', '_renderPath', 'originalPath']);
      const points = this.tunnelCenterlinePathForBranch(branch, rawPoints);
      if (points.length < 2) continue;
      const material = new THREE.LineBasicMaterial({
        color: this.branchColor(branch, colorMode),
        transparent: true,
        opacity: options.opacity ?? 0.92
      });
      this.configureOverlayMaterial(material);
      this.ventilationMaterials.add(material);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
      line.renderOrder = 32;
      line.name = `ventilation-branch-${branch.id}`;
      line.userData.ventilationType = 'branch';
      line.userData.branchId = branch.id;
      line.userData.baseColor = material.color.clone();
      this.ventilationGroup.add(line);

      const group = new THREE.Group();
      group.name = `ventilation-branch-group-${branch.id}`;
      group.add(line);

      if (showDirection) {
        this.addDirectionArrow(
          group,
          points,
          material.color,
          this.ventilationMaterials,
          { ventilationType: 'branch', branchId: branch.id, namePrefix: 'ventilation-arrow', renderOrder: 34 },
          { startRatio: 0.42, endRatio: 0.68, minLength: 12, headLength: 7, headWidth: 4, opacity: options.opacity ?? 0.92, renderOrder: 34 }
        );
      }

      this.ventilationBranchObjects.set(branch.id, { group, line, branch, points, material });
      this.ventilationGroup.add(group);
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
    this.airflowGroup.clear();
    this.airflowBranchObjects.clear();
    this.airflowMaterials.clear();
  }

  addAirflowBranches(branches = [], options = {}) {
    this.clearAirflowOverlay();
    const opacity = options.opacity ?? 0.85;
    const showDirection = options.showDirection !== false;
    const showAnomaly = options.showAnomalyHighlight !== false;
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
        this.addDirectionArrow(
          group,
          points,
          color,
          this.airflowMaterials,
          { ventilationType: 'branch', airflowType: 'branch', branchId: branch.id, namePrefix: 'airflow-arrow', renderOrder: 44 },
          {
            startRatio: 0.46,
            endRatio: 0.72,
            minLength: 10,
            headLength: Math.max(5, radius * 7),
            headWidth: Math.max(3, radius * 4),
            opacity,
            renderOrder: 44
          }
        );
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
    this.anomalyGroup.clear();
    this.anomalyBranchObjects.clear();
    this.anomalyMaterials.clear();
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
    this.hazardGroup.clear();
    this.hazardMaterials.clear();
    this.resetRoadwayHazardColoring();
  }

  addHazardEdges(roadway, states = [], options = {}) {
    this.clearHazardOverlay();
    const opacity = options.opacity ?? 0.65;
    this.hazardColorOpacity = opacity;
    this.hazardVisualStyle = options.hazardStyle || 'water';
    this.lastHazardColoring = { roadway, states };
    this.applyRoadwayHazardColoring(roadway, states);
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
        const marker = new THREE.Mesh(new THREE.SphereGeometry(3.0, 24, 24), sourceMaterial);
        marker.renderOrder = 64;
        marker.position.copy(this.pointAtPathRatio(points, source.sourceRatio ?? 0.5).add(new THREE.Vector3(0, 0, 1.2)));
        marker.name = `water-source-${source.sourceId}`;
        marker.userData.roadwayHazardType = 'source';
        marker.userData.roadwayEdgeId = source.sourceId;
        this.hazardGroup.add(marker);
      }
    }
  }

  setHazardOverlayVisible(flag) {
    this.hazardGroup.visible = flag;
    if (!flag) {
      this.resetRoadwayHazardColoring();
      return;
    }
    if (this.lastHazardColoring) {
      this.applyRoadwayHazardColoring(this.lastHazardColoring.roadway, this.lastHazardColoring.states);
    }
  }

  setHazardOverlayOpacity(opacity) {
    const value = Math.max(0, Math.min(1, Number(opacity)));
    this.hazardColorOpacity = value;
    if (this.lastHazardColoring && this.hazardGroup.visible) {
      this.resetRoadwayHazardColoring();
      this.applyRoadwayHazardColoring(this.lastHazardColoring.roadway, this.lastHazardColoring.states);
    }
    this.setOverlayMaterialsOpacity(this.hazardMaterials, value);
  }

  clearSafeRouteOverlay() {
    this.routeGroup.clear();
    this.routeMaterials.clear();
    this.routeObjects.clear();
  }

  routeStatusColor(status) {
    if (status === 'noRoute') return 0xff4d4d;
    if (status === 'risky') return 0xf2a51a;
    return 0x4ade80;
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

    for (const person of people || []) {
      const color = person.routeStatus === 'noRoute' ? 0xff4d4d : person.routeStatus === 'risky' ? 0xf2a51a : 0x4ade80;
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.28, transparent: true, opacity: 0.96 });
      this.configureOverlayMaterial(material);
      this.routeMaterials.add(material);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(3.9, 20, 20), material);
      marker.renderOrder = 72;
      marker.position.copy(this.positionFromRoadwayAnchor(roadway, person.roadwayAnchor, person.position, 1.8));
      marker.name = `person-marker-${person.personId}`;
      marker.userData.personId = person.personId;
      this.routeGroup.add(marker);
    }

    for (const resource of resources || []) {
      const material = new THREE.MeshStandardMaterial({ color: 0x42d392, emissive: 0x42d392, emissiveIntensity: 0.22, transparent: true, opacity: 0.98 });
      this.configureOverlayMaterial(material);
      this.routeMaterials.add(material);
      const marker = new THREE.Mesh(new THREE.ConeGeometry(4.2, 9, 24), material);
      marker.renderOrder = 72;
      marker.position.copy(this.positionFromRoadwayAnchor(roadway, resource.roadwayAnchor, resource.position, 4.2));
      marker.rotation.x = Math.PI;
      marker.name = `resource-marker-${resource.resourceId}`;
      marker.userData.resourceId = resource.resourceId;
      this.routeGroup.add(marker);
    }
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
      candidates.push({
        ...object.userData.geologyPick,
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
    for (const [id, entry] of this.ventilationBranchObjects) {
      const active = String(id) === String(branchId);
      entry.material.color.copy(active ? new THREE.Color(0xffffff) : entry.line.userData.baseColor);
      entry.material.opacity = active ? 1 : 0.55;
      entry.material.needsUpdate = true;
    }
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
    if (entry?.group) this.focusOnObject(entry.group);
  }

  focusVentilationFacility(facilityId) {
    const mesh = this.ventilationFacilityObjects.get(facilityId);
    if (mesh) this.focusOn(mesh);
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
    const camEnd = target.clone().add(direction.setLength(maxDim * 1.45));
    this.animateCameraTo(target, camEnd, 0.5);
  }

  focusOnRoadway() {
    this.focusOnObject(this.roadwayObject);
  }

  focusOnSensor(sensorID) {
    const sensor = this.getSensorObject(sensorID);
    if (sensor) this.focusOn(sensor);
  }

  focusOn(obj) {
    if (!obj) return;
    const target = obj.getWorldPosition ? obj.getWorldPosition(new THREE.Vector3()) : obj.position.clone();
    const camStart = this.camera.position.clone();
    const dir = new THREE.Vector3().subVectors(camStart, this.controls.target);
    if (dir.lengthSq() < 0.0001) dir.set(1, 1, 1);
    const camEnd = target.clone().add(dir.setLength(8));
    this.animateCameraTo(target, camEnd, 0.5);
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

  onPick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const facilityId = this.pickVentilationFacilityMarker();
    if (facilityId) {
      this.onVentilationFacilityPick?.(facilityId);
      return;
    }
    const branchId = this.pickVentilationBranchFromRoadway();
    if (branchId) {
      this.onVentilationBranchPick?.(branchId);
      return;
    }
    const emergencyObject = this.pickEmergencyResponseObject();
    if (emergencyObject) {
      if (emergencyObject.type === 'person') this.onPersonPick?.(emergencyObject.id);
      else if (emergencyObject.type === 'resource') this.onEmergencyResourcePick?.(emergencyObject.id);
      else if (emergencyObject.type === 'route') this.onSafeRoutePick?.(emergencyObject.id, emergencyObject.personId);
      return;
    }
    const geologicalObject = this.pickGeologicalObject();
    if (geologicalObject) {
      geologicalObject.handler?.(geologicalObject);
      this.onGeologicalObjectPick?.(geologicalObject);
      return;
    }
    const roadwayEntity = this.pickRoadwayEntity();
    if (roadwayEntity && this.onRoadwayPick) {
      this.onRoadwayPick(roadwayEntity);
      return;
    }
    const intersects = this.raycaster.intersectObjects(Array.from(this.sensors.values()));
    if (intersects.length > 0) {
      const sensorID = intersects[0].object.userData.sensorID;
      this.onSensorPick?.(sensorID);
      return;
    }
    this.onBlankPick?.({ event });
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const delta = this.clock.getDelta();
    if (this.viewHelper?.animating) {
      this.viewHelper.center.copy(this.controls.target);
      this.viewHelper.update(delta);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.viewHelper && this.viewHelperRenderer) {
      this.viewHelper.center.copy(this.controls.target);
      this.viewHelper.render(this.viewHelperRenderer);
    }
  }
}
