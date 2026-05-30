const G = 9.81;
const EPS = 1e-6;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value)));

function toPoint(value = {}) {
  if (value?.isVector3) return { x: value.x, y: value.y, z: value.z };
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1], points[i]);
  return length;
}

function pointAtS(points, targetS) {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  if (points.length === 1) return { ...points[0] };
  let traveled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distance(a, b);
    if (traveled + segmentLength >= targetS) {
      const local = segmentLength > EPS ? (targetS - traveled) / segmentLength : 0;
      return lerpPoint(a, b, clamp(local));
    }
    traveled += segmentLength;
  }
  return { ...points[points.length - 1] };
}

function projectPointRatio(points, point) {
  const target = toPoint(point);
  const total = polylineLength(points);
  if (total <= EPS) return 0.5;
  let traveled = 0;
  let bestS = 0;
  let bestDistance = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ap = { x: target.x - a.x, y: target.y - a.y, z: target.z - a.z };
    const lengthSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
    const t = lengthSq > EPS ? clamp((ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / lengthSq) : 0;
    const projected = lerpPoint(a, b, t);
    const d = distance(projected, target);
    if (d < bestDistance) {
      bestDistance = d;
      bestS = traveled + Math.sqrt(lengthSq) * t;
    }
    traveled += Math.sqrt(lengthSq);
  }
  return clamp(bestS / total);
}

function edgeEndpoints(edge) {
  return [edge?.from ?? edge?.source ?? edge?.j1, edge?.to ?? edge?.target ?? edge?.j2].filter(Boolean).map(String);
}

function edgePath(roadway, edge) {
  const raw = edge?.path?.length ? edge.path : edge?.verts?.length ? edge.verts : [];
  if (raw.length >= 2) return raw.map(toPoint);
  const [from, to] = edgeEndpoints(edge);
  return [roadway?.getNodePosition?.(from), roadway?.getNodePosition?.(to)].filter(Boolean).map(toPoint);
}

export function projectRoadwayEdgeRatio(roadway, edgeId, point) {
  const edge = roadway?.edgeMap?.get?.(String(edgeId)) || roadway?.getEdges?.().find((item) => String(item.id) === String(edgeId));
  const path = edgePath(roadway, edge);
  return path.length >= 2 ? projectPointRatio(path, point) : 0.5;
}

export class WaterInrushHydraulic1DSolver {
  constructor({ roadway, params = {} }) {
    this.roadway = roadway;
    this.params = {
      startTime: Number(params.startTime ?? 0),
      duration: Math.max(0, Number(params.duration ?? 20)),
      timeSteps: Math.max(1, Math.floor(Number(params.timeSteps ?? 40))),
      timeInterval: Math.max(0.001, Number(params.timeInterval ?? 1)),
      sourceEdgeId: params.sourceEdgeId,
      sourceRatio: clamp(params.sourceRatio ?? 0.5),
      intensity: Number(params.intensity ?? 1),
      inflowRate: Math.max(0, Number(params.inflowRate ?? 8)) * Math.max(0, Number(params.intensity ?? 1)),
      inflowMode: params.inflowMode === 'timed' ? 'timed' : 'continuous',
      cellLength: Math.max(1, Number(params.cellLength ?? 10)),
      roadwayWidth: Math.max(0.5, Number(params.roadwayWidth ?? 4)),
      roadwayHeight: Math.max(0.5, Number(params.roadwayHeight ?? 3)),
      conductanceScale: Math.max(0.001, Number(params.conductanceScale ?? 1.2)),
      leakageRate: Math.max(0, Number(params.leakageRate ?? 0)),
      riskyDepthThreshold: Math.max(0.001, Number(params.riskyDepthThreshold ?? 0.3)),
      blockedDepthThreshold: Math.max(0.001, Number(params.blockedDepthThreshold ?? 0.8)),
      fullFlowRatio: clamp(params.fullFlowRatio ?? 0.95, 0.1, 1),
      maxCells: Math.max(100, Math.floor(Number(params.maxCells ?? 4000))),
      scenarioId: params.scenarioId || 'water_inrush_demo'
    };
    this.cells = [];
    this.cellsById = new Map();
    this.edgeCellMap = new Map();
    this.links = [];
    this.arrivalTimes = new Map();
    this.summary = {};
  }

