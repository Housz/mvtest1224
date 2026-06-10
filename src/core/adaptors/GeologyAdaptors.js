import Papa from 'papaparse';
import { collectObjectPaths, extensionOf, fetchText, pickSuggestedRoleMapping } from './adaptorUtils.js';
import { appPath } from '../../utils/appPath.js';

async function readJsonSource(source, fallback = {}) {
  if (source?.data) return source.data;
  if (source?.text) return JSON.parse(source.text);
  if (source?.path) return JSON.parse(await fetchText(source.path));
  return fallback;
}

async function readArrayBufferSource(source) {
  if (source?.arrayBuffer instanceof ArrayBuffer) return source.arrayBuffer;
  if (source?.buffer instanceof ArrayBuffer) return source.buffer;
  if (source?.data instanceof ArrayBuffer) return source.data;
  if (source?.data?.buffer instanceof ArrayBuffer) return source.data.buffer;
  if (source?.path) {
    const response = await fetch(appPath(source.path));
    if (!response.ok) throw new Error(`Failed to fetch ${source.path}: ${response.status}`);
    return response.arrayBuffer();
  }
  return new ArrayBuffer(0);
}

async function readCsvSource(source) {
  if (!source?.text && !source?.path) return { rows: [], fields: [] };
  const text = source.text ?? (await fetchText(source.path));
  const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  const rows = parsed.data.filter((row) => Object.keys(row || {}).length > 0);
  return { rows, fields: parsed.meta.fields || Object.keys(rows[0] || {}) };
}

function addPathsFromSamples(samples, extras = []) {
  const paths = new Set();
  Object.entries(samples).forEach(([key, value]) => {
    collectObjectPaths({ [key]: value || {} }, '', paths);
  });
  extras.forEach((path) => paths.add(path));
  return [...paths].sort();
}

