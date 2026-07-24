const MULTIPLICITIES = new Set(['one', 'optional', 'many', 'one-or-more']);

function issue(severity, code, message, path = '') {
  return { severity, code, message, path };
}

function validateArray(value, path, { required = false, min = 0 } = {}) {
  if (value == null) {
    return required ? [issue('error', 'required-array', `${path} is required.`, path)] : [];
  }
  if (!Array.isArray(value)) return [issue('error', 'invalid-array', `${path} must be an array.`, path)];
  if (value.length < min) return [issue('error', 'array-too-small', `${path} must contain at least ${min} item(s).`, path)];
  return [];
}

function validateGeometry(data = {}) {
  const diagnostics = [];
  const hasSupport = Boolean(
    data.modelPath || data.objText || data.form || data.meshParts?.length || data.points?.length ||
    data.vertices?.length || data.surfaces?.length || data.blocks?.length || data.grid || data.volume
  );
  if (!hasSupport) diagnostics.push(issue('warning', 'empty-geometry', 'Geometry template has no declared spatial support.', 'data'));
  if (data.points != null) diagnostics.push(...validateArray(data.points, 'data.points'));
  if (data.vertices != null) diagnostics.push(...validateArray(data.vertices, 'data.vertices'));
  if (data.faces != null) diagnostics.push(...validateArray(data.faces, 'data.faces'));
  if (data.meshParts != null) diagnostics.push(...validateArray(data.meshParts, 'data.meshParts'));
  return diagnostics;
}

function validateGraph(data = {}) {
  const diagnostics = [
    ...validateArray(data.nodes, 'data.nodes', { required: true }),
    ...validateArray(data.edges, 'data.edges', { required: true })
  ];
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return diagnostics;
  const nodeIds = new Set(data.nodes.map((node) => String(node?.id ?? node?.nodeId ?? '')));
  data.edges.forEach((edge, index) => {
    const source = edge?.source ?? edge?.from ?? edge?.j1;
    const target = edge?.target ?? edge?.to ?? edge?.j2;
    if (source == null || target == null) {
      diagnostics.push(issue('error', 'missing-incidence', `Graph edge ${index} has no complete incidence.`, `data.edges.${index}`));
      return;
    }
    if (nodeIds.size && (!nodeIds.has(String(source)) || !nodeIds.has(String(target)))) {
      diagnostics.push(issue('warning', 'unknown-incidence-target', `Graph edge ${index} references an unknown node.`, `data.edges.${index}`));
    }
  });
  return diagnostics;
}

function validateRegistry(data = {}, metadata = {}) {
  const entities = data.entities ?? data.rows ?? [];
  const diagnostics = validateArray(entities, 'data.entities', { required: true });
  if (!Array.isArray(entities)) return diagnostics;
  const keyRole = metadata.keyRole;
  if (!keyRole) diagnostics.push(issue('warning', 'missing-key-role', 'Registry template does not declare a key role.', 'metadata.keyRole'));
  if (keyRole) {
    const values = entities.map((entity) => entity?.[keyRole]).filter((value) => value != null && value !== '');
    if (new Set(values.map(String)).size !== values.length) {
      diagnostics.push(issue('error', 'duplicate-registry-key', `Registry key role ${keyRole} contains duplicate values.`, `data.entities`));
    }
  }
  return diagnostics;
}

function validateState(data = {}, metadata = {}) {
  const rows = data.rows ?? [];
  const diagnostics = validateArray(rows, 'data.rows', { required: true });
  if (!metadata.subjectRole) diagnostics.push(issue('warning', 'missing-subject-role', 'State template does not declare a subject role.', 'metadata.subjectRole'));
  if (!metadata.timeRole && rows.some((row) => row?.time != null || row?.timestamp != null)) {
    diagnostics.push(issue('warning', 'missing-time-role', 'State rows contain time values but no time role is declared.', 'metadata.timeRole'));
  }
  return diagnostics;
}

function validateField(data = {}, metadata = {}) {
  const diagnostics = [];
  const values = data.values ?? data.rows ?? data.elements ?? data.attributes ?? data.blocks;
  if (!data.support && !metadata.support && !data.grid) {
    diagnostics.push(issue('warning', 'missing-field-support', 'Field template does not declare its support.', 'data.support'));
  }
  if (values == null) diagnostics.push(issue('warning', 'empty-field', 'Field template has no values.', 'data'));
  else if (!Array.isArray(values) && typeof values !== 'object') {
    diagnostics.push(issue('error', 'invalid-field-values', 'Field values must be an array or keyed object.', 'data'));
  }
  return diagnostics;
}

