import { GeologicalBodyDataset } from '../GeologicalBodyDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';

export function materializeGeologicalBody({ contract, adaptorResults, roleMapping, sources, representationProfile = 'generic' }) {
  const source = adaptorResults.body || adaptorResults.geology || adaptorResults.model || firstAdaptorResult(adaptorResults);
  const geometrySource = adaptorResults.geometry || {};
  const unitsSource = adaptorResults.units || {};
  const surfacesSource = adaptorResults.surfaces || {};
  const blocksSource = adaptorResults.blocks || {};
  const attributesSource = adaptorResults.attributes || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const profile = representationProfile || source.representationProfile || geometrySource.representationProfile || 'generic';
  const rawUnits = mergeRows(source.units, source.raw?.units, source.raw?.geologicalUnits, rowsOf(unitsSource));
  const explicitBodies = mergeRows(source.bodies, source.raw?.bodies, source.raw?.geologicalBodies, rowsOf(adaptorResults.bodies));
  const rawBodies = explicitBodies.length ? explicitBodies : rawUnits;
  const rawSurfaces = mergeByIdentity(
    mergeRows(source.surfaces, source.raw?.surfaces, source.raw?.meshes, geometrySource.surfaces, rowsOf(surfacesSource)),
    ['surfaceId', 'surface_id', 'meshPartId', 'mesh_part_id', 'name']
  );
  const rawBlocks = mergeRows(source.blocks, source.rows, source.raw?.blocks, blocksSource.blocks, rowsOf(blocksSource));
  const attributes = mergeRows(source.attributes, source.raw?.attributes, attributesSource.elements, attributesSource.attributes, rowsOf(attributesSource));
  const relations = mergeRows(source.relations, source.raw?.relations, rowsOf(relationsSource), relationsSource.relations);

  const units = rawUnits.map((row, index) => ({
    ...row,
    geologicalUnitId:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitId', 'id'), 'units')) ??
      row.unit_id ??
      row.unitId ??
      row.id ??
      `GU_${index + 1}`,
    geologicalUnitName:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitName', 'name'), 'units')) ??
      row.unit_name ??
      row.unitName ??
      row.name ??
      `Unit ${index + 1}`,
    geologicalUnitType:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitType', 'type'), 'units')) ?? row.unit_type ?? row.unitType ?? row.type ?? 'unknown'
  }));
  const bodies = rawBodies.map((row, index) => ({
    ...row,
    bodyId:
      getPathValue(row, relativePath(rolePath(mapping, 'bodyId', 'bodyId'), 'bodies')) ??
      row.body_id ??
      row.bodyId ??
      row.id ??
      row.geologicalUnitId ??
      row.unit_id ??
      `GB_${index + 1}`,
    bodyName:
      getPathValue(row, relativePath(rolePath(mapping, 'bodyName', 'bodyName'), 'bodies')) ??
      row.body_name ??
      row.unit_name ??
      row.name ??
      row.geologicalUnitName ??
      `Body ${index + 1}`,
    geologicalUnitId:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitId', 'geologicalUnitId'), 'bodies')) ??
      row.unit_id ??
      row.unitId ??
      row.geologicalUnitId ??
      null,
    geologicalUnitType:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitType', 'type'), 'bodies')) ?? row.unit_type ?? row.body_type ?? row.type ?? 'unknown',
    roofSurface: getPathValue(row, relativePath(rolePath(mapping, 'roofSurface', 'roofSurface'), 'bodies')) ?? row.roofSurfaceId ?? row.roof_surface_id ?? null,
    floorSurface: getPathValue(row, relativePath(rolePath(mapping, 'floorSurface', 'floorSurface'), 'bodies')) ?? row.floorSurfaceId ?? row.floor_surface_id ?? null
  }));
  const surfaces = rawSurfaces.map((row, index) => ({
    ...row,
    surfaceId:
      getPathValue(row, relativePath(rolePath(mapping, 'surfaceId', 'surfaceId'), 'surfaces')) ??
      row.surface_id ??
      row.id ??
      row.meshPartId ??
      row.mesh_part_id ??
      `SURF_${index + 1}`,
    surfaceType: getPathValue(row, relativePath(rolePath(mapping, 'surfaceType', 'surfaceType'), 'surfaces')) ?? row.surface_type ?? row.type ?? 'surface',
    layerOrder: getPathValue(row, relativePath(rolePath(mapping, 'layerOrder', 'layerOrder'), 'surfaces')) ?? row.layer_order ?? row.order ?? null,
    meshPartId: getPathValue(row, relativePath(rolePath(mapping, 'meshPartId', 'meshPartId'), 'surfaces')) ?? row.mesh_part_id ?? row.name ?? null,
    bodyId: row.body_id ?? row.bodyId ?? null,
    geologicalUnitId:
      getPathValue(row, relativePath(rolePath(mapping, 'geologicalUnitId', 'geologicalUnitId'), 'surfaces')) ?? row.unit_id ?? row.unitId ?? null,
    horizonElevation:
      getPathValue(row, relativePath(rolePath(mapping, 'horizonElevation', 'elevation'), 'surfaces')) ?? row.horizonElevation ?? null
  }));
  const blocks = rawBlocks.map((row, index) => ({
    ...row,
    blockId:
      getPathValue(row, relativePath(rolePath(mapping, 'blockId', 'blockId'), 'blocks')) ??
      row.block_id ??
      row.id ??
      `BLOCK_${index + 1}`,
    bodyId:
      getPathValue(row, relativePath(rolePath(mapping, 'bodyId', 'bodyId'), 'blocks')) ??
      getPathValue(row, relativePath(rolePath(mapping, 'orebodyId', 'orebodyId'), 'blocks')) ??
      row.orebody_id ??
      null,
    centroidX: getPathValue(row, relativePath(rolePath(mapping, 'centroidX', 'x'), 'blocks')),
    centroidY: getPathValue(row, relativePath(rolePath(mapping, 'centroidY', 'y'), 'blocks')),
    centroidZ: getPathValue(row, relativePath(rolePath(mapping, 'centroidZ', 'z'), 'blocks')),
    blockSizeX: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeX', 'dx'), 'blocks')),
    blockSizeY: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeY', 'dy'), 'blocks')),
    blockSizeZ: getPathValue(row, relativePath(rolePath(mapping, 'blockSizeZ', 'dz'), 'blocks')),
    lithology: getPathValue(row, relativePath(rolePath(mapping, 'lithology', 'lithology'), 'blocks')) ?? row.oreType,
    grade: getPathValue(row, relativePath(rolePath(mapping, 'grade', 'grade'), 'blocks')),
    density: getPathValue(row, relativePath(rolePath(mapping, 'density', 'density'), 'blocks'))
  }));

  const templates = {
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Geological body registry',
      role: 'geologicalIdentity',
      data: { units, bodies, surfaces, blocks: blocks.map((block) => ({ blockId: block.blockId, bodyId: block.bodyId })) },
      roleMapping: fieldRoleMapping(mapping, ['bodyId', 'bodyName', 'geologicalUnitId', 'geologicalUnitName', 'geologicalUnitType', 'surfaceId', 'blockId']),
      metadata: { representationProfile: profile }
    }),
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Geological body geometry',
      role: 'geologicalSpatialSupport',
      data: {
        form: profile === 'volumetric-block' ? 'BlockModel' : profile === 'layered-surface' ? 'SurfaceMesh / LayerInterface' : 'Hybrid',
        surfaces,
        blocks,
        meshParts: mergeRows(source.meshParts, geometrySource.meshParts),
        objText: geometrySource.objText ?? geometrySource.raw?.text ?? '',
        modelPath: sources.geometry?.path ?? geometrySource.source?.path ?? ''
      },
      roleMapping: fieldRoleMapping(mapping, ['geometrySupport', 'surfaceId', 'meshPartId', 'blockId', 'centroidX', 'centroidY', 'centroidZ']),
      metadata: { representationProfile: profile }
    }),
    field: createTemplate('Field', {
      id: 'field',
      label: 'Geological body attributes',
      role: 'geologicalAttributeField',
      data: { attributes, blocks },
      roleMapping: fieldRoleMapping(mapping, ['attributeField', 'thickness', 'grade', 'density', 'lithology', 'confidence', 'uncertainty']),
      metadata: { support: profile === 'volumetric-block' ? 'blocks' : 'surfaces / units' }
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Geological body relations',
      role: 'geologicalObjectRelation',
      data: { rows: relations, bodies, surfaces, blocks },
      roleMapping: fieldRoleMapping(mapping, ['relationToRoadway', 'relationToBorehole', 'roofSurface', 'floorSurface']),
      metadata: { relation: 'geological objects can reference roadway, borehole, surface, and body objects' }
    })
  };

  const report = makeReport();
  if (!units.length && !bodies.length && !surfaces.length && !blocks.length) {
    report.errors.push('Geological body dataset has no units, bodies, surfaces, or blocks.');
  }
  validateUnique(units.map((unit) => unit.geologicalUnitId).filter(Boolean), 'Geological unit ids', report);
  validateUnique(bodies.map((body) => body.bodyId).filter(Boolean), 'Geological body ids', report);
  validateUnique(surfaces.map((surface) => surface.surfaceId).filter(Boolean), 'Geological surface ids', report);
  validateUnique(blocks.map((block) => block.blockId).filter(Boolean), 'Geological block ids', report);
  if (!surfaces.length && !blocks.length) report.warnings.push('Geological body has no explicit renderable geometry support.');
  report.summary = {
    representationProfile: profile,
    unitCount: units.length,
    bodyCount: bodies.length,
    surfaceCount: surfaces.length,
    blockCount: blocks.length,
    attributeCount: attributes.length
  };

  return new GeologicalBodyDataset({
    representationProfile: profile,
    units,
    bodies,
    surfaces,
    blocks,
    attributes,
    relations,
    geometrySupport: {
      profile,
      surfaces,
      blocks,
      meshParts: mergeRows(source.meshParts, geometrySource.meshParts),
      objText: geometrySource.objText ?? geometrySource.raw?.text ?? '',
      modelPath: sources.geometry?.path ?? geometrySource.source?.path ?? ''
    },
    source: {
      bodyPath: sources.body?.path || sources.geology?.path || sources.model?.path,
      geometryPath: sources.geometry?.path,
      unitsPath: sources.units?.path,
      surfacesPath: sources.surfaces?.path,
      relationsPath: sources.relations?.path
    },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults
  });
}
