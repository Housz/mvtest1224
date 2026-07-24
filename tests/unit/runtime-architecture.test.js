import { describe, expect, it, vi } from 'vitest';
import { SharedContext } from '../../src/core/modules/SharedContext.js';
import { VisualContributionManager } from '../../src/core/modules/VisualContributionManager.js';
import { LayoutStateStore } from '../../src/core/modules/LayoutStateStore.js';
import { DatasetChannel } from '../../src/core/modules/DatasetChannel.js';
import { WorkspaceCompiler } from '../../src/core/modules/WorkspaceCompiler.js';
import { WorkspaceRuntime } from '../../src/core/modules/WorkspaceRuntime.js';
import { OperatorNodeDefinitions } from '../../src/core/operators/OperatorNodes.js';
import { GraphModel, GRAPH_SCHEMA_VERSION } from '../../src/core/graph/GraphModel.js';
import { createRoadwayHazardStateDataset } from '../../src/core/datasets/RoadwayHazardStateFactory.js';

describe('formal Operator manifests', () => {
  it('declares all seven paper-level Operator components', () => {
    expect(OperatorNodeDefinitions).toHaveLength(18);
    OperatorNodeDefinitions.forEach((definition) => {
      const manifest = definition.operatorManifest;
      expect(manifest).toBeTruthy();
      expect(manifest.inputs).toBeTruthy();
      expect(manifest.parameters).toBeTruthy();
      expect(manifest.context).toBeTruthy();
      expect(manifest.processing).toBeTruthy();
      expect(manifest.contributions).toBeTruthy();
      expect(manifest.interactions).toBeTruthy();
      expect(manifest.outputs).toBeTruthy();
    });
  });

  it('installs the common runtime contract for every Operator package', () => {
    OperatorNodeDefinitions.forEach((definition) => {
      const runtime = definition.createRuntime().createOperator({
        id: `test:${definition.typeId}`,
        typeId: definition.typeId,
        label: definition.label,
        params: { ...(definition.defaultParams || {}) },
        ports: definition.ports
      }, {});

      expect(runtime.operatorRuntimeContractVersion).toBe(1);
      expect(typeof runtime.beginExecution).toBe('function');
      expect(typeof runtime.publishOutput).toBe('function');
      expect(typeof runtime.getOutputDataset).toBe('function');
      expect(typeof runtime.subscribeOutput).toBe('function');
      expect(typeof runtime.cleanupBase).toBe('function');
    });
  });
});

