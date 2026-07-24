export const isFiniteNumber = (value) => Number.isFinite(Number(value));
export const toPoint = (value = {}) => {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
};

export function getPathValue(object, path) {
  if (!path || object == null) return undefined;
  return String(path)
    .split('.')
    .reduce((current, key) => (current == null ? undefined : current[key]), object);
}

export function relativePath(path, collectionName) {
  const prefix = `${collectionName}.`;
  return String(path || '').startsWith(prefix) ? String(path).slice(prefix.length) : path;
}

export function rolePath(roleMapping, key, fallback = '') {
  return roleMapping?.[key] || fallback;
}

export function completeRoleMapping(contract, adaptorResults, userRoleMapping = {}) {
  const mapping = {};
  (contract?.roles || []).forEach((role) => {
    if (role.defaultPath) mapping[role.key] = role.defaultPath;
  });
  Object.values(adaptorResults || {}).forEach((result) => {
    Object.assign(mapping, result?.suggestedRoleMapping || {});
  });
  Object.entries(userRoleMapping || {}).forEach(([key, value]) => {
    if (value) mapping[key] = value;
  });
  return mapping;
}

export function makeReport() {
  return { valid: true, warnings: [], errors: [], summary: {} };
}

export function finalizeReport(report, templates = {}) {
  report.diagnostics = report.diagnostics || [];
  Object.entries(templates).forEach(([key, template]) => {
    const validation = template.validate();
    report.errors.push(...validation.errors);
    report.warnings.push(...validation.warnings);
    report.diagnostics.push(...(validation.diagnostics || []).map((diagnostic) => ({
      ...diagnostic,
      path: diagnostic.path ? `templates.${key}.${diagnostic.path}` : `templates.${key}`
    })));
  });
  report.errors = [...new Set(report.errors)];
  report.warnings = [...new Set(report.warnings)];
  report.valid = report.errors.length === 0;
  report.summary.templates = Object.values(templates).map((template) => template.summary());
  return report;
}

export function validateUnique(values, label, report) {
  const seen = new Set();
  values.forEach((value) => {
    if (value == null || value === '') {
      report.errors.push(`${label} contains an empty id.`);
      return;
    }
    if (seen.has(value)) report.errors.push(`${label} contains duplicate id: ${value}`);
    seen.add(value);
  });
}

export function firstAdaptorResult(adaptorResults = {}) {
  return Object.entries(adaptorResults || {}).find(([key, result]) => key !== 'descriptor' && result?.kind !== 'MineVis dataset descriptor')?.[1] || {};
}

export function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

export function arrayOf(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function mergeRows(...collections) {
  return collections.flatMap((collection) => arrayOf(collection));
}

export function mergeByIdentity(rows = [], identityKeys = []) {
  const merged = new Map();
  rows.forEach((row, index) => {
    if (!row) return;
    const id = identityKeys.map((key) => getPathValue(row, key)).find((value) => value != null && value !== '') ?? `__row_${index}`;
    const key = String(id);
    merged.set(key, { ...(merged.get(key) || {}), ...row });
  });
  return [...merged.values()];
}

export function valueFromAnyPath(row, paths = []) {
  for (const path of paths) {
    const value = getPathValue(row, path);
    if (value != null && value !== '') return value;
  }
  return undefined;
}

export function fieldRoleMapping(mapping, keys = []) {
  return Object.fromEntries(keys.map((key) => [key, mapping[key]]).filter(([, value]) => value));
}

const GEOLOGICAL_ATTRIBUTE_NON_VALUE_KEYS = new Set([
  'id',
  'elementId',
  'element_id',
  'supportElementId',
  'support_element_id',
  'blockId',
  'block_id',
  'modelId',
  'model_id',
  'unitId',
  'unit_id',
  'seamId',
  'seam_id',
  'surfaceId',
  'surface_id',
  'lithology',
  'unitType',
  'unit_type',
  'category',
  'resourceCategory',
  'resource_category',
  'x',
  'X',
  'y',
  'Y',
  'z',
  'Z',
  'centroid',
  'centroidX',
  'centroidY',
  'centroidZ',
  'centroid_x',
  'centroid_y',
  'centroid_z',
  'gridX',
  'gridY',
  'grid_x',
  'grid_y',
  'blockSizeX',
  'blockSizeY',
  'blockSizeZ',
  'block_size_x',
  'block_size_y',
  'block_size_z',
  'dx',
  'dy',
  'dz',
  'size',
  'layerOrder',
  'layer_order',
  'attributeName',
  'attributeValue',
  'attribute_name',
  'attribute_value',
  'valueType',
  'value_type',
  'name',
  'value',
  'unit'
]);

export function isGeologicalAttributeValueColumn(key, value) {
  if (!key || GEOLOGICAL_ATTRIBUTE_NON_VALUE_KEYS.has(key)) return false;
  if (value == null || value === '' || typeof value === 'object') return false;
  return isFiniteNumber(value);
}
