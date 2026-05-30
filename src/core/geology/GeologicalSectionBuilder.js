import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { toSectionVector3 } from '../geometry/SectionFrame.js';

const EPS = 1e-7;

const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

function pointObject(point) {
  const p = toSectionVector3(point);
  return { x: p.x, y: p.y, z: p.z };
}

function parseObj(text) {
  if (!text) return null;
  try {
    return new OBJLoader().parse(text);
  } catch (error) {
    console.warn('[MineVis Geological Section] Failed to parse OBJ source:', error);
    return null;
  }
}

function objectNames(object) {
  const names = [];
  let current = object;
  while (current) {
    if (current.name) names.push(current.name);
    current = current.parent;
  }
  return [...new Set(names.filter(Boolean).map(String))];
}

function surfaceKeyMap(surfaces = []) {
  const map = new Map();
  surfaces.forEach((surface, index) => {
    [
      surface.meshPartId,
      surface.mesh_part_id,
      surface.meshPart,
      surface.objectName,
      surface.groupName,
      surface.name,
      surface.surfaceId,
      surface.id
    ]
      .filter(Boolean)
      .forEach((key) => map.set(String(key), { surface, index }));
  });
  return map;
}

function structureKeyMap(structures = []) {
  const map = new Map();
  structures.forEach((structure, index) => {
    [
      structure.meshPartId,
      structure.mesh_part_id,
      structure.objectName,
      structure.groupName,
      structure.structureId,
      structure.id,
      structure.name
    ]
      .filter(Boolean)
      .forEach((key) => map.set(String(key), { structure, index }));
  });
  return map;
}

function geometryTriangles(mesh) {
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  if (!position) return [];
  mesh.updateMatrixWorld?.(true);
  const matrix = mesh.matrixWorld || new THREE.Matrix4();
  const index = geometry.index;
  const triangles = [];
  const read = (i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix);
  if (index) {
    const count = Math.floor(index.count / 3) * 3;
    for (let i = 0; i < count; i += 3) {
      triangles.push([read(index.getX(i)), read(index.getX(i + 1)), read(index.getX(i + 2))]);
    }
  } else {
    const count = Math.floor(position.count / 3) * 3;
    for (let i = 0; i < count; i += 3) triangles.push([read(i), read(i + 1), read(i + 2)]);
  }
  return triangles;
}

function uniquePoints(points = []) {
  const result = [];
  points.forEach((point) => {
    if (!result.some((entry) => entry.distanceToSquared(point) < 1e-8)) result.push(point);
  });
  return result;
}

function intersectTriangle(sectionFrame, triangle) {
  const signed = triangle.map((point) => sectionFrame.distanceToPoint(point));
  const points = [];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 0]
  ];
  edges.forEach(([aIndex, bIndex]) => {
    const a = triangle[aIndex];
    const b = triangle[bIndex];
    const da = signed[aIndex];
    const db = signed[bIndex];
    if (Math.abs(da) < EPS && Math.abs(db) < EPS) {
      points.push(a.clone(), b.clone());
      return;
    }
    if (Math.abs(da) < EPS) {
      points.push(a.clone());
      return;
    }
    if (Math.abs(db) < EPS) {
      points.push(b.clone());
      return;
    }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      points.push(a.clone().lerp(b, t));
    }
  });
  const unique = uniquePoints(points);
  if (unique.length < 2) return null;
  return [unique[0], unique[1]];
}

function segmentToProjected(sectionFrame, points3D) {
  return {
    points3D: points3D.map(pointObject),
    points: points3D.map((point) => {
      const projected = sectionFrame.projectPoint(point);
      return { x: projected.x, y: projected.y, d: projected.d };
    })
  };
}

function fallbackSlabPolyline(sectionFrame, mesh, limit = 600) {
  const position = mesh.geometry?.attributes?.position;
  if (!position) return [];
  mesh.updateMatrixWorld?.(true);
  const matrix = mesh.matrixWorld || new THREE.Matrix4();
  const points = [];
  for (let i = 0; i < position.count && points.length < limit; i += 1) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix);
    if (sectionFrame.isPointInSlab(point)) points.push(point);
  }
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 2) segments.push([points[i], points[i + 1]]);
  return segments;
}

