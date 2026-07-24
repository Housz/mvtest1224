import { DataTemplateRegistry } from './DataTemplateRegistry.js';

export const CanonicalDatasetTaxonomy = Object.freeze([
  { id: 'roadways-infrastructure', label: 'Roadways & Infrastructure' },
  { id: 'geology-resources', label: 'Geology & Resources' },
  { id: 'monitoring-sensing', label: 'Monitoring & Sensing' },
  { id: 'production-operations', label: 'Production & Operations' },
  { id: 'ventilation', label: 'Ventilation & Utility Networks' },
  { id: 'people-vehicles', label: 'People, Vehicles & Mobile Assets' },
  { id: 'robots-equipment', label: 'Robots & Equipment' },
  { id: 'safety-emergency', label: 'Safety & Emergency' }
]);

const TAXONOMY_ALIASES = Object.freeze({
  'Roadways & Infrastructure': 'roadways-infrastructure',
  'Geology & Resources': 'geology-resources',
  'Geology & Resource Datasets': 'geology-resources',
  'Monitoring & Sensing': 'monitoring-sensing',
  'Production & Operations': 'production-operations',
  'Ventilation & Utility Network': 'ventilation',
  'Ventilation & Utility Networks': 'ventilation',
  'People & Vehicles': 'people-vehicles',
  'Equipment, People & Mobile Asset': 'people-vehicles',
  'People, Vehicles & Mobile Assets': 'people-vehicles',
  'Robots & Equipment': 'robots-equipment',
  'Safety & Emergency': 'safety-emergency',
  'Safety, Hazard & Emergency': 'safety-emergency'
});

const taxonomyIds = new Set(CanonicalDatasetTaxonomy.map((item) => item.id));

export function resolveDatasetTaxonomyId(value) {
  if (!value) return '';
  if (taxonomyIds.has(value)) return value;
  return TAXONOMY_ALIASES[value] || '';
}

function diagnostic(severity, code, message, path = '') {
  return { severity, code, message, path };
}

function reportFromDiagnostics(diagnostics, summary = {}) {
  const errors = diagnostics.filter((item) => item.severity === 'error').map((item) => item.message);
  const warnings = diagnostics.filter((item) => item.severity === 'warning').map((item) => item.message);
  return { valid: errors.length === 0, errors, warnings, diagnostics, summary };
}

function normalizeBinding(key, binding) {
  const normalized = typeof binding === 'string' ? { kind: binding } : { ...(binding || {}) };
  if (!DataTemplateRegistry.get(normalized.kind)) {
    throw new Error(`Dataset template binding ${key} uses unsupported kind ${normalized.kind || '<missing>'}.`);
  }
  return Object.freeze({
    key,
    kind: normalized.kind,
    semanticRole: normalized.semanticRole || key,
    required: normalized.required !== false,
    multiplicity: normalized.multiplicity || (normalized.required === false ? 'optional' : 'one'),
    acceptedForms: Object.freeze([...(normalized.acceptedForms || [])])
  });
}

function normalizeConstraint(constraint, index) {
  if (typeof constraint === 'function') {
    return Object.freeze({
      id: `constraint-${index + 1}`,
      severity: 'error',
      description: '',
      validate: constraint
    });
  }
  if (typeof constraint === 'string') {
    return Object.freeze({
      id: `contract-rule-${index + 1}`,
      severity: 'warning',
      description: constraint,
      validate: () => true
    });
  }
  if (!constraint?.id || typeof constraint.validate !== 'function') {
    throw new Error('Dataset constraint requires id and validate().');
  }
  return Object.freeze({
    severity: 'error',
    description: '',
    ...constraint
  });
}

export function defineDataset(definition) {
  if (!definition?.id) throw new Error('Dataset definition requires id.');
  if (!definition.datasetType) throw new Error(`Dataset definition ${definition.id} requires datasetType.`);
  if (!definition.semanticClass) throw new Error(`Dataset definition ${definition.id} requires semanticClass.`);
  if (!definition.contractId) throw new Error(`Dataset definition ${definition.id} requires contractId.`);
  const taxonomyId = resolveDatasetTaxonomyId(definition.taxonomyId);
  if (!taxonomyId) throw new Error(`Dataset definition ${definition.id} has an invalid taxonomyId.`);
  if (typeof definition.DatasetClass !== 'function') {
    throw new Error(`Dataset definition ${definition.id} requires DatasetClass.`);
  }
  const templateBindings = Object.freeze(Object.fromEntries(
    Object.entries(definition.templateBindings || {}).map(([key, binding]) => [key, normalizeBinding(key, binding)])
  ));
  const roles = Object.freeze((definition.roles || []).map((role) => Object.freeze({
    ...role,
    id: role.id || role.key
  })));
  const constraints = Object.freeze((definition.constraints || []).map(normalizeConstraint));
  return Object.freeze({
    schemaVersion: 1,
    ...definition,
    taxonomyId,
    templateBindings,
    roles,
    constraints
  });
}