function csvPaths(fields = [], collection = '') {
  const prefixed = collection ? fields.map((field) => `${collection}.${field}`) : [];
  return [...new Set([...fields, ...prefixed])].sort();
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function jsonSummary(paths, rows = {}) {
  return {
    fieldCount: paths.length,
    ...rows
  };
}

const blockFieldHints = [
  'blockId',
  'block_id',
  'id',
  'x',
  'y',
  'z',
  'centroid_x',
  'centroid_y',
  'centroid_z',
  'dx',
  'dy',
  'dz',
  'size_x',
  'size_y',
  'size_z',
  'grade',
  'density',
  'sg',
  'ore_type',
  'oreType',
  'lithology',
  'category',
  'resourceCategory'
];

export class LayeredGeologyJsonAdaptor {
  constructor() {
    this.id = 'LayeredGeologyJsonAdaptor';
    this.label = 'Layered Geology JSON Adaptor';
    this.kind = 'Layered geology JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /geolog|seam|layer|strata|horizon|surface/i.test(path);
  }

  async load(source, contract) {
    const raw = await readJsonSource(source);
    const units = firstArray(raw.units, raw.geologicalUnits, raw.geological_units);
    const bodies = firstArray(raw.bodies, raw.geologicalBodies, raw.geological_bodies, raw.units);
    const surfaces = firstArray(raw.surfaces, raw.meshes, raw.horizons, raw.layers);
    const blocks = firstArray(raw.blocks, raw.blockModel, raw.block_model);
    const attributes = firstArray(raw.attributes, raw.fields, raw.properties);
    const relations = firstArray(raw.relations, raw.relationships);
    const paths = addPathsFromSamples(
      {
        units: units[0],
        bodies: bodies[0],
        surfaces: surfaces[0],
        blocks: blocks[0],
        attributes: attributes[0],
        relations: relations[0]
      },
      [
        'units.id',
        'units.name',
        'units.type',
        'bodies.bodyId',
        'surfaces.surfaceId',
        'surfaces.surfaceType',
        'surfaces.layerOrder',
        'surfaces.meshPartId',
        'blocks.blockId',
        'blocks.grade',
        'blocks.density'
      ]
    );
    return {
      source,
      kind: this.kind,
      raw,
      representationProfile: 'layered-surface',
      units,
      bodies,
      surfaces,
      blocks,
      attributes,
      relations,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: jsonSummary(paths, {
        unitCount: units.length,
        bodyCount: bodies.length,
        surfaceCount: surfaces.length,
        blockCount: blocks.length
      })
    };
  }
}

export class SurfaceMeshGeologyAdaptor {
  constructor() {
    this.id = 'SurfaceMeshGeologyAdaptor';
    this.label = 'Surface Mesh Geology Adaptor';
    this.kind = 'Geological surface mesh';
  }

  supports(source) {
    return ['obj', 'stl', 'gltf', 'glb'].includes(extensionOf(source?.path || source?.name || ''));
  }

  async load(source, contract) {
    const ext = extensionOf(source?.path || source?.name || '');
    const filename = (source?.name || source?.path || '').split(/[\\/]/).pop() || 'geological_surface';
    const text = ext === 'obj' || source?.text ? source?.text ?? (source?.path ? await fetchText(source.path) : '') : '';
    const meshParts = [];
    if (text) {
      String(text)
        .split(/\r?\n/)
        .forEach((line) => {
          const match = line.match(/^\s*[og]\s+(.+)$/);
          if (match) meshParts.push({ meshPartId: match[1].trim(), name: match[1].trim(), surfaceType: 'meshSurface' });
        });
    }
    if (!meshParts.length) {
      const baseName = filename.replace(/\.[^.]+$/, '');
      meshParts.push({ meshPartId: baseName, name: baseName, surfaceType: ext === 'stl' ? 'stlSurface' : 'meshSurface' });
    }
    const surfaces = meshParts.map((part, index) => ({
      surfaceId: part.meshPartId || `SURF_${index + 1}`,
      surfaceType: 'meshSurface',
      meshPartId: part.meshPartId,
      name: part.name,
      geometryPath: source?.path || source?.name || '',
      geometryFormat: ext
    }));
    const paths = ['surfaces.surfaceId', 'surfaces.surfaceType', 'surfaces.meshPartId', 'surfaces.name'];
    return {
      source,
      kind: this.kind,
      raw: { text, meshParts, geometryPath: source?.path || source?.name || '', geometryFormat: ext },
      representationProfile: 'layered-surface',
      surfaces,
      meshParts,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: { surfaceCount: surfaces.length, meshPartCount: meshParts.length }
    };
  }
}

export class ResourceBlockGridJsonAdaptor {
  constructor() {
    this.id = 'ResourceBlockGridJsonAdaptor';
    this.label = 'Resource Block Grid JSON Adaptor';
    this.kind = 'Resource block grid JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /resource_block_grid|model_meta|grid/i.test(path);
  }

  async load(source, contract) {
    const raw = await readJsonSource(source);
    const nx = raw.nx ?? raw.width ?? raw.grid?.nx ?? raw.grid?.width;
    const ny = raw.ny ?? raw.height ?? raw.grid?.ny ?? raw.grid?.height;
    const nz = raw.nz ?? raw.depth ?? raw.grid?.nz ?? raw.grid?.depth;
    const bounds = raw.bounds || {
      min: raw.origin || raw.min || [0, 0, 0],
      max:
        raw.max ||
        (raw.origin && raw.cellSize && nx && ny && nz
          ? [
              Number(raw.origin[0]) + Number(raw.cellSize[0] ?? raw.cellSize) * Number(nx),
              Number(raw.origin[1]) + Number(raw.cellSize[1] ?? raw.cellSize) * Number(ny),
              Number(raw.origin[2]) + Number(raw.cellSize[2] ?? raw.cellSize) * Number(nz)
            ]
          : null)
    };
    const grid = {
      nx: Number(nx || 0),
      ny: Number(ny || 0),
      nz: Number(nz || 0),
      width: Number(nx || 0),
      height: Number(ny || 0),
      depth: Number(nz || 0),
      totalVoxels: Number(raw.totalVoxels ?? raw.total_voxels ?? (nx || 0) * (ny || 0) * (nz || 0)),
      origin: raw.origin || bounds?.min || [0, 0, 0],
      cellSize: raw.cellSize || null,
      bounds,
      coordinateSystem: raw.coordinateSystem || raw.spatialReference || null,
      binaryFile: raw.binaryFile || raw.binary_file || 'resource_block_attributes.bin'
    };
    const attributes = firstArray(raw.attributes, raw.fields, raw.attributeSchema).map((attribute) => ({
      attributeName: attribute.attributeName ?? attribute.key ?? attribute.name,
      key: attribute.key ?? attribute.attributeName ?? attribute.name,
      label: attribute.label ?? attribute.name ?? attribute.attributeName,
      valueType: attribute.valueType ?? attribute.dtype ?? attribute.type,
      dtype: attribute.dtype ?? attribute.valueType ?? attribute.type,
      unit: attribute.unit ?? '',
      offset: attribute.offset,
      length: attribute.length,
      min: attribute.min,
      max: attribute.max,
      nodata: attribute.nodata ?? attribute.noData
    }));
    const paths = [
      'nx',
      'ny',
      'nz',
      'origin',
      'cellSize',
      'bounds.min',
      'bounds.max',
      'binaryFile',
      'attributes.attributeName',
      'attributes.dtype',
      'attributes.offset',
      'attributes.length'
    ];
    return {
      source,
      kind: this.kind,
      raw,
      representationProfile: 'resource-block',
      grid,
      attributes,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: {
        gridSize: `${grid.nx} x ${grid.ny} x ${grid.nz}`,
        totalVoxels: grid.totalVoxels,
        attributeCount: attributes.length,
        binaryFile: grid.binaryFile
      }
    };
  }
}

export class ResourceBlockAttributeBinaryAdaptor {
  constructor() {
    this.id = 'ResourceBlockAttributeBinaryAdaptor';
    this.label = 'Resource Block Attribute Binary Adaptor';
    this.kind = 'Resource block attribute binary';
  }

  supports(source) {
    return ['bin', 'raw'].includes(extensionOf(source?.path || source?.name || ''));
  }

  async load(source) {
    const buffer = await readArrayBufferSource(source);
    return {
      source,
      kind: this.kind,
      raw: { byteLength: buffer.byteLength },
      arrayBuffer: buffer,
      fields: [],
      paths: [],
      suggestedRoleMapping: {},
      summary: { byteLength: buffer.byteLength }
    };
  }
}

export class BoreholeTrajectoryJsonAdaptor {
  constructor() {
    this.id = 'BoreholeTrajectoryJsonAdaptor';
    this.label = 'Borehole Trajectory JSON Adaptor';
    this.kind = 'Borehole trajectory JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return ['json', 'csv'].includes(extensionOf(path)) && /trajectory|trajectories|borehole/i.test(path);
  }

  async load(source, contract) {
    const ext = extensionOf(source?.path || source?.name || '');
    let raw;
    let trajectories;
    if (ext === 'csv') {
      const { rows, fields } = await readCsvSource(source);
      const grouped = new Map();
      rows.forEach((row, index) => {
        const boreholeId = row.boreholeId ?? row.borehole_id ?? row.hole_id ?? row.id ?? `BH_${index + 1}`;
        if (!grouped.has(String(boreholeId))) grouped.set(String(boreholeId), []);
        grouped.get(String(boreholeId)).push({
          x: Number(row.x ?? row.X ?? row.collar_x ?? 0),
          y: Number(row.y ?? row.Y ?? row.collar_y ?? 0),
          z: Number(row.z ?? row.Z ?? row.collar_z ?? 0),
          depth: Number(row.depth ?? row.md ?? row.measured_depth ?? row.depth_to ?? 0),
          order: Number(row.vertex_order ?? row.vertexOrder ?? row.order ?? grouped.get(String(boreholeId)).length)
        });
      });
      trajectories = [...grouped.entries()].map(([boreholeId, points]) => ({
        boreholeId,
        points: points.sort((a, b) => a.order - b.order)
      }));
      raw = { rows, fields, trajectories };
    } else {
      raw = await readJsonSource(source);
      trajectories = Array.isArray(raw) ? raw : firstArray(raw.trajectories, raw.boreholeTrajectories, raw.data);
    }
    const boreholes = trajectories.map((trajectory, index) => ({
      boreholeId: trajectory.boreholeId ?? trajectory.borehole_id ?? trajectory.id ?? `BH_${index + 1}`,
      trajectory: trajectory.points ?? trajectory.trajectory ?? trajectory.track ?? []
    }));
    const paths = addPathsFromSamples({ trajectories: trajectories[0], points: boreholes[0]?.trajectory?.[0] }, [
      'trajectories.boreholeId',
      'trajectories.points.x',
      'trajectories.points.y',
      'trajectories.points.z',
      'trajectories.points.depth'
    ]);
    return {
      source,
      kind: this.kind,
      raw,
      trajectories,
      boreholes,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: { trajectoryCount: trajectories.length, pointCount: boreholes.reduce((sum, row) => sum + (row.trajectory?.length || 0), 0) }
    };
  }
}

export class VolumetricBlockModelJsonAdaptor {
  constructor() {
    this.id = 'VolumetricBlockModelJsonAdaptor';
    this.label = 'Volumetric Block Model JSON Adaptor';
    this.kind = 'Volumetric block model JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /block|resource|ore|volume|voxel/i.test(path);
  }

  async load(source, contract) {
    const raw = await readJsonSource(source);
    const blocks = firstArray(raw.blocks, raw.blockModel, raw.block_model, raw.elements, raw.rows, raw.data);
    const bodies = firstArray(raw.bodies, raw.orebodies, raw.domains);
    const attributes = firstArray(raw.attributes, raw.fields, raw.properties);
    const relations = firstArray(raw.relations, raw.relationships);
    const paths = addPathsFromSamples(
      { blocks: blocks[0], bodies: bodies[0], attributes: attributes[0], relations: relations[0] },
      blockFieldHints.map((field) => `blocks.${field}`)
    );
    return {
      source,
      kind: this.kind,
      raw,
      representationProfile: 'volumetric-block',
      blocks,
      bodies,
      attributes,
      relations,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: jsonSummary(paths, { blockCount: blocks.length, bodyCount: bodies.length })
    };
  }
}

export class BlockModelCsvAdaptor {
  constructor() {
    this.id = 'BlockModelCsvAdaptor';
    this.label = 'Block Model CSV Adaptor';
    this.kind = 'Block model CSV';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'csv' && /block|resource|ore|grade|model/i.test(path);
  }

  async load(source, contract) {
    const { rows, fields } = await readCsvSource(source);
    const paths = csvPaths(fields, 'blocks');
    blockFieldHints.forEach((field) => paths.push(field, `blocks.${field}`));
    const uniquePaths = [...new Set(paths)].sort();
    return {
      source,
      kind: this.kind,
      raw: { rows },
      representationProfile: 'resource-block',
      rows,
      blocks: rows,
      fields: uniquePaths,
      paths: uniquePaths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, uniquePaths),
      summary: { rowCount: rows.length, blockCount: rows.length, fieldCount: uniquePaths.length, fields }
    };
  }
}

