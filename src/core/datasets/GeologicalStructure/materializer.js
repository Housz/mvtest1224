import { GeologicalStructureDataset } from '../GeologicalStructureDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeGeologicalStructure({ contract, adaptorResults, roleMapping, sources }) {
  const source = adaptorResults.legacy || adaptorResults.structures || firstAdaptorResult(adaptorResults);
  const geometrySource = adaptorResults.geometry || {};
  const structureSource = adaptorResults.structures || {};
  const traceSource = adaptorResults.traces || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const rawStructures = mergeByIdentity(
    mergeRows(source.structures, source.raw?.structures, rowsOf(structureSource), geometrySource.surfaces),
    ['structureId', 'structure_id', 'meshPartId', 'mesh_part_id', 'surfaceId', 'name']
  );
  const relations = mergeRows(source.relations, source.raw?.relations, rowsOf(relationsSource), relationsSource.relations);
  const structures = rawStructures.map((row, index) => ({
    ...row,
    structureId:
      getPathValue(row, relativePath(rolePath(mapping, 'structureId', 'structureId'), 'structures')) ??
      row.structureId ??
      row.structure_id ??
      row.mesh_part_id ??
      row.meshPartId ??
      row.surfaceId ??
      row.id ??
      `GS_${index + 1}`,
    structureName:
      getPathValue(row, relativePath(rolePath(mapping, 'structureName', 'name'), 'structures')) ??
      row.structure_name ??
      row.structureName ??
      row.name ??
      `Structure ${index + 1}`,
    structureType:
      getPathValue(row, relativePath(rolePath(mapping, 'structureType', 'structureType'), 'structures')) ?? row.structure_type ?? row.type ?? 'unknown',
    geometry:
      getPathValue(row, relativePath(rolePath(mapping, 'geometrySupport', 'geometry'), 'structures')) ??
      (row.geometryPath ? { form: row.geometryFormat || 'mesh', path: row.geometryPath, meshPartId: row.meshPartId } : null) ??
      row.trace ??
      row.surface ??
      row.mesh ??
      null,
    strike: getPathValue(row, relativePath(rolePath(mapping, 'strike', 'strike'), 'structures')),
    dip: getPathValue(row, relativePath(rolePath(mapping, 'dip', 'dip'), 'structures')),
    throw: getPathValue(row, relativePath(rolePath(mapping, 'throw', 'throw'), 'structures')),
    width: getPathValue(row, relativePath(rolePath(mapping, 'width', 'width'), 'structures')),
    confidence: getPathValue(row, relativePath(rolePath(mapping, 'confidence', 'confidence'), 'structures')),
    waterConductivity: getPathValue(row, relativePath(rolePath(mapping, 'waterConductivity', 'waterConductivity'), 'structures')) ?? row.water_conductivity,
    activity: getPathValue(row, relativePath(rolePath(mapping, 'activity', 'activity'), 'structures')),
    riskLevel: getPathValue(row, relativePath(rolePath(mapping, 'riskLevel', 'riskLevel'), 'structures')) ?? row.risk_level
  }));

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Geological structure registry',
      role: 'structureIdentity',
      data: { entities: structures.map((structure) => ({ structureId: structure.structureId, structureName: structure.structureName, structureType: structure.structureType })) },
      roleMapping: fieldRoleMapping(mapping, ['structureId', 'structureName', 'structureType']),
      metadata: { keyRole: 'structureId' }
    }),
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Geological structure geometry',
      role: 'structureSpatialSupport',
      data: {
        form: 'Trace / Surface / Zone',
        structures,
        traces: rowsOf(traceSource),
        meshParts: geometrySource.meshParts || [],
        objText: geometrySource.objText ?? geometrySource.raw?.text ?? '',
        modelPath: sources.geometry?.path ?? geometrySource.source?.path ?? ''
      },
      roleMapping: fieldRoleMapping(mapping, ['geometrySupport']),
      metadata: { form: 'GeologicalStructureGeometry' }
    }),
    field: createTemplate('Field', {
      id: 'field',
      label: 'Geological structure attributes',
      role: 'structureAttributeField',
      data: { rows: structures },
      roleMapping: fieldRoleMapping(mapping, ['strike', 'dip', 'throw', 'width', 'confidence', 'waterConductivity', 'activity', 'riskLevel'])
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Geological structure relation',
      role: 'structureObjectRelation',
      data: { rows: relations },
      roleMapping: {},
      metadata: { relation: 'structures may cut bodies, intersect roadway, or be observed by boreholes' }
    })
  };

  const report = makeReport();
  if (!structures.length) report.errors.push('Geological structure dataset has no structures.');
  validateUnique(structures.map((structure) => structure.structureId).filter(Boolean), 'Geological structure ids', report);
  structures.forEach((structure) => {
    if (!structure.structureType) report.errors.push(`Structure ${structure.structureId} is missing structure type.`);
  });
  report.summary = {
    structureCount: structures.length,
    structureTypes: [...new Set(structures.map((structure) => structure.structureType).filter(Boolean))],
    relationCount: relations.length
  };

  return new GeologicalStructureDataset({
    structures,
    relations,
    geometrySupport: {
      form: 'Trace / Surface / Zone',
      structures,
      traces: rowsOf(traceSource),
      meshParts: geometrySource.meshParts || [],
      objText: geometrySource.objText ?? geometrySource.raw?.text ?? '',
      modelPath: sources.geometry?.path ?? geometrySource.source?.path ?? ''
    },
    source: { structurePath: sources.structures?.path || sources.legacy?.path, geometryPath: sources.geometry?.path, relationsPath: sources.relations?.path },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
