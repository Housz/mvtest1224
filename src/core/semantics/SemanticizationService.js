import { DefaultSourceAdaptorRegistry } from '../adaptors/SourceAdaptorRegistry.js';
import { collectObjectPaths, fetchText } from '../adaptors/adaptorUtils.js';
import { DatasetDefinitionRegistry } from '../datasets/definitions/index.js';
import { SemanticContractRegistry } from './SemanticContractRegistry.js';
import { materializeDataset, mergeRoleMapping } from './DatasetMaterializers.js';
import { mapWithConcurrency, yieldToMainThread } from '../runtime/CooperativeTaskScheduler.js';

function diagnostic(stage, severity, code, message, path = '', details = {}) {
  return { stage, severity, code, message, path, details };
}

function hasSourcePayload(source = {}) {
  return Boolean(
    source.path ||
    source.name ||
    source.text ||
    source.data ||
    source.buffer ||
    source.arrayBuffer
  );
}

function sourceDisplayName(sourceKey, source = {}) {
  return source.label || sourceKey;
}

function descriptorBasePath(source = {}) {
  const path = source.path || source.name || '';
  const index = String(path).lastIndexOf('/');
  return index >= 0 ? String(path).slice(0, index + 1) : '';
}

function resolveDescriptorRelativePath(path, basePath) {
  if (!path || typeof path !== 'string') return path;
  if (/^(\/|https?:\/\/|data:|blob:)/i.test(path)) return path;
  return `${basePath || ''}${path}`;
}

function descriptorSourceEntries(descriptor = {}) {
  const sourceSlots = descriptor.sourceSlots || descriptor.sources || {};
  if (Array.isArray(sourceSlots)) {
    return sourceSlots
      .map((slot) => [slot.key || slot.id || slot.name, slot])
      .filter(([key]) => key);
  }
  return Object.entries(sourceSlots);
}

async function readDescriptorSource(source = {}) {
  if (!hasSourcePayload(source)) return null;
  if (source.data && typeof source.data === 'object') return source.data;
  const text = typeof source.text === 'string' && source.text.trim()
    ? source.text
    : source.path ? await fetchText(source.path) : '';
  if (!text) return null;
  return JSON.parse(text);
}

function applyDescriptorToParams(params, descriptor, descriptorSource) {
  const basePath = descriptorBasePath(descriptorSource);
  params.sources = params.sources || {};
  descriptorSourceEntries(descriptor).forEach(([sourceKey, slot]) => {
    if (!sourceKey || sourceKey === 'descriptor') return;
    const next = { ...(params.sources[sourceKey] || {}) };
    if (slot.label) next.label = slot.label;
    if (slot.template) next.template = slot.template;
    if (slot.required != null) next.required = Boolean(slot.required);
    if (slot.acceptedFormats) next.acceptedFormats = slot.acceptedFormats;
    const adaptor = slot.adaptor || slot.adapter || slot.adapterHint || slot.adaptorHint;
    if (adaptor) next.adaptor = adaptor;
    const path = slot.path || slot.href || slot.url;
    if (path) next.path = resolveDescriptorRelativePath(path, basePath);
    params.sources[sourceKey] = next;
  });
  if (descriptor.representationProfile || descriptor.profile) {
    params.representationProfile = descriptor.representationProfile || descriptor.profile;
  }
  if (descriptor.datasetType) params.datasetType = descriptor.datasetType;
  if (descriptor.semanticClass) params.semanticClass = descriptor.semanticClass;
  params.roleMapping = {
    ...(descriptor.suggestedRoleMapping || descriptor.roleMapping || {}),
    ...(params.roleMapping || {})
  };
  params.descriptor = descriptor;
  params.descriptorPath = descriptorSource.path || descriptorSource.name || params.descriptorPath;
}

function createStage(id) {
  return { id, status: 'pending', diagnostics: [], summary: {}, startedAt: null, durationMs: 0 };
}

function startStage(stage) {
  stage.startedAt = performance.now();
  return stage;
}

function finishStage(stage, status = null) {
  if (Number.isFinite(stage.startedAt)) stage.durationMs = performance.now() - stage.startedAt;
  if (status) stage.status = status;
  else if (stage.diagnostics.some((item) => item.severity === 'error')) stage.status = 'error';
  else if (stage.diagnostics.some((item) => item.severity === 'warning')) stage.status = 'warning';
  else stage.status = 'ready';
  return stage;
}

function appendDatasetDiagnostic(dataset, item) {
  dataset.validation = dataset.validation || {
    valid: true,
    warnings: [],
    errors: [],
    diagnostics: [],
    summary: {}
  };
  dataset.validation.diagnostics = dataset.validation.diagnostics || [];
  dataset.validation.diagnostics.push(item);
  if (item.severity === 'error') dataset.validation.errors.push(item.message);
  if (item.severity === 'warning') dataset.validation.warnings.push(item.message);
}

