const emptyValidation = () => ({
  valid: true,
  warnings: [],
  errors: [],
  diagnostics: [],
  summary: {}
});

function templateEntries(templates) {
  if (templates instanceof Map) return [...templates.entries()];
  return Object.entries(templates || {});
}

function mergeValidation(base, next) {
  const errors = [...(base?.errors || []), ...(next?.errors || [])];
  const warnings = [...(base?.warnings || []), ...(next?.warnings || [])];
  const diagnostics = [...(base?.diagnostics || []), ...(next?.diagnostics || [])];
  return {
    ...(base || {}),
    ...(next || {}),
    valid: errors.length === 0 && base?.valid !== false && next?.valid !== false,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    diagnostics,
    summary: { ...(base?.summary || {}), ...(next?.summary || {}) }
  };
}

/**
 * Common runtime shape for every semantic Dataset.
 *
 * Existing Dataset classes retain their public fields and accessors. This base
 * only centralizes the D = <Semantic Contract, Data Templates> invariant and
 * common template/validation introspection.
 */
export class BaseSemanticDataset {
  constructor({
    type,
    semanticClass,
    taxonomyId = '',
    contract = null,
    templates = {},
    roleMapping = {},
    validation = null,
    source = null,
    metadata = {},
    adaptorResults = null
  } = {}) {
    if (!type) throw new Error('Semantic Dataset requires a dataset type.');
    this.type = type;
    this.datasetType = type;
    this.contract = contract;
    this.semanticClass = semanticClass || contract?.class || '';
    this.taxonomyId = taxonomyId;
    this.templates = templates || {};
    this.roleMapping = roleMapping || {};
    this.validation = validation || emptyValidation();
    this.adaptorResults = adaptorResults;
    this.source = source;
    this.metadata = metadata || {};
  }

  listTemplates() {
    return templateEntries(this.templates).map(([key, template]) => ({
      key,
      template,
      id: template?.id || key,
      kind: template?.type || template?.kind || '',
      role: template?.role || ''
    }));
  }

  getTemplate(idOrRole) {
    if (!idOrRole) return null;
    const direct = this.templates instanceof Map
      ? this.templates.get(idOrRole)
      : this.templates?.[idOrRole];
    if (direct) return direct;
    const match = this.listTemplates().find(({ id, role, kind }) => (
      id === idOrRole || role === idOrRole || kind === idOrRole
    ));
    return match?.template || null;
  }

  getTemplatesByKind(kind) {
    return this.listTemplates()
      .filter((entry) => entry.kind === kind)
      .map((entry) => entry.template);
  }

  hasTemplate(kindOrId) {
    return Boolean(this.getTemplate(kindOrId));
  }

  validateTemplates() {
    let result = emptyValidation();
    this.listTemplates().forEach(({ key, template }) => {
      if (!template?.validate) {
        result = mergeValidation(result, {
          valid: false,
          errors: [`Template ${key} does not implement validate().`],
          diagnostics: [{
            severity: 'error',
            code: 'template-validator-missing',
            message: `Template ${key} does not implement validate().`,
            path: `templates.${key}`
          }]
        });
        return;
      }
      const validation = template.validate();
      result = mergeValidation(result, {
        ...validation,
        diagnostics: (validation.diagnostics || []).map((diagnostic) => ({
          ...diagnostic,
          path: diagnostic.path
            ? `templates.${key}.${diagnostic.path}`
            : `templates.${key}`
        }))
      });
    });
    return result;
  }

  applyValidation(validation) {
    this.validation = mergeValidation(this.validation, validation);
    return this.validation;
  }

  getSemanticDescriptor() {
    return {
      datasetType: this.type,
      semanticClass: this.semanticClass,
      taxonomyId: this.taxonomyId,
      contractId: this.contract?.id || null,
      representationProfile: this.representationProfile || null,
      templateBindings: this.listTemplates().map(({ key, id, kind, role }) => ({
        key,
        templateId: id,
        kind,
        role
      }))
    };
  }

  getSemanticSummary() {
    return {
      ...this.getSemanticDescriptor(),
      valid: this.validation?.valid !== false,
      warningCount: this.validation?.warnings?.length || 0,
      errorCount: this.validation?.errors?.length || 0,
      templates: this.listTemplates().map(({ key, template }) => ({
        key,
        ...(template?.summary?.() || {})
      }))
    };
  }
}

export function initializeSemanticDataset(target, options) {
  const base = new BaseSemanticDataset(options);
  Object.assign(target, base);
  return target;
}

export function combineDatasetValidation(...reports) {
  return reports.filter(Boolean).reduce(mergeValidation, emptyValidation());
}
