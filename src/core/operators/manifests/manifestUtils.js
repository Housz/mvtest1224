export function contribution(
  id,
  host,
  contributionKind,
  semanticRole,
  objectSystem,
  visualChannels = {},
  composition = {}
) {
  return {
    id,
    host,
    contributionKind,
    semanticRole,
    objectSystem,
    visualChannels,
    composition: {
      mergePolicy: 'compose',
      focusBehavior: semanticRole === 'control' ? 'context' : 'primary-when-focused',
      canPin: true,
      ...composition
    }
  };
}

export function interaction(id, description, consumes = [], publishes = []) {
  return { id, description, consumes, publishes };
}

export function operatorManifest({
  context = {},
  processing = {},
  contributions = [],
  interactions = [],
  dependencyExposure = {}
} = {}) {
  return Object.freeze({
    explicit: true,
    context: {
      consumes: context.consumes || [],
      publishes: context.publishes || []
    },
    processing: {
      kind: 'analysis-and-visualization',
      deterministic: true,
      ...processing
    },
    contributions,
    interactions,
    dependencyExposure
  });
}
