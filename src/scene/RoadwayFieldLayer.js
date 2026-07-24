import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function asVector3(point) {
  if (!point) return new THREE.Vector3();
  if (point.isVector3) return point.clone();
  if (Array.isArray(point)) return new THREE.Vector3(Number(point[0]) || 0, Number(point[1]) || 0, Number(point[2]) || 0);
  return new THREE.Vector3(Number(point.x) || 0, Number(point.y) || 0, Number(point.z) || 0);
}

function edgePath(roadway, edge) {
  const path = edge?.path?.length ? edge.path : edge?.verts;
  if (path?.length >= 2) return path.map(asVector3);
  const from = roadway?.getNodePosition?.(edge?.from ?? edge?.source);
  const to = roadway?.getNodePosition?.(edge?.to ?? edge?.target);
  return [from, to].filter(Boolean).map(asVector3);
}

function addBaseColors(geometry, color) {
  const count = geometry.attributes.position?.count || 0;
  const values = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = color.r;
    values[index * 3 + 1] = color.g;
    values[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
}

function normalizedGeometry(sourceGeometry, matrixWorld, color) {
  if (!sourceGeometry?.attributes?.position?.count) return null;
  let geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  geometry.clearGroups();
  geometry.applyMatrix4(matrixWorld);
  addBaseColors(geometry, color);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function modelFieldSources(sourceObject, sourceMaterial, baseColor) {
  if (!sourceObject) return [];
  sourceObject.updateMatrixWorld(true);
  const sources = [];
  sourceObject.traverse((source) => {
    if (!source?.isMesh || !source.userData?.heatmap || source.userData?.roadwayRenderProxy) return;
    const geometry = normalizedGeometry(source.geometry, source.matrixWorld, baseColor);
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, sourceMaterial);
    mesh.name = source.name;
    mesh.userData.heatmap = source.userData.heatmap;
    mesh.userData.topoID = source.userData.topoID;
    sources.push(mesh);
  });
  return sources;
}

export function createRoadwayFieldLayer(roadway, {
  name = 'roadway-field-layer',
  sourceObject = null,
  radius = 2.15,
  radialSegments = 6,
  color = '#3a4a7a'
} = {}) {
  const root = new THREE.Group();
  root.name = name;
  const baseColor = new THREE.Color(color);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0.04,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const sourceMaterial = new THREE.MeshBasicMaterial({
    color,
    vertexColors: true,
    visible: false
  });
  root.userData.roadwayFieldMaterial = material;
  root.userData.roadwayFieldSourceMaterial = sourceMaterial;
  root.userData.roadwayFieldSources = modelFieldSources(sourceObject, sourceMaterial, baseColor);
  root.userData.sourceKind = root.userData.roadwayFieldSources.length ? 'roadway-model' : 'topology-fallback';
  if (!root.userData.roadwayFieldSources.length) {
    const edges = roadway?.getEdges?.() || roadway?.edges || [];
    edges.forEach((edge, index) => {
      const points = edgePath(roadway, edge);
      if (points.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      const tubularSegments = Math.max(8, Math.min(96, (points.length - 1) * 8));
      const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
      addBaseColors(geometry, baseColor);
      const mesh = new THREE.Mesh(geometry, sourceMaterial);
      mesh.name = String(edge.id ?? 'edge-' + index);
      mesh.userData.heatmap = {
        type: 'Connection',
        data: {
          id: edge.id,
          topoId: edge.id,
          j1: edge.from ?? edge.source,
          j2: edge.to ?? edge.target,
          idx: index,
          verts: points.map((point) => ({ x: point.x, y: point.y, z: point.z }))
        }
      };
      mesh.userData.topoID = edge.id;
      root.userData.roadwayFieldSources.push(mesh);
    });
    const nodes = roadway?.getNodes?.() || roadway?.nodes || [];
    nodes.forEach((node, index) => {
      const position = asVector3(node.position ?? node.coordinate ?? node);
      const geometry = new THREE.SphereGeometry(radius * 1.08, Math.max(12, radialSegments * 2), Math.max(8, radialSegments));
      geometry.translate(position.x, position.y, position.z);
      addBaseColors(geometry, baseColor);
      const mesh = new THREE.Mesh(geometry, sourceMaterial);
      mesh.name = String(node.id ?? 'node-' + index);
      mesh.userData.heatmap = {
        type: 'Node',
        data: { id: node.id, x: position.x, y: position.y, z: position.z }
      };
      mesh.userData.topoID = node.id;
      root.userData.roadwayFieldSources.push(mesh);
    });
  }
  root.userData.roadwayFieldSources.forEach((mesh) => root.add(mesh));
  const mergedGeometry = mergeGeometries(
    root.userData.roadwayFieldSources.map((mesh) => mesh.geometry),
    false
  );
  if (mergedGeometry) {
    const proxy = new THREE.Mesh(mergedGeometry, material);
    proxy.name = name + '-render-proxy';
    proxy.renderOrder = 18;
    proxy.userData.roadwayFieldRenderProxy = true;
    proxy.userData.sourceKind = root.userData.sourceKind;
    root.userData.roadwayFieldProxy = proxy;
    root.add(proxy);
  } else {
    sourceMaterial.visible = true;
  }
  return root;
}

export function createRoadwaySelectionOverlay(sourceObject, {
  name = 'roadway-selection-overlay',
  edgeIds = [],
  nodeIds = [],
  color = '#ffd166'
} = {}) {
  if (!sourceObject) return null;
  const activeEdges = new Set(edgeIds.map((id) => String(id)));
  const activeNodes = new Set(nodeIds.map((id) => String(id)));
  if (!activeEdges.size && !activeNodes.size) return null;
  sourceObject.updateMatrixWorld(true);
  const baseColor = new THREE.Color(color);
  const geometries = [];
  sourceObject.traverse((source) => {
    if (!source?.isMesh || !source.userData?.heatmap || source.userData?.roadwayRenderProxy) return;
    const meta = source.userData.heatmap;
    const entityId = String(meta.data?.id ?? source.userData.topoID ?? '');
    const topoId = String(meta.data?.topoId ?? source.userData.topoID ?? entityId);
    const selected = meta.type === 'Connection'
      ? activeEdges.has(entityId) || activeEdges.has(topoId)
      : meta.type === 'Node'
        ? activeNodes.has(entityId) || activeNodes.has(topoId)
        : false;
    if (!selected) return;
    const geometry = normalizedGeometry(source.geometry, source.matrixWorld, baseColor);
    if (geometry) geometries.push(geometry);
  });
  if (!geometries.length) return null;
  const geometry = mergeGeometries(geometries, false);
  geometries.forEach((item) => item.dispose());
  if (!geometry) return null;
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: 0xff9f1c,
    emissiveIntensity: 0.9,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const overlay = new THREE.Mesh(geometry, material);
  overlay.name = name;
  overlay.renderOrder = 56;
  overlay.userData.roadwaySelectionOverlay = true;
  overlay.userData.edgeIds = [...activeEdges];
  overlay.userData.nodeIds = [...activeNodes];
  return overlay;
}

export function syncRoadwayFieldLayerColors(root) {
  const proxy = root?.userData?.roadwayFieldProxy;
  const target = proxy?.geometry?.attributes?.color;
  if (!target) return;
  let offset = 0;
  for (const source of root.userData.roadwayFieldSources || []) {
    const colors = source.geometry?.attributes?.color;
    if (!colors) continue;
    target.array.set(colors.array, offset);
    offset += colors.array.length;
  }
  target.needsUpdate = true;
}

export function setRoadwayFieldLayerOpacity(root, opacity) {
  const value = Math.max(0, Math.min(1, Number(opacity)));
  const material = root?.userData?.roadwayFieldMaterial;
  if (!material) return;
  material.transparent = value < 1;
  material.opacity = value;
  material.depthWrite = value >= 0.98;
  material.needsUpdate = true;
}

export function disposeRoadwayFieldLayer(root) {
  if (!root) return;
  root.traverse((child) => child.geometry?.dispose?.());
  root.userData?.roadwayFieldMaterial?.dispose?.();
  root.userData?.roadwayFieldSourceMaterial?.dispose?.();
  root.removeFromParent();
}
