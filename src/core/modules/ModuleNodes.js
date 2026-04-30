export const ModuleNodeDefinitions = [
  {
    typeId: 'ModuleNode',
    label: 'Module',
    kind: 'module',
    defaultParams: {
      moduleId: 'environment',
      title: 'Environment',
      slots: [
        { id: 'function-1', label: 'Sensor Detail' },
        { id: 'function-2', label: 'Roadway Temp Snapshot' }
      ]
    },
    buildPorts(node) {
      const slots = node.params?.slots || [];
      return slots.map((slot, idx) => ({
        id: `slot-${slot.id || idx}`,
        name: slot.label || `Function ${idx + 1}`,
        direction: 'in',
        type: 'OperatorRef'
      }));
    },
    createRuntime() {
      return {
        updatePorts(nodeModel) {
          const slots = nodeModel.params?.slots || [];
          nodeModel.ports = slots.map((slot, idx) => ({
            id: `slot-${slot.id || idx}`,
            name: slot.label || `Function ${idx + 1}`,
            direction: 'in',
            type: 'OperatorRef'
          }));
        }
      };
    }
  }
];
