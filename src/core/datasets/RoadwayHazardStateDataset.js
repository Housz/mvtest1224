import { BaseSemanticDataset } from '../semantics/BaseSemanticDataset.js';

const toTimestamp = (value) => {
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function normalizeRow(row) {
  const edgeId = row.roadwayEdgeId ?? row.roadway_edge_id ?? row.edgeId ?? row.edge_id ?? null;
  const nodeId = row.roadwayNodeId ?? row.roadway_node_id ?? row.nodeId ?? row.node_id ?? null;
  const time = row.time ?? row.timestamp ?? row.t ?? row.step ?? 0;
  return {
    ...row,
    time,
    timeValue: toTimestamp(time),
    roadwayEdgeId: edgeId == null || edgeId === '' ? null : String(edgeId),
    roadwayNodeId: nodeId == null || nodeId === '' ? null : String(nodeId),
    hazardType: row.hazardType ?? row.hazard_type ?? row.type ?? 'hazard',
    hazardValue: Number(row.hazardValue ?? row.hazard_value ?? row.value ?? row.intensity ?? 0),
    severity: row.severity ?? 'unknown',
    passability: row.passability ?? 'passable',
    arrivalTime: row.arrivalTime ?? row.arrival_time ?? null,
    scenarioId: row.scenarioId ?? row.scenario_id ?? 'default',
    sourceId: row.sourceId ?? row.source_id ?? null
  };
}

function nearestRow(series, target, tolerance = Infinity) {
  let best = null;
  let bestDistance = Infinity;
  series.forEach((row) => {
    const distance = Math.abs(row.timeValue - target);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  });
  return best && bestDistance <= tolerance ? best : null;
}

export class RoadwayHazardStateDataset extends BaseSemanticDataset {
  constructor({
    rows = [],
    source = null,
    statePath = source?.statePath ?? null,
    metadata = {},
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    super({
      type: 'RoadwayHazardStateDataset',
      semanticClass: contract?.class ?? 'RoadwayHazardState',
      taxonomyId: 'safety-emergency',
      contract,
      templates,
      roleMapping,
      validation,
      adaptorResults,
      source: source ?? { statePath },
      metadata
    });
    this.statePath = statePath;
    this.rows = rows.map(normalizeRow).filter((row) => row.roadwayEdgeId || row.roadwayNodeId);
    this.edgeSeries = new Map();
    this.nodeSeries = new Map();
    this.rows.forEach((row) => {
      if (row.roadwayEdgeId) {
        if (!this.edgeSeries.has(row.roadwayEdgeId)) this.edgeSeries.set(row.roadwayEdgeId, []);
        this.edgeSeries.get(row.roadwayEdgeId).push(row);
      }
      if (row.roadwayNodeId) {
        if (!this.nodeSeries.has(row.roadwayNodeId)) this.nodeSeries.set(row.roadwayNodeId, []);
        this.nodeSeries.get(row.roadwayNodeId).push(row);
      }
    });
    this.edgeSeries.forEach((series) => series.sort((a, b) => a.timeValue - b.timeValue));
    this.nodeSeries.forEach((series) => series.sort((a, b) => a.timeValue - b.timeValue));
  }

  getTimeRange() {
    const values = this.rows.map((row) => row.timeValue).filter(Number.isFinite);
    if (!values.length) return { min: 0, max: 0, times: [] };
    const times = [...new Set(values)].sort((a, b) => a - b);
    return { min: times[0], max: times[times.length - 1], times };
  }

  getSnapshot(time, tolerance = Infinity) {
    const target = toTimestamp(time);
    const toleranceValue = Number.isFinite(Number(tolerance)) ? Number(tolerance) : Infinity;
    const snapshot = new Map();
    this.edgeSeries.forEach((series, edgeId) => {
      const row = nearestRow(series, target, toleranceValue);
      if (row) snapshot.set(edgeId, row);
    });
    return snapshot;
  }

  getEdgeState(edgeId, time, tolerance = Infinity) {
    const target = toTimestamp(time);
    const series = this.edgeSeries.get(String(edgeId)) ?? [];
    return nearestRow(series, target, Number.isFinite(Number(tolerance)) ? Number(tolerance) : Infinity);
  }

  listAffectedRoadwayEdges(time, options = {}) {
    const snapshot = this.getSnapshot(time, options.tolerance ?? Infinity);
    return [...snapshot.values()]
      .filter((row) => {
        if (options.passability) return row.passability === options.passability;
        return row.passability !== 'passable' || Number(row.hazardValue) > 0;
      })
      .map((row) => row.roadwayEdgeId);
  }

  getStatesBySeverity(severity, time = null) {
    const targetSeverity = String(severity).toLowerCase();
    const rows = time == null ? this.rows : [...this.getSnapshot(time).values()];
    return rows.filter((row) => String(row.severity).toLowerCase() === targetSeverity);
  }

  getBlockedEdges(time) {
    return [...this.getSnapshot(time).values()]
      .filter((row) => row.passability === 'blocked')
      .map((row) => row.roadwayEdgeId);
  }

  getRiskyEdges(time) {
    return [...this.getSnapshot(time).values()]
      .filter((row) => row.passability === 'risky')
      .map((row) => row.roadwayEdgeId);
  }

  isEdgePassable(edgeId, time) {
    const state = this.getEdgeState(edgeId, time);
    return !state || state.passability === 'passable';
  }

  getHazardType() {
    return this.rows.find((row) => row.hazardType)?.hazardType ?? null;
  }

  toJSON() {
    return {
      datasetType: 'RoadwayHazardState',
      semanticClass: this.semanticClass,
      version: '1.0',
      metadata: this.metadata || {},
      rows: this.rows.map((row) => ({ ...row }))
    };
  }

  toCSV() {
    const baseHeaders = [
      'time',
      'roadway_edge_id',
      'roadway_node_id',
      'hazard_type',
      'hazard_value',
      'severity',
      'passability',
      'arrival_time',
      'scenario_id',
      'source_id'
    ];
    const aliases = new Map([
      ['roadwayEdgeId', 'roadway_edge_id'],
      ['roadwayNodeId', 'roadway_node_id'],
      ['hazardType', 'hazard_type'],
      ['hazardValue', 'hazard_value'],
      ['arrivalTime', 'arrival_time'],
      ['scenarioId', 'scenario_id'],
      ['sourceId', 'source_id']
    ]);
    const baseKeys = new Set(['time', 'roadwayEdgeId', 'roadwayNodeId', 'hazardType', 'hazardValue', 'severity', 'passability', 'arrivalTime', 'scenarioId', 'sourceId']);
    const extraKeys = [...new Set(this.rows.flatMap((row) => Object.keys(row)))]
      .filter((key) => !baseKeys.has(key) && key !== 'timeValue')
      .sort();
    const headers = [...baseHeaders, ...extraKeys.map((key) => aliases.get(key) || key)];
    const escape = (value) => {
      if (value == null) return '';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      headers.join(','),
      ...this.rows.map((row) =>
        [
          row.time,
          row.roadwayEdgeId,
          row.roadwayNodeId,
          row.hazardType,
          row.hazardValue,
          row.severity,
          row.passability,
          row.arrivalTime,
          row.scenarioId,
          row.sourceId,
          ...extraKeys.map((key) => row[key])
        ]
          .map(escape)
          .join(',')
      )
    ].join('\n');
  }
}