function validateRelation(data = {}, metadata = {}) {
  const rows = data.rows ?? data.anchors ?? [];
  const diagnostics = validateArray(rows, 'data.rows', { required: true });
  if (!metadata.relation && !data.relation && !data.source && !data.target) {
    diagnostics.push(issue('warning', 'missing-relation-role', 'Relation template does not describe its relation role.', 'metadata.relation'));
  }
  return diagnostics;
}

const definitions = [
  {
    kind: 'Geometry',
    label: 'Geometry',
    forms: ['Point', 'Polyline', 'Curve', 'Mesh', 'Surface', 'Volume'],
    attributes: [
      { key: 'position', domain: 'R3', multiplicity: 'optional' },
      { key: 'vertices', domain: 'R3', multiplicity: 'many' },
      { key: 'faces', domain: 'index tuple', multiplicity: 'many' },
      { key: 'grid', domain: 'spatial partition', multiplicity: 'optional' }
    ],
    validate: validateGeometry
  },
  {
    kind: 'Graph',
    label: 'Graph',
    forms: ['DirectedGraph', 'UndirectedGraph'],
    attributes: [
      { key: 'nodes', domain: 'entity', multiplicity: 'many' },
      { key: 'edges', domain: 'incidence', multiplicity: 'many' }
    ],
    validate: validateGraph
  },
  {
    kind: 'Registry',
    label: 'Registry',
    forms: ['EntityRegistry'],
    attributes: [
      { key: 'key', domain: 'identifier', multiplicity: 'one' },
      { key: 'attributes', domain: 'record', multiplicity: 'many' }
    ],
    validate: validateRegistry
  },
  {
    kind: 'State',
    label: 'State',
    forms: ['Snapshot', 'TimeSeries'],
    attributes: [
      { key: 'subject', domain: 'identifier', multiplicity: 'one' },
      { key: 'time', domain: 'time', multiplicity: 'optional' },
      { key: 'attributes', domain: 'record', multiplicity: 'many' }
    ],
    validate: validateState
  },
  {
    kind: 'Field',
    label: 'Field',
    forms: ['ScalarField', 'VectorField', 'CategoricalField'],
    attributes: [
      { key: 'support', domain: 'support domain', multiplicity: 'one' },
      { key: 'values', domain: 'value', multiplicity: 'many' }
    ],
    validate: validateField
  },
  {
    kind: 'Relation',
    label: 'Relation',
    forms: ['BinaryRelation', 'AttributedRelation'],
    attributes: [
      { key: 'source', domain: 'identifier', multiplicity: 'one' },
      { key: 'target', domain: 'identifier', multiplicity: 'one' },
      { key: 'attributes', domain: 'record', multiplicity: 'many' }
    ],
    validate: validateRelation
  }
];

export class DataTemplateRegistryClass {
  constructor(initialDefinitions = definitions) {
    this.definitions = new Map();
    initialDefinitions.forEach((definition) => this.register(definition));
  }

  register(definition) {
    if (!definition?.kind) throw new Error('Data Template definition requires a kind.');
    const attributes = definition.attributes || [];
    attributes.forEach((attribute) => {
      if (!attribute.key || !attribute.domain || !MULTIPLICITIES.has(attribute.multiplicity)) {
        throw new Error(`Invalid ${definition.kind} attribute schema entry.`);
      }
    });
    const normalized = Object.freeze({
      ...definition,
      forms: Object.freeze([...(definition.forms || [])]),
      attributes: Object.freeze(attributes.map((attribute) => Object.freeze({ ...attribute })))
    });
    this.definitions.set(normalized.kind, normalized);
    return normalized;
  }

  get(kind) {
    return this.definitions.get(kind) || null;
  }

  list() {
    return [...this.definitions.values()];
  }

  validate(instance) {
    const definition = this.get(instance?.type);
    if (!definition) {
      return { valid: false, warnings: [], errors: [`Unsupported Data Template kind: ${instance?.type || '<missing>'}.`], diagnostics: [] };
    }
    const diagnostics = definition.validate?.(instance.data || {}, instance.metadata || {}, instance) || [];
    const errors = diagnostics.filter((item) => item.severity === 'error').map((item) => item.message);
    const warnings = diagnostics.filter((item) => item.severity === 'warning').map((item) => item.message);
    return { valid: errors.length === 0, warnings, errors, diagnostics };
  }
}

export const DataTemplateRegistry = new DataTemplateRegistryClass();
export const DataTemplateDefinitions = definitions;