function buildSurfaceIntersections({ geologicalBody, sectionFrame, objText }) {
  const object = parseObj(objText);
  const surfaces = geologicalBody?.listSurfaces?.() || [];
  if (!object) return [];
  const byMesh = surfaceKeyMap(surfaces);
  const results = [];
  let fallbackIndex = 0;
  object.updateMatrixWorld?.(true);
  object.traverse((child) => {
    if (!child.isMesh) return;
    const matched = objectNames(child).map((name) => byMesh.get(name)).find(Boolean);
    const surface = matched?.surface || surfaces[fallbackIndex] || {
      surfaceId: child.name || `SURF_${fallbackIndex + 1}`,
      surfaceType: 'surface'
    };
    const index = matched?.index ?? fallbackIndex;
    fallbackIndex += 1;
    const unitId = surface.geologicalUnitId ?? surface.unitId ?? surface.bodyId ?? null;
    const lineSegments = [];
    geometryTriangles(child)
      .slice(0, 120000)
      .forEach((triangle) => {
        const segment = intersectTriangle(sectionFrame, triangle);
        if (segment) lineSegments.push(segment);
      });
    const finalSegments = lineSegments.length ? lineSegments : fallbackSlabPolyline(sectionFrame, child);
    finalSegments.forEach((segment, segmentIndex) => {
      const projected = segmentToProjected(sectionFrame, segment);
      results.push({
        type: 'geologicalSurface',
        id: surface.surfaceId ?? surface.id ?? `${child.name || 'surface'}_${segmentIndex}`,
        surfaceId: surface.surfaceId ?? surface.id,
        unitId,
        bodyId: surface.bodyId,
        surfaceType: surface.surfaceType ?? surface.type ?? 'surface',
        meshPartId: surface.meshPartId ?? surface.mesh_part_id ?? child.name,
        sourceIndex: index,
        segmentIndex,
        ...projected
      });
    });
  });
  return results;
}

function gridDimensions(grid = {}) {
  return {
    nx: Number(grid.nx ?? grid.width ?? 0),
    ny: Number(grid.ny ?? grid.height ?? 0),
    nz: Number(grid.nz ?? grid.depth ?? 0)
  };
}

function arrayPoint(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value)) return value.map(Number);
  if (value && typeof value === 'object') return [Number(value.x), Number(value.y), Number(value.z)];
  return fallback;
}

function gridBounds(grid = {}) {
  const { nx, ny, nz } = gridDimensions(grid);
  const origin = arrayPoint(grid.origin ?? grid.bounds?.min, [0, 0, 0]);
  const cell = Array.isArray(grid.cellSize) ? grid.cellSize.map(Number) : [Number(grid.cellSize) || 1, Number(grid.cellSize) || 1, Number(grid.cellSize) || 1];
  const min = arrayPoint(grid.bounds?.min, origin);
  const max = grid.bounds?.max
    ? arrayPoint(grid.bounds.max, [min[0] + nx * cell[0], min[1] + ny * cell[1], min[2] + nz * cell[2]])
    : [min[0] + nx * cell[0], min[1] + ny * cell[1], min[2] + nz * cell[2]];
  return {
    nx,
    ny,
    nz,
    min: new THREE.Vector3(Number(min[0]) || 0, Number(min[1]) || 0, Number(min[2]) || 0),
    max: new THREE.Vector3(Number(max[0]) || 0, Number(max[1]) || 0, Number(max[2]) || 0),
    cell: new THREE.Vector3(Number(cell[0]) || 1, Number(cell[1]) || 1, Number(cell[2]) || 1)
  };
}

