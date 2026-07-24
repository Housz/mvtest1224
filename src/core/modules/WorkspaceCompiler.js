import { DatasetChannel } from './DatasetChannel.js';
import { SharedContext } from './SharedContext.js';
import { canonicalizeContextKeys } from './ContextKeyRegistry.js';

function diagnostic(severity, code, message, details = {}) {
  return { severity, code, message, details };
}

function inputDataset(value) {
  if (value?.__operatorDatasetOutput) return value.channel?.dataset ?? null;
  return value;
}

function templateKinds(dataset) {
  const templates = dataset?.templates instanceof Map
    ? [...dataset.templates.values()]
    : Object.values(dataset?.templates || {});
  return new Set(
    templates.map((template) => template?.type || template?.kind)
  );
}

export class WorkspaceCompiler {
  constructor({ graph, definitionRegistry }) {
    this.graph = graph;
    this.definitionRegistry = definitionRegistry;
    this.nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    this.incomingByNode = new Map();
    graph.edges.forEach((edge) => {
      if (!this.incomingByNode.has(edge.to.nodeId)) this.incomingByNode.set(edge.to.nodeId, []);
      this.incomingByNode.get(edge.to.nodeId).push(edge);
    });
  }

  incoming(nodeId) {
    return this.incomingByNode.get(nodeId) || [];
  }

  validateInput(node, portId, value) {
    const definition = this.definitionRegistry.get(node.typeId);
    const requirement = definition?.inputRequirements?.[portId];
    const port = node.ports?.find((item) => item.id === portId && item.direction === 'in');
    const diagnostics = [];
    if (!value) {
      if (!port?.optional && !requirement?.optional) diagnostics.push(diagnostic(
        'error',
        'required-input-missing',
        `${node.label || node.typeId} requires input ${portId}.`,
        { nodeId: node.id, portId }
      ));
      return diagnostics;
    }
    if (value?.type && port?.type && value.type !== port.type) {
      diagnostics.push(diagnostic(
        'error',
        'input-dataset-type-mismatch',
        `${node.label || node.typeId} input ${portId} expects ${port.type}, received ${value.type}.`,
        { nodeId: node.id, portId }
      ));
    }
    const dataset = inputDataset(value);
    if (!dataset || !requirement) return diagnostics;
    if (requirement.class && dataset.semanticClass !== requirement.class) diagnostics.push(diagnostic(
      'error',
      'input-semantic-class-mismatch',
      `${node.label || node.typeId} input ${portId} expects semantic class ${requirement.class}.`,
      { nodeId: node.id, portId, received: dataset.semanticClass }
    ));
    const kinds = templateKinds(dataset);
    (requirement.requiredTemplates || []).forEach((kind) => {
      if (!kinds.has(kind)) diagnostics.push(diagnostic(
        'error',
        'input-template-missing',
        `${node.label || node.typeId} input ${portId} requires template ${kind}.`,
        { nodeId: node.id, portId, kind }
      ));
    });
    return diagnostics;
  }

  compileOperatorGraph(workspaceId, rootNodeIds, dataOutputs) {
    const instances = new Map();
    const outputs = new Map(dataOutputs);
    const channels = new Map();
    const visiting = [];
    const topologicalOrder = [];
    const diagnostics = [];
    const dependenciesByNode = new Map();

    const ensureOperator = (nodeId) => {
      if (instances.has(nodeId)) return instances.get(nodeId);
      const cycleIndex = visiting.indexOf(nodeId);
      if (cycleIndex >= 0) {
        const cycle = [...visiting.slice(cycleIndex), nodeId]
          .map((id) => this.nodeById.get(id)?.label || id);
        throw new Error(`Operator cycle detected: ${cycle.join(' -> ')}.`);
      }
      const node = this.nodeById.get(nodeId);
      if (!node || node.kind !== 'operator') {
        throw new Error(`Workspace root ${nodeId} is not an Operator node.`);
      }
      visiting.push(nodeId);
      const inputs = {};
      const dependencyIds = [];
      this.incoming(nodeId).forEach((edge) => {
        const upstreamNode = this.nodeById.get(edge.from.nodeId);
        if (upstreamNode?.kind === 'operator') {
          ensureOperator(upstreamNode.id);
          dependencyIds.push(upstreamNode.id);
        }
        const upstreamOutputs = outputs.get(edge.from.nodeId);
        if (upstreamOutputs?.[edge.from.portId] != null) {
          inputs[edge.to.portId] = upstreamOutputs[edge.from.portId];
        }
      });
      (node.ports || [])
        .filter((port) => port.direction === 'in')
        .forEach((port) => diagnostics.push(...this.validateInput(node, port.id, inputs[port.id])));

      const definition = this.definitionRegistry.get(node.typeId);
      const runtimeNode = {
        ...node,
        id: `${workspaceId}:${node.id}`,
        graphNodeId: node.id,
        params: node.params,
        ports: node.ports,
        runtime: node.runtime
      };
      const operator = node.runtime.createOperator(runtimeNode, inputs);
      operator.graphNodeId = node.id;
      operator.workspaceId = workspaceId;
      operator.definition = definition;
      operator.operatorManifest = definition?.operatorManifest || null;
      instances.set(nodeId, operator);
      dependenciesByNode.set(nodeId, dependencyIds);

      const operatorOutputs = { operator };
      (node.ports || [])
        .filter((port) => port.direction === 'out' && port.id !== 'operator')
        .forEach((port) => {
          const channel = new DatasetChannel({
            id: `${workspaceId}:${node.id}:${port.id}`,
            type: port.type,
            operator,
            portId: port.id
          });
          channels.set(`${node.id}:${port.id}`, channel);
          operatorOutputs[port.id] = channel.asInputProxy();
        });
      outputs.set(node.id, operatorOutputs);
      visiting.pop();
      topologicalOrder.push(nodeId);
      return operator;
    };

    rootNodeIds.forEach(ensureOperator);
    return {
      instances,
      outputs,
      channels,
      dependenciesByNode,
      topologicalOrder,
      diagnostics
    };
  }

