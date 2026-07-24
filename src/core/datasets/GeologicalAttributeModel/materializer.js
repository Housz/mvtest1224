import { GeologicalAttributeModelDataset } from '../GeologicalAttributeModelDataset.js';
import { GeometryTemplate, GraphTemplate, RegistryTemplate, StateTemplate, RelationTemplate, createTemplate } from '../../semantics/DataTemplates.js';
import { isFiniteNumber, toPoint, getPathValue, relativePath, rolePath, completeRoleMapping, makeReport, finalizeReport, validateUnique, firstAdaptorResult, rowsOf, arrayOf, mergeRows, mergeByIdentity, valueFromAnyPath, fieldRoleMapping, isGeologicalAttributeValueColumn } from '../shared/MaterializerUtils.js';
import { nowMs, yieldToMainThread } from '../../runtime/CooperativeTaskScheduler.js';

export async function materializeGeologicalAttributeModel({ contract, adaptorResults, roleMapping, sources, representationProfile = 'generic' }) {
  const source = adaptorResults.model || adaptorResults.attributes || firstAdaptorResult(adaptorResults);
  const gridSource = adaptorResults.grid || {};
  const binarySource = adaptorResults.binary || {};
  const schemaSource = adaptorResults.schema || {};
  const previewSource = adaptorResults.preview || {};
  const elementSource = adaptorResults.elements || adaptorResults.attributes || {};
  const blockSource = adaptorResults.blocks || {};
  const geometrySource = adaptorResults.geometry || {};
  const relationsSource = adaptorResults.relations || {};
  const mapping = completeRoleMapping(contract, adaptorResults, roleMapping);
  const profile = representationProfile || source.representationProfile || gridSource.representationProfile || 'generic';
  const grid = gridSource.grid || source.grid || source.raw?.grid || null;
  const binaryBuffer = binarySource.arrayBuffer || null;
  const sourceElementRows = source === elementSource || source === blockSource || source === previewSource
    ? []
    : mergeRows(source.elements, source.blocks, source.rows, source.raw?.elements);
  const rawElements = mergeRows(
    sourceElementRows,
    elementSource.elements || elementSource.blocks || rowsOf(elementSource),
    blockSource.blocks || blockSource.elements || rowsOf(blockSource),
    previewSource.elements || previewSource.blocks || rowsOf(previewSource)
  );
  const rawAttributes = mergeRows(source.attributes, source.raw?.attributes, gridSource.attributes, rowsOf(schemaSource));
  const relations = mergeRows(source.relations, source.raw?.relations, rowsOf(relationsSource), relationsSource.relations);
  const elements = [];
  let elementSliceStartedAt = nowMs();
  for (let index = 0; index < rawElements.length; index += 1) {
    const row = rawElements[index];
    const blockId = getPathValue(row, relativePath(rolePath(mapping, 'blockId', 'blockId'), 'elements')) ?? row.block_id ?? row.blockId ?? row.id;
    const seamId = getPathValue(row, relativePath(rolePath(mapping, 'seamId', 'seamId'), 'elements')) ?? row.seam_id;
    const rawElementId =
      getPathValue(row, relativePath(rolePath(mapping, 'supportElementId', 'supportElementId'), 'elements')) ??
      row.element_id ??
      row.elementId ??
      blockId ??
      `GA_${index + 1}`;
    const elementId = profile === 'coal-seam-attribute' && seamId && rawElementId
      ? `${seamId}_${rawElementId}`
      : rawElementId;
    const centroidX = getPathValue(row, relativePath(rolePath(mapping, 'centroidX', 'x'), 'elements'));
    const centroidY = getPathValue(row, relativePath(rolePath(mapping, 'centroidY', 'y'), 'elements'));
    const centroidZ = getPathValue(row, relativePath(rolePath(mapping, 'centroidZ', 'z'), 'elements'));
    const blockSizeX = getPathValue(row, relativePath(rolePath(mapping, 'blockSizeX', 'dx'), 'elements'));
    const blockSizeY = getPathValue(row, relativePath(rolePath(mapping, 'blockSizeY', 'dy'), 'elements'));
    const blockSizeZ = getPathValue(row, relativePath(rolePath(mapping, 'blockSizeZ', 'dz'), 'elements'));
    elements.push({
      ...row,
      id: String(elementId),
      elementId: String(elementId),
      blockId: blockId == null ? null : String(blockId),
      modelId: getPathValue(row, relativePath(rolePath(mapping, 'modelId', 'modelId'), 'elements')) ?? row.model_id ?? null,
      centroidX,
      centroidY,
      centroidZ,
      centroid: row.centroid ?? {
        x: Number(centroidX ?? row.x ?? row.X ?? row.gridX ?? 0),
        y: Number(centroidY ?? row.y ?? row.Y ?? row.gridY ?? 0),
        z: Number(centroidZ ?? row.z ?? row.Z ?? row.elevation ?? 0)
      },
      blockSizeX,
      blockSizeY,
      blockSizeZ,
      size: row.size ?? {
        x: Number(blockSizeX ?? row.dx ?? row.size_x ?? 0),
        y: Number(blockSizeY ?? row.dy ?? row.size_y ?? 0),
        z: Number(blockSizeZ ?? row.dz ?? row.size_z ?? 0)
      },
      attributeName: getPathValue(row, relativePath(rolePath(mapping, 'attributeName', 'attributeName'), 'elements')) ?? row.name,
      attributeValue: getPathValue(row, relativePath(rolePath(mapping, 'attributeValue', 'attributeValue'), 'elements')) ?? row.value,
      grade: getPathValue(row, relativePath(rolePath(mapping, 'grade', 'grade'), 'elements')),
      density: getPathValue(row, relativePath(rolePath(mapping, 'density', 'density'), 'elements')),
      tonnage: getPathValue(row, relativePath(rolePath(mapping, 'tonnage', 'tonnage'), 'elements')),
      oreType: getPathValue(row, relativePath(rolePath(mapping, 'oreType', 'oreType'), 'elements')) ?? row.ore_type,
      resourceCategory: getPathValue(row, relativePath(rolePath(mapping, 'resourceCategory', 'resourceCategory'), 'elements')) ?? row.resource_category,
      thickness: getPathValue(row, relativePath(rolePath(mapping, 'thickness', 'thickness'), 'elements')),
      riskValue: getPathValue(row, relativePath(rolePath(mapping, 'riskValue', 'riskValue'), 'elements')),
      uncertainty: getPathValue(row, relativePath(rolePath(mapping, 'uncertainty', 'uncertainty'), 'elements')),
      seamId,
      surfaceId: getPathValue(row, relativePath(rolePath(mapping, 'surfaceId', 'surfaceId'), 'elements')) ?? row.surface_id,
      calorificValue: getPathValue(row, relativePath(rolePath(mapping, 'calorificValue', 'calorificValue'), 'elements')) ?? row.calorific_value,
      gasContent: getPathValue(row, relativePath(rolePath(mapping, 'gasContent', 'gasContent'), 'elements')) ?? row.gas_content,
      waterContent: getPathValue(row, relativePath(rolePath(mapping, 'waterContent', 'waterContent'), 'elements')) ?? row.water_content
    });
    if ((index + 1) % 512 === 0 && nowMs() - elementSliceStartedAt >= 8) {
      await yieldToMainThread();
      elementSliceStartedAt = nowMs();
    }
  }
  const attributes = rawAttributes.length ? rawAttributes.map((attribute) => ({
    ...attribute,
    attributeName: attribute.attributeName ?? attribute.attribute_name ?? attribute.key ?? attribute.name,
    valueType: attribute.valueType ?? attribute.value_type ?? attribute.dtype ?? attribute.type,
    unit: attribute.unit ?? '',
    nodata: attribute.nodata ?? attribute.noData
  })) : [];
  const blocks = elements.filter((element) => element.blockId || profile === 'resource-block');
  const binaryAttributes = {};
  if (binaryBuffer && grid && attributes.length) {
    attributes.forEach((attribute, index) => {
      const key = attribute.key ?? attribute.attributeName ?? attribute.name ?? `attribute_${index + 1}`;
      const dtype = String(attribute.dtype ?? attribute.valueType ?? '').toLowerCase();
      const offset = Number(attribute.offset ?? 0);
      const length = Number(attribute.length ?? grid.totalVoxels ?? 0);
      if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0 || attribute.offset == null) return;
      try {
        if (dtype.includes('uint8')) binaryAttributes[key] = new Uint8Array(binaryBuffer, offset, length);
        else if (dtype.includes('int16')) binaryAttributes[key] = new Int16Array(binaryBuffer, offset, length);
        else if (dtype.includes('uint16')) binaryAttributes[key] = new Uint16Array(binaryBuffer, offset, length);
        else if (dtype.includes('int32')) binaryAttributes[key] = new Int32Array(binaryBuffer, offset, length);
        else if (dtype.includes('uint32')) binaryAttributes[key] = new Uint32Array(binaryBuffer, offset, length);
        else binaryAttributes[key] = new Float32Array(binaryBuffer, offset, length);
      } catch (error) {
        // Keep semanticization resilient; validation below will still expose missing arrays.
      }
    });
  }

  const templates = {
    geometry: new GeometryTemplate({
      id: 'geometry',
      label: 'Geological attribute geometry support',
      role: 'attributeSpatialSupport',
      data: {
        form: profile === 'resource-block' ? 'BlockModel' : profile === 'coal-seam-attribute' ? 'SurfaceGrid' : 'GenericSpatialTable',
        elements,
        blocks,
        grid,
        meshParts: geometrySource.meshParts || []
      },
      roleMapping: fieldRoleMapping(mapping, ['spatialSupport', 'supportElementId', 'blockId', 'centroidX', 'centroidY', 'centroidZ', 'gridX', 'gridY']),
      metadata: { representationProfile: profile }
    }),
    field: createTemplate('Field', {
      id: 'field',
      label: 'Geological attribute field',
      role: 'spatialGeologicalField',
      data: { elements, attributes, grid, binaryAttributes: Object.keys(binaryAttributes) },
      roleMapping: fieldRoleMapping(mapping, [
        'attributeName',
        'attributeValue',
        'valueType',
        'unit',
        'grade',
        'density',
        'tonnage',
        'thickness',
        'ash',
        'sulfur',
        'calorificValue',
        'gasContent',
        'waterContent',
        'riskValue',
        'riskType',
        'probability',
        'uncertainty'
      ]),
      metadata: { support: 'geological geometry support' }
    }),
    registry: new RegistryTemplate({
      id: 'registry',
      label: 'Geological attribute element registry',
      role: 'attributeElementIdentity',
      data: { modelId: sources.model?.path || sources.grid?.path || profile, elements, grid },
      roleMapping: fieldRoleMapping(mapping, ['modelId', 'supportElementId', 'blockId', 'geologicalUnitId', 'orebodyId', 'domainId', 'seamId']),
      metadata: { keyRole: 'supportElementId / blockId' }
    }),
    relation: new RelationTemplate({
      id: 'relation',
      label: 'Geological attribute relations',
      role: 'attributeModelRelation',
      data: { rows: relations, elements },
      roleMapping: fieldRoleMapping(mapping, ['geologicalUnitId', 'orebodyId', 'domainId', 'surfaceId']),
      metadata: { relation: 'attribute model elements can reference bodies, domains, surfaces, roadway, or boreholes' }
    })
  };

  const report = makeReport();
  if (!elements.length && !grid) report.errors.push('Geological attribute model has no spatial elements or grid support.');
  const seenElementIds = new Set();
  elements.forEach((element) => {
    const value = element.elementId;
    if (value == null || value === '') report.errors.push('Geological attribute element ids contains an empty id.');
    else if (seenElementIds.has(value)) report.errors.push(`Geological attribute element ids contains duplicate id: ${value}`);
    seenElementIds.add(value);
  });
  blocks.forEach((block) => {
    ['blockSizeX', 'blockSizeY', 'blockSizeZ'].forEach((key) => {
      if (block[key] != null && block[key] !== '' && Number(block[key]) <= 0) report.errors.push(`Block ${block.blockId || block.elementId} has invalid ${key}.`);
    });
  });
  const attributeNames = new Set();
  const detectionCount = Math.min(elements.length, 1024);
  const detectionElements = [];
  for (let index = 0; index < detectionCount; index += 1) {
    const sourceIndex = detectionCount <= 1
      ? 0
      : Math.floor(index * (elements.length - 1) / (detectionCount - 1));
    detectionElements.push(elements[sourceIndex]);
  }
  detectionElements.forEach((element) => {
    ['grade', 'density', 'tonnage', 'thickness', 'ash', 'sulfur', 'calorificValue', 'gasContent', 'waterContent', 'riskValue', 'uncertainty'].forEach((key) => {
      if (element[key] != null && element[key] !== '') attributeNames.add(key);
    });
    Object.entries(element).forEach(([key, value]) => {
      if (isGeologicalAttributeValueColumn(key, value)) attributeNames.add(key);
    });
    if (element.attributeName) attributeNames.add(element.attributeName);
  });
  if (!attributeNames.size && !attributes.length) report.warnings.push('Geological attribute model has no detected attribute values.');
  attributes.forEach((attribute) => {
    const name = attribute.attributeName ?? attribute.key ?? attribute.name;
    if (name) attributeNames.add(name);
  });
  report.summary = {
    representationProfile: profile,
    elementCount: elements.length,
    blockCount: blocks.length,
    gridSize: grid ? `${grid.nx || grid.width} x ${grid.ny || grid.height} x ${grid.nz || grid.depth}` : null,
    attributeCount: attributeNames.size || attributes.length,
    attributes: [...attributeNames]
  };

  return new GeologicalAttributeModelDataset({
    representationProfile: profile,
    modelId: sources.model?.path || sources.grid?.path || profile,
    elements,
    blocks,
    attributes,
    relations,
    grid,
    binaryAttributes,
    source: {
      modelPath: sources.model?.path || sources.attributes?.path || sources.elements?.path,
      gridPath: sources.grid?.path,
      binaryPath: sources.binary?.path,
      schemaPath: sources.schema?.path,
      geometryPath: sources.geometry?.path,
      blocksPath: sources.blocks?.path,
      relationsPath: sources.relations?.path
    },
    contract,
    templates,
    roleMapping: mapping,
    validation: finalizeReport(report, templates),
    adaptorResults,
    normalizedElements: true,
    attributeNames: [...attributeNames]
  });
}