  run() {
    this.discretize();
    if (!this.cells.length) {
      return { rows: [], summary: { totalCells: 0, warning: 'No hydraulic cells were generated.' } };
    }
    const sourceCell = this.findSourceCell();
    let totalInjected = 0;
    let totalLeakage = 0;
    const rows = [];
    const substeps = Math.max(1, Math.ceil(this.params.timeInterval / 0.25));
    const dt = this.params.timeInterval / substeps;
    for (let step = 0; step < this.params.timeSteps; step += 1) {
      const outputTime = this.params.startTime + step * this.params.timeInterval;
      for (let substep = 0; substep < substeps; substep += 1) {
        const time = outputTime + substep * dt;
        const inflowActive =
          sourceCell &&
          time >= this.params.startTime &&
          (this.params.inflowMode === 'continuous' || time <= this.params.startTime + this.params.duration);
        if (inflowActive) {
          const injected = Math.max(0, this.params.inflowRate) * dt;
          sourceCell.volume += injected;
          totalInjected += injected;
        }
        this.updateCellState();
        this.applyFluxes(dt);
        totalLeakage += this.applyLeakage(dt);
        this.updateCellState();
        this.recordArrivals(time + dt);
      }
      rows.push(...this.aggregateEdgeRows(outputTime));
    }
    const totalStored = this.cells.reduce((sum, cell) => sum + cell.volume, 0);
    const wetEdges = new Set();
    const blockedEdges = new Set();
    let maxDepth = 0;
    for (const row of rows) {
      const depth = Number(row.maxDepth ?? row.hazardValue) || 0;
      if (depth > maxDepth) maxDepth = depth;
      if (Number(row.hazardValue) > 0) wetEdges.add(row.roadwayEdgeId);
      if (row.passability === 'blocked') blockedEdges.add(row.roadwayEdgeId);
    }
    this.summary = {
      totalCells: this.cells.length,
      totalLinks: this.links.length,
      totalWaterInjected: Number(totalInjected.toFixed(4)),
      totalWaterStored: Number(totalStored.toFixed(4)),
      totalLeakage: Number(totalLeakage.toFixed(4)),
      massBalanceError: Number((totalInjected - totalStored - totalLeakage).toFixed(4)),
      wetEdgesCount: wetEdges.size,
      blockedEdgesCount: blockedEdges.size,
      maxDepth: Number(maxDepth.toFixed(4)),
      sourceEdgeId: this.params.sourceEdgeId,
      sourceRatio: this.params.sourceRatio
    };
    return { rows, summary: this.summary, cells: this.cells };
  }