function buildGridSlice({ attributeModel, sectionFrame, activeAttribute, maxRenderedBlocksInSection }) {
  const grid = attributeModel?.grid;
  const values = activeAttribute ? attributeModel?.binaryAttributes?.[activeAttribute] : null;
  if (!grid || !values) return [];
  const bounds = gridBounds(grid);
  const total = bounds.nx * bounds.ny * bounds.nz;
  if (!total) return [];
  const step = Math.max(1, Math.ceil(total / Math.max(1, maxRenderedBlocksInSection * 4)));
  const result = [];
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) continue;
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }
  const range = Number.isFinite(minValue) && Number.isFinite(maxValue) ? { min: minValue, max: maxValue } : { min: 0, max: 1 };
  for (let index = 0; index < total && result.length < maxRenderedBlocksInSection; index += step) {
    const ix = index % bounds.nx;
    const iy = Math.floor(index / bounds.nx) % bounds.ny;
    const iz = Math.floor(index / (bounds.nx * bounds.ny));
    const center = new THREE.Vector3(
      bounds.min.x + (ix + 0.5) * bounds.cell.x,
      bounds.min.y + (iy + 0.5) * bounds.cell.y,
      bounds.min.z + (iz + 0.5) * bounds.cell.z
    );
    if (!sectionFrame.isPointInSlab(center)) continue;
    const rawValue = Number(values[index]);
    if (!Number.isFinite(rawValue)) continue;
    const projected = sectionFrame.projectPoint(center);
    result.push({
      type: 'geologicalBlock',
      id: `VOX_${ix}_${iy}_${iz}`,
      blockId: `VOX_${ix}_${iy}_${iz}`,
      elementId: `VOX_${ix}_${iy}_${iz}`,
      gridIndex: [ix, iy, iz],
      centroid: pointObject(center),
      size: { x: bounds.cell.x, y: bounds.cell.y, z: bounds.cell.z },
      activeAttribute,
      value: rawValue,
      normalizedValue: (rawValue - range.min) / (range.max - range.min || 1),
      x: projected.x,
      y: projected.y,
      d: projected.d
    });
  }
  return result;
}

function buildElementBlockSlice({ attributeModel, geologicalBody, sectionFrame, activeAttribute, maxRenderedBlocksInSection }) {
  const sourceBlocks = [
    ...(attributeModel?.listBlocks?.() || []),
    ...(geologicalBody?.listBlocks?.() || [])
  ];
  const result = [];
  const seen = new Set();
  for (const block of sourceBlocks) {
    const id = String(block.elementId ?? block.blockId ?? block.id ?? result.length);
    if (seen.has(id)) continue;
    seen.add(id);
    const center = toSectionVector3(block.centroid ?? block);
    if (!sectionFrame.isPointInSlab(center)) continue;
    const projected = sectionFrame.projectPoint(center);
    const value = attributeModel?.getValue?.(block.elementId ?? block.blockId ?? id, activeAttribute) ?? block[activeAttribute];
    result.push({
      type: 'geologicalBlock',
      id,
      blockId: block.blockId ?? id,
      elementId: block.elementId ?? id,
      centroid: pointObject(center),
      size: block.size,
      lithology: block.lithology,
      orebodyId: block.orebodyId ?? block.bodyId,
      resourceCategory: block.resourceCategory,
      activeAttribute,
      value,
      x: projected.x,
      y: projected.y,
      d: projected.d
    });
    if (result.length >= maxRenderedBlocksInSection) break;
  }
  return result;
}

function buildBlockSlice(options) {
  const grid = buildGridSlice(options);
  return grid.length ? grid : buildElementBlockSlice(options);
}

function buildBoreholeProjections({ borehole, sectionFrame }) {
  if (!borehole) return [];
  return (borehole.listBoreholes?.() || [])
    .map((item) => {
      const raw = borehole.getTrajectory?.(item.boreholeId) || [];
      const points = raw.map(toSectionVector3);
      if (!points.length) return null;
      const minDistance = Math.min(...points.map((point) => Math.abs(sectionFrame.distanceToPoint(point))));
      if (minDistance > sectionFrame.thickness * 1.5) return null;
      const projected = points.map((point) => sectionFrame.projectPoint(point));
      return {
        type: 'borehole',
        id: item.boreholeId,
        boreholeId: item.boreholeId,
        label: item.boreholeName ?? item.boreholeId,
        collar: item.collar,
        intervals: borehole.getIntervals?.(item.boreholeId) || [],
        points: projected.map((point) => ({ x: point.x, y: point.y, d: point.d })),
        points3D: points.map(pointObject),
        distance: minDistance
      };
    })
    .filter(Boolean);
}

function geometryPoints(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(toSectionVector3);
  if (Array.isArray(value.points)) return value.points.map(toSectionVector3);
  if (Array.isArray(value.path)) return value.path.map(toSectionVector3);
  if (Array.isArray(value.trace)) return value.trace.map(toSectionVector3);
  if (Array.isArray(value.vertices)) return value.vertices.map(toSectionVector3);
  return [];
}

