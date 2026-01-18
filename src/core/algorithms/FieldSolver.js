import * as THREE from 'three';
import { sampleColor } from '../../utils/colors.js';

function ensureVertexColors(mesh, baseColor = '#3a4a7a') {
  const geom = mesh.geometry;
  if (!geom || !geom.attributes?.position) return;
  const count = geom.attributes.position.count;
  if (!geom.attributes.color || geom.attributes.color.count !== count) {
    const color = new THREE.Color(baseColor);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  if (mesh.material) {
    mesh.material.vertexColors = true;
    mesh.material.needsUpdate = true;
  }
}

function buildConnections(topo) {
  if (!topo?.nodes || !topo?.edges) return [];
  const nodeMap = topo.nodeMap || new Map(topo.nodes.map((n) => [n.id, n]));
  return topo.edges.map((e, idx) => {
    const a = nodeMap.get(e.from)?.coordinate || [0, 0, 0];
    const b = nodeMap.get(e.to)?.coordinate || [0, 0, 0];
    const vertsFromPath =
      Array.isArray(e.path) && e.path.length
        ? e.path.map((p) => ({
            x: p.x ?? p[0] ?? 0,
            y: p.y ?? p[1] ?? 0,
            z: p.z ?? p[2] ?? 0
          }))
        : [];
    const verts =
      vertsFromPath.length >= 2
        ? vertsFromPath
        : [
            { x: a[0], y: a[1], z: a[2] },
            { x: b[0], y: b[1], z: b[2] }
          ];
    return {
      id: e.id,
      idx,
      j1: e.from,
      j2: e.to,
      verts
    };
  });
}

function buildAdjacency(connections) {
  const map = new Map();
  for (const c of connections) {
    if (!map.has(c.j1)) map.set(c.j1, []);
    if (!map.has(c.j2)) map.set(c.j2, []);
    map.get(c.j1).push(c);
    map.get(c.j2).push(c);
  }
  return map;
}

function buildControlPoints(conn, nodeValues, sensors, minVal) {
  const controls = [];
  const vStart = nodeValues.get(conn.j1) ?? minVal;
  const vEnd = nodeValues.get(conn.j2) ?? minVal;
  controls.push({ t: 0, v: vStart });
  const totalLen = conn._totalLen ?? computeTotalLength(conn);
  const connSensors = sensors.filter((s) => s.parentType === 'Connection' && (s.parentId === conn.id || s.parentIndex === conn.idx));
  connSensors.forEach((s) => {
    let t = Number.isFinite(s.ratio) ? s.ratio : projectRatioOnConnection(s, conn);
    t = Math.max(0, Math.min(1, t));
    controls.push({ t, v: s.value });
  });
  controls.push({ t: 1, v: vEnd });
  controls.sort((a, b) => a.t - b.t);
  return { controls, totalLen: totalLen || 1 };
}

function computeTotalLength(conn) {
  if (!conn?.verts || conn.verts.length < 2) return 1;
  let len = 0;
  for (let i = 0; i < conn.verts.length - 1; i++) {
    const v1 = conn.verts[i];
    const v2 = conn.verts[i + 1];
    len += new THREE.Vector3(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z).length();
  }
  conn._totalLen = len || 1;
  return conn._totalLen;
}

export function diffuseNodeValues(nodes, connections, sensors, defaultMin = 0, iterations = 5) {
  const nodeVals = new Map(nodes.map((n) => [n.id, null]));
  const nodeConnMap = buildAdjacency(connections);

  sensors.forEach((s) => {
    if (s.parentType === 'Node' && s.parentId) {
      nodeVals.set(s.parentId, s.value);
    }
  });

  // Seed endpoints from connection sensors (projected average)
  connections.forEach((c) => {
    const connSensors = sensors.filter((s) => s.parentType === 'Connection' && (s.parentId === c.id || s.parentIndex === c.idx));
    if (!connSensors.length) return;
    const avg = connSensors.reduce((a, b) => a + b.value, 0) / connSensors.length;
    if (nodeVals.get(c.j1) === null) nodeVals.set(c.j1, avg);
    if (nodeVals.get(c.j2) === null) nodeVals.set(c.j2, avg);
  });

  for (let iter = 0; iter < iterations; iter++) {
    nodes.forEach((n) => {
      if (nodeVals.get(n.id) !== null) return;
      let sum = 0;
      let count = 0;
      const conns = nodeConnMap.get(n.id) || [];
      conns.forEach((c) => {
        const connSensors = sensors.filter((s) => s.parentType === 'Connection' && (s.parentId === c.id || s.parentIndex === c.idx));
        if (connSensors.length > 0) {
          const avg = connSensors.reduce((a, b) => a + b.value, 0) / connSensors.length;
          sum += avg;
          count++;
          return;
        }
        const other = c.j1 === n.id ? c.j2 : c.j1;
        const val = nodeVals.get(other);
        if (val !== null && val !== undefined) {
          sum += val;
          count++;
        }
      });
      if (count > 0) nodeVals.set(n.id, sum / count);
    });
  }

  nodes.forEach((n) => {
    if (nodeVals.get(n.id) === null) nodeVals.set(n.id, defaultMin);
  });

  return { nodeVals, nodeConnMap };
}

function projectRatioOnConnection(pos, conn) {
  if (!conn?.verts?.length) return 0.5;
  if (conn.verts.length === 1) return 0.5;
  let totalLen = 0;
  const segLens = [];
  for (let i = 0; i < conn.verts.length - 1; i++) {
    const v1 = conn.verts[i];
    const v2 = conn.verts[i + 1];
    const len = new THREE.Vector3(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z).length();
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen < 1e-6) return 0.5;

  const target = new THREE.Vector3(pos.x, pos.y, pos.z);
  let accu = 0;
  let bestT = 0;
  for (let i = 0; i < conn.verts.length - 1; i++) {
    const v1 = conn.verts[i];
    const v2 = conn.verts[i + 1];
    const a = new THREE.Vector3(v1.x, v1.y, v1.z);
    const b = new THREE.Vector3(v2.x, v2.y, v2.z);
    const ab = new THREE.Vector3().subVectors(b, a);
    const lenSq = Math.max(ab.lengthSq(), 1e-6);
    let tSeg = new THREE.Vector3().subVectors(target, a).dot(ab) / lenSq;
    tSeg = Math.max(0, Math.min(1, tSeg));
    const projLen = tSeg * segLens[i];
    const globalT = (accu + projLen) / totalLen;
    bestT = globalT;
    // pick the first segment that contains orthogonal projection
    if (tSeg > 0 && tSeg < 1) break;
    accu += segLens[i];
  }
  return bestT;
}

function makeColorFn(mapName, min, max) {
  return (v) => {
    const t = (v - min) / (max - min || 1);
    return sampleColor(mapName, t);
  };
}

export function applyHeatmapColoring(rootGroup, connections, nodeValues, sensors, options) {
  const { min, max, map = 'rainbow' } = options || {};
  const minVal = min ?? 0;
  const maxVal = max ?? minVal + 1;
  if (!rootGroup) return;
  const connMap = new Map(connections.map((c) => [c.id, c]));
  const connControls = new Map();
  const colorFn = makeColorFn(map, minVal, maxVal);
  const neighborMap = buildAdjacency(connections);

  rootGroup.traverse((mesh) => {
    const meta = mesh.userData?.heatmap;
    if (!mesh.isMesh || !meta) return;
    ensureVertexColors(mesh, mesh.material?.color?.getStyle());

    mesh.updateMatrixWorld();
    const colors = mesh.geometry.attributes.color;
    const pos = mesh.geometry.attributes.position;
    if (!colors || !pos) return;

    if (meta.type === 'Connection') {
      const conn = connMap.get(meta.data?.id) || connMap.get(meta.data?.topoId) || meta.data;
      if (!conn) return;
      const key = conn.id || meta.data?.id;
      if (!connControls.has(key)) connControls.set(key, buildControlPoints(conn, nodeValues, sensors, minVal));
      const { controls: pts, totalLen } = connControls.get(key);

      const p1 = new THREE.Vector3(conn.verts?.[0]?.x || 0, conn.verts?.[0]?.y || 0, conn.verts?.[0]?.z || 0);
      const pend = conn.verts?.[conn.verts.length - 1] || { x: 0, y: 0, z: 0 };
      const p2 = new THREE.Vector3(pend.x, pend.y, pend.z);
      const vec = new THREE.Vector3().subVectors(p2, p1);
      const lenSq = Math.max(vec.lengthSq(), 1e-6);

      const vWorld = new THREE.Vector3();
      for (let i = 0; i < colors.count; i++) {
        const v = vWorld.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
        let t = new THREE.Vector3().subVectors(v, p1).dot(vec) / lenSq;
        t = Math.max(0, Math.min(1, t));

        let val = pts[0].v;
        for (let k = 0; k < pts.length - 1; k++) {
          if (t >= pts[k].t && t <= pts[k + 1].t) {
            const dt = pts[k + 1].t - pts[k].t;
            const lenSeg = Math.max(dt * totalLen, 1e-6);
            const f = dt === 0 ? 0 : (t - pts[k].t) / dt;
            const slope = (pts[k + 1].v - pts[k].v) / lenSeg;
            val = pts[k].v + f * lenSeg * slope;
            break;
          }
        }
        const c = new THREE.Color(colorFn(val));
        colors.setXYZ(i, c.r, c.g, c.b);
      }
    } else if (meta.type === 'Node') {
      const data = meta.data;
      const center = new THREE.Vector3(data.x, data.y, data.z);
      const neighbors = (neighborMap.get(data.id) || [])
        .map((c) => {
          const key = c.id;
          const ctrl = connControls.get(key) || buildControlPoints(c, nodeValues, sensors, minVal);
          connControls.set(key, ctrl);
          const { controls: pts, totalLen } = ctrl;
          if (pts.length < 2) return null;
          const isStart = c.j1 === data.id;
          const seg = isStart ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
          const dt = Math.max(seg[1].t - seg[0].t, 1e-6);
          const lenSeg = Math.max(dt * totalLen, 1e-6);
          const slope = (seg[1].v - seg[0].v) / lenSeg;
          const startVal = seg[0].v;

          const near = isStart ? c.verts[0] : c.verts[c.verts.length - 1];
          const far = isStart ? c.verts[1] || c.verts[0] : c.verts[c.verts.length - 2] || c.verts[0];
          const nearPos = new THREE.Vector3(near.x, near.y, near.z);
          const farPos = new THREE.Vector3(far.x, far.y, far.z);
          const dir = new THREE.Vector3().subVectors(farPos, nearPos).normalize();
          return { dir, slope, startVal };
        })
        .filter(Boolean);

      const vWorld = new THREE.Vector3();
      const vec = new THREE.Vector3();
      for (let i = 0; i < colors.count; i++) {
        const v = vWorld.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
        vec.subVectors(v, center);
        const dist = vec.length();
        let finalVal = minVal;
        if (dist > 1e-3 && neighbors.length > 0) {
          const vecNorm = vec.clone().normalize();
          let bestDot = -1;
          let bestSlope = 0;
          let bestStart = minVal;
          neighbors.forEach((nb) => {
            const dot = vecNorm.dot(nb.dir);
            if (dot > bestDot) {
              bestDot = dot;
              bestSlope = nb.slope;
              bestStart = nb.startVal;
            }
          });
          finalVal = bestStart;
          if (bestDot > 0) finalVal += dist * bestDot * bestSlope;
        } else if (neighbors.length) {
          // Fallback to first neighbor start value when vertex at center
          finalVal = neighbors[0].startVal ?? minVal;
        }
        const c = new THREE.Color(colorFn(finalVal));
        colors.setXYZ(i, c.r, c.g, c.b);
      }
    }
    colors.needsUpdate = true;
  });
}

export function buildHeatmapInput(topo, registry, snapshot) {
  const nodes = (topo?.nodes || []).map((n) => {
    const coord = Array.isArray(n.coordinate) ? n.coordinate : [n.coordinate?.x, n.coordinate?.y, n.coordinate?.z];
    const [x = 0, y = 0, z = 0] = coord || [];
    return { id: n.id, x, y, z, coordinate: [x, y, z] };
  });
  const connections = buildConnections(topo);
  const sensors = [];
  const edgeIds = new Set(connections.map((c) => c.id));

  (registry || []).forEach((s, idx) => {
    const value = snapshot?.get(s.sensorID);
    if (value === undefined || value === null) return;
    const rawId = s.roadwayID || s.nodeId || s.node_id || s.edgeId || s.edge_id || s.connectionId;
    const pos = { x: Number(s.x), y: Number(s.y), z: Number(s.z) };
    const ratio = Number.isFinite(Number(s.ratio)) ? Number(s.ratio) : Number.isFinite(Number(s.t)) ? Number(s.t) : null;

    if (rawId && edgeIds.has(rawId)) {
      sensors.push({
        parentType: 'Connection',
        parentId: rawId,
        parentIndex: connections.findIndex((c) => c.id === rawId),
        value,
        ...pos,
        ratio: ratio ?? projectRatioOnConnection(pos, connections.find((c) => c.id === rawId))
      });
    } else {
      sensors.push({
        parentType: 'Node',
        parentId: rawId,
        parentIndex: idx,
        value,
        ...pos,
        ratio: ratio ?? 0.5
      });
    }
  });

  return { nodes, connections, sensors };
}
