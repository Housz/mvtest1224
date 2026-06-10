export function defineOperator({ RuntimeClass, createOperator, ...definition }) {
  const factory = createOperator || ((nodeModel, inputs) => new RuntimeClass(nodeModel, inputs));
  return {
    kind: 'operator',
    category: 'Operator',
    color: '#f2a51a',
    ...definition,
    createRuntime() {
      return {
        createOperator: factory
      };
    }
  };
}
