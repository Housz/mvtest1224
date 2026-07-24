import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { nowMs, yieldToMainThread } from '../core/runtime/CooperativeTaskScheduler.js';

const WORKER_THRESHOLD = 512 * 1024;
let parserWorker = null;
let nextTaskId = 0;
const pendingTasks = new Map();
const descriptorCache = new Map();
const objectTemplateCache = new Map();

function ensureWorker() {
  if (parserWorker) return parserWorker;
  parserWorker = new Worker(new URL('./objParseWorker.js', import.meta.url), { type: 'module' });
  parserWorker.addEventListener('message', (event) => {
    const { id, descriptors, error } = event.data || {};
    const task = pendingTasks.get(id);
    if (!task) return;
    pendingTasks.delete(id);
    if (error) task.reject(Object.assign(new Error(error.message || 'OBJ worker failed.'), error));
    else task.resolve(descriptors || []);
  });
  parserWorker.addEventListener('error', (event) => {
    const error = event.error || new Error(event.message || 'OBJ worker failed.');
    pendingTasks.forEach(({ reject }) => reject(error));
    pendingTasks.clear();
    parserWorker?.terminate();
    parserWorker = null;
  });
  return parserWorker;
}

function parseDescriptors(text) {
  const source = String(text || '');
  if (descriptorCache.has(source)) return descriptorCache.get(source);
  const promise = new Promise((resolve, reject) => {
    const id = ++nextTaskId;
    pendingTasks.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, text: source });
  }).catch((error) => {
    descriptorCache.delete(source);
    throw error;
  });
  descriptorCache.set(source, promise);
  return promise;
}

async function objectFromDescriptors(descriptors) {
  const root = new THREE.Group();
  root.name = 'OBJRoot';
  let sliceStartedAt = nowMs();
  for (const descriptor of descriptors) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(descriptor.positions, 3));
    if (descriptor.indices?.length) {
      geometry.setIndex(new THREE.BufferAttribute(descriptor.indices, 1));
    }
    if (descriptor.normals?.length === descriptor.positions?.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(descriptor.normals, 3));
    }
    const bounds = descriptor.bounds;
    if (bounds?.min?.length === 3 && bounds?.max?.length === 3) {
      geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max)
      );
    } else {
      geometry.computeBoundingBox();
    }
    if (bounds?.center?.length === 3 && Number.isFinite(bounds.radius)) {
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(...bounds.center),
        bounds.radius
      );
    } else {
      geometry.computeBoundingSphere();
    }
    geometry.userData.minevisSharedObjGeometry = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = descriptor.name || '';
    root.add(mesh);
    if (nowMs() - sliceStartedAt >= 8) {
      await yieldToMainThread();
      sliceStartedAt = nowMs();
    }
  }
  return root;
}

export async function parseObjAsync(text) {
  const source = String(text || '');
  if (!source) return new THREE.Group();
  if (typeof Worker !== 'function' || source.length < WORKER_THRESHOLD) {
    return new OBJLoader().parse(source);
  }
  let record = objectTemplateCache.get(source);
  if (!record) {
    record = {
      uses: 0,
      promise: parseDescriptors(source).then((descriptors) => objectFromDescriptors(descriptors))
    };
    objectTemplateCache.set(source, record);
  }
  const firstUse = record.uses === 0;
  record.uses += 1;
  const clone = cloneObjObject(await record.promise, { cloneGeometry: false });
  clone.userData.minevisObjFirstUse = firstUse;
  return clone;
}

export function cloneObjObject(source, { cloneGeometry = false } = {}) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (!child.isMesh) return;
    if (cloneGeometry) {
      child.geometry = child.geometry?.clone?.() || child.geometry;
      if (child.geometry?.userData) delete child.geometry.userData.minevisSharedObjGeometry;
    }
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => material?.clone?.() || material);
    } else {
      child.material = child.material?.clone?.() || child.material;
    }
  });
  return clone;
}

export function clearObjDescriptorCache() {
  descriptorCache.clear();
  objectTemplateCache.clear();
}
