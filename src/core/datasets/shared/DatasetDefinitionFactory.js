import { defineDataset } from '../../semantics/DatasetDefinitionRegistry.js';

function materializerValidationConstraint(datasetType) {
  return {
    id: 'materializer-validation',
    severity: 'error',
    description: 'The materialized Dataset must pass source and semantic validation.',
    validate(dataset) {
      if (dataset?.validation?.valid !== false) return true;
      return {
        message: `${datasetType} materialization reported validation errors.`,
        path: 'validation'
      };
    }
  };
}

export function defineBuiltInDataset({
  contract,
  validators = [],
  ...definition
}) {
  if (!contract?.id) throw new Error('Built-in Dataset definition requires a Semantic Contract.');
  return defineDataset({
    ...definition,
    contractId: contract.id,
    roles: contract.roles || [],
    constraints: [
      ...(contract.constraints || []),
      ...validators,
      materializerValidationConstraint(definition.datasetType)
    ]
  });
}