export class DatasetDefinitionRegistryClass {
  constructor() {
    this.definitions = new Map();
    this.byType = new Map();
    this.byClass = new Map();
    this.byContract = new Map();
    this.byMaterializer = new Map();
  }

  register(rawDefinition) {
    const definition = rawDefinition?.schemaVersion ? rawDefinition : defineDataset(rawDefinition);
    if (this.definitions.has(definition.id)) {
      throw new Error(`Duplicate Dataset definition id: ${definition.id}.`);
    }
    if (this.byType.has(definition.datasetType)) {
      throw new Error(`Duplicate Dataset type: ${definition.datasetType}.`);
    }
    this.definitions.set(definition.id, definition);
    this.byType.set(definition.datasetType, definition);
    this.byClass.set(definition.semanticClass, definition);
    this.byContract.set(definition.contractId, definition);
    if (definition.materializerId) this.byMaterializer.set(definition.materializerId, definition);
    return definition;
  }

  get(id) {
    return this.definitions.get(id) || null;
  }

  getByType(datasetType) {
    return this.byType.get(datasetType) || null;
  }

  getByClass(semanticClass) {
    return this.byClass.get(semanticClass) || null;
  }

  getByContract(contractId) {
    return this.byContract.get(contractId) || null;
  }

  getByMaterializer(materializerId) {
    return this.byMaterializer.get(materializerId) || null;
  }

  list() {
    return [...this.definitions.values()];
  }

  validateDataset(dataset, definitionOrId = null) {
    const definition = typeof definitionOrId === 'string'
      ? this.get(definitionOrId)
      : definitionOrId || this.getByType(dataset?.type) || this.getByClass(dataset?.semanticClass);
    if (!definition) {
      return reportFromDiagnostics([
        diagnostic('error', 'dataset-definition-missing', `No Dataset definition exists for ${dataset?.type || '<missing>'}.`)
      ]);
    }
    const diagnostics = [];
    if (dataset?.type !== definition.datasetType) {
      diagnostics.push(diagnostic(
        'error',
        'dataset-type-mismatch',
        `Expected Dataset type ${definition.datasetType}, received ${dataset?.type || '<missing>'}.`,
        'type'
      ));
    }
    if (dataset?.semanticClass !== definition.semanticClass) {
      diagnostics.push(diagnostic(
        'error',
        'semantic-class-mismatch',
        `Expected semantic class ${definition.semanticClass}, received ${dataset?.semanticClass || '<missing>'}.`,
        'semanticClass'
      ));
    }
    Object.entries(definition.templateBindings).forEach(([key, binding]) => {
      const template = dataset?.templates instanceof Map
        ? dataset.templates.get(key)
        : dataset?.templates?.[key];
      if (!template) {
        if (binding.required) diagnostics.push(diagnostic(
          'error',
          'required-template-missing',
          `Required ${binding.kind} template binding ${key} is missing.`,
          `templates.${key}`
        ));
        return;
      }
      const kind = template.type || template.kind;
      if (kind !== binding.kind) diagnostics.push(diagnostic(
        'error',
        'template-kind-mismatch',
        `Template binding ${key} must be ${binding.kind}, received ${kind || '<missing>'}.`,
        `templates.${key}`
      ));
      const validation = template.validate?.();
      (validation?.diagnostics || []).forEach((item) => diagnostics.push({
        ...item,
        path: item.path ? `templates.${key}.${item.path}` : `templates.${key}`
      }));
    });
    definition.roles.filter((role) => role.required).forEach((role) => {
      const mapping = dataset?.roleMapping?.[role.id];
      if (mapping == null || mapping === '') diagnostics.push(diagnostic(
        'error',
        'required-role-unmapped',
        `Required semantic role ${role.id} is not mapped.`,
        `roleMapping.${role.id}`
      ));
    });
    definition.constraints.forEach((constraint) => {
      let outcome = true;
      try {
        outcome = constraint.validate(dataset, definition);
      } catch (error) {
        outcome = error?.message || 'Constraint execution failed.';
      }
      if (outcome === true || outcome == null) return;
      const message = typeof outcome === 'string'
        ? outcome
        : outcome.message || constraint.description || `Constraint ${constraint.id} failed.`;
      diagnostics.push(diagnostic(
        outcome.severity || constraint.severity,
        constraint.id,
        message,
        outcome.path || ''
      ));
    });
    return reportFromDiagnostics(diagnostics, {
      datasetId: definition.id,
      datasetType: definition.datasetType,
      semanticClass: definition.semanticClass,
      taxonomyId: definition.taxonomyId,
      templateCount: dataset?.templates instanceof Map
        ? dataset.templates.size
        : Object.keys(dataset?.templates || {}).length
    });
  }
}

export const DatasetDefinitionRegistry = new DatasetDefinitionRegistryClass();