  discretize() {
    const edges = this.roadway?.getEdges?.() || [];
    const edgeInfos = edges
      .map((edge) => {
        const path = edgePath(this.roadway, edge);
        return { edge, path, length: Math.max(polylineLength(path), 1) };
      })
      .filter((entry) => entry.path.length >= 2);
    const estimatedCells = edgeInfos.reduce((sum, entry) => sum + Math.max(2, Math.ceil(entry.length / this.params.cellLength)), 0);
    const effectiveCellLength = estimatedCells > this.params.maxCells
      ? this.params.cellLength * (estimatedCells / this.params.maxCells)
      : this.params.cellLength;
    const nodeBoundaryCells = new Map();
    const addBoundary = (nodeId, cell) => {
      if (!nodeId) return;
      if (!nodeBoundaryCells.has(nodeId)) nodeBoundaryCells.set(nodeId, []);
      nodeBoundaryCells.get(nodeId).push(cell);
    };
    edgeInfos.forEach(({ edge, path, length }) => {
      const edgeId = String(edge.id);
      const count = Math.max(2, Math.ceil(length / effectiveCellLength));
      const cellLength = length / count;
      const edgeCells = [];
      for (let index = 0; index < count; index += 1) {
        const s0 = index * cellLength;
        const s1 = index === count - 1 ? length : (index + 1) * cellLength;
        const centerS = (s0 + s1) * 0.5;
        const center = pointAtS(path, centerS);
        const cell = {
          id: `${edgeId}::${index}`,
          edgeId,
          cellIndex: index,
          s0,
          s1,
          centerS,
          length: Math.max(EPS, s1 - s0),
          edgeLength: length,
          center,
          z: center.z,
          width: this.params.roadwayWidth,
          height: this.params.roadwayHeight,
          area: this.params.roadwayWidth * this.params.roadwayHeight,
          capacityVolume: this.params.roadwayWidth * this.params.roadwayHeight * Math.max(EPS, s1 - s0),
          volume: 0,
          depth: 0,
          fillRatio: 0,
          surchargeVolume: 0,
          surchargeHead: 0,
          hydraulicHead: center.z,
          neighbors: []
        };
        this.cells.push(cell);
        this.cellsById.set(cell.id, cell);
        edgeCells.push(cell);
      }
      this.edgeCellMap.set(edgeId, edgeCells);
      for (let index = 0; index < edgeCells.length - 1; index += 1) {
        this.addLink(edgeCells[index], edgeCells[index + 1], edgeCells[index].length);
      }
      const [from, to] = edgeEndpoints(edge);
      addBoundary(from, edgeCells[0]);
      addBoundary(to, edgeCells[edgeCells.length - 1]);
    });
    nodeBoundaryCells.forEach((cells) => {
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          this.addLink(cells[i], cells[j], Math.max(1, (cells[i].length + cells[j].length) * 0.5));
        }
      }
    });
    this.updateCellState();
  }

  addLink(a, b, length) {
    if (!a || !b || a.id === b.id) return;
    const key = [a.id, b.id].sort().join('|');
    if (this.links.some((link) => link.key === key)) return;
    const link = { key, a, b, length: Math.max(1, Number(length) || 1) };
    this.links.push(link);
    a.neighbors.push(b.id);
    b.neighbors.push(a.id);
  }

  findSourceCell() {
    const edges = this.roadway?.getEdges?.() || [];
    if (!this.params.sourceEdgeId && edges[0]) this.params.sourceEdgeId = String(edges[0].id);
    const cells = this.edgeCellMap.get(String(this.params.sourceEdgeId)) || [];
    if (!cells.length) return null;
    const edgeLength = cells[0].edgeLength || cells.reduce((sum, cell) => sum + cell.length, 0);
    const sourceS = clamp(this.params.sourceRatio) * edgeLength;
    return cells.find((cell) => sourceS >= cell.s0 && sourceS <= cell.s1) || cells[Math.floor(cells.length * clamp(this.params.sourceRatio))] || cells[0];
  }

  updateCellState() {
    this.cells.forEach((cell) => {
      cell.volume = Math.max(0, Number.isFinite(cell.volume) ? cell.volume : 0);
      cell.depth = Math.min(cell.height, cell.volume / Math.max(EPS, cell.width * cell.length));
      cell.fillRatio = clamp(cell.depth / cell.height);
      cell.surchargeVolume = Math.max(0, cell.volume - cell.capacityVolume);
      cell.surchargeHead = cell.surchargeVolume / Math.max(EPS, cell.width * cell.length);
      cell.hydraulicHead = cell.z + cell.depth + cell.surchargeHead;
    });
  }

  applyFluxes(dt) {
    const fluxes = [];
    const outgoing = new Map();
    for (const link of this.links) {
      const headDiff = link.a.hydraulicHead - link.b.hydraulicHead;
      if (Math.abs(headDiff) < 1e-5) continue;
      const from = headDiff > 0 ? link.a : link.b;
      const to = headDiff > 0 ? link.b : link.a;
      if (from.volume <= EPS || from.depth <= EPS) continue;
      const wetArea = from.width * Math.max(0.03, from.depth);
      const wetFactor = clamp(from.fillRatio, 0.08, 1);
      const conductance = this.params.conductanceScale * wetArea / Math.max(1, link.length);
      let delta = conductance * Math.sqrt(2 * G * Math.abs(headDiff)) * wetFactor * dt;
      if (!Number.isFinite(delta) || delta <= 0) continue;
      delta = Math.min(delta, from.volume * 0.55);
      fluxes.push({ from, to, delta });
      outgoing.set(from.id, (outgoing.get(from.id) || 0) + delta);
    }
    fluxes.forEach((flux) => {
      const maxOutgoing = flux.from.volume * 0.65;
      const scale = outgoing.get(flux.from.id) > maxOutgoing && outgoing.get(flux.from.id) > EPS
        ? maxOutgoing / outgoing.get(flux.from.id)
        : 1;
      const delta = Math.min(flux.from.volume, flux.delta * scale);
      flux.from.volume -= delta;
      flux.to.volume += delta;
    });
  }

  applyLeakage(dt) {
    if (this.params.leakageRate <= 0) return 0;
    let leaked = 0;
    const factor = clamp(1 - this.params.leakageRate * dt, 0, 1);
    this.cells.forEach((cell) => {
      const before = cell.volume;
      cell.volume *= factor;
      leaked += before - cell.volume;
    });
    return leaked;
  }

  recordArrivals(time) {
    this.cells.forEach((cell) => {
      if (cell.depth > 0.01 && !this.arrivalTimes.has(cell.id)) this.arrivalTimes.set(cell.id, Number(time.toFixed(4)));
    });
  }

  classify(maxDepth, maxFillRatio) {
    if (maxDepth <= 0) return { severity: 'none', passability: 'passable' };
    if (maxFillRatio >= this.params.fullFlowRatio || maxDepth >= this.params.blockedDepthThreshold) return { severity: 'high', passability: 'blocked' };
    if (maxDepth >= this.params.riskyDepthThreshold) return { severity: 'medium', passability: 'risky' };
    return { severity: 'low', passability: 'passable' };
  }

  aggregateEdgeRows(time) {
    const rows = [];
    this.edgeCellMap.forEach((cells, edgeId) => {
      const totalLength = cells.reduce((sum, cell) => sum + cell.length, 0) || 1;
      const wetCells = cells.filter((cell) => cell.depth > 0.01);
      const waterVolume = cells.reduce((sum, cell) => sum + cell.volume, 0);
      const maxDepth = Math.max(0, ...cells.map((cell) => cell.depth));
      const meanDepth = cells.reduce((sum, cell) => sum + cell.depth * cell.length, 0) / totalLength;
      const maxFillRatio = Math.max(0, ...cells.map((cell) => cell.fillRatio));
      const wetLengthRatio = wetCells.reduce((sum, cell) => sum + cell.length, 0) / totalLength;
      const blockedRatio = cells
        .filter((cell) => cell.depth >= this.params.blockedDepthThreshold || cell.fillRatio >= this.params.fullFlowRatio)
        .reduce((sum, cell) => sum + cell.length, 0) / totalLength;
      const arrivalTime = Math.min(
        Infinity,
        ...wetCells.map((cell) => this.arrivalTimes.get(cell.id)).filter((value) => Number.isFinite(value))
      );
      const flowRegime =
        maxDepth <= 0
          ? 'dry'
          : cells.some((cell) => cell.surchargeVolume > 0.01)
            ? 'surcharged'
            : maxFillRatio >= this.params.fullFlowRatio
              ? 'full'
              : 'open';
      const { severity, passability } = this.classify(maxDepth, maxFillRatio);
      rows.push({
        time,
        timeValue: time,
        roadwayEdgeId: edgeId,
        roadwayNodeId: null,
        hazardType: 'water',
        hazardValue: Number(maxDepth.toFixed(4)),
        maxDepth: Number(maxDepth.toFixed(4)),
        meanDepth: Number(meanDepth.toFixed(4)),
        maxFillRatio: Number(maxFillRatio.toFixed(4)),
        wetLengthRatio: Number(wetLengthRatio.toFixed(4)),
        flowRegime,
        waterVolume: Number(waterVolume.toFixed(4)),
        blockedRatio: Number(blockedRatio.toFixed(4)),
        wetSegments: wetCells.map((cell) => ({
          s0Ratio: Number((cell.s0 / totalLength).toFixed(4)),
          s1Ratio: Number((cell.s1 / totalLength).toFixed(4)),
          depth: Number(cell.depth.toFixed(4)),
          fillRatio: Number(cell.fillRatio.toFixed(4)),
          flowRegime: cell.surchargeVolume > 0.01 ? 'surcharged' : cell.fillRatio >= this.params.fullFlowRatio ? 'full' : 'open'
        })),
        severity,
        passability,
        arrivalTime: Number.isFinite(arrivalTime) ? arrivalTime : null,
        scenarioId: this.params.scenarioId,
        sourceId: this.params.sourceEdgeId,
        sourceRatio: this.params.sourceRatio,
        roadwayWidth: this.params.roadwayWidth,
        roadwayHeight: this.params.roadwayHeight
      });
    });
    return rows;
  }
}
