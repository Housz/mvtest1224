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

function edgeEndpoints(edge) {
  return [edge?.from ?? edge?.source ?? edge?.j1, edge?.to ?? edge?.target ?? edge?.j2].filter(Boolean).map(String);
}

function edgePath(roadway, edge) {
  const raw = edge?.path?.length ? edge.path : edge?.verts?.length ? edge.verts : [];
  if (raw.length >= 2) return raw.map(toPoint);
  const [from, to] = edgeEndpoints(edge);
  return [roadway?.getNodePosition?.(from), roadway?.getNodePosition?.(to)].filter(Boolean).map(toPoint);
}

function severityRank(severity) {
  return { none: 0, low: 1, medium: 2, high: 3 }[severity] ?? 0;
}

function passabilityRank(passability) {
  return { passable: 0, risky: 1, blocked: 2 }[passability] ?? 0;
}

export class FireSmoke1DSolver {
  constructor({ roadway, ventilationNetwork = null, airflowState = null, params = {} }) {
    this.roadway = roadway;
    this.ventilationNetwork = ventilationNetwork;
    this.airflowState = airflowState;
    this.params = {
      sourceEdgeId: params.sourceEdgeId,
      sourceRatio: clamp(params.sourceRatio ?? 0.5),
      ignitionTime: Number(params.ignitionTime ?? 0),
      simulationDuration: Math.max(1, Number(params.simulationDuration ?? 1800)),
      timeSteps: Math.max(1, Math.floor(Number(params.timeSteps ?? 60))),
      timeInterval: Math.max(0.001, Number(params.timeInterval ?? 30)),
      cellLength: Math.max(1, Number(params.cellLength ?? 10)),
      roadwayWidth: Math.max(0.5, Number(params.roadwayWidth ?? 4)),
      roadwayHeight: Math.max(0.5, Number(params.roadwayHeight ?? 3)),
      initialHeatRelease: Math.max(0, Number(params.initialHeatRelease ?? 1)),
      burnRate: Math.max(0.0001, Number(params.burnRate ?? 0.03)),
      fuelLoad: Math.max(0.01, Number(params.fuelLoad ?? 4)),
      heatYield: Math.max(0, Number(params.heatYield ?? 1)),
      heatLossRate: Math.max(0, Number(params.heatLossRate ?? 0.006)),
      ignitionThreshold: Math.max(0.01, Number(params.ignitionThreshold ?? 1)),
      smokeYield: Math.max(0, Number(params.smokeYield ?? 1)),
      coYield: Math.max(0, Number(params.coYield ?? 0.1)),
      smokeDiffusion: Math.max(0, Number(params.smokeDiffusion ?? 0.05)),
      ventilationAdvectionScale: Math.max(0, Number(params.ventilationAdvectionScale ?? 1)),
      ventilationDilutionScale: Math.max(0, Number(params.ventilationDilutionScale ?? 0.2)),
      airflowFireBoost: Math.max(0, Number(params.airflowFireBoost ?? 0.5)),
      riskyTempThreshold: Number(params.riskyTempThreshold ?? 60),
      blockedTempThreshold: Number(params.blockedTempThreshold ?? 120),
      riskySmokeThreshold: Number(params.riskySmokeThreshold ?? 0.25),
      blockedSmokeThreshold: Number(params.blockedSmokeThreshold ?? 0.6),
      riskyVisibilityThreshold: Number(params.riskyVisibilityThreshold ?? 20),
      blockedVisibilityThreshold: Number(params.blockedVisibilityThreshold ?? 5),
      riskyCOThreshold: Number(params.riskyCOThreshold ?? 50),
      blockedCOThreshold: Number(params.blockedCOThreshold ?? 150),
      useVentilation: params.useVentilation !== false,
      ambientTemperature: Number(params.ambientTemperature ?? 25),
      visibilityMax: Number(params.visibilityMax ?? 60),
      maxCells: Math.max(100, Math.floor(Number(params.maxCells ?? 4000))),
      scenarioId: params.scenarioId || 'fire_smoke_demo'
    };
    this.cells = [];
    this.edgeCellMap = new Map();
    this.links = [];
    this.fireArrivalTimes = new Map();
    this.smokeArrivalTimes = new Map();
    this.edgeAirflowMap = new Map();
  }

