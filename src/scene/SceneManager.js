import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

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
    this.topology = null;

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPick(e));
    this.animate();
  }

  onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
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

  /**
   * 加载 OBJ 模型 (支持 URL 或 纯文本)
   * @param {string|null} url - 文件路径 (若有)
   * @param {string|null} text - 文件内容 (若为 inline)
   * @param {Array} mapping - 部件映射表
   */
  async loadRoadwayModel(url, text, mapping, topo) {
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

      const map = new Map();
      if (Array.isArray(mapping)) {
        mapping.forEach((m) => {
          if (m.mesh_part_id && m.topo_ref_id) {
            map.set(m.mesh_part_id, m.topo_ref_id);
          }
        });
      }

      object.traverse((child) => {
        if (!child.isMesh) return;
        child.material = new THREE.MeshStandardMaterial({
          color: '#3a4a7a',
          side: THREE.DoubleSide,
          vertexColors: true
        });
        child.material.needsUpdate = true;

        const name = child.name || '';
        let topoId = map.get(name);
        let edge = topoId ? topo?.edges?.find((e) => e.id === topoId) : null;
        let nodeHeat = null;

        if (!topoId && topo) {
          const edgeMatch = name.match(/edge[_-]?(\d+)/i);
          if (edgeMatch) {
            const idx = Number(edgeMatch[1]);
            edge = topo.edges?.[idx];
            topoId = edge?.id;
          }
        }

        if (!edge && topo) {
          const nodeMatch = name.match(/node[_-]?(.+)/i);
          if (nodeMatch) {
            const key = nodeMatch[1];
            const nodeById = topo.nodes?.find((n) => n.id === key);
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
          const start = nodeMap.get(edge.from)?.coordinate;
          const end = nodeMap.get(edge.to)?.coordinate;
          const verts =
            start && end
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
          this.edgeMeshes.set(topoId || name, child);
        } else if (nodeHeat) {
          child.userData.heatmap = nodeHeat;
        }
      });

      this.scene.add(object);

      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      this.controls.target.copy(center);
      this.camera.position.copy(center).addScalar(maxDim * 1.5);
      this.controls.update();
    } catch (err) {
      console.error('Failed to load roadway model:', err);
    }
  }

  buildRoadway(topo) {
    this.topology = topo;
    const material = new THREE.MeshStandardMaterial({ color: '#3a4a7a', vertexColors: true });
    const nodeMaterial = new THREE.MeshStandardMaterial({ color: '#8fb9ff', vertexColors: true });
    const edgeGeometryCache = {};
    for (const [idx, edge] of topo.edges.entries()) {
      const a = topo.getNodePosition(edge.from);
      const b = topo.getNodePosition(edge.to);
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
      this.scene.add(mesh);
      this.edgeMeshes.set(edge.id, mesh);
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
      this.scene.add(mesh);
    }

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
  }

  addSensors(registry) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ff9f43', emissive: '#ff9f43' });
    for (const sensor of registry) {
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

  focusOn(obj) {
    if (!obj) return;
    const target = obj.position.clone();
    const start = this.controls.target.clone();
    const camStart = this.camera.position.clone();
    const dir = new THREE.Vector3().subVectors(camStart, start);
    const camEnd = target.clone().add(dir.setLength(8));
    const duration = 0.6;
    let elapsed = 0;
    const animateFocus = () => {
      elapsed += this.clock.getDelta();
      const t = Math.min(1, elapsed / duration);
      this.controls.target.lerpVectors(start, target, t);
      this.camera.position.lerpVectors(camStart, camEnd, t);
      this.controls.update();
      if (t < 1) requestAnimationFrame(animateFocus);
    };
    animateFocus();
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
    const intersects = this.raycaster.intersectObjects(Array.from(this.sensors.values()));
    if (intersects.length > 0) {
      const sensorID = intersects[0].object.userData.sensorID;
      this.onSensorPick?.(sensorID);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
