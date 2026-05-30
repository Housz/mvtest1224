const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

function toPoint(value = {}) {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return {
    x: Number(value.x ?? value.X ?? value.collarX ?? value.collar_x ?? 0),
    y: Number(value.y ?? value.Y ?? value.collarY ?? value.collar_y ?? 0),
    z: Number(value.z ?? value.Z ?? value.collarZ ?? value.collar_z ?? 0)
  };
}

function normalizeBorehole(row = {}, index = 0) {
  const id = row.boreholeId ?? row.borehole_id ?? row.hole_id ?? row.id ?? `BH_${index + 1}`;
  return {
    ...row,
    id: String(id),
    boreholeId: String(id),
    boreholeName: row.boreholeName ?? row.name ?? row.holeName ?? String(id),
    collar: toPoint(row.collar ?? row),
    trajectory: asArray(row.trajectory ?? row.path ?? row.survey)
  };
}

function normalizeInterval(row = {}, index = 0) {
  const boreholeId = row.boreholeId ?? row.borehole_id ?? row.hole_id ?? row.holeId ?? row.id ?? null;
  return {
    ...row,
    id: String(row.sampleId ?? row.sample_id ?? row.intervalId ?? `INT_${index + 1}`),
    boreholeId: boreholeId == null ? null : String(boreholeId),
    depthFrom: Number(row.depthFrom ?? row.depth_from ?? row.from_depth ?? row.from ?? 0),
    depthTo: Number(row.depthTo ?? row.depth_to ?? row.to_depth ?? row.to ?? row.depth ?? 0),
    lithology: row.lithology ?? row.rock_type ?? row.rockType ?? null,
    grade: row.grade ?? row.assay ?? row.value ?? null
  };
}

export class BoreholeDataset {
  constructor({
    boreholes = [],
    intervals = [],
    samples = [],
    logs = [],
    source = null,
    metadata = {},
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'BoreholeDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'Borehole';
    this.taxonomyClass = contract?.taxonomyClass ?? 'Geology & Resource Datasets';
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source;
    this.metadata = metadata;
    this.boreholes = asArray(boreholes).map(normalizeBorehole);
    this.intervals = asArray(intervals).map(normalizeInterval);
    this.samples = asArray(samples).map(normalizeInterval);
    this.logs = asArray(logs).map(normalizeInterval);
    this.boreholeMap = new Map(this.boreholes.map((borehole) => [borehole.boreholeId, borehole]));
  }

  listBoreholes() {
    return this.boreholes;
  }

  getBorehole(id) {
    return this.boreholeMap.get(String(id)) ?? null;
  }

  getTrajectory(id) {
    const borehole = this.getBorehole(id);
    if (!borehole) return [];
    if (borehole.trajectory?.length) return borehole.trajectory;
    return [borehole.collar];
  }

  getIntervals(id) {
    return this.intervals.filter((interval) => interval.boreholeId === String(id));
  }

  getSamples(id) {
    return this.samples.filter((sample) => sample.boreholeId === String(id));
  }

  getLogs(id, attributeName = null) {
    const rows = this.logs.length ? this.logs : this.intervals;
    return rows.filter((row) => {
      if (row.boreholeId !== String(id)) return false;
      if (!attributeName) return true;
      return row[attributeName] != null || String(row.attributeName ?? row.name) === String(attributeName);
    });
  }

  getIntervalAtDepth(boreholeId, depth) {
    const value = Number(depth);
    return this.getIntervals(boreholeId).find((interval) => value >= interval.depthFrom && value <= interval.depthTo) ?? null;
  }

  getSummary() {
    return {
      boreholeCount: this.boreholes.length,
      intervalCount: this.intervals.length,
      sampleCount: this.samples.length,
      logCount: this.logs.length
    };
  }
}
