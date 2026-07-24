# D-O-M Architecture: Paper-to-Code Mapping

This document defines how the formal concepts in `docs/paper_latex.md` map to the MineVis implementation. It is an implementation contract, not only a source-layout guide. Compatibility facades preserve existing graph files and public imports while registries enforce the formal model.

## Architecture Overview

```text
Project sources
  -> Data Node semanticization
  -> semantic Dataset instances
  -> Operator processing and visual contributions
  -> Module workspace compilation and coordination
```

The authoring graph is configurator-facing. Data Nodes, Operator Nodes, and Module Nodes remain the only draggable D-O-M node kinds. Data Templates are internal developer abstractions. At runtime, Module Nodes become workspaces and root Operator chains become end-user Functions.

## Formal Mapping

| Paper concept | Formal role | Code interface |
|---|---|---|
| Data Template `T = <kind, attribute schema>` | Finite structural basis | `DataTemplateRegistry`, `DataTemplates` |
| Semantic Contract `Sigma = <class, roles, constraints>` | Domain meaning and validity | package `contract.js`, `defineSemanticContract()` |
| Dataset `D = <Sigma, Delta>` | Semantic runtime data | package `definition.js`, `BaseSemanticDataset` |
| Template binding `Delta` and role relation `rho` | Binds semantic roles to internal structures | `templateBindings`, `roleMapping` |
| Data Node | Source-to-Dataset semanticization | `DataNodePresetRegistry`, `SemanticizationService` |
| Operator `O = <D_in, P, C, Phi, V, I, D_out>` | Reusable visual-analytic capability | `defineOperator()`, `operatorManifest` |
| Module | Authoring composition scope | `ModuleDefinitionRegistry`, `ModuleNodes` |
| Workspace | Runtime Module instance | `WorkspaceCompiler`, `WorkspaceRuntime` |
| Shared context | Module-scoped coordination | `SharedContext` |
| Dataset closure | Semantic Operator composition | `DatasetChannel` |
| Visual composition | Contribution lifecycle and coordination | `VisualContributionManager` |
| Visual host | Named workspace placement target | `WorkspaceHostRegistry` |

## Data Template Layer

`DataTemplateRegistry` contains exactly six structural kinds:

- `Geometry`
- `Graph`
- `Registry`
- `State`
- `Field`
- `Relation`

Each definition declares accepted structural forms, an attribute schema, multiplicity, and an executable validator. Runtime template instances retain the compatibility fields `id`, `type`, `role`, `data`, and `metadata`.

Templates are never editor nodes. A configurator selects a domain Dataset preset such as `Roadway`, `Borehole`, or `Resource Block Model`; the Dataset materializer constructs the internal templates.

## Dataset Layer

Each built-in Dataset owns a package under `src/core/datasets/<Dataset>/`:

```text
definition.js   Dataset identity, taxonomy, template bindings
contract.js     semantic class, roles, executable constraints
materializer.js source-neutral construction of templates and runtime data
runtime.js      stable runtime Dataset class export
validators.js   package-local domain invariants
index.js        package exports
```

`DatasetDefinitionRegistry` is the authoritative index. A definition declares:

- stable Dataset ID and runtime type;
- semantic class and contract;
- one of the eight canonical Dataset taxonomy IDs;
- template bindings, including required/optional multiplicity;
- semantic roles;
- executable constraints;
- runtime Dataset class;
- materializer ID.

`BaseSemanticDataset` provides the common runtime shape:

```text
type
semanticClass
contract
templates
roleMapping
validation
source
metadata
```

Domain Dataset classes preserve their existing accessors. Operators consume those accessors and render-support APIs, not source paths, adaptor results, or raw fetch operations.

The compatibility files `SemanticContractRegistry.js`, `DatasetMaterializers.js`, and `datasets/definitions/index.js` are registry facades. They contain no domain implementation.

## Data Node Semanticization

A Data Node is a preset over a Dataset definition. Multiple presets can produce the same Dataset type, for example layered and volumetric geological body presets.

`DataNodes.js` is the stable public facade. `DataNodeRuntime.js` owns compatibility normalization and invokes semanticization, while `nodes/presets/` contains configurator-facing preset metadata.

`SemanticizationService` executes a fixed staged pipeline:

1. Parse an optional descriptor.
2. Resolve and load configured source slots.
3. Build a source field catalog.
4. infer and merge editable role mappings.
5. Materialize the Dataset.
6. Validate Data Templates.
7. Validate the Semantic Contract and Dataset definition.

Every source adaptor exposes `canLoad(source)`, `load(source, contract)`, and `inspect(source, contract)`. Legacy adaptors with `supports()` are wrapped by `SourceAdaptorRegistry`.

Diagnostics retain their stage, severity, code, path, and details. A missing required source returns an invalid Dataset without crashing the application. A missing optional source produces a warning.

