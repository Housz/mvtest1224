import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
    this.edgeMeshes = new Map();
    this.nodeMeshes = new Map();
    this.roadwayMeshIndex = new Map();
    this.edgeEndpointNodes = new Map();
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
    this.roadwayHighlightMaterials = new Map();
    this.topology = null;
    this.roadwayObject = null;
    this.focusAnimationFrame = null;
    this.raycaster.params.Line = { threshold: 3 };
    this.scene.add(this.ventilationGroup);
    this.scene.add(this.airflowGroup);
    this.scene.add(this.anomalyGroup);
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
    if (this.roadwayObject) {
      if (topo) this.topology = topo;
      this.roadwayObject.visible = true;
      return this.roadwayObject;
    }
    const loader = new OBJLoader();
    let object = null;
    if (topo) this.topology = topo;

    try {
      if (url) {
        object = await loader.loadAsync(url);
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
    if (this.roadwayObject) {
      this.roadwayObject.visible = true;
      return this.roadwayObject;
    }
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
    const mat = new THREE.MeshStandardMaterial({ color: '#ff9f43', emissive: '#ff9f43' });
    for (const sensor of registry) {
      if (this.sensors.has(sensor.sensorID)) continue;
      const geo = new THREE.SphereGeometry(0.35, 16, 16);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(sensor.x, sensor.y, sensor.z);
      mesh.userData.sensorID = sensor.sensorID;
      mesh.name = `sensor-${sensor.sensorID}`;
      this.scene.add(mesh);
      this.sensors.set(sensor.sensorID, mesh);
    }
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

  createSegmentTube(start, end, radius, material, userData = {}) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0.0001) return null;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
    const mesh = new THREE.Mesh(geometry, material);
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
      if (child.material) {
        child.material.transparent = options.transparent ?? true;
        if (options.opacity != null) child.material.opacity = options.opacity;
        materialSet?.add?.(child.material);
      }
    });
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
      const points = this.branchPathPoints(branch, ['path', 'renderPath', '_renderPath', 'originalPath']);
      if (points.length < 2) continue;
      const material = new THREE.LineBasicMaterial({
        color: this.branchColor(branch, colorMode),
        transparent: true,
        opacity: options.opacity ?? 0.92
      });
      this.ventilationMaterials.add(material);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
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
          { ventilationType: 'branch', branchId: branch.id, namePrefix: 'ventilation-arrow' },
          { startRatio: 0.42, endRatio: 0.68, minLength: 12, headLength: 7, headWidth: 4, opacity: options.opacity ?? 0.92 }
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
            ? new THREE.BoxGeometry(3.3, 3.3, 3.3)
            : type === 'stopping'
              ? new THREE.BoxGeometry(4.2, 4.2, 1.6)
              : type === 'regulator'
                ? new THREE.OctahedronGeometry(2.5)
                : new THREE.SphereGeometry(2.2, 18, 18);
        const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.95 });
        this.ventilationMaterials.add(material);
        const mesh = new THREE.Mesh(geometry, material);
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
        this.ventilationMaterials.add(material);
        const marker = new THREE.Mesh(geometry, material);
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
    const value = Math.max(0, Math.min(1, Number(opacity)));
    this.ventilationMaterials.forEach((material) => {
      material.transparent = value < 1;
      material.opacity = value;
      material.needsUpdate = true;
    });
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
      const points = this.branchPathPoints(branch, ['renderPath', 'path', '_renderPath', 'originalPath']);
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
      this.airflowMaterials.add(material);
      const group = new THREE.Group();
      group.name = `airflow-branch-group-${branch.id}`;
      const tubes = this.addPolylineTube(group, points, radius, material, {
        ventilationType: 'branch',
        airflowType: 'branch',
        branchId: branch.id,
        namePrefix: 'airflow-branch'
      });

      if (showDirection) {
        this.addDirectionArrow(
          group,
          points,
          color,
          this.airflowMaterials,
          { ventilationType: 'branch', airflowType: 'branch', branchId: branch.id, namePrefix: 'airflow-arrow' },
          {
            startRatio: 0.46,
            endRatio: 0.72,
            minLength: 10,
            headLength: Math.max(5, radius * 7),
            headWidth: Math.max(3, radius * 4),
            opacity
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
        this.airflowMaterials.add(markerMaterial);
        const marker = new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(1.6, radius * 4.5)), markerMaterial);
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
    const value = Math.max(0, Math.min(1, Number(opacity)));
    this.airflowMaterials.forEach((material) => {
      material.transparent = value < 1;
      material.opacity = value;
      material.needsUpdate = true;
    });
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
      const points = this.branchPathPoints(branch, ['renderPath', 'path', 'originalPath', '_renderPath']);
      if (points.length < 2) continue;
      const color = new THREE.Color(branch.renderColor || '#ff4d4d');
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.58,
        transparent: true,
        opacity
      });
      this.anomalyMaterials.add(material);
      const group = new THREE.Group();
      group.name = `anomaly-branch-group-${branch.id}`;
      const tubes = this.addPolylineTube(group, points, 0.72, material, {
        ventilationType: 'branch',
        anomalyType: 'branch',
        branchId: branch.id,
        namePrefix: 'anomaly-branch'
      });

      const markerMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.88,
        transparent: true,
        opacity: Math.min(1, opacity + 0.08)
      });
      this.anomalyMaterials.add(markerMaterial);
      const marker = new THREE.Mesh(new THREE.OctahedronGeometry(3.2), markerMaterial);
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
    const value = Math.max(0, Math.min(1, Number(opacity)));
    this.anomalyMaterials.forEach((material) => {
      material.transparent = value < 1;
      material.opacity = value;
      material.needsUpdate = true;
    });
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
    const intersects = this.raycaster.intersectObjects(Array.from(this.sensors.values()));
    if (intersects.length > 0) {
      const sensorID = intersects[0].object.userData.sensorID;
      this.onSensorPick?.(sensorID);
    }
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