describe('SharedContext', () => {
  it('tracks revisions, sources, equality and batches', () => {
    const context = new SharedContext({}, { allowedKeys: ['selection'], workspaceId: 'W1' });
    const listener = vi.fn();
    context.subscribe('selection', listener);

    expect(context.set('selection', { id: 'A' }, { source: 'test' })).toBe(true);
    const current = context.get('selection');
    expect(context.set('selection', current, { source: 'test' })).toBe(false);
    context.batch(() => {
      context.set('selection', { id: 'B' }, { source: 'batch' });
      context.set('selection', { id: 'C' }, { source: 'batch' });
    }, { source: 'batch' });

    expect(context.get('selection')).toEqual({ id: 'C' });
    expect(context.getEntry('selection').source).toBe('batch');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('canonicalizes legacy aliases and clears only declared selection keys', () => {
    const context = new SharedContext({}, {
      allowedKeys: ['selectedVentilationBranch', 'selection', 'timeCursor'],
      workspaceId: 'W2'
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(context.set('selectedBranch', 'B1')).toBe(true);
    expect(context.get('selectedVentilationBranch')).toBe('B1');
    expect(context.get('selectedBranch')).toBe('B1');
    expect(context.set('selectedGeologicalUnit', 'GU_1')).toBe(false);
    expect(context.set('selectedGeologicalUnit', 'GU_2')).toBe(false);
    expect(warning).toHaveBeenCalledTimes(1);

    context.set('selection', { type: 'ventilationBranch', id: 'B1' });
    context.set('time', 12);
    context.clearDeclaredSelection();

    expect(context.get('selectedVentilationBranch')).toBeNull();
    expect(context.get('selection')).toBeNull();
    expect(context.get('timeCursor')).toBe(12);
    warning.mockRestore();
  });
});

describe('VisualContributionManager', () => {
  it('coalesces transactions and repeated focus updates without synchronous recursion', async () => {
    const manager = new VisualContributionManager();
    const listener = vi.fn();
    manager.subscribe(listener);
    const show = vi.fn();
    const hide = vi.fn();

    manager.register({
      id: 'panel:one',
      type: 'panel',
      ownerFunctionId: 'F1',
      label: 'Panel One',
      show,
      hide
    });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);

    manager.transaction(() => {
      manager.setVisible('panel:one', false);
      manager.setVisible('panel:one', true);
      manager.setOpacity('panel:one', 0.6);
      manager.setFocusedFunction('F1');
    });
    for (let index = 0; index < 10_000; index += 1) {
      manager.setFocusedFunction('F1');
      manager.setVisible('panel:one', true);
    }
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(3);
    expect(manager.revision).toBe(2);
    expect(manager.get('panel:one').effectiveVisible).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
  });

  it('unregisters one contribution with cleanup and one coalesced removal notification', async () => {
    const manager = new VisualContributionManager();
    const cleanup = vi.fn();
    const listener = vi.fn();
    manager.subscribe(listener);
    manager.register({ id: 'panel:temporary', type: 'panel', label: 'Temporary', cleanup });
    await Promise.resolve();

    expect(manager.unregister('panel:temporary')).toBe(true);
    expect(manager.unregister('panel:temporary')).toBe(false);
    await Promise.resolve();

    expect(manager.get('panel:temporary')).toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls.at(-1)?.[1]?.removed).toEqual(['panel:temporary']);
  });
  it('routes panel activation requests without coupling operators to the layout engine', () => {
    const manager = new VisualContributionManager();
    const listener = vi.fn();
    const dispose = manager.subscribeActivation(listener);
    const element = {};

    manager.register({
      id: 'panel:chart',
      type: 'chart',
      label: 'Chart',
      element,
      visible: false
    });
    manager.register({
      id: 'layer:scene',
      type: 'scene-layer',
      label: 'Scene Layer'
    });

    expect(manager.requestActivate('panel:chart')).toBe(true);
    expect(manager.get('panel:chart').visible).toBe(true);
    expect(listener).toHaveBeenCalledWith('panel:chart', manager.get('panel:chart'));
    expect(manager.requestActivate('layer:scene')).toBe(false);

    dispose();
    manager.requestActivate('panel:chart');
    expect(listener).toHaveBeenCalledTimes(1);
  });

});


describe('WorkspaceRuntime dependency lifecycle', () => {
  it('promotes and demotes one retained dependency session without duplicate attach or cleanup', async () => {
    const contributionManager = new VisualContributionManager();
    const dependencyCleanup = vi.fn();
    const dependentCleanup = vi.fn();
    const dependencyOperator = {
      id: 'O1',
      operatorManifest: { dependencyExposure: { exposeWhenRootActive: true } },
      attach: vi.fn(async ({ contributionRegistry, functionId }) => {
        contributionRegistry.register({
          id: 'O1:panel',
          ownerId: 'O1',
          functionId,
          type: 'panel',
          label: 'Dependency panel'
        });
        return { cleanup: dependencyCleanup };
      }),
      updateViews: vi.fn()
    };
    const dependentOperator = {
      id: 'O2',
      operatorManifest: {},
      attach: vi.fn(async () => ({ cleanup: dependentCleanup })),
      recomputeRoutes: vi.fn()
    };
    const dependencyFunction = {
      id: 'F1',
      label: 'Dependency function',
      operator: dependencyOperator,
      dependencies: [],
      enabled: false
    };
    const dependentFunction = {
      id: 'F2',
      label: 'Dependent function',
      operator: dependentOperator,
      dependencies: [dependencyOperator],
      enabled: false
    };
    const workspace = {
      id: 'W1',
      context: {},
      functions: [dependencyFunction, dependentFunction],
      datasetChannels: []
    };
    const sceneManager = { setActiveInteractionOwner: vi.fn() };
    const runtime = new WorkspaceRuntime({ workspace, sceneManager, contributionManager });

    await runtime.attachFunction(dependentFunction);
    const retainedSession = runtime.dependencyRecords.get('O1').session;
    expect(dependencyOperator.attach).toHaveBeenCalledTimes(1);
    expect(contributionManager.get('O1:panel').ownerFunctionId).toBe('F2');

    await runtime.attachFunction(dependencyFunction);
    expect(dependencyFunction.session).toBe(retainedSession);
    expect(dependencyOperator.attach).toHaveBeenCalledTimes(1);
    expect(contributionManager.get('O1:panel').ownerFunctionId).toBe('F1');

    runtime.closeFunction(dependencyFunction, { keepPinned: false });
    expect(dependencyCleanup).not.toHaveBeenCalled();
    expect(contributionManager.get('O1:panel').ownerFunctionId).toBe('F2');

    await runtime.attachFunction(dependencyFunction);
    expect(dependencyOperator.attach).toHaveBeenCalledTimes(1);
    expect(contributionManager.get('O1:panel').ownerFunctionId).toBe('F1');

    runtime.closeFunction(dependencyFunction, { keepPinned: false });
    runtime.closeFunction(dependentFunction, { keepPinned: false });
    expect(dependencyCleanup).toHaveBeenCalledTimes(1);
    expect(dependentCleanup).toHaveBeenCalledTimes(1);
    expect(contributionManager.get('O1:panel')).toBeUndefined();
  });
});

describe('LayoutStateStore', () => {
  it('ignores legacy v5 keys when loading v6 layout state', () => {
    const entries = new Map();
    const originalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key) => entries.get(key) || null,
      setItem: (key, value) => entries.set(key, String(value)),
      removeItem: (key) => entries.delete(key)
    };
    entries.set(
      'minevis.preview.layout.v5:graph:workspace:wide',
      JSON.stringify({ version: 5, layout: { legacy: true } })
    );
    const store = new LayoutStateStore();
    expect(store.load({ graphId: 'graph', workspaceId: 'workspace', viewportClass: 'wide' })).toBeNull();
    globalThis.localStorage = originalStorage;
  });
});

