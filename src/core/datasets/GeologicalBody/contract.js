import { defineSemanticContract, role } from '../../semantics/SemanticContractDefinition.js';

export const GeologicalBodyContract = defineSemanticContract({
    id: 'GeologicalBodyContract',
    class: 'GeologicalBody',
    taxonomyClass: 'Geology & Resource Datasets',
    label: 'Geological Body',
    description:
      'A semantic geological body dataset for layered surfaces, volumetric blocks, geological units, and their relations.',
    requiredTemplates: ['Registry', 'Geometry', 'Relation'],
    roles: [
      role('bodyId', 'Body ID', 'Stable geological body identity.', false, 'string', 'bodies.bodyId', [
        'bodies.bodyId',
        'bodies.body_id',
        'bodies.id',
        'blocks.bodyId'
      ]),
      role('bodyName', 'Body Name', 'Human-readable body name.', false, 'string', 'bodies.bodyName', [
        'bodies.bodyName',
        'bodies.name'
      ]),
      role('geologicalUnitId', 'Geological Unit ID', 'Stable geological unit identity.', false, 'string', 'units.id', [
        'units.id',
        'units.unitId',
        'units.geologicalUnitId',
        'surfaces.geologicalUnitId'
      ]),
      role('geologicalUnitName', 'Geological Unit Name', 'Human-readable geological unit name.', false, 'string', 'units.name', [
        'units.name',
        'units.geologicalUnitName'
      ]),
      role('geologicalUnitType', 'Geological Unit Type', 'Unit type such as seam, stratum, orebody, or lithology.', false, 'string', 'units.type', [
        'units.type',
        'units.geologicalUnitType',
        'bodies.type'
      ]),
      role('geometrySupport', 'Geometry Support', 'Surface, mesh, solid, block, or hybrid support for the body.', false, 'string', 'surfaces.geometry', [
        'surfaces.geometry',
        'surfaces.meshPartId',
        'blocks.blockId'
      ]),
      role('attributeField', 'Attribute Field', 'Attribute field attached to the geological support.', false, 'string', 'attributes.attributeName', [
        'attributes.attributeName',
        'attributes.name',
        'blocks.grade'
      ]),
      role('spatialReference', 'Spatial Reference', 'Coordinate reference or spatial frame.', false, 'string', 'metadata.spatialReference', [
        'metadata.spatialReference',
        'spatialReference'
      ]),
      role('relationToRoadway', 'Relation to Roadway', 'Relation between geological object and roadway objects.', false, 'string', 'relations.roadwayEdgeId', [
        'relations.roadwayEdgeId',
        'relations.roadwayNodeId'
      ]),
      role('relationToBorehole', 'Relation to Borehole', 'Relation between geological body and boreholes.', false, 'string', 'relations.boreholeId', [
        'relations.boreholeId',
        'relations.hole_id'
      ]),
      role('confidence', 'Confidence', 'Confidence or reliability score.', false, 'number', 'attributes.confidence', [
        'confidence',
        'attributes.confidence',
        'blocks.confidence'
      ]),
      role('uncertainty', 'Uncertainty', 'Uncertainty value or category.', false, 'number', 'attributes.uncertainty', [
        'uncertainty',
        'attributes.uncertainty',
        'blocks.uncertainty'
      ]),
      role('surfaceId', 'Surface ID', 'Layered surface identity.', false, 'string', 'surfaces.surfaceId', [
        'surfaces.surfaceId',
        'surfaces.id'
      ]),
      role('surfaceType', 'Surface Type', 'Surface type such as roof, floor, horizon, or mesh surface.', false, 'string', 'surfaces.surfaceType', [
        'surfaces.surfaceType',
        'surfaces.type'
      ]),
      role('layerOrder', 'Layer Order', 'Order of a layer or horizon.', false, 'number', 'surfaces.layerOrder', [
        'surfaces.layerOrder',
        'surfaces.order'
      ]),
      role('roofSurface', 'Roof Surface', 'Roof surface id for paired layered body representation.', false, 'string', 'bodies.roofSurface', [
        'bodies.roofSurface',
        'bodies.roofSurfaceId'
      ]),
      role('floorSurface', 'Floor Surface', 'Floor surface id for paired layered body representation.', false, 'string', 'bodies.floorSurface', [
        'bodies.floorSurface',
        'bodies.floorSurfaceId'
      ]),
      role('meshPartId', 'Mesh Part ID', 'Mesh object or group identity.', false, 'string', 'surfaces.meshPartId', [
        'surfaces.meshPartId',
        'meshParts.name'
      ]),
      role('horizonElevation', 'Horizon Elevation', 'Representative elevation of a horizon or surface.', false, 'number', 'surfaces.elevation', [
        'surfaces.elevation',
        'surfaces.horizonElevation'
      ]),
      role('thickness', 'Thickness', 'Layer or seam thickness.', false, 'number', 'attributes.thickness', [
        'thickness',
        'attributes.thickness',
        'blocks.thickness'
      ]),
      role('blockId', 'Block ID', 'Volumetric block identity.', false, 'string', 'blocks.blockId', [
        'blocks.blockId',
        'blocks.block_id',
        'blocks.id'
      ]),
      role('centroidX', 'Centroid X', 'Block centroid X coordinate.', false, 'number', 'blocks.x', [
        'blocks.x',
        'blocks.centroid_x',
        'blocks.centroidX'
      ]),
      role('centroidY', 'Centroid Y', 'Block centroid Y coordinate.', false, 'number', 'blocks.y', [
        'blocks.y',
        'blocks.centroid_y',
        'blocks.centroidY'
      ]),
      role('centroidZ', 'Centroid Z', 'Block centroid Z coordinate.', false, 'number', 'blocks.z', [
        'blocks.z',
        'blocks.centroid_z',
        'blocks.centroidZ'
      ]),
      role('blockSizeX', 'Block Size X', 'Block size in X.', false, 'number', 'blocks.dx', [
        'blocks.dx',
        'blocks.size_x',
        'blocks.block_size_x'
      ]),
      role('blockSizeY', 'Block Size Y', 'Block size in Y.', false, 'number', 'blocks.dy', [
        'blocks.dy',
        'blocks.size_y',
        'blocks.block_size_y'
      ]),
      role('blockSizeZ', 'Block Size Z', 'Block size in Z.', false, 'number', 'blocks.dz', [
        'blocks.dz',
        'blocks.size_z',
        'blocks.block_size_z'
      ]),
      role('orebodyId', 'Orebody ID', 'Orebody or domain identity for a block.', false, 'string', 'blocks.orebodyId', [
        'blocks.orebodyId',
        'blocks.orebody_id',
        'blocks.domainId'
      ]),
      role('lithology', 'Lithology', 'Lithology or rock type.', false, 'string', 'blocks.lithology', [
        'blocks.lithology',
        'blocks.oreType',
        'blocks.ore_type'
      ]),
      role('grade', 'Grade', 'Grade or assay value.', false, 'number', 'blocks.grade', ['blocks.grade', 'grade']),
      role('density', 'Density', 'Density or specific gravity.', false, 'number', 'blocks.density', [
        'blocks.density',
        'blocks.sg'
      ])
    ],
    constraints: [
      'Geological unit ids should be stable if provided.',
      'Geometry support must exist.',
      'Spatial reference should be valid or recorded.',
      'Field support must match geometry support.',
      'Surface ids or block ids should be unique if provided.',
      'Relation targets should reference valid objects when relations are provided.'
    ]
  });
