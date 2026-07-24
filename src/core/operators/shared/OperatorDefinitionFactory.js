import { adoptOperatorRuntime } from './BaseOperatorRuntime.js';

const PRIMARY_CLASSES = new Set(['Spatial', 'Topological', 'Temporal', 'Simulation']);

function inputManifest(definition) {
  const requirements = definition.inputRequirements || {};
  return Object.fromEntries(
    (definition.ports || [])
      .filter((port) => port.direction === 'in')
      .map((port) => [port.id, {
        id: port.id,
        name: port.name,
        datasetType: port.type,
        optional: Boolean(port.optional || requirements[port.id]?.optional),
        semanticRequirement: requirements[port.id] || null
      }])
  );
}

function outputManifest(definition) {
  return (definition.ports || [])
    .filter((port) => port.direction === 'out')
    .map((port) => ({
      id: port.id,
      name: port.name,
      type: port.type,
      datasetOutput: port.type !== 'OperatorRef'
    }));
}

function normalizeContext(context = {}) {
  return {
    consumes: [...new Set(context.consumes || [])],
    publishes: [...new Set(context.publishes || [])]
  };
}

function contributionContentDefaults(contribution = {}) {
  const kind = String(contribution.contributionKind || '').toLowerCase();
  const role = String(contribution.semanticRole || '').toLowerCase();
  const host = String(contribution.host || '').toLowerCase();
  if (host === 'main-3d-scene' || kind === 'layer') {
    return { profile: 'scene', padding: 'none', overflow: 'hidden' };
  }
  if (kind === 'chart' || kind === 'timeline') {
    return { profile: 'chart', padding: 'none', overflow: 'hidden' };
  }
  if (kind === 'topology-view' || kind === 'drawing' || host === 'topology-view' || host === 'bottom-panel') {
    return { profile: 'canvas', padding: 'none', overflow: 'hidden' };
  }
  if (role === 'control' || kind === 'control') {
    return { profile: 'form', padding: 'compact', overflow: 'auto' };
  }
  if (role === 'detail' || role === 'legend' || kind === 'legend') {
    return { profile: 'table', padding: 'compact', overflow: 'auto' };
  }
  return { profile: 'mixed', padding: 'compact', overflow: 'auto' };
}

function normalizeContribution(contribution, operatorTypeId) {
  if (!contribution?.id) {
    throw new Error(`Operator ${operatorTypeId} has a visual contribution without id.`);
  }
  if (!contribution.host || !contribution.contributionKind || !contribution.semanticRole || !contribution.objectSystem) {
    throw new Error(`Operator ${operatorTypeId} contribution ${contribution.id} is incomplete.`);
  }
  const layout = contribution.layout || {};
  const content = contributionContentDefaults(contribution);
  return {
    visualChannels: {},
    composition: {
      mergePolicy: 'compose',
      focusBehavior: 'context',
      canPin: true
    },
    ...contribution,
    visualChannels: { ...(contribution.visualChannels || {}) },
    composition: {
      mergePolicy: 'compose',
      focusBehavior: 'context',
      canPin: true,
      ...(contribution.composition || {})
    },
    layout: {
      ...layout,
      content: {
        ...content,
        ...(layout.content || {})
      }
    }
  };
}

function normalizeInteractions(interactions = []) {
  return interactions.map((interaction, index) => ({
    id: interaction.id || `interaction-${index + 1}`,
    description: '',
    consumes: [],
    publishes: [],
    ...interaction
  }));
}

export function validateOperatorDefinition(definition, { requireExplicitManifest = false } = {}) {
  const errors = [];
  if (!definition?.typeId) errors.push('Operator requires typeId.');
  if (!definition?.label) errors.push(`Operator ${definition?.typeId || '<missing>'} requires label.`);
  if (!PRIMARY_CLASSES.has(definition?.taxonomy?.primaryClass)) {
    errors.push(`Operator ${definition?.typeId || '<missing>'} has an invalid primary taxonomy class.`);
  }
  const manifest = definition?.operatorManifest;
  if (requireExplicitManifest && !manifest?.explicit) {
    errors.push(`Operator ${definition?.typeId || '<missing>'} does not have an explicit D-O-M manifest.`);
  }
  ['inputs', 'parameters', 'context', 'processing', 'contributions', 'interactions', 'outputs'].forEach((key) => {
    if (manifest?.[key] == null) errors.push(`Operator ${definition?.typeId || '<missing>'} is missing manifest.${key}.`);
  });
  return { valid: errors.length === 0, errors };
}

export function formalizeOperatorDefinition(definition, explicitManifest = null) {
  const existing = definition.operatorManifest || {};
  const provided = explicitManifest || {};
  const context = normalizeContext(provided.context || definition.context || existing.context);
  const processing = {
    kind: 'runtime-orchestrated',
    processorId: definition.typeId,
    deterministic: false,
    ...(existing.processing || {}),
    ...(definition.processing || {}),
    ...(provided.processing || {})
  };
  const contributions = (
    provided.contributions ||
    definition.contributions ||
    existing.contributions ||
    []
  ).map((item) => normalizeContribution(item, definition.typeId));
  const interactions = normalizeInteractions(
    provided.interactions ||
    definition.interactions ||
    existing.interactions ||
    []
  );
  const manifest = {
    schemaVersion: 1,
    explicit: Boolean(explicitManifest?.explicit || definition.manifestExplicit || existing.explicit),
    typeId: definition.typeId,
    taxonomy: definition.taxonomy,
    inputs: provided.inputs || definition.inputs || existing.inputs || inputManifest(definition),
    parameters: provided.parameters || definition.parameters || existing.parameters || {
      defaults: definition.defaultParams || {},
      schema: definition.paramSchema || []
    },
    context,
    processing,
    contributions,
    interactions,
    outputs: provided.outputs || definition.outputs || existing.outputs || outputManifest(definition),
    dependencyExposure: {
      exposeWhenRootActive: false,
      ...(existing.dependencyExposure || {}),
      ...(definition.dependencyExposure || {}),
      ...(provided.dependencyExposure || {})
    }
  };
  const formalized = {
    kind: 'operator',
    category: 'Operator',
    color: '#f2a51a',
    ...definition,
    inputs: manifest.inputs,
    parameters: manifest.parameters,
    context: manifest.context,
    processing: manifest.processing,
    contributions: manifest.contributions,
    interactions: manifest.interactions,
    outputs: manifest.outputs,
    operatorManifest: manifest
  };
  const validation = validateOperatorDefinition(formalized);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return formalized;
}

export function defineOperator({ RuntimeClass, createOperator, ...definition }) {
  const factory = createOperator || ((nodeModel, inputs) => new RuntimeClass(nodeModel, inputs));
  const createRuntimeInstance = (nodeModel, inputs) => adoptOperatorRuntime(
    factory(nodeModel, inputs),
    nodeModel,
    inputs
  );
  return formalizeOperatorDefinition({
    ...definition,
    createRuntime() {
      return {
        createOperator: createRuntimeInstance
      };
    }
  });
}

export function formalizeOperatorDefinitions(definitions, manifestRegistry) {
  return definitions.map((definition) => {
    const manifest = manifestRegistry?.get(definition.typeId);
    if (!manifest) throw new Error(`No explicit Operator manifest registered for ${definition.typeId}.`);
    return formalizeOperatorDefinition(definition, manifest);
  });
}
