import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function toSectionVector3(value = {}) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
  }
  return new THREE.Vector3(
    Number(value.x ?? value.X ?? value[0]) || 0,
    Number(value.y ?? value.Y ?? value[1]) || 0,
    Number(value.z ?? value.Z ?? value[2]) || 0
  );
}

function vectorOr(value, fallback) {
  const vector = toSectionVector3(value);
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z) ? vector : fallback.clone();
}

function normalizeOr(vector, fallback) {
  const result = vector.clone();
  return result.lengthSq() > 1e-10 ? result.normalize() : fallback.clone().normalize();
}

export class SectionFrame {
  constructor({ mode = 'axis-aligned', origin, u, v, normal, thickness = 5, axis = 'X', position = 0 } = {}) {
    this.mode = mode;
    this.axis = axis;
    this.position = Number(position) || 0;
    this.origin = vectorOr(origin, new THREE.Vector3());
    this.u = normalizeOr(vectorOr(u, new THREE.Vector3(1, 0, 0)), new THREE.Vector3(1, 0, 0));
    this.v = normalizeOr(vectorOr(v, WORLD_UP), WORLD_UP);
    this.normal = normalizeOr(vectorOr(normal, new THREE.Vector3(0, 0, 1)), new THREE.Vector3(0, 0, 1));
    this.thickness = Math.max(0.01, Number(thickness) || 5);
  }

  distanceToPoint(point) {
    return toSectionVector3(point).sub(this.origin).dot(this.normal);
  }

  projectPoint(point) {
    const p = toSectionVector3(point);
    const delta = p.clone().sub(this.origin);
    return {
      x: delta.dot(this.u),
      y: delta.dot(this.v),
      d: delta.dot(this.normal),
      point: p
    };
  }

  isPointInSlab(point, thickness = this.thickness) {
    return Math.abs(this.distanceToPoint(point)) <= Math.max(0.01, Number(thickness) || this.thickness) * 0.5;
  }

  projectPolyline(points = [], { slabOnly = false } = {}) {
    return (points || [])
      .map((point) => this.projectPoint(point))
      .filter((point) => !slabOnly || Math.abs(point.d) <= this.thickness * 0.5);
  }

  plane() {
    return new THREE.Plane().setFromNormalAndCoplanarPoint(this.normal, this.origin);
  }

  frameKey(precision = 3) {
    const pack = (vector) => [vector.x, vector.y, vector.z].map((value) => Number(value).toFixed(precision)).join(',');
    return `${this.mode}:${this.axis}:${Number(this.position).toFixed(precision)}:${Number(this.thickness).toFixed(precision)}:${pack(this.origin)}:${pack(this.normal)}`;
  }

  toPlainObject() {
    const vec = (vector) => ({ x: vector.x, y: vector.y, z: vector.z });
    return {
      mode: this.mode,
      axis: this.axis,
      position: this.position,
      thickness: this.thickness,
      origin: vec(this.origin),
      u: vec(this.u),
      v: vec(this.v),
      normal: vec(this.normal)
    };
  }
}

function axisAlignedFrame(params = {}) {
  const axis = String(params.axis || 'X').toUpperCase();
  const position = Number(params.position) || 0;
  if (axis === 'Y') {
    return new SectionFrame({
      mode: 'axis-aligned',
      axis,
      position,
      thickness: params.thickness,
      origin: new THREE.Vector3(0, position, 0),
      u: new THREE.Vector3(1, 0, 0),
      v: new THREE.Vector3(0, 0, 1),
      normal: new THREE.Vector3(0, 1, 0)
    });
  }
  if (axis === 'Z') {
    return new SectionFrame({
      mode: 'axis-aligned',
      axis,
      position,
      thickness: params.thickness,
      origin: new THREE.Vector3(0, 0, position),
      u: new THREE.Vector3(1, 0, 0),
      v: WORLD_UP,
      normal: new THREE.Vector3(0, 0, 1)
    });
  }
  return new SectionFrame({
    mode: 'axis-aligned',
    axis: 'X',
    position,
    thickness: params.thickness,
    origin: new THREE.Vector3(position, 0, 0),
    u: new THREE.Vector3(0, 0, 1),
    v: WORLD_UP,
    normal: new THREE.Vector3(1, 0, 0)
  });
}

function verticalTwoPointFrame(params = {}) {
  const a = vectorOr(params.verticalLinePointA, new THREE.Vector3(-100, 0, 0));
  const b = vectorOr(params.verticalLinePointB, new THREE.Vector3(100, 0, 0));
  const horizontal = b.clone().sub(a);
  horizontal.y = 0;
  const u = normalizeOr(horizontal, new THREE.Vector3(1, 0, 0));
  const normal = normalizeOr(new THREE.Vector3().crossVectors(u, WORLD_UP), new THREE.Vector3(0, 0, 1));
  return new SectionFrame({
    mode: 'vertical-two-point',
    axis: 'custom',
    position: 0,
    thickness: params.thickness,
    origin: a,
    u,
    v: WORLD_UP,
    normal
  });
}

export function createSectionFrame(params = {}) {
  if (params.sectionMode === 'vertical-two-point') return verticalTwoPointFrame(params);
  return axisAlignedFrame(params);
}
