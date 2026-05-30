const toPoint = (value = {}) => ({
  x: Number(value.x ?? value.X ?? value[0]) || 0,
  y: Number(value.y ?? value.Y ?? value[1]) || 0,
  z: Number(value.z ?? value.Z ?? value[2]) || 0
});

const distance = (a, b) => {
  const pa = toPoint(a);
  const pb = toPoint(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
};

function polylineLength(points = []) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1], points[i]);
  return length;
}

function interpolatePoint(a, b, t) {
  const pa = toPoint(a);
  const pb = toPoint(b);
  return {
    x: pa.x + (pb.x - pa.x) * t,
    y: pa.y + (pb.y - pa.y) * t,
    z: pa.z + (pb.z - pa.z) * t
  };
}

function samplePolyline(points = [], { interval = 10, maxSamples = 20 } = {}) {
  const clean = points.map(toPoint).filter((point) => Number.isFinite(point.x));
  if (clean.length < 2) return clean.map((point, index) => ({ point, distance: index }));
  const length = polylineLength(clean);
  const count = Math.max(2, Math.min(Number(maxSamples) || 20, Math.ceil(length / Math.max(1, Number(interval) || 10)) + 1));
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const target = (sampleIndex / Math.max(1, count - 1)) * length;
    let traveled = 0;
    for (let i = 1; i < clean.length; i += 1) {
      const seg = distance(clean[i - 1], clean[i]);
      if (traveled + seg >= target || i === clean.length - 1) {
        const point = interpolatePoint(clean[i - 1], clean[i], seg ? (target - traveled) / seg : 0);
        samples.push({ point, distance: target });
        break;
      }
      traveled += seg;
    }
  }
  return samples;
}

function pointToSegmentDistance(point, a, b) {
  const p = toPoint(point);
  const pa = toPoint(a);
  const pb = toPoint(b);
  const vx = pb.x - pa.x;
  const vy = pb.y - pa.y;
  const vz = pb.z - pa.z;
  const wx = p.x - pa.x;
  const wy = p.y - pa.y;
  const wz = p.z - pa.z;
  const denom = vx * vx + vy * vy + vz * vz || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy + wz * vz) / denom));
  return Math.hypot(p.x - (pa.x + vx * t), p.y - (pa.y + vy * t), p.z - (pa.z + vz * t));
}

function pointToPolylineDistance(point, points = []) {
  const clean = points.map(toPoint).filter((entry) => Number.isFinite(entry.x));
  if (!clean.length) return Infinity;
  if (clean.length === 1) return distance(point, clean[0]);
  let min = Infinity;
  for (let i = 1; i < clean.length; i += 1) min = Math.min(min, pointToSegmentDistance(point, clean[i - 1], clean[i]));
  return min;
}

function structureTrace(structure = {}) {
  const geometry = structure.geometry;
  if (Array.isArray(geometry)) return geometry;
  if (Array.isArray(geometry?.points)) return geometry.points;
  if (Array.isArray(geometry?.trace)) return geometry.trace;
  if (Array.isArray(geometry?.path)) return geometry.path;
  if (geometry?.form === 'parametricFaultPlane') {
    const center = toPoint(geometry.center);
    const length = Number(geometry.length) || 200;
    const strike = ((Number(geometry.strikeDeg) || 0) * Math.PI) / 180;
    const dx = Math.cos(strike) * length * 0.5;
    const dz = Math.sin(strike) * length * 0.5;
    return [
      { x: center.x - dx, y: center.y, z: center.z - dz },
      { x: center.x + dx, y: center.y, z: center.z + dz }
    ];
  }
  if (structure.center || structure.position) return [structure.center || structure.position];
  return [];
}

function summarize(values = []) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  values.forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    min = Math.min(min, numeric);
    max = Math.max(max, numeric);
    sum += numeric;
    count += 1;
  });
  return count ? { min, max, mean: sum / count } : { min: null, max: null, mean: null };
}

function resolveEdgePath(roadway, edge) {
  const path = edge.path?.length ? edge.path : edge.verts?.length ? edge.verts : [];
  if (path.length >= 2) return path.map(toPoint);
  return [roadway.getNodePosition?.(edge.source ?? edge.from), roadway.getNodePosition?.(edge.target ?? edge.to)].filter(Boolean).map(toPoint);
}

function nearestBoreholes(borehole, samples, limitDistance = 80) {
  if (!borehole) return [];
  const rows = [];
  (borehole.listBoreholes?.() || []).forEach((hole) => {
    const trajectory = borehole.getTrajectory?.(hole.boreholeId) || [hole.position ?? hole.collar].filter(Boolean);
    let min = Infinity;
    samples.forEach((sample) => {
      min = Math.min(min, pointToPolylineDistance(sample.point, trajectory));
    });
    if (Number.isFinite(min) && min <= limitDistance) rows.push({ boreholeId: hole.boreholeId, distance: min });
  });
  return rows.sort((a, b) => a.distance - b.distance).slice(0, 5);
}

