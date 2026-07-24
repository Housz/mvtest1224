import { SensorRegistryDataset } from '../SensorRegistryDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeSensorRegistry({ contract, adaptorResults, roleMapping, sources }) {
  const table = adaptorResults.registry || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rows = table.rows || [];
  const sensors = rows.map((row, index) => {
    const id = getPathValue(row, rolePath(mapping, 'sensorIdentity', 'sensorID')) ?? `S${index + 1}`;
    const anchor = getPathValue(row, rolePath(mapping, 'roadwayAnchor', 'roadwayID'));
    const sensorType = getPathValue(row, rolePath(mapping, 'sensorType', 'type')) ?? 'temperature';
    const ratio = getPathValue(row, rolePath(mapping, 'ratio', 'ratio'));
    const anchorText = anchor == null ? '' : String(anchor);
    return {
      ...row,
      id: String(id),
      sensorID: String(id),
      type: sensorType,
      x: Number(getPathValue(row, rolePath(mapping, 'positionX', 'x'))),
      y: Number(getPathValue(row, rolePath(mapping, 'positionY', 'y'))),
      z: Number(getPathValue(row, rolePath(mapping, 'positionZ', 'z'))),
      roadwayID: anchorText || null,
      edgeId: anchorText.startsWith('Edge') ? anchorText : null,
      nodeId: anchorText.startsWith('Node') ? anchorText : null,
      parentType: anchorText.startsWith('Node') ? 'Node' : 'Connection',
      ratio: ratio === '' || ratio == null ? null : Number(ratio),
      idx: index
    };
  });

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Sensor registry',
      role: 'entityIdentity',
      data: { entities: sensors },
      roleMapping: {
        sensorIdentity: mapping.sensorIdentity,
        sensorType: mapping.sensorType
      },
      metadata: { keyRole: 'sensorIdentity' }
    }),
    pointGeometry: new GeometryTemplate({
      id: 'pointGeometry',
      label: 'Sensor point geometry',
      role: 'sensorPosition',
      data: {
        form: 'PointSet',
        points: sensors.map((sensor) => ({ id: sensor.sensorID, x: sensor.x, y: sensor.y, z: sensor.z }))
      },
      roleMapping: {
        positionX: mapping.positionX,
        positionY: mapping.positionY,
        positionZ: mapping.positionZ
      },
      metadata: { form: 'PointSet' }
    }),
    mountedOnRoadway: new RelationTemplate({
      id: 'mountedOnRoadway',
      label: 'Mounted on roadway',
      role: 'roadwayMountRelation',
      data: {
        source: 'registry.sensorIdentity',
        target: 'Roadway.graph.edgeId / nodeId',
        anchors: sensors.map((sensor) => ({
          sensorID: sensor.sensorID,
          edgeId: sensor.edgeId,
          nodeId: sensor.nodeId,
          ratio: sensor.ratio
        }))
      },
      roleMapping: {
        roadwayAnchor: mapping.roadwayAnchor,
        ratio: mapping.ratio
      },
      metadata: { relation: 'sensors are mounted onto roadway graph entities' }
    })
  };

  const report = makeReport();
  validateUnique(sensors.map((sensor) => sensor.sensorID), 'Sensor ids', report);
  sensors.forEach((sensor) => {
    if (!isFiniteNumber(sensor.x) || !isFiniteNumber(sensor.y) || !isFiniteNumber(sensor.z)) {
      report.errors.push(`Sensor ${sensor.sensorID} has invalid position.`);
    }
    if (!sensor.edgeId && !sensor.nodeId) report.warnings.push(`Sensor ${sensor.sensorID} has no roadway anchor.`);
  });
  report.summary = {
    sensorCount: sensors.length,
    anchoredSensorCount: sensors.filter((sensor) => sensor.edgeId || sensor.nodeId).length
  };

  return new SensorRegistryDataset({
    sensors,
    source: { registryPath: sources.registry?.path },
    registryPath: sources.registry?.path,
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
