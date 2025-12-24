import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(30, 30, 30);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.sensors = new Map();
    this.edgeMeshes = new Map();

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
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 0.9);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(20, 30, 10);
    this.scene.add(dir);
  }

  buildRoadway(topo) {
    const material = new THREE.MeshStandardMaterial({ color: '#3a4a7a' });
    const nodeMaterial = new THREE.MeshStandardMaterial({ color: '#8fb9ff' });
    const edgeGeometryCache = {};
    for (const edge of topo.edges) {
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
      this.scene.add(mesh);
      this.edgeMeshes.set(edge.id, mesh);
    }

    for (const node of topo.nodes) {
      const geo = new THREE.SphereGeometry(0.9, 16, 16);
      const mesh = new THREE.Mesh(geo, nodeMaterial.clone());
      mesh.position.set(...node.coordinate);
      mesh.name = node.id;
      this.scene.add(mesh);
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
    // just store for coloring
    this.edgeValues = edgeValues;
  }

  colorEdges(edgeValues, colorFn) {
    for (const [edgeId, mesh] of this.edgeMeshes.entries()) {
      const v = edgeValues.get(edgeId) ?? 0;
      mesh.material.color = new THREE.Color(colorFn(v));
    }
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
