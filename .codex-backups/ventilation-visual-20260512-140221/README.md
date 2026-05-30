# MineVis Demo

MineVis is a configurable visualization framework demo for underground mining. The current codebase follows the D-O-M architecture used in the paper:

```text
Data -> Operator -> Module
```

Configurators use the node editor to connect semantic Data Nodes, reusable Operator Nodes, and Module Nodes. End users use the runtime workspace, functions, and visual contributions.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL in the browser. The editor is served from `index.html`; the runtime preview is served from `preview.html`.

## Current Demo Graph

The editor seeds a minimal concept-correct graph:

```text
Roadway
Sensor Registry
Temperature Sensor Readings
        -> Roadway Temperature Analysis
        -> Monitoring Workspace
```

The graph contains:

- `Roadway` Data Node: materializes a `RoadwayDataset` from `roadway_topo.json` and `roadway_model.obj`.
- `Sensor Registry` Data Node: materializes a `SensorRegistryDataset` from `temperature_sensors.csv`.
- `Temperature Sensor Readings` Data Node: materializes an environmental scalar readings dataset from `Temperature_timeseries_20steps.csv`.
- `Roadway Temperature Analysis` Operator Node: colors roadway geometry by temperature, displays sensor markers, handles sensor selection, and renders the selected sensor trend chart.
- `Monitoring Workspace` Module Node: turns connected root operators into runtime functions.

## Environmental Monitoring Presets

The editor exposes concrete environmental monitoring presets for configurators while reusing generic developer-maintained implementations.

Data presets:

- `Temperature Sensor Readings`
- `CO Sensor Readings`
- `Humidity Sensor Readings`
- `CH4 Sensor Readings`
- `Environmental Sensor Readings`

Operator presets:

- `Roadway Temperature Analysis`
- `Roadway CO Concentration Analysis`
- `Roadway Humidity Analysis`
- `Roadway CH4 Concentration Analysis`
- `Roadway Scalar State Analysis`

The concrete presets set variable, unit, default range, colormap, and labels. Internally they reuse the same environmental readings materializer and the same roadway scalar state analysis runtime.

## Ventilation Analysis Additions

The node library also includes the first ventilation workspace building blocks. They are not added to the default seed graph, so the temperature demo remains the startup example.

Data presets:

- `Ventilation Network`: taxonomy `Ventilation & Utility Network`; semantic class `VentilationNetwork`; templates `Graph`, `Registry`, `Relation`; default source `/data/ventilation_network.json`.
- `Airflow State`: taxonomy `Ventilation & Utility Network`; semantic class `AirflowState`; templates `State`, `Field`, `Relation`; default source `/data/airflow_state.csv`.

Operator presets:

- `Ventilation Network Overview`: primary operator class `Topological`; inputs `Roadway` and `Ventilation Network`; visual contributions are `Roadway 3D Model`, `Ventilation 2D Drawing`, `Ventilation Topology Graph`, `3D Ventilation Network Overlay`, `Facility Legend`, and `Branch / Facility Detail Panel`.
- `Airflow Distribution Analysis`: primary operator class `Topological`; inputs `Roadway`, `Ventilation Network`, and `Airflow State`; visual contributions are `Roadway 3D Model`, `3D Airflow Distribution Overlay`, `Airflow Network State View`, `Airflow Legend / Variable Control`, and `Selected Branch Airflow Summary`.
- `Branch Airflow Trend Inspection`: primary operator class `Temporal`; inputs `Roadway`, `Ventilation Network`, and `Airflow State`; visual contributions are `Roadway 3D Model`, `Ventilation 2D Drawing`, `Ventilation Topology Graph`, `3D Ventilation Network Overlay`, `Branch Airflow Trend Chart`, `Branch Selector / Context Panel`, and `Branch Airflow Statistics Panel`.
- `Ventilation Anomaly Inspection`: primary operator class `Topological`; inputs `Roadway`, `Ventilation Network`, and `Airflow State`; visual contributions are `Ventilation Anomaly List`, `Anomaly Timeline`, `3D Anomaly Highlight Overlay`, `Topology Anomaly Highlight View`, and `Anomaly Detail Panel`.

The overview and airflow operators share module context keys:

- `time`: current airflow state snapshot time.
- `selectedBranch`: current ventilation branch.
- `selectedFacility`: current ventilation facility, used by the overview operator.
- `selection`: generic shared selection object.
- `activeAirflowVariable`: current airflow variable, such as `airQuantity`, `velocity`, or `pressureDrop`.

`Airflow Distribution Analysis` uses a branch-attached airflow glyph metaphor: arrows encode direction, branch width/tube radius encodes air quantity, color encodes the selected variable, and non-normal `anomaly_type` rows are highlighted. `Branch Airflow Trend Inspection` follows the shared `selectedBranch`, `time`, and `activeAirflowVariable` context to update trend charts and statistics. `Ventilation Anomaly Inspection` evaluates the current airflow snapshot for non-normal anomaly types, reverse flow, low airflow, high pressure drop, and missing data; it adds type/severity/branch filters, branch search, sorting, a shared time slider, an anomaly timeline, explanatory detail, and branch selection publishing for coordinated diagnosis.