function buildStructureProjections({ geologicalStructure, sectionFrame, objText }) {
  const structures = geologicalStructure?.listStructures?.() || [];
  const result = [];
  structures.forEach((structure) => {
    const points = geometryPoints(structure.geometry ?? structure.trace ?? structure.path);
    if (points.length >= 2 && points.some((point) => sectionFrame.isPointInSlab(point))) {
      result.push({
        type: 'geologicalStructure',
        id: structure.structureId,
        structureId: structure.structureId,
        structureType: structure.structureType,
        label: structure.structureName,
        points: sectionFrame.projectPolyline(points).map((point) => ({ x: point.x, y: point.y, d: point.d })),
        points3D: points.map(pointObject)
      });
    }
  });
  const object = parseObj(objText);
  if (!object) return result;
  const byMesh = structureKeyMap(structures);
  let fallbackIndex = 0;
  object.updateMatrixWorld?.(true);
  object.traverse((child) => {
    if (!child.isMesh) return;
    const matched = objectNames(child).map((name) => byMesh.get(name)).find(Boolean);
    const structure = matched?.structure || structures[fallbackIndex] || { structureId: child.name || `GS_${fallbackIndex + 1}`, structureType: 'structure' };
    fallbackIndex += 1;
    geometryTriangles(child).forEach((triangle) => {
      const segment = intersectTriangle(sectionFrame, triangle);
      if (!segment) return;
      result.push({
        type: 'geologicalStructure',
        id: structure.structureId,
        structureId: structure.structureId,
        structureType: structure.structureType,
        label: structure.structureName,
        ...segmentToProjected(sectionFrame, segment)
      });
    });
  });
  return result;
}

function edgePath(roadway, edge) {
  const raw = edge?.path?.length ? edge.path : edge?.verts?.length ? edge.verts : [];
  if (raw.length >= 2) return raw.map(toSectionVector3);
  const from = edge?.from ?? edge?.source ?? edge?.j1;
  const to = edge?.to ?? edge?.target ?? edge?.j2;
  return [roadway?.getNodePosition?.(from), roadway?.getNodePosition?.(to)].filter(Boolean).map(toSectionVector3);
}

function buildRoadwayProjections({ roadway, sectionFrame }) {
  if (!roadway) return [];
  return (roadway.getEdges?.() || roadway.edges || [])
    .map((edge) => {
      const points = edgePath(roadway, edge);
      if (points.length < 2) return null;
      if (!points.some((point) => sectionFrame.isPointInSlab(point))) return null;
      return {
        type: 'roadwaySegment',
        id: String(edge.id),
        roadwayEdgeId: String(edge.id),
        points: sectionFrame.projectPolyline(points).map((point) => ({ x: point.x, y: point.y, d: point.d })),
        points3D: points.map(pointObject)
      };
    })
    .filter(Boolean);
}

export function buildGeologicalSectionResult({
  geologicalBody,
  roadway = null,
  borehole = null,
  geologicalStructure = null,
  attributeModel = null,
  sectionFrame,
  activeAttribute = null,
  maxRenderedBlocksInSection = 5000,
  geologicalBodyObjText = '',
  structureObjText = ''
} = {}) {
  const geologicalIntersections = buildSurfaceIntersections({ geologicalBody, sectionFrame, objText: geologicalBodyObjText });
  const blockSliceElements = buildBlockSlice({
    attributeModel,
    geologicalBody,
    sectionFrame,
    activeAttribute,
    maxRenderedBlocksInSection: Math.max(1, Number(maxRenderedBlocksInSection) || 5000)
  });
  const boreholeProjections = buildBoreholeProjections({ borehole, sectionFrame });
  const structureIntersections = buildStructureProjections({ geologicalStructure, sectionFrame, objText: structureObjText });
  const roadwayProjections = buildRoadwayProjections({ roadway, sectionFrame });
  return {
    frame: sectionFrame.toPlainObject(),
    geologicalIntersections,
    blockSliceElements,
    boreholeProjections,
    structureIntersections,
    roadwayProjections,
    attributeSamples: blockSliceElements,
    summary: {
      geologicalLineCount: geologicalIntersections.length,
      blockCount: blockSliceElements.length,
      boreholeCount: boreholeProjections.length,
      structureCount: structureIntersections.length,
      roadwayCount: roadwayProjections.length,
      activeAttribute: activeAttribute || null
    }
  };
}