  collectDependencies(rootNodeId, compiled) {
    const visited = new Set();
    const ordered = [];
    const visit = (nodeId) => {
      (compiled.dependenciesByNode.get(nodeId) || []).forEach((dependencyId) => {
        if (visited.has(dependencyId)) return;
        visited.add(dependencyId);
        visit(dependencyId);
        ordered.push(dependencyId);
      });
    };
    visit(rootNodeId);
    return ordered.map((nodeId) => compiled.instances.get(nodeId)).filter(Boolean);
  }

  contextKeys(compiled) {
    const keys = new Set(['selection', 'timeCursor']);
    compiled.instances.forEach((operator) => {
      (operator.operatorManifest?.context?.consumes || []).forEach((key) => keys.add(key));
      (operator.operatorManifest?.context?.publishes || []).forEach((key) => keys.add(key));
    });
    return canonicalizeContextKeys([...keys]);
  }

  compileWorkspace(moduleNode, dataOutputs) {
    const inbound = this.incoming(moduleNode.id);
    const inboundByPort = new Map(inbound.map((edge) => [edge.to.portId, edge]));
    const slots = (moduleNode.params?.functions || [])
      .filter((slot) => !slot.placeholder)
      .map((slot) => {
        const edge = inboundByPort.get(slot.id);
        const rootNode = edge ? this.nodeById.get(edge.from.nodeId) : null;
        return rootNode?.kind === 'operator' ? { slot, rootNode } : null;
      })
      .filter(Boolean);
    const compiled = this.compileOperatorGraph(
      moduleNode.id,
      [...new Set(slots.map(({ rootNode }) => rootNode.id))],
      dataOutputs
    );
    const rootOperators = slots.map(({ rootNode }) => compiled.instances.get(rootNode.id));
    const workspace = moduleNode.runtime.createWorkspace(moduleNode, rootOperators);
    workspace.context = new SharedContext({}, {
      allowedKeys: this.contextKeys(compiled),
      workspaceId: moduleNode.id
    });
    workspace.functions = slots.map(({ slot, rootNode }) => {
      const operator = compiled.instances.get(rootNode.id);
      return {
        id: `${moduleNode.id}:${slot.id}:${operator.id}`,
        slotId: slot.id,
        graphOperatorNodeId: rootNode.id,
        label: slot.label || operator.label,
        operator,
        dependencies: this.collectDependencies(rootNode.id, compiled),
        enabled: false,
        rememberedEnabled: false,
        session: null
      };
    });
    workspace.focusedFunctionId = null;
    workspace.operatorInstances = compiled.instances;
    workspace.datasetChannels = compiled.channels;
    workspace.topologicalOrder = compiled.topologicalOrder;
    workspace.diagnostics = compiled.diagnostics;
    workspace.plan = {
      moduleNodeId: moduleNode.id,
      roots: slots.map(({ rootNode }) => rootNode.id),
      topologicalOrder: [...compiled.topologicalOrder],
      functions: workspace.functions.map((fn) => ({
        id: fn.id,
        rootOperatorNodeId: fn.graphOperatorNodeId,
        dependencyOperatorNodeIds: fn.dependencies.map((operator) => operator.graphNodeId),
        exposurePolicy: fn.operator.operatorManifest?.dependencyExposure || {}
      }))
    };
    return workspace;
  }

  compile(dataOutputs) {
    const workspaces = this.graph.nodes
      .filter((node) => node.kind === 'module')
      .map((moduleNode) => this.compileWorkspace(moduleNode, dataOutputs));
    return {
      workspaces,
      diagnostics: workspaces.flatMap((workspace) => workspace.diagnostics || [])
    };
  }
}