## Runtime Concepts

- **Data Node**: semantic adaptor. It connects data sources, selects source adaptors, applies role mapping, materializes data templates, validates a semantic contract, and returns a dataset.
- **Dataset**: semantic runtime object consumed by operators. In MineVis, `Dataset = Semantic Contract + Data Templates`.
- **Semantic Contract**: dataset class, roles, required templates, and constraints. Demo contracts are `Roadway`, `SensorRegistry`, and `SensorReadings`.
- **Data Template**: internal structural form from the paper taxonomy: `Geometry`, `Graph`, `Registry`, `State`, `Field`, and `Relation`.
- **Role Mapping**: configurator-editable mapping from adaptor fields/paths to semantic roles, for example `observedEntity <- sensorID`.
- **Operator**: configurator-facing capability block. It consumes datasets, subscribes to module context, and emits visual contributions.
- **Module / Workspace**: end-user workspace that owns shared context and function toggles.
- **Function**: runtime concept inferred from a root operator connected to a module. There is no separate Function Node in the editor.
- **Visual Contribution**: visible artifact produced by an operator, such as scene layers, charts, controls, legends, or panels.

## Data Node Semanticization Flow

Each Data Node follows the same pipeline:

```text
Data Source
  -> Source Adaptor
  -> Role Mapping
  -> Data Templates
  -> Semantic Contract Validation
  -> Dataset Instance
```

Current source adaptors:

- `CSVTableAdaptor`: parses CSV tables, previews fields, suggests role mappings.
- `JSONGraphAdaptor`: parses roadway graph JSON, previews node/edge paths.
- `OBJGeometryAdaptor`: parses OBJ geometry, previews mesh part names.
- `VentilationNetworkJsonAdaptor`: parses ventilation nodes, branches, facilities, relations, and boundary conditions.
- `AirflowStateCsvAdaptor`: parses branch-based airflow state rows and suggests airflow role mappings.

Current contracts and templates:

- `RoadwayContract`: class `Roadway`; templates `Graph`, `Geometry`, `Relation`.
- `SensorRegistryContract`: class `SensorRegistry`; templates `Registry`, `Geometry`, `Relation`.
- `SensorReadingsContract`: class `EnvironmentalSensorReadings`; templates `State`, `Relation`.
- `VentilationNetworkContract`: class `VentilationNetwork`; templates `Graph`, `Registry`, `Relation`.
- `AirflowStateContract`: class `AirflowState`; templates `State`, `Field`, `Relation`.

The Inspector exposes configurator-facing semanticization controls by default:

- source paths
- editable role mapping
- validation report

Developer-oriented details such as resolved source adaptors, semantic contracts, output ports, and materialized data template summaries are available in the collapsed `Developer details` section.

## Source Layout

- `src/main.js`: editor entry. Registers node definitions, seeds the graph, opens preview.
- `src/preview.js`: runtime entry. Executes data nodes, creates operator instances, builds workspaces, manages visual contributions.
- `src/core/adaptors/`: source adaptor registry and format adaptors.
- `src/core/semantics/`: dataset taxonomy, semantic contracts, data templates, and dataset materializers.
- `src/core/environmental/EnvironmentalPresets.js`: environmental readings and roadway scalar analysis preset metadata.
- `src/core/nodes/DataNodes.js`: semantic Data Node definitions.
- `src/core/datasets/`: runtime dataset classes and data loading registry.
- `src/core/operators/OperatorNodes.js`: configurator-facing Operator Node definitions.
- `src/core/operators/OperatorKernels.js`: low-level kernels used internally by operators. These are not editor nodes.
- `src/core/modules/ModuleNodes.js`: Module Node definitions.
- `src/core/graph/`: graph model and node definition registry.
- `src/core/algorithms/FieldSolver.js`: roadway temperature field and mesh coloring algorithms.
- `src/scene/SceneManager.js`: Three.js scene, OBJ roadway loading, sensor/ventilation picking, layer visibility/opacity.
- `src/ui/`: node editor, inspector, chart, legend, and related UI helpers.
- `src/utils/colors.js`: colormap definitions and sampling utilities.
- `public/data/`: bundled demo roadway, sensor registry, temperature series, and small mock CO / humidity / CH4 time-series files.

## Extension Rules

- New dataset classes should come from the MineVis dataset taxonomy or be explicit extensions of it.
- New data template instances should use the paper template taxonomy: `Geometry`, `Graph`, `Registry`, `State`, `Field`, or `Relation`.
- New operators must declare one primary operator taxonomy class: `Spatial`, `Topological`, `Temporal`, or `Simulation`.
- Source parsing belongs in source adaptors. Domain meaning belongs in semantic contracts and dataset materializers.
- Data templates are internal to datasets and should not be exposed as draggable editor nodes.

## Legacy Cleanup Note

Older prototype concepts such as fragmented `RoadwayTopology` / `RoadwayGeometry` contracts, facet outputs, explicit Function Nodes, `DataResource`, and `SensorDataset` have been removed from the active source tree. New extensions should add semantic datasets, configurator-facing operators, or module/workspace behavior instead of reintroducing the old facet/function-node pipeline.