function deduplicateValidation(validation) {
  validation.errors = [...new Set(validation.errors || [])];
  validation.warnings = [...new Set(validation.warnings || [])];
  validation.valid = validation.errors.length === 0;
  return validation;
}

export class SemanticizationService {
  constructor({
    adaptorRegistry = DefaultSourceAdaptorRegistry,
    contractRegistry = SemanticContractRegistry,
    datasetDefinitionRegistry = DatasetDefinitionRegistry,
    materialize = materializeDataset,
    resolveRoleMapping = mergeRoleMapping
  } = {}) {
    this.adaptorRegistry = adaptorRegistry;
    this.contractRegistry = contractRegistry;
    this.datasetDefinitionRegistry = datasetDefinitionRegistry;
    this.materialize = materialize;
    this.resolveRoleMapping = resolveRoleMapping;
  }

  createStages() {
    return {
      descriptor: createStage('descriptor'),
      sources: createStage('sources'),
      fieldCatalog: createStage('fieldCatalog'),
      roleResolution: createStage('roleResolution'),
      materialization: createStage('materialization'),
      templates: createStage('templates'),
      contract: createStage('contract')
    };
  }

  async semanticize({ nodeModel, params, updateNode = true }) {
    const stages = this.createStages();
    const sourceErrors = [];
    const adaptorResults = {};
    startStage(stages.descriptor);

    const descriptorSource = params.sources?.descriptor ||
      (params.descriptorPath ? { path: params.descriptorPath } : null);
    if (descriptorSource && hasSourcePayload(descriptorSource)) {
      try {
        const descriptor = await readDescriptorSource(descriptorSource);
        if (descriptor) {
          applyDescriptorToParams(params, descriptor, descriptorSource);
          const entries = descriptorSourceEntries(descriptor);
          params.descriptorStatus = {
            loaded: true,
            sourceSlotCount: entries.length,
            representationProfile: params.representationProfile
          };
          const paths = [...collectObjectPaths(descriptor)].sort();
          adaptorResults.descriptor = {
            kind: 'MineVis dataset descriptor',
            raw: descriptor,
            paths,
            fields: paths,
            summary: params.descriptorStatus
          };
          stages.descriptor.summary = params.descriptorStatus;
        } else {
          stages.descriptor.diagnostics.push(diagnostic(
            'descriptor',
            'warning',
            'descriptor-empty',
            'Dataset descriptor is empty.',
            'sources.descriptor'
          ));
        }
      } catch (error) {
        const message = error.message || String(error);
        params.descriptorStatus = { loaded: false, error: message };
        stages.descriptor.diagnostics.push(diagnostic(
          'descriptor',
          'warning',
          'descriptor-load-failed',
          `Dataset descriptor could not be loaded: ${message}`,
          'sources.descriptor'
        ));
      }
    } else {
      stages.descriptor.status = 'skipped';
    }
    if (stages.descriptor.status === 'pending') finishStage(stages.descriptor);

    const contract = this.contractRegistry.get(params.contractId);
    if (!contract) throw new Error(`Unknown semantic contract: ${params.contractId}`);

    startStage(stages.sources);
    const sourceEntries = Object.entries(params.sources || {}).filter(([sourceKey]) => sourceKey !== 'descriptor');
    await mapWithConcurrency(sourceEntries, async ([sourceKey, source]) => {
      const label = sourceDisplayName(sourceKey, source);
      if (!hasSourcePayload(source)) {
        stages.sources.diagnostics.push(diagnostic(
          'sources',
          source?.required ? 'error' : 'warning',
          source?.required ? 'required-source-missing' : 'optional-source-missing',
          `${source?.required ? 'Required' : 'Optional'} source missing: ${label}.`,
          `sources.${sourceKey}`
        ));
        return;
      }
      try {
        adaptorResults[sourceKey] = await this.adaptorRegistry.load(source, contract);
      } catch (error) {
        sourceErrors.push({ sourceKey, source, error });
        stages.sources.diagnostics.push(diagnostic(
          'sources',
          source?.required ? 'error' : 'warning',
          'source-load-failed',
          `Failed to load ${label}: ${error.message || String(error)}.`,
          `sources.${sourceKey}`
        ));
      }
    }, { concurrency: 3 });
    await yieldToMainThread();
    stages.sources.summary = {
      configured: Object.keys(params.sources || {}).filter((key) => key !== 'descriptor').length,
      loaded: Object.keys(adaptorResults).filter((key) => key !== 'descriptor').length,
      failed: sourceErrors.length
    };
    finishStage(stages.sources);

    startStage(stages.fieldCatalog);
    const fieldCatalog = {};
    Object.entries(adaptorResults).forEach(([sourceKey, result]) => {
      fieldCatalog[sourceKey] = [...new Set([
        ...(result?.fields || []),
        ...(result?.paths || [])
      ])].sort();
    });
    stages.fieldCatalog.summary = {
      sourceCount: Object.keys(fieldCatalog).length,
      fieldCount: Object.values(fieldCatalog).reduce((sum, fields) => sum + fields.length, 0)
    };
    finishStage(stages.fieldCatalog);

    startStage(stages.roleResolution);
    const roleMapping = this.resolveRoleMapping(contract, adaptorResults, params.roleMapping);
    const requiredRoles = (contract.roles || []).filter((role) => role.required);
    const missingRoles = requiredRoles.filter((role) => !roleMapping[role.key]);
    missingRoles.forEach((role) => stages.roleResolution.diagnostics.push(diagnostic(
      'roleResolution',
      'error',
      'required-role-unmapped',
      `Required semantic role ${role.key} is not mapped.`,
      `roleMapping.${role.key}`
    )));
    stages.roleResolution.summary = {
      roleCount: contract.roles?.length || 0,
      mappedCount: Object.values(roleMapping).filter(Boolean).length,
      missingRequiredCount: missingRoles.length
    };
    finishStage(stages.roleResolution);
    if (updateNode) nodeModel.params.roleMapping = roleMapping;

    await yieldToMainThread();
    startStage(stages.materialization);
    const dataset = await this.materialize({
      datasetType: params.datasetType,
      contract,
      adaptorResults,
      roleMapping,
      sources: params.sources,
      variable: params.variable,
      unit: params.unit,
      displayRange: params.displayRange,
      representationProfile: params.representationProfile
    });
    stages.materialization.summary = dataset.validation?.summary || {};
    (dataset.validation?.errors || []).forEach((message) => stages.materialization.diagnostics.push(
      diagnostic('materialization', 'error', 'materialization-error', message)
    ));
    (dataset.validation?.warnings || []).forEach((message) => stages.materialization.diagnostics.push(
      diagnostic('materialization', 'warning', 'materialization-warning', message)
    ));
    finishStage(stages.materialization);
    await yieldToMainThread();

    startStage(stages.templates);
    startStage(stages.contract);
    const definition = this.datasetDefinitionRegistry.getByMaterializer(params.datasetType);
    const definitionValidation = this.datasetDefinitionRegistry.validateDataset(dataset, definition);
    stages.templates.diagnostics.push(...definitionValidation.diagnostics.filter((item) => (
      item.code.includes('template') || item.path?.startsWith('templates.')
    )).map((item) => ({ ...item, stage: 'templates' })));
    stages.contract.diagnostics.push(...definitionValidation.diagnostics.filter((item) => (
      !item.code.includes('template') && !item.path?.startsWith('templates.')
    )).map((item) => ({ ...item, stage: 'contract' })));
    stages.templates.summary = {
      bindingCount: Object.keys(definition?.templateBindings || {}).length,
      templateCount: Object.keys(dataset.templates || {}).length
    };
    stages.contract.summary = {
      contractId: contract.id,
      semanticClass: contract.class,
      constraintCount: definition?.constraints?.length || 0
    };
    finishStage(stages.templates);
    finishStage(stages.contract);

    Object.values(stages).flatMap((stage) => stage.diagnostics).forEach((item) => {
      if (item.stage === 'materialization') return;
      appendDatasetDiagnostic(dataset, item);
    });
    deduplicateValidation(dataset.validation);
    dataset.semanticization = {
      revision: (nodeModel.runtime?.semanticRevision || 0) + 1,
      stages,
      fieldCatalog,
      diagnostics: Object.values(stages).flatMap((stage) => stage.diagnostics)
    };

    if (updateNode) {
      nodeModel.params.semanticStatus = {
        valid: dataset.validation.valid,
        errors: dataset.validation.errors.length,
        warnings: dataset.validation.warnings.length,
        summary: dataset.validation.summary || {},
        stages: Object.fromEntries(Object.entries(stages).map(([key, stage]) => [key, stage.status]))
      };
      if (dataset.validation?.summary?.valueRange && params.datasetType === 'SensorReadings') {
        nodeModel.params.detectedRange = dataset.validation.summary.valueRange;
      }
    }

    return {
      dataset,
      contract,
      definition,
      adaptorResults,
      fieldCatalog,
      roleMapping,
      sourceErrors,
      stages,
      diagnostics: dataset.semanticization.diagnostics
    };
  }
}

export const DefaultSemanticizationService = new SemanticizationService();
