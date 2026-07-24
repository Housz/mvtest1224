function faceVertexIndex(token, vertexCount) {
  const raw = Number(String(token || '').split('/')[0]);
  if (!Number.isInteger(raw) || raw === 0) return -1;
  return raw > 0 ? raw - 1 : vertexCount + raw;
}

function createObject(name = 'default') {
  return {
    name,
    positions: [],
    normals: [],
    indices: [],
    vertexMap: new Map()
  };
}

function localVertexIndex(target, vertices, sourceIndex) {
  if (target.vertexMap.has(sourceIndex)) return target.vertexMap.get(sourceIndex);
  const point = vertices[sourceIndex];
  if (!point) return -1;
  const localIndex = target.positions.length / 3;
  target.positions.push(point[0], point[1], point[2]);
  target.normals.push(0, 0, 0);
  target.vertexMap.set(sourceIndex, localIndex);
  return localIndex;
}

function addNormal(target, index, x, y, z) {
  const offset = index * 3;
  target.normals[offset] += x;
  target.normals[offset + 1] += y;
  target.normals[offset + 2] += z;
}

function pushTriangle(target, vertices, aIndex, bIndex, cIndex) {
  const a = vertices[aIndex];
  const b = vertices[bIndex];
  const c = vertices[cIndex];
  if (!a || !b || !c) return;
  const localA = localVertexIndex(target, vertices, aIndex);
  const localB = localVertexIndex(target, vertices, bIndex);
  const localC = localVertexIndex(target, vertices, cIndex);
  if (localA < 0 || localB < 0 || localC < 0) return;
  target.indices.push(localA, localB, localC);
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = (aby * acz) - (abz * acy);
  const ny = (abz * acx) - (abx * acz);
  const nz = (abx * acy) - (aby * acx);
  addNormal(target, localA, nx, ny, nz);
  addNormal(target, localB, nx, ny, nz);
  addNormal(target, localC, nx, ny, nz);
}

function finishObject(target, objects) {
  if (!target.indices.length) return;
  for (let index = 0; index < target.normals.length; index += 3) {
    const x = target.normals[index];
    const y = target.normals[index + 1];
    const z = target.normals[index + 2];
    const length = Math.hypot(x, y, z) || 1;
    target.normals[index] = x / length;
    target.normals[index + 1] = y / length;
    target.normals[index + 2] = z / length;
  }
  target.vertexMap.clear();
  delete target.vertexMap;
  objects.push(target);
}

function geometryBounds(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const center = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5
  ];
  let radiusSquared = 0;
  for (let index = 0; index < positions.length; index += 3) {
    const dx = positions[index] - center[0];
    const dy = positions[index + 1] - center[1];
    const dz = positions[index + 2] - center[2];
    radiusSquared = Math.max(radiusSquared, (dx * dx) + (dy * dy) + (dz * dz));
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center,
    radius: Math.sqrt(radiusSquared)
  };
}

function parseObj(text) {
  const vertices = [];
  const objects = [];
  let current = createObject();
  const flush = () => finishObject(current, objects);
  const lines = String(text || '').split(/\r?\n/);
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line || line[0] === '#') continue;
    if (line.startsWith('v ')) {
      const values = line.slice(2).trim().split(/\s+/);
      vertices.push([Number(values[0]) || 0, Number(values[1]) || 0, Number(values[2]) || 0]);
      continue;
    }
    if (line.startsWith('o ') || line.startsWith('g ')) {
      flush();
      current = createObject(line.slice(2).trim() || `object_${objects.length + 1}`);
      continue;
    }
    if (!line.startsWith('f ')) continue;
    const tokens = line.slice(2).trim().split(/\s+/);
    if (tokens.length < 3) continue;
    const indices = tokens.map((token) => faceVertexIndex(token, vertices.length));
    for (let index = 1; index < indices.length - 1; index += 1) {
      pushTriangle(current, vertices, indices[0], indices[index], indices[index + 1]);
    }
  }
  flush();
  const transfers = [];
  const descriptors = objects.map((object) => {
    const positions = new Float32Array(object.positions);
    const normals = new Float32Array(object.normals);
    const IndexArray = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array;
    const indices = new IndexArray(object.indices);
    transfers.push(positions.buffer, normals.buffer, indices.buffer);
    return {
      name: object.name,
      positions,
      normals,
      indices,
      bounds: geometryBounds(positions)
    };
  });
  return { descriptors, transfers };
}

self.onmessage = (event) => {
  const { id, text } = event.data || {};
  try {
    const { descriptors, transfers } = parseObj(text);
    self.postMessage({ id, descriptors }, transfers);
  } catch (error) {
    self.postMessage({ id, error: { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || '' } });
  }
};
