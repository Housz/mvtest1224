import { BaseSemanticDataset } from '../semantics/BaseSemanticDataset.js';

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function normalizeSensor(rawSensor, index) {
  const id =
    rawSensor.sensor_id ??
    rawSensor.sensorId ??
    rawSensor.sensorID ??
    rawSensor.id ??
    rawSensor.ID ??
    rawSensor.name ??
    `S${index + 1}`;
  const x = toNumber(rawSensor.x ?? rawSensor.X ?? rawSensor.position_x ?? rawSensor.posX);
  const y = toNumber(rawSensor.y ?? rawSensor.Y ?? rawSensor.position_y ?? rawSensor.posY);
  const z = toNumber(rawSensor.z ?? rawSensor.Z ?? rawSensor.position_z ?? rawSensor.posZ);
  const edgeId =
    rawSensor.edge_id ??
    rawSensor.edgeId ??
    rawSensor.roadway_id ??
    rawSensor.roadwayId ??
    rawSensor.roadwayID ??
    rawSensor.parentId;
  const nodeId = rawSensor.node_id ?? rawSensor.nodeId;
  const parentType = rawSensor.parentType ?? (nodeId ? 'Node' : 'Connection');
  const parentIndex = rawSensor.parentIndex ?? rawSensor.edge_index ?? rawSensor.edgeIndex ?? rawSensor.node_index ?? rawSensor.nodeIndex;
  const ratio = rawSensor.ratio ?? rawSensor.path_ratio ?? rawSensor.position_ratio ?? rawSensor.t;

  return {
    ...rawSensor,
    id: String(id),
    sensorID: String(id),
    sensor_id: String(id),
    type: rawSensor.type ?? rawSensor.sensor_type ?? rawSensor.variable ?? 'temperature',
    x,
    y,
    z,
    position: { x, y, z },
    edgeId: edgeId != null ? String(edgeId) : null,
    nodeId: nodeId != null ? String(nodeId) : null,
    parentType,
    parentIndex: parentIndex != null && parentIndex !== '' ? Number(parentIndex) : parentIndex,
    ratio: ratio != null && ratio !== '' ? toNumber(ratio, null) : null
  };
}

export class SensorRegistryDataset extends BaseSemanticDataset {
  constructor({
    sensors = [],
    source = null,
    registryPath = source?.registryPath ?? null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    super({
      type: 'SensorRegistryDataset',
      semanticClass: contract?.class ?? 'SensorRegistry',
      taxonomyId: 'monitoring-sensing',
      contract,
      templates,
      roleMapping,
      validation,
      adaptorResults,
      source: source ?? { registryPath }
    });
    this.registryPath = registryPath;
    this.sensors = sensors.map(normalizeSensor);
    this.sensorMap = new Map(this.sensors.map((sensor) => [String(sensor.id), sensor]));
  }

  listSensors() {
    return this.sensors;
  }

  listSensorIDs() {
    return this.sensors.map((sensor) => sensor.id);
  }

  getSensor(sensorID) {
    return this.sensorMap.get(String(sensorID)) ?? null;
  }

  getSensorPosition(sensorID) {
    return this.getSensor(sensorID)?.position ?? null;
  }

  getRoadwayAnchor(sensorID) {
    const sensor = this.getSensor(sensorID);
    if (!sensor) return null;
    return {
      parentType: sensor.parentType,
      parentIndex: sensor.parentIndex,
      edgeId: sensor.edgeId,
      nodeId: sensor.nodeId,
      ratio: sensor.ratio
    };
  }

  [Symbol.iterator]() {
    return this.sensors[Symbol.iterator]();
  }
}
