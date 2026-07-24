import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const GeologicalAttributeModelContract = defineSemanticContract({
    id: 'GeologicalAttributeModelContract',
    class: 'GeologicalAttributeModel',
    taxonomyClass: 'Geology & Resource Datasets',
    label: 'Geological Attribute Model',
    description: 'Spatial geological attribute fields including resource block models, seam attributes, and risk or uncertainty models.',
    requiredTemplates: ['Geometry', 'Field'],
    roles: [
      role('modelId', 'Model ID', 'Attribute model identity.', false, 'string', 'modelId', ['modelId', 'model_id']),
      role('attributeName', 'Attribute Name', 'Name of a model attribute.', false, 'string', 'attributeName', [
        'attributeName',
        'elements.attributeName',
        'name'
      ]),
      role('attributeValue', 'Attribute Value', 'Value of a model attribute.', false, 'number', 'attributeValue', [
        'attributeValue',
        'elements.attributeValue',
        'value'
      ]),
      role('valueType', 'Value Type', 'Attribute value type.', false, 'string', 'valueType', ['valueType', 'value_type']),
      role('unit', 'Unit', 'Physical unit.', false, 'string', 'unit', ['unit', 'units']),
      role('spatialSupport', 'Spatial Support', 'Spatial support type for the field.', false, 'string', 'spatialSupport', [
        'spatialSupport',
        'support'
      ]),
      role('supportElementId', 'Support Element ID', 'Spatial support element identity.', false, 'string', 'supportElementId', [
        'supportElementId',
        'elementId',
        'blockId'
      ]),
      role('spatialReference', 'Spatial Reference', 'Coordinate reference or spatial frame.', false, 'string', 'spatialReference', [
        'spatialReference'
      ]),
      role('geologicalUnitId', 'Geological Unit ID', 'Related geological unit identity.', false, 'string', 'geologicalUnitId', [
        'geologicalUnitId',
        'unitId'
      ]),
      role('uncertainty', 'Uncertainty', 'Uncertainty value.', false, 'number', 'uncertainty', [
        'uncertainty',
        'elements.uncertainty'
      ]),
      role('classification', 'Classification', 'Classification or category.', false, 'string', 'classification', [
        'classification',
        'category'
      ]),
      role('blockId', 'Block ID', 'Resource block identity.', false, 'string', 'blockId', [
        'blockId',
        'block_id',
        'elements.blockId'
      ]),
      role('centroidX', 'Centroid X', 'Element or block centroid X.', false, 'number', 'x', ['x', 'centroid_x', 'elements.x']),
      role('centroidY', 'Centroid Y', 'Element or block centroid Y.', false, 'number', 'y', ['y', 'centroid_y', 'elements.y']),
      role('centroidZ', 'Centroid Z', 'Element or block centroid Z.', false, 'number', 'z', ['z', 'centroid_z', 'elements.z']),
      role('blockSizeX', 'Block Size X', 'Block size in X.', false, 'number', 'dx', ['dx', 'size_x', 'block_size_x']),
      role('blockSizeY', 'Block Size Y', 'Block size in Y.', false, 'number', 'dy', ['dy', 'size_y', 'block_size_y']),
      role('blockSizeZ', 'Block Size Z', 'Block size in Z.', false, 'number', 'dz', ['dz', 'size_z', 'block_size_z']),
      role('grade', 'Grade', 'Ore or resource grade.', false, 'number', 'grade', ['grade', 'au', 'cu', 'fe']),
      role('density', 'Density', 'Density or specific gravity.', false, 'number', 'density', ['density', 'sg']),
      role('tonnage', 'Tonnage', 'Tonnage or resource quantity.', false, 'number', 'tonnage', ['tonnage']),
      role('oreType', 'Ore Type', 'Ore or lithology type.', false, 'string', 'oreType', ['oreType', 'ore_type', 'lithology']),
      role('resourceCategory', 'Resource Category', 'Resource classification category.', false, 'string', 'resourceCategory', [
        'resourceCategory',
        'category'
      ]),
      role('orebodyId', 'Orebody ID', 'Related orebody identity.', false, 'string', 'orebodyId', ['orebodyId', 'orebody_id']),
      role('domainId', 'Domain ID', 'Resource domain identity.', false, 'string', 'domainId', ['domainId', 'domain_id']),
      role('seamId', 'Seam ID', 'Coal seam identity.', false, 'string', 'seamId', ['seamId', 'seam_id']),
      role('surfaceId', 'Surface ID', 'Surface or grid support identity.', false, 'string', 'surfaceId', ['surfaceId', 'surface_id']),
      role('gridX', 'Grid X', 'Surface grid X coordinate.', false, 'number', 'gridX', ['gridX', 'grid_x']),
      role('gridY', 'Grid Y', 'Surface grid Y coordinate.', false, 'number', 'gridY', ['gridY', 'grid_y']),
      role('elevation', 'Elevation', 'Surface elevation.', false, 'number', 'elevation', ['elevation']),
      role('thickness', 'Thickness', 'Coal seam or layer thickness.', false, 'number', 'thickness', ['thickness']),
      role('ash', 'Ash', 'Coal ash value.', false, 'number', 'ash', ['ash']),
      role('sulfur', 'Sulfur', 'Coal sulfur value.', false, 'number', 'sulfur', ['sulfur']),
      role('calorificValue', 'Calorific Value', 'Coal calorific value.', false, 'number', 'calorificValue', [
        'calorificValue',
        'calorific_value'
      ]),
      role('gasContent', 'Gas Content', 'Coal seam gas content.', false, 'number', 'gasContent', ['gasContent', 'gas_content']),
      role('waterContent', 'Water Content', 'Coal seam water content.', false, 'number', 'waterContent', [
        'waterContent',
        'water_content'
      ]),
      role('riskValue', 'Risk Value', 'Risk or hazard probability value.', false, 'number', 'riskValue', [
        'riskValue',
        'risk_value'
      ]),
      role('riskType', 'Risk Type', 'Risk category or type.', false, 'string', 'riskType', ['riskType', 'risk_type']),
      role('probability', 'Probability', 'Probability value.', false, 'number', 'probability', ['probability']),
      role('threshold', 'Threshold', 'Threshold associated with classification.', false, 'number', 'threshold', ['threshold']),
      role('category', 'Category', 'Generic category.', false, 'string', 'category', ['category'])
    ],
    constraints: [
      'Attribute values must match valueType.',
      'Geometry support must be valid.',
      'Field support must match geometry support.',
      'Unit should be specified for physical quantities.',
      'Block ids should be unique if block registry is provided.',
      'Block sizes must be valid.',
      'Spatial reference should be recorded.',
      'Relation targets should reference valid geological units, roadway edges, or boreholes when provided.'
    ]
  });