describe('DatasetChannel', () => {
  it('rejects an output that violates its Dataset contract', () => {
    const channel = new DatasetChannel({
      id: 'hazard',
      type: 'RoadwayHazardStateDataset',
      portId: 'hazardState'
    });
    expect(() => channel.publish({
      type: 'WrongDataset',
      semanticClass: 'Wrong',
      templates: {}
    })).toThrow('Invalid Dataset output');
  });
});

describe('WorkspaceCompiler', () => {
  function operatorNode(id, typeId, ports) {
    const runtime = {
      createOperator(node, inputs) {
        return {
          id: node.id,
          label: node.label,
          inputs,
          attach: async () => ({ cleanup() {} }),
          getOutputDataset: () => null
        };
      }
    };
    return { id, kind: 'operator', typeId, label: typeId, params: {}, ports, runtime };
  }

  function moduleNode(id) {
    return {
      id,
      kind: 'module',
      typeId: 'module',
      label: id,
      params: { functions: [{ id: 'function-1', label: 'Root', placeholder: false }] },
      ports: [{ id: 'function-1', direction: 'in', type: 'OperatorRef' }],
      runtime: {
        createWorkspace(node, operators) {
          return { id: node.id, label: node.label, operators };
        }
      }
    };
  }

  function edge(fromNode, fromPort, toNode, toPort) {
    return {
      id: `${fromNode}:${fromPort}->${toNode}:${toPort}`,
      from: { nodeId: fromNode, portId: fromPort },
      to: { nodeId: toNode, portId: toPort }
    };
  }

  function fixture({ cycle = false, workspaceCount = 1 } = {}) {
    const data = {
      id: 'D1',
      kind: 'data',
      ports: [{ id: 'dataset', direction: 'out', type: 'InputDataset' }]
    };
    const upstream = operatorNode('O1', 'upstream', [
      { id: 'input', direction: 'in', type: 'InputDataset' },
      { id: 'operator', direction: 'out', type: 'OperatorRef' },
      { id: 'state', direction: 'out', type: 'OutputDataset' }
    ]);
    const root = operatorNode('O2', 'root', [
      { id: 'state', direction: 'in', type: 'OutputDataset' },
      { id: 'operator', direction: 'out', type: 'OperatorRef' }
    ]);
    const modules = Array.from({ length: workspaceCount }, (_, index) => moduleNode(`M${index + 1}`));
    const edges = [
      edge('D1', 'dataset', 'O1', 'input'),
      edge('O1', 'state', 'O2', 'state'),
      ...modules.map((module) => edge('O2', 'operator', module.id, 'function-1'))
    ];
    if (cycle) edges.push(edge('O2', 'operator', 'O1', 'input'));
    return { nodes: [data, upstream, root, ...modules], edges };
  }

  function registry() {
    const definitions = new Map([
      ['upstream', {
        inputRequirements: {},
        operatorManifest: {
          context: { consumes: [], publishes: ['selection'] },
          dependencyExposure: { exposeWhenRootActive: true }
        }
      }],
      ['root', {
        inputRequirements: {},
        operatorManifest: { context: { consumes: ['selection'], publishes: [] } }
      }]
    ]);
    return { get: (typeId) => definitions.get(typeId) || null };
  }

  it('topologically compiles dependencies and isolates runtime instances by workspace', () => {
    const graph = fixture({ workspaceCount: 2 });
    const compiler = new WorkspaceCompiler({ graph, definitionRegistry: registry() });
    const result = compiler.compile(new Map([['D1', { dataset: { type: 'InputDataset' } }]]));

    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces[0].topologicalOrder).toEqual(['O1', 'O2']);
    expect(result.workspaces[0].functions[0].dependencies).toHaveLength(1);
    expect(result.workspaces[0].functions[0].operator).not.toBe(
      result.workspaces[1].functions[0].operator
    );
    expect(result.workspaces[0].context.allowedKeys).toEqual(
      new Set(['selection', 'timeCursor'])
    );
  });


  it('validates and routes a derived Dataset through an Operator closure', () => {
    const hazard = createRoadwayHazardStateDataset([
      {
        time: 0,
        roadwayEdgeId: 'E1',
        hazardType: 'water',
        hazardValue: 1,
        severity: 'high',
        passability: 'blocked',
        scenarioId: 'closure-test'
      }
    ]);
    const data = {
      id: 'D1',
      kind: 'data',
      ports: [{ id: 'dataset', direction: 'out', type: 'InputDataset' }]
    };
    const upstream = operatorNode('O1', 'upstream', [
      { id: 'input', direction: 'in', type: 'InputDataset' },
      { id: 'operator', direction: 'out', type: 'OperatorRef' },
      { id: 'hazardState', direction: 'out', type: 'RoadwayHazardStateDataset' }
    ]);
    upstream.runtime = {
      createOperator(node, inputs) {
        return {
          id: node.id,
          inputs,
          outputs: { hazardState: hazard },
          attach: async () => ({ cleanup() {} }),
          getOutputDataset: (portId) => portId === 'hazardState' ? hazard : null
        };
      }
    };
    const root = operatorNode('O2', 'root', [
      { id: 'hazardState', direction: 'in', type: 'RoadwayHazardStateDataset' },
      { id: 'operator', direction: 'out', type: 'OperatorRef' }
    ]);
    const module = moduleNode('M1');
    const graph = {
      nodes: [data, upstream, root, module],
      edges: [
        edge('D1', 'dataset', 'O1', 'input'),
        edge('O1', 'hazardState', 'O2', 'hazardState'),
        edge('O2', 'operator', 'M1', 'function-1')
      ]
    };
    const definitions = new Map([
      ['upstream', {
        inputRequirements: {},
        operatorManifest: {
          context: { consumes: [], publishes: ['timeCursor'] },
          dependencyExposure: { exposeWhenRootActive: true }
        }
      }],
      ['root', {
        inputRequirements: {
          hazardState: {
            class: 'RoadwayHazardState',
            requiredTemplates: ['State', 'Field', 'Relation']
          }
        },
        operatorManifest: {
          context: { consumes: ['timeCursor'], publishes: [] },
          dependencyExposure: { exposeWhenRootActive: false }
        }
      }]
    ]);
    const compiler = new WorkspaceCompiler({
      graph,
      definitionRegistry: { get: (typeId) => definitions.get(typeId) || null }
    });
    const workspace = compiler.compile(
      new Map([['D1', { dataset: { type: 'InputDataset' } }]])
    ).workspaces[0];
    const proxy = workspace.functions[0].operator.inputs.hazardState;

    expect(workspace.diagnostics).toEqual([]);
    expect(workspace.functions[0].dependencies).toHaveLength(1);
    expect(workspace.plan.functions[0].exposurePolicy.exposeWhenRootActive).toBe(false);
    expect(proxy.__operatorDatasetOutput).toBe(true);
    expect(proxy.getDataset()).toBe(hazard);
    expect(proxy.channel.validation.valid).toBe(true);
    expect(proxy.channel.validation.summary.semanticClass).toBe('RoadwayHazardState');
  });

  it('rejects Operator dependency cycles', () => {
    const graph = fixture({ cycle: true });
    const compiler = new WorkspaceCompiler({ graph, definitionRegistry: registry() });

    expect(() => compiler.compile(
      new Map([['D1', { dataset: { type: 'InputDataset' } }]])
    )).toThrow('Operator cycle detected');
  });
});

describe('Graph schema migration', () => {
  it('loads a schema-less graph and serializes the current version', () => {
    const registry = {
      get: () => ({
        kind: 'data',
        label: 'Test',
        defaultParams: {},
        ports: [],
        createRuntime: () => ({})
      })
    };
    const graph = new GraphModel(registry);
    graph.load({
      nodes: [{ id: 'N1', typeId: 'test', position: { x: 0, y: 0 } }],
      edges: []
    });
    const serialized = JSON.parse(graph.serialize());

    expect(serialized.schemaVersion).toBe(GRAPH_SCHEMA_VERSION);
    expect(serialized.nodes[0].id).toBe('N1');
  });
});