export class BoreholeJsonAdaptor {
  constructor() {
    this.id = 'BoreholeJsonAdaptor';
    this.label = 'Borehole JSON Adaptor';
    this.kind = 'Borehole JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /borehole|drill|hole|sampling|assay/i.test(path);
  }

  async load(source, contract) {
    const raw = await readJsonSource(source);
    const boreholes = firstArray(raw.boreholes, raw.holes, raw.drillholes, raw.data);
    const intervals = firstArray(raw.intervals, raw.logs, raw.samples, raw.assays);
    const samples = firstArray(raw.samples, raw.assays);
    const logs = firstArray(raw.logs, raw.intervals);
    const paths = addPathsFromSamples(
      { boreholes: boreholes[0], intervals: intervals[0], samples: samples[0], logs: logs[0] },
      [
        'boreholes.boreholeId',
        'boreholes.hole_id',
        'boreholes.collar.x',
        'boreholes.collar.y',
        'boreholes.collar.z',
        'intervals.boreholeId',
        'intervals.depthFrom',
        'intervals.depthTo',
        'intervals.lithology',
        'intervals.grade'
      ]
    );
    return {
      source,
      kind: this.kind,
      raw,
      boreholes,
      intervals,
      samples,
      logs,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: jsonSummary(paths, {
        boreholeCount: boreholes.length,
        intervalCount: intervals.length,
        sampleCount: samples.length
      })
    };
  }
}