## Operator Layer

Every public Operator is created through `defineOperator()` and receives an explicit `operatorManifest`. The tuple from the paper maps as follows:

| Tuple member | Manifest field |
|---|---|
| `D_in` | `inputs` and semantic `inputRequirements` |
| `P` | `parameters.defaults` and `parameters.schema` |
| `C` | `context.consumes` and `context.publishes` |
| `Phi` | `processing` |
| `V` | `contributions` |
| `I` | `interactions` |
| `D_out` | `outputs` |

A visual contribution must declare `id`, `host`, `contributionKind`, `semanticRole`, `objectSystem`, `visualChannels`, and `composition`.

Each Operator is an independent package with at least `definition.js`, `runtime.js`, and `index.js`. Domain algorithms, panels, scene layers, and canvas views belong in package-local or family-shared services. Runtime classes orchestrate these services and own lifecycle cleanup; they do not parse source files.

`OperatorNodes.js` is a stable compatibility facade. It aggregates packages and binds their explicit manifests without changing type IDs, ports, or graph serialization.

## Module Layer

`WorkspaceCompiler` translates the authored graph into runtime workspaces:

1. Identify root Operators connected to Module Function slots.
2. Trace upstream Operator dependencies.
3. detect cycles.
4. validate semantic input compatibility.
5. create a workspace-local Operator runtime instance graph.
6. create Dataset Channels for semantic outputs.
7. topologically order dependencies.
8. derive Function plans and exposure policies.
9. create the allowed Shared Context interface.

`WorkspaceRuntime` attaches dependencies before root Operators, reference-counts shared dependencies, exposes dependency controls only when declared by manifest, and performs deterministic cleanup.

`SharedContext` tracks value, revision, source, equality, and batched updates. This prevents simple feedback loops and isolates context between workspaces.

`DatasetChannel` validates derived outputs against Dataset definitions before downstream consumption. This is the executable form of Dataset closure.

`VisualContributionManager` owns visibility, opacity, order, focus, pinning, interaction locks, and contribution cleanup. It uses descriptors instead of labels or Operator-specific type checks.

`WorkspaceLayoutService` presents panel contributions as an overlay dock workspace while the Main Scene remains a full-screen underlay. `ContributionLayoutPolicy` maps semantic roles to default regions, `LayoutStateStore` persists UI layout outside graph JSON, `ResponsiveViewHost` resizes charts and canvas views, and `SceneViewportInsets` provides an unobstructed rectangle for camera focus. The complete contract is documented in [Preview Workspace and Visual Contribution Layout](preview-workspace.md).

`preview.js` is only the page bootstrap and UI adapter for these Module services.

## Compatibility Boundaries

The following interfaces remain stable:

- `DataNodeDefinitions`
- `OperatorNodeDefinitions`
- `ModuleNodeDefinitions`
- all node `typeId` values;
- all port IDs and Dataset types;
- existing default parameters and seed graph;
- graph JSON without `schemaVersion`, through the migration reader;
- existing Dataset accessors.

Graph serialization writes the current optional `schemaVersion`. Runtime-only UI state does not enter graph JSON.

## Extension Workflow

### Add a Dataset

1. Create a package in `src/core/datasets/<Dataset>/`.
2. Compose only the six registered Data Template kinds.
3. Define semantic roles and executable constraints in `contract.js`.
4. Implement source-neutral materialization in `materializer.js`.
5. expose domain accessors through the runtime Dataset class.
6. Register the definition through the Dataset definition facade.
7. Add or reuse a Data Node preset and source adaptors.
8. Add contract, materializer, and semanticization tests.

### Add a Data Node Preset

1. Reference an existing Dataset ID.
2. Declare representation profile, source slots, descriptor support, and default role mapping.
3. Keep role mapping editable.
4. Do not introduce a new Dataset class merely for a file format.

### Add an Operator

1. Create an independent Operator package.
2. Use `defineOperator()`.
3. Declare all seven formal manifest components, including empty context or outputs when appropriate.
4. Consume Dataset accessors only.
5. Place algorithms and views outside orchestration methods.
6. declare every visual contribution and interaction.
7. Add smoke, lifecycle, and browser regression coverage.

### Add a Module Type

1. Define workspace, Function, Shared Context, visual composition, and Dataset closure policies.
2. Register through `ModuleDefinitionRegistry`.
3. Let `WorkspaceCompiler` derive dependencies; do not hardcode Operator type IDs in preview code.

## Architecture Gates

Run these checks before merging:

```bash
npm run check:english
npm run check:architecture
npm run test:operators
npm run test:unit
npm run test:e2e
npm run build
```

`check:architecture` enforces the six templates, eight Dataset taxonomy classes, 12 Dataset packages, 21 Data Node presets, 18 explicit Operator manifests and packages, one Module definition, executable constraints, stable facades, and unique ports/type IDs.