  run() {
    this.discretize();
    if (!this.cells.length) return { rows: [], summary: { totalCells: 0, warning: 'No fire/smoke cells were generated.' } };
    this.buildEdgeAirflowMap();
    const sourceCell = this.findSourceCell();
    if (sourceCell) {
      sourceCell.burningIntensity = 1;
      sourceCell.temperature += 70 * this.params.initialHeatRelease;
      sourceCell.fireArrivalTime = this.params.ignitionTime;
      this.fireArrivalTimes.set(sourceCell.id, this.params.ignitionTime);
    }
    const rows = [];
    const substeps = Math.max(1, Math.ceil(this.params.timeInterval / 5));
    const dt = this.params.timeInterval / substeps;
    for (let step = 0; step < this.params.timeSteps; step += 1) {
      const outputTime = this.params.ignitionTime + step * this.params.timeInterval;
      for (let substep = 0; substep < substeps; substep += 1) {
        const time = outputTime + substep * dt;
        this.updateAirflow(time);
        this.applyCombustion(time, dt, sourceCell);
        this.applyIgnitionSpread(time, dt);
        this.applySmokeTransport(dt);
        this.applyCoolingAndDilution(dt);
        this.updateDerivedState(time + dt);
      }
      rows.push(...this.aggregateEdgeRows(outputTime));
    }
    const summary = this.buildSummary(rows);
    return { rows, summary, cells: this.cells };
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
    const effectiveCellLength =
      estimatedCells > this.params.maxCells ? this.params.cellLength * (estimatedCells / this.params.maxCells) : this.params.cellLength;
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
        const volume = this.params.roadwayWidth * this.params.roadwayHeight * Math.max(EPS, s1 - s0);
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
          volume,
          fuelLoad: this.params.fuelLoad,
          fuelRemaining: this.params.fuelLoad,
          burningIntensity: 0,
          heatExposure: 0,
          temperature: this.params.ambientTemperature,
          smokeMass: 0,
          smokeDensity: 0,
          visualHazard: 0,
          coMass: 0,
          coConcentration: 0,
          visibility: this.params.visibilityMax,
          airflowVelocity: 0,
          airflowDirectionSign: 1,
          fireArrivalTime: null,
          smokeArrivalTime: null
        };
        this.cells.push(cell);
        edgeCells.push(cell);
      }
      this.edgeCellMap.set(edgeId, edgeCells);
      for (let index = 0; index < edgeCells.length - 1; index += 1) this.addLink(edgeCells[index], edgeCells[index + 1], 'edge');
      const [from, to] = edgeEndpoints(edge);
      addBoundary(from, edgeCells[0]);
      addBoundary(to, edgeCells[edgeCells.length - 1]);
    });
    nodeBoundaryCells.forEach((cells) => {
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) this.addLink(cells[i], cells[j], 'junction');
      }
    });
    this.updateDerivedState(this.params.ignitionTime);
  }

  addLink(a, b, kind) {
    if (!a || !b || a.id === b.id) return;
    this.links.push({ a, b, kind, length: Math.max(1, (a.length + b.length) * 0.5) });
  }

  findSourceCell() {
    const edgeId = String(this.params.sourceEdgeId || this.roadway?.getEdges?.()[0]?.id || '');
    if (!this.params.sourceEdgeId) this.params.sourceEdgeId = edgeId;
    const cells = this.edgeCellMap.get(edgeId) || [];
    if (!cells.length) return null;
    const index = Math.max(0, Math.min(cells.length - 1, Math.floor(this.params.sourceRatio * cells.length)));
    return cells[index];
  }

  buildEdgeAirflowMap() {
    if (!this.params.useVentilation || !this.ventilationNetwork || !this.airflowState) return;
    for (const branch of this.ventilationNetwork.listBranches?.() || []) {
      const edgeIds = branch.roadwayEdgeIds || [];
      edgeIds.forEach((edgeId, index) => {
        this.edgeAirflowMap.set(String(edgeId), { branchId: branch.id, localSign: index === 0 ? 1 : 1 });
      });
    }
  }

  updateAirflow(time) {
    this.cells.forEach((cell) => {
      const airflow = this.edgeAirflowMap.get(cell.edgeId);
      const state = airflow ? this.airflowState?.getBranchState?.(airflow.branchId, time, Infinity) : null;
      const velocity = Math.max(0, Math.abs(Number(state?.velocity) || 0));
      const sign = (Number(state?.directionSign) || 1) * (airflow?.localSign || 1);
      cell.airflowVelocity = velocity;
      cell.airflowDirectionSign = sign >= 0 ? 1 : -1;
    });
  }

  applyCombustion(time, dt, sourceCell) {
    if (sourceCell && time >= this.params.ignitionTime && time <= this.params.ignitionTime + this.params.simulationDuration) {
      sourceCell.burningIntensity = Math.max(sourceCell.burningIntensity, 1);
      sourceCell.fuelRemaining = Math.max(sourceCell.fuelRemaining, this.params.fuelLoad * 0.08);
    }
    this.cells.forEach((cell) => {
      if (cell.burningIntensity <= 0 || cell.fuelRemaining <= 0) return;
      const burnedFuel = Math.min(cell.fuelRemaining, this.params.burnRate * cell.burningIntensity * dt * 0.32);
      cell.fuelRemaining -= burnedFuel;
      cell.temperature += burnedFuel * this.params.heatYield * 130;
      cell.smokeMass += burnedFuel * this.params.smokeYield * 20;
      cell.coMass += burnedFuel * this.params.coYield * 760;
      if (cell.fireArrivalTime == null) {
        cell.fireArrivalTime = time;
        this.fireArrivalTimes.set(cell.id, time);
      }
      if (cell.fuelRemaining <= EPS) cell.burningIntensity *= Math.exp(-0.24 * dt);
    });
  }

  linkAlignment(fromCell, toCell) {
    if (fromCell.edgeId !== toCell.edgeId) return 0;
    const forward = toCell.cellIndex > fromCell.cellIndex ? 1 : -1;
    return forward === fromCell.airflowDirectionSign ? 1 : -0.5;
  }

  applyIgnitionSpread(time, dt) {
    const exposureAdds = new Map();
    this.links.forEach((link) => {
      [
        [link.a, link.b],
        [link.b, link.a]
      ].forEach(([from, to]) => {
        if (from.burningIntensity <= 0 || to.fuelRemaining <= 0 || to.burningIntensity > 0) return;
        const alignment = this.linkAlignment(from, to);
        const airflowBoost = 1 + this.params.airflowFireBoost * alignment * Math.min(1.5, from.airflowVelocity);
        const heat = (0.038 * from.burningIntensity * Math.max(0.3, airflowBoost) * dt) / Math.max(1, link.length / 10);
        exposureAdds.set(to, (exposureAdds.get(to) || 0) + heat);
      });
    });
    exposureAdds.forEach((value, cell) => {
      cell.heatExposure += value;
      if (cell.heatExposure >= this.params.ignitionThreshold) {
        cell.burningIntensity = Math.max(cell.burningIntensity, 0.85);
        if (cell.fireArrivalTime == null) {
          cell.fireArrivalTime = time;
          this.fireArrivalTimes.set(cell.id, time);
        }
      }
    });
  }

  applySmokeTransport(dt) {
    const smokeDelta = new Map();
    const coDelta = new Map();
    const move = (from, to, smokeAmount, coAmount) => {
      if (smokeAmount <= 0 && coAmount <= 0) return;
      smokeDelta.set(from, (smokeDelta.get(from) || 0) - smokeAmount);
      smokeDelta.set(to, (smokeDelta.get(to) || 0) + smokeAmount);
      coDelta.set(from, (coDelta.get(from) || 0) - coAmount);
      coDelta.set(to, (coDelta.get(to) || 0) + coAmount);
    };
    this.links.forEach((link) => {
      const densityDiff = link.a.smokeDensity - link.b.smokeDensity;
      if (Math.abs(densityDiff) > EPS) {
        const from = densityDiff > 0 ? link.a : link.b;
        const to = densityDiff > 0 ? link.b : link.a;
        const fraction = clamp((this.params.smokeDiffusion * Math.abs(densityDiff) * dt) / Math.max(1, link.length), 0, 0.22);
        move(from, to, from.smokeMass * fraction, from.coMass * fraction);
      }
      if (link.a.edgeId === link.b.edgeId) {
        const edgeSign = link.b.cellIndex > link.a.cellIndex ? 1 : -1;
        const from = link.a.airflowDirectionSign === edgeSign ? link.a : link.b;
        const to = from === link.a ? link.b : link.a;
        const velocity = Math.max(from.airflowVelocity, to.airflowVelocity);
        if (velocity > EPS) {
          const fraction = clamp(this.params.ventilationAdvectionScale * velocity * dt / Math.max(1, link.length), 0, 0.45);
          move(from, to, from.smokeMass * fraction, from.coMass * fraction);
        }
      }
    });
    smokeDelta.forEach((delta, cell) => {
      cell.smokeMass = Math.max(0, cell.smokeMass + delta);
    });
    coDelta.forEach((delta, cell) => {
      cell.coMass = Math.max(0, cell.coMass + delta);
    });
  }

  applyCoolingAndDilution(dt) {
    this.cells.forEach((cell) => {
      cell.temperature += (this.params.ambientTemperature - cell.temperature) * clamp(this.params.heatLossRate * dt, 0, 0.35);
      const dilution = clamp(this.params.ventilationDilutionScale * cell.airflowVelocity * dt * 0.02, 0, 0.3);
      cell.smokeMass *= 1 - dilution;
      cell.coMass *= 1 - dilution;
    });
  }

  updateDerivedState(time) {
    this.cells.forEach((cell) => {
      cell.smokeDensity = cell.smokeMass / Math.max(EPS, cell.volume);
      cell.coConcentration = cell.coMass / Math.max(EPS, cell.volume);
      cell.visibility = Math.max(0.5, this.params.visibilityMax / (1 + cell.smokeDensity * 16));
      const tempRisk = clamp((cell.temperature - this.params.ambientTemperature) / Math.max(1, this.params.blockedTempThreshold - this.params.ambientTemperature));
      const smokeRisk = clamp(cell.smokeDensity / Math.max(EPS, this.params.blockedSmokeThreshold));
      const coRisk = clamp(cell.coConcentration / Math.max(EPS, this.params.blockedCOThreshold));
      const visibilityRisk = clamp(1 - cell.visibility / Math.max(EPS, this.params.visibilityMax));
      const currentVisual = Math.max(tempRisk, smokeRisk, coRisk, visibilityRisk, cell.burningIntensity);
      cell.visualHazard = Math.max(currentVisual, (cell.visualHazard || 0) * 0.965);
      if (cell.smokeArrivalTime == null && cell.smokeDensity > 0.01) {
        cell.smokeArrivalTime = time;
        this.smokeArrivalTimes.set(cell.id, time);
      }
    });
  }

  classifyCell(cell) {
    if (cell.burningIntensity > 0.2 || cell.temperature >= this.params.blockedTempThreshold || cell.visibility <= this.params.blockedVisibilityThreshold || cell.coConcentration >= this.params.blockedCOThreshold || cell.smokeDensity >= this.params.blockedSmokeThreshold) {
      return { passability: 'blocked', severity: 'high' };
    }
    if (cell.temperature >= this.params.riskyTempThreshold || cell.visibility <= this.params.riskyVisibilityThreshold || cell.coConcentration >= this.params.riskyCOThreshold || cell.smokeDensity >= this.params.riskySmokeThreshold) {
      return { passability: 'risky', severity: 'medium' };
    }
    if (cell.smokeDensity > 0.01 || cell.temperature > this.params.ambientTemperature + 5) return { passability: 'passable', severity: 'low' };
    return { passability: 'passable', severity: 'none' };
  }

  aggregateEdgeRows(time) {
    const rows = [];
    this.edgeCellMap.forEach((cells, edgeId) => {
      let maxTemperature = this.params.ambientTemperature;
      let maxSmokeDensity = 0;
      let maxCO = 0;
      let worstVisibility = this.params.visibilityMax;
      let maxBurning = 0;
      let maxVisualHazard = 0;
      let severity = 'none';
      let passability = 'passable';
      let fireArrivalTime = null;
      let smokeArrivalTime = null;
      const affectedSegments = [];
      cells.forEach((cell) => {
        maxTemperature = Math.max(maxTemperature, cell.temperature);
        maxSmokeDensity = Math.max(maxSmokeDensity, cell.smokeDensity);
        maxCO = Math.max(maxCO, cell.coConcentration);
        worstVisibility = Math.min(worstVisibility, cell.visibility);
        maxBurning = Math.max(maxBurning, cell.burningIntensity);
        maxVisualHazard = Math.max(maxVisualHazard, cell.visualHazard || 0);
        const cls = this.classifyCell(cell);
        if (severityRank(cls.severity) > severityRank(severity)) severity = cls.severity;
        if (passabilityRank(cls.passability) > passabilityRank(passability)) passability = cls.passability;
        if (cell.fireArrivalTime != null) fireArrivalTime = fireArrivalTime == null ? cell.fireArrivalTime : Math.min(fireArrivalTime, cell.fireArrivalTime);
        if (cell.smokeArrivalTime != null) smokeArrivalTime = smokeArrivalTime == null ? cell.smokeArrivalTime : Math.min(smokeArrivalTime, cell.smokeArrivalTime);
        const riskRatio = this.cellRiskRatio(cell);
        if (riskRatio > 0.012) {
          affectedSegments.push({
            s0Ratio: cell.s0 / Math.max(EPS, cell.edgeLength),
            s1Ratio: cell.s1 / Math.max(EPS, cell.edgeLength),
            fillRatio: Math.max(0.08, riskRatio),
            depth: riskRatio,
            flowRegime: passability === 'blocked' ? 'full' : 'open'
          });
        }
      });
      const hazardValue = this.edgeRiskValue({ maxTemperature, maxSmokeDensity, maxCO, worstVisibility, maxBurning, maxVisualHazard });
      rows.push({
        time,
        timeValue: time,
        roadwayEdgeId: edgeId,
        roadwayNodeId: null,
        hazardType: 'fire_smoke',
        hazardValue,
        temperature: Number(maxTemperature.toFixed(3)),
        smokeDensity: Number(maxSmokeDensity.toFixed(5)),
        coConcentration: Number(maxCO.toFixed(3)),
        visibility: Number(worstVisibility.toFixed(3)),
        fireIntensity: Number(maxBurning.toFixed(4)),
        visualHazard: Number(maxVisualHazard.toFixed(4)),
        maxFillRatio: Number(maxVisualHazard.toFixed(4)),
        smokeSeverity: maxSmokeDensity >= this.params.blockedSmokeThreshold ? 'high' : maxSmokeDensity >= this.params.riskySmokeThreshold ? 'medium' : maxSmokeDensity > 0.01 ? 'low' : 'none',
        thermalSeverity: maxTemperature >= this.params.blockedTempThreshold ? 'high' : maxTemperature >= this.params.riskyTempThreshold ? 'medium' : maxTemperature > this.params.ambientTemperature + 5 ? 'low' : 'none',
        toxicitySeverity: maxCO >= this.params.blockedCOThreshold ? 'high' : maxCO >= this.params.riskyCOThreshold ? 'medium' : maxCO > 0 ? 'low' : 'none',
        severity,
        passability,
        riskCost: Number((1 + hazardValue * 8).toFixed(3)),
        fireArrivalTime,
        smokeArrivalTime,
        arrivalTime: smokeArrivalTime ?? fireArrivalTime,
        scenarioId: this.params.scenarioId,
        sourceId: this.params.sourceEdgeId,
        sourceRatio: this.params.sourceRatio,
        wetSegments: affectedSegments
      });
    });
    return rows;
  }

  cellRiskRatio(cell) {
    const temp = clamp((cell.temperature - this.params.ambientTemperature) / Math.max(1, this.params.blockedTempThreshold - this.params.ambientTemperature));
    const smoke = clamp(cell.smokeDensity / Math.max(EPS, this.params.blockedSmokeThreshold));
    const co = clamp(cell.coConcentration / Math.max(EPS, this.params.blockedCOThreshold));
    const visibility = clamp(1 - cell.visibility / Math.max(EPS, this.params.visibilityMax));
    const visual = clamp(cell.visualHazard || 0) * 0.78;
    return Math.max(temp, smoke, co, visibility, cell.burningIntensity, visual);
  }

  edgeRiskValue(values) {
    return Math.max(
      clamp((values.maxTemperature - this.params.ambientTemperature) / Math.max(1, this.params.blockedTempThreshold - this.params.ambientTemperature)),
      clamp(values.maxSmokeDensity / Math.max(EPS, this.params.blockedSmokeThreshold)),
      clamp(values.maxCO / Math.max(EPS, this.params.blockedCOThreshold)),
      clamp(1 - values.worstVisibility / Math.max(EPS, this.params.visibilityMax)),
      clamp(values.maxBurning),
      clamp(values.maxVisualHazard || 0) * 0.72
    );
  }

  buildSummary(rows) {
    let burningCellsMax = 0;
    let smokeAffectedCellsMax = 0;
    let maxTemperature = this.params.ambientTemperature;
    let maxSmokeDensity = 0;
    let worstVisibility = this.params.visibilityMax;
    this.cells.forEach((cell) => {
      if (cell.burningIntensity > 0.05) burningCellsMax += 1;
      if (cell.smokeDensity > 0.01) smokeAffectedCellsMax += 1;
      maxTemperature = Math.max(maxTemperature, cell.temperature);
      maxSmokeDensity = Math.max(maxSmokeDensity, cell.smokeDensity);
      worstVisibility = Math.min(worstVisibility, cell.visibility);
    });
    const blockedEdgesMax = new Set(rows.filter((row) => row.passability === 'blocked').map((row) => row.roadwayEdgeId)).size;
    return {
      totalCells: this.cells.length,
      burningCellsMax,
      smokeAffectedCellsMax,
      blockedEdgesMax,
      maxTemperature: Number(maxTemperature.toFixed(3)),
      maxSmokeDensity: Number(maxSmokeDensity.toFixed(5)),
      worstVisibility: Number(worstVisibility.toFixed(3)),
      useVentilation: Boolean(this.params.useVentilation && this.ventilationNetwork && this.airflowState),
      sourceEdgeId: this.params.sourceEdgeId,
      sourceRatio: this.params.sourceRatio
    };
  }
}