export class BoreholeCsvAdaptor {
  constructor() {
    this.id = 'BoreholeCsvAdaptor';
    this.label = 'Borehole CSV Adaptor';
    this.kind = 'Borehole CSV';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'csv' && /borehole|drill|hole|sampling|assay/i.test(path);
  }

  async load(source, contract) {
    const { rows, fields } = await readCsvSource(source);
    const paths = csvPaths(fields, 'intervals');
    [
      'borehole_id',
      'hole_id',
      'id',
      'x',
      'y',
      'z',
      'collar_x',
      'collar_y',
      'collar_z',
      'from',
      'depth_from',
      'from_depth',
      'to',
      'depth_to',
      'to_depth',
      'lithology',
      'rock_type',
      'grade',
      'assay',
      'value'
    ].forEach((field) => paths.push(field, `intervals.${field}`));
    const uniquePaths = [...new Set(paths)].sort();
    return {
      source,
      kind: this.kind,
      raw: { rows },
      rows,
      intervals: rows,
      fields: uniquePaths,
      paths: uniquePaths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, uniquePaths),
      summary: { rowCount: rows.length, intervalCount: rows.length, fieldCount: uniquePaths.length, fields }
    };
  }
}

export class GeologicalStructureJsonAdaptor {
  constructor() {
    this.id = 'GeologicalStructureJsonAdaptor';
    this.label = 'Geological Structure JSON Adaptor';
    this.kind = 'Geological structure JSON';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return extensionOf(path) === 'json' && /fault|fracture|fold|structure|broken/i.test(path);
  }

