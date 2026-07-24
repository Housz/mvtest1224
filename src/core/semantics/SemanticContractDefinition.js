export const role = (
  key,
  label,
  description,
  required = true,
  expectedType = 'string',
  defaultPath = '',
  candidates = []
) => Object.freeze({
  key,
  label,
  description,
  required,
  expectedType,
  defaultPath,
  candidates: Object.freeze([...candidates])
});

function normalizeConstraint(contractId, constraint, index) {
  if (typeof constraint === 'function') {
    return Object.freeze({
      id: `${contractId}.constraint-${index + 1}`,
      severity: 'error',
      description: '',
      validate: constraint
    });
  }
  if (constraint && typeof constraint === 'object') {
    if (!constraint.id || typeof constraint.validate !== 'function') {
      throw new Error(`Semantic contract ${contractId} has an invalid constraint.`);
    }
    return Object.freeze({
      severity: 'error',
      description: '',
      ...constraint
    });
  }
  const description = String(constraint || 'Semantic contract rule.');
  return Object.freeze({
    id: `${contractId}.rule-${index + 1}`,
    severity: 'warning',
    description,
    validate(dataset) {
      if (dataset?.validation?.valid !== false) return true;
      return {
        severity: 'warning',
        message: `Contract rule requires attention: ${description}`,
        path: 'validation'
      };
    }
  });
}

export function defineSemanticContract(definition) {
  if (!definition?.id || !definition.class) {
    throw new Error('Semantic contract requires id and class.');
  }
  return Object.freeze({
    ...definition,
    requiredTemplates: Object.freeze([...(definition.requiredTemplates || [])]),
    roles: Object.freeze((definition.roles || []).map((item) => Object.freeze({ ...item }))),
    constraints: Object.freeze(
      (definition.constraints || []).map((constraint, index) =>
        normalizeConstraint(definition.id, constraint, index)
      )
    )
  });
}
