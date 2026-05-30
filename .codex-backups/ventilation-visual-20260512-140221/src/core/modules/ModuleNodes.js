function nextFunctionId(functions = []) {
  const used = new Set(functions.map((fn) => fn.id));
  let index = 1;
  while (used.has(`function-${index}`)) index += 1;
  return `function-${index}`;
}

function ensureFunctions(nodeModel) {
  nodeModel.params = nodeModel.params || {};
  const functions = Array.isArray(nodeModel.params.functions) ? nodeModel.params.functions : [];
  if (!functions.length) {
    functions.push({ id: 'function-1', label: '(Add Function)', placeholder: true });
  }
  nodeModel.params.functions = functions;
  return functions;
}

export function buildModuleFunctionPorts(nodeModel) {
  const functions = ensureFunctions(nodeModel);
  return functions.map((fn) => ({
    id: fn.id,
    name: fn.placeholder ? '(Add Function)' : fn.label || 'Function',
    direction: 'in',
    type: 'OperatorRef'
  }));
}

export function syncModuleFunctionSlots(nodeModel, { edges = [], nodes = [] } = {}) {
  const existing = ensureFunctions(nodeModel);
  const existingById = new Map(existing.map((fn) => [fn.id, fn]));
  const functionSlots = [];
  const orderedEdges = edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.to.nodeId === nodeModel.id)
    .sort((a, b) => {
      const ai = existing.findIndex((fn) => fn.id === a.edge.to.portId);
      const bi = existing.findIndex((fn) => fn.id === b.edge.to.portId);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      return a.index - b.index;
    });

  orderedEdges.forEach(({ edge }) => {
    let slot = existingById.get(edge.to.portId);
    if (!slot || edge.to.portId === 'operator') {
      const freePlaceholder = existing.find(
        (fn) => fn.placeholder && !functionSlots.some((usedSlot) => usedSlot.id === fn.id)
      );
      const id = freePlaceholder?.id || nextFunctionId([...existing, ...functionSlots]);
      edge.to.portId = id;
      slot = { id };
    }
    const operator = nodes.find((node) => node.id === edge.from.nodeId);
    const customLabel = slot.customLabel === true;
    functionSlots.push({
      id: edge.to.portId,
      label: customLabel ? slot.label || operator?.label || 'Function' : operator?.label || slot.label || 'Function',
      operatorNodeId: edge.from.nodeId,
      customLabel,
      placeholder: false
    });
  });

  functionSlots.push({ id: nextFunctionId(functionSlots), label: '(Add Function)', placeholder: true });
  nodeModel.params.functions = functionSlots;
  nodeModel.ports = buildModuleFunctionPorts(nodeModel);
  return functionSlots;
}

export const ModuleNodeDefinitions = [
  {
    typeId: 'ModuleNode',
    label: 'Workspace',
    kind: 'module',
    category: 'Module',
    color: '#2faa64',
    buildPorts: buildModuleFunctionPorts,
    defaultParams: {
      workspaceName: 'Workspace',
      functions: [{ id: 'function-1', label: '(Add Function)', placeholder: true }],
      context: {
        time: true,
        selection: true
      }
    },
    inlineControls: [],
    createRuntime() {
      return {
        onOperatorConnected(nodeModel, operatorNode, portId) {
          const functions = ensureFunctions(nodeModel);
          const slot = functions.find((fn) => fn.id === portId);
          if (!slot) return;
          slot.label = operatorNode?.label || 'Function';
          slot.operatorNodeId = operatorNode?.id || null;
          slot.customLabel = false;
          slot.placeholder = false;
          nodeModel.ports = buildModuleFunctionPorts(nodeModel);
        },
        syncFunctionSlots: syncModuleFunctionSlots,
        refreshPorts(nodeModel) {
          nodeModel.ports = buildModuleFunctionPorts(nodeModel);
        },
        createWorkspace(nodeModel, operators = []) {
          return {
            id: nodeModel.id,
            label: nodeModel.params?.workspaceName || nodeModel.label,
            operators
          };
        }
      };
    }
  }
];