  async load(source, contract) {
    const raw = await readJsonSource(source);
    const structures = firstArray(raw.structures, raw.faults, raw.fractures, raw.folds, raw.zones, raw.data);
    const relations = firstArray(raw.relations, raw.relationships);
    const paths = addPathsFromSamples(
      { structures: structures[0], relations: relations[0] },
      [
        'structures.structureId',
        'structures.structureName',
        'structures.structureType',
        'structures.geometry',
        'structures.strike',
        'structures.dip',
        'structures.throw',
        'structures.width',
        'structures.riskLevel'
      ]
    );
    return {
      source,
      kind: this.kind,
      raw,
      structures,
      relations,
      fields: paths,
      paths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
      summary: jsonSummary(paths, { structureCount: structures.length })
    };
  }
}

export class GeologicalAttributeTableAdaptor {
  constructor() {
    this.id = 'GeologicalAttributeTableAdaptor';
    this.label = 'Geological Attribute Table Adaptor';
    this.kind = 'Geological attribute table';
  }

  supports(source) {
    const path = source?.path || source?.name || '';
    return ['csv', 'json'].includes(extensionOf(path)) && /attribute|risk|uncertainty|seam|coal|grid|model/i.test(path);
  }

  async load(source, contract) {
    const ext = extensionOf(source?.path || source?.name || '');
    if (ext === 'json') {
      const raw = await readJsonSource(source);
      const elements = firstArray(raw.elements, raw.rows, raw.blocks, raw.grid, raw.data);
      const attributes = firstArray(raw.attributes, raw.fields, raw.properties);
      const relations = firstArray(raw.relations, raw.relationships);
      const paths = addPathsFromSamples({ elements: elements[0], attributes: attributes[0], relations: relations[0] }, [
        'elements.elementId',
        'elements.blockId',
        'elements.attributeName',
        'elements.attributeValue',
        'elements.grade',
        'elements.thickness',
        'elements.riskValue',
        'elements.uncertainty'
      ]);
      return {
        source,
        kind: this.kind,
        raw,
        elements,
        blocks: elements,
        attributes,
        relations,
        fields: paths,
        paths,
        suggestedRoleMapping: pickSuggestedRoleMapping(contract, paths),
        summary: jsonSummary(paths, { elementCount: elements.length, attributeCount: attributes.length })
      };
    }
    const { rows, fields } = await readCsvSource(source);
    const paths = csvPaths(fields, 'elements');
    [
      'elementId',
      'supportElementId',
      'attributeName',
      'attributeValue',
      'grade',
      'thickness',
      'ash',
      'sulfur',
      'calorificValue',
      'gasContent',
      'waterContent',
      'riskValue',
      'probability',
      'uncertainty'
    ].forEach((field) => paths.push(field, `elements.${field}`));
    const uniquePaths = [...new Set(paths)].sort();
    return {
      source,
      kind: this.kind,
      raw: { rows },
      rows,
      elements: rows,
      blocks: rows,
      fields: uniquePaths,
      paths: uniquePaths,
      suggestedRoleMapping: pickSuggestedRoleMapping(contract, uniquePaths),
      summary: { rowCount: rows.length, elementCount: rows.length, fieldCount: uniquePaths.length, fields }
    };
  }
}