function dominantGeologicalUnit(edge, geologicalBody, attributeSamples = []) {
  const explicit =
    edge.geologicalUnitId ??
    edge.unitId ??
    edge.unit_id ??
    edge.bodyId ??
    edge.coalLayerId ??
    edge.layerId ??
    edge.metadata?.geologicalUnitId ??
    edge.metadata?.unitId;
  if (explicit) return String(explicit);
  const candidates = attributeSamples
    .map((sample) => sample?.element?.geologicalUnitId ?? sample?.element?.unitId ?? sample?.element?.seamId ?? sample?.element?.orebodyId ?? sample?.element?.bodyId)
    .filter(Boolean);
  if (candidates.length) {
    const counts = new Map();
    candidates.forEach((id) => counts.set(String(id), (counts.get(String(id)) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  const units = geologicalBody?.listUnits?.() || geologicalBody?.listBodies?.() || [];
  if (units.length === 1) return units[0].geologicalUnitId ?? units[0].unitId ?? units[0].bodyId ?? null;
  return null;
}

function recommendationFor(level) {
  if (level === 'high') return 'Inspect nearby structures / adverse geology and consider advanced detection or reinforcement.';
  if (level === 'medium') return 'Check geological context and consider support review.';
  return 'Normal geological condition.';
}

export function buildRoadwayGeologyRelationResult({
  roadway,
  geologicalBody = null,
  geologicalStructure = null,
  attributeModel = null,
  borehole = null,
  activeAttribute = null,
  params = {}
} = {}) {
  const edges = roadway?.getEdges?.() || roadway?.edges || [];
  const warning = Number(params.structureWarningDistance) || 50;
  const critical = Number(params.structureCriticalDistance) || 20;
  const threshold = Number(params.attributeThreshold);
  const hasThreshold = Number.isFinite(threshold);
  const direction = params.attributeRiskDirection || 'high';
  const structures = geologicalStructure?.listStructures?.() || [];
  const edgeRelations = new Map();
  const samples = [];
  let totalLength = 0;
  let highRiskLength = 0;
  let mediumRiskLength = 0;
  let nearStructureCount = 0;
  let thresholdExceededCount = 0;

  edges.forEach((edge) => {
    const path = resolveEdgePath(roadway, edge);
    const length = roadway?.edgeLength?.(edge) || polylineLength(path);
    totalLength += length;
    const samplePoints = samplePolyline(path, { interval: params.sampleInterval, maxSamples: params.maxSamplesPerEdge });
    const attributeSamples = activeAttribute && attributeModel
      ? samplePoints.map((sample) => ({ ...sample, sample: attributeModel.sampleAtPoint?.(sample.point, activeAttribute) })).filter((sample) => sample.sample)
      : [];
    const attributeValues = attributeSamples.map((sample) => Number(sample.sample?.value)).filter(Number.isFinite);
    const attributeByDistance = new Map(attributeSamples.map((sample) => [sample.distance, sample.sample]));
    const attributeStats = summarize(attributeValues);
    const activeAttributeValue = attributeStats.mean;
    let nearestStructure = null;
    structures.forEach((structure) => {
      const trace = structureTrace(structure);
      if (!trace.length) return;
      let distanceToTrace = Infinity;
      samplePoints.forEach((sample) => {
        distanceToTrace = Math.min(distanceToTrace, pointToPolylineDistance(sample.point, trace));
      });
      if (!nearestStructure || distanceToTrace < nearestStructure.distanceToStructure) {
        nearestStructure = {
          nearestStructureId: structure.structureId,
          nearestStructureType: structure.structureType,
          distanceToStructure: distanceToTrace
        };
      }
    });
    const nearbyBoreholes = nearestBoreholes(borehole, samplePoints, warning * 2);
    const dominantUnit = dominantGeologicalUnit(edge, geologicalBody, attributeSamples.map((sample) => sample.sample));
    let riskScore = 0;
    if (nearestStructure?.distanceToStructure != null) {
      if (nearestStructure.distanceToStructure < critical) riskScore += 2;
      else if (nearestStructure.distanceToStructure < warning) riskScore += 1;
    }
    if (hasThreshold && activeAttributeValue != null) {
      const exceeded = direction === 'low' ? activeAttributeValue < threshold : activeAttributeValue > threshold;
      if (exceeded) {
        riskScore += 1;
        thresholdExceededCount += 1;
      }
    }
    const riskLevel = riskScore >= 3 ? 'high' : riskScore >= 1 ? 'medium' : 'low';
    if (riskLevel === 'high') highRiskLength += length;
    if (riskLevel === 'medium') mediumRiskLength += length;
    if (nearestStructure?.distanceToStructure < warning) nearStructureCount += 1;
    const relation = {
      edgeId: edge.id,
      edge,
      path,
      length,
      geologicalUnits: dominantUnit ? [dominantUnit] : [],
      dominantGeologicalUnit: dominantUnit,
      nearestStructureId: nearestStructure?.nearestStructureId ?? null,
      nearestStructureType: nearestStructure?.nearestStructureType ?? null,
      distanceToStructure: nearestStructure?.distanceToStructure ?? null,
      activeAttributeValue,
      attributeStats,
      nearbyBoreholes,
      riskScore,
      riskLevel,
      recommendation: recommendationFor(riskLevel),
      samplePoints: samplePoints.map((sample) => ({
        ...sample,
        attributeValue: attributeByDistance.has(sample.distance) ? Number(attributeByDistance.get(sample.distance)?.value) : null,
        attributeSample: attributeByDistance.get(sample.distance) ?? null
      }))
    };
    edgeRelations.set(edge.id, relation);
    samples.push(...relation.samplePoints.map((sample) => ({ edgeId: edge.id, ...sample })));
  });

  return {
    edgeRelations,
    relations: [...edgeRelations.values()],
    samples,
    summary: {
      edgeCount: edges.length,
      totalLength,
      highRiskLength,
      mediumRiskLength,
      nearStructureCount,
      thresholdExceededCount,
      activeAttribute
    }
  };
}
