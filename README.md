# MineVis Demo

MineVis is a configurable visualization framework demo for underground mining. The current codebase follows the D-O-M architecture used in the paper:

```text
Data -> Operator -> Module
```

Configurators use the node editor to connect semantic Data Nodes, reusable Operator Nodes, and Module Nodes. End users use the runtime workspace, functions, and visual contributions.

The implementation-level mapping from the paper formalism to registries, packages, and runtime services is documented in [D-O-M Architecture: Paper-to-Code Mapping](docs/architecture/dom-code-mapping.md).

## Run

```bash
npm install
npm run dev
```

Open the Vite URL in the browser. The editor is served from `index.html`; the runtime preview is served from `preview.html`.

## Built-in Demo Graphs

The Editor discovers every `*.json` graph in `src/presets/graphs/` through Vite at build time. Presets are listed by filename in the `Built-in graph` selector, and the first filename in case-insensitive alphabetical order is loaded when the Editor starts.

The bundled presets are:

- `Environmental_Monitoring.json`: six nodes and seven connections.
- `Ventilation_Analysis.json`: eight nodes and fifteen connections.

Selecting a preset replaces the current graph immediately. If the current graph has unsaved changes, the Editor asks for confirmation first. `Load JSON` imports a local graph for the current session; it does not add that file to the built-in preset catalog. Add source-controlled presets to `src/presets/graphs/`; Vite reloads them during development, while GitHub Pages requires a new production build and deployment. If no valid preset exists, the Editor falls back to its minimal Monitoring seed graph.
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
Roadway scalar operators support coordinated multi-sensor comparison (up to eight sensors). The linked time-series chart can be presented as a docked panel, an interactive scene callout, a camera-facing world billboard, or a fixed world plane. One to four series use a shared chart by default; five to eight use small multiples. The Sensor List, 3D markers, chart series, and legend share primary, comparison, and hover selection state.


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

- `timeCursor`: current airflow state snapshot time (`time` remains a legacy alias).
- `selectedVentilationBranch`: primary ventilation branch (`selectedBranch` remains a legacy alias).
- `selectedVentilationFacility`: current ventilation facility.
- `selection`: generic primary selection.
- `selectionSet`: ordered same-type comparison members and primary ID.
- `hoveredSelection`: transient cross-view hover target.
- `activeAirflowVariable`: current airflow variable, such as `airQuantity`, `velocity`, or `pressureDrop`.

`Airflow Distribution Analysis` uses a branch-attached airflow glyph metaphor: arrows encode direction, branch width/tube radius encodes air quantity, color encodes the selected variable, and non-normal `anomaly_type` rows are highlighted. Airflow Distribution and Branch Airflow Trend both support up to eight linked branches, stable comparison colors, 3D halos, automatic superimposed/small-multiple layouts, and the four shared chart presentations. `Ventilation Anomaly Inspection` evaluates the current airflow snapshot for non-normal anomaly types, reverse flow, low airflow, high pressure drop, and missing data; it adds type/severity/branch filters, branch search, sorting, a shared time slider, an anomaly timeline, explanatory detail, and branch selection publishing for coordinated diagnosis.

## Emergency Response Data Layer

The node library includes the base datasets needed for the Emergency Response Workspace. They are not added to the default seed graph.

Data presets:

- `People`: taxonomy `Equipment, People & Mobile Asset`; semantic class `People`; templates `Registry`, `Geometry`, `State`, `Relation`; default source `/data/people.json`.
- `Emergency Resources`: taxonomy `Safety, Hazard & Emergency`; semantic class `EmergencyResources`; templates `Registry`, `Geometry`, `Relation`; default source `/data/emergency_resources.json`.

Derived dataset prepared for future simulation operators:

- `Roadway Hazard State`: taxonomy `Safety, Hazard & Emergency / Simulation & Scenario`; semantic class `RoadwayHazardState`; templates `State`, `Field`, `Relation`; intended output of operators such as `Water Inrush Simulation` or `Fire and Smoke Simulation`.

`Roadway Hazard State` is not treated as a primary hand-authored dataset. Water inrush source location, intensity, and timing should be implemented as simulation operator parameters, not as a standalone Data Node.

## Emergency Response Operators

The node library includes the first Emergency Response operators. They are not part of the default seed graph.

Operator presets:

- `Water Inrush Simulation`: primary operator class `Simulation`; input `Roadway`; output `Roadway Hazard State`; visual contributions include `Roadway 3D Model`, `Water Inrush Hazard Overlay`, `Hazard Legend`, and `Affected Roadway Summary`. It generates graph-propagated water depth states over roadway edges and can export the generated hazard dataset as JSON or CSV.
- `Fire and Smoke Simulation`: primary operator class `Simulation`; inputs `Roadway`, optional `Ventilation Network`, and optional `Airflow State`; output `Roadway Hazard State`; visual contributions include fire source marker, fire/heat and smoke hazard overlay, risk/passability coloring, fire/smoke controls, legend, and summary. It uses a simplified 1D roadway-cell model with fire spread, smoke diffusion, and one-way ventilation-coupled smoke advection.
- `Personnel Emergency Analysis`: primary operator class `Topological`; inputs `Roadway`, `People`, `Emergency Resources`, and optional `Roadway Hazard State`; visual contributions include `3D Emergency Response Overlay`, `2D Emergency Response Map`, people/resource markers, `Emergency Response Summary`, `Personnel Risk & Route List`, `Emergency Resource Panel`, `Route Detail Panel`, `Quick Hazard Sketch`, and `Emergency Response Legend`.
- `Safe Route Analysis (Legacy)`: compatibility alias for earlier graphs; new configurations should use `Personnel Emergency Analysis`.

`Personnel Emergency Analysis` supports the main hazard-source modes:

- no hazard state: normal shortest-path routing to available exits
- upstream hazard state: consumes `Water Inrush Simulation.hazardState` or `Fire and Smoke Simulation.hazardState`
- imported hazard state: consumes a `Roadway Hazard State (Mock)` Data Node
- quick hazard sketch: end users can mark roadway edges as `blocked`, `risky`, or `clear`; the temporary constraint state can be exported as a `RoadwayHazardState` dataset

Dataset closure example:

```text
Water Inrush Simulation.hazardState
        -> Personnel Emergency Analysis.hazardState

Fire and Smoke Simulation.hazardState
        -> Personnel Emergency Analysis.hazardState
```

`Roadway Hazard State` is a first-class semantic dataset whether it comes from a Data Node, a simulation operator, or manual constraints. Downstream operators consume it through the same semantic contract.

## Geological Analysis Data Layer

The node library now includes the base datasets needed for the Geological Analysis Workspace. They are not added to the default seed graph.

Geological Body presets:

- `Layered Geological Body`: semantic class `GeologicalBody`; representation profile `layered-surface`; templates `Registry`, `Geometry`, `Field`, `Relation`.
- `Volumetric / Block Geological Body`: semantic class `GeologicalBody`; representation profile `volumetric-block`; templates `Registry`, `Geometry`, `Field`, `Relation`.
- `Geological Body`: generic entry for layered, volumetric, hybrid, or manually mapped geological bodies.

Borehole and structure presets:

- `Borehole`: semantic class `Borehole`; templates `Registry`, `Geometry`, `Field`, `Relation`; supports collar, trajectory, interval log, sample, lithology, and assay roles.
- `Geological Structure`: semantic class `GeologicalStructure`; templates `Registry`, `Geometry`, optional `Field`, `Relation`; supports faults, fractures, folds, broken zones, and structural zones.

Geological Attribute Model presets:

- `Resource Block Model`: semantic class `GeologicalAttributeModel`; representation profile `resource-block`; templates `Geometry`, `Field`, `Registry`, `Relation`.
- `Coal Seam Attribute Model`: semantic class `GeologicalAttributeModel`; representation profile `coal-seam-attribute`; templates `Geometry`, `Field`, `Registry`, `Relation`.
- `Geological Risk / Uncertainty Model`: semantic class `GeologicalAttributeModel`; representation profile `risk-uncertainty`; templates `Geometry`, `Field`, `Registry`, `Relation`.
- `Geological Attribute Model`: generic spatial attribute model entry.

All geological Data Nodes use the same semanticization flow as the existing monitoring, ventilation, and emergency datasets: source adaptor, representation profile, editable role mapping, template preview, and validation. The sample sources live in `public/data/geological`, exposed in the frontend as `/data/geological/...`.

Geological Data Nodes use fixed source slots rather than a required manifest file. Descriptor files with the suffix `.minevis.json` are optional: when supplied, they can fill source slots, representation profile, and suggested role mapping, but the Inspector still keeps role mapping editable.

Default sample slots include:

- `Layered Geological Body`: `/data/geological/layered_geological_surfaces.obj`, `/data/geological/layered_geological_units.csv`, `/data/geological/layered_geological_surfaces.csv`, and `/data/geological/layered_geological_relations.csv`.
- `Volumetric / Block Geological Body`: `/data/geological/geovolume_geological_bodies.obj`, `/data/geological/geovolume_bodies.csv`, and `/data/geological/geovolume_surfaces.csv`.
- `Borehole`: `/data/geological/boreholes.csv`, `/data/geological/borehole_trajectories.json`, and `/data/geological/borehole_intervals.csv`.
- `Geological Structure`: `/data/geological/geological_structures.obj`, `/data/geological/geological_structures.csv`, and `/data/geological/geological_structure_relations.csv`.
- `Resource Block Model`: `/data/geological/resource_block_grid.json`, `/data/geological/resource_block_attribute_schema.csv`, and `/data/geological/resource_block_attributes.bin`, so large block models do not need to be expanded into huge JSON files.
- `Coal Seam Attribute Model`: `/data/geological/coal_seam_attribute_grid.csv`.

Generic and risk/uncertainty geological entries remain creatable without sample files; missing required sources appear as validation errors rather than crashing the app. Legacy single JSON geology exports remain supported as optional source slots.

## Geological Model Overview

`Geological Model Overview` is the first Geological Analysis Workspace operator. It is a `Spatial` operator that consumes `Geological Body` and can optionally consume `Roadway`, `Borehole`, `Geological Structure`, and `Geological Attribute Model`.

Visual contributions:

- `3D Geological Model Layer`: geological body surfaces or sampled blocks, borehole trajectories, structures/faults, optional roadway context, optional attribute points/blocks, and selection highlight.
- `Geological Layer / Object Panel`: show/hide, opacity, color mode, active attribute, and object lists.
- `Geological Legend`: geological unit or lithology colors, attribute color scale, borehole and structure symbols.
- `Selected Geological Object Detail`: details for selected units, surfaces, boreholes, structures, and blocks.
- `Attribute Summary`: active attribute, element counts, grid size, and value range when an attribute model is connected.

Shared context keys include `selectedGeologicalUnit`, `selectedSurface`, `selectedBorehole`, `selectedStructure`, `selectedBlock`, `activeGeologicalAttribute`, and `selection`.

## Geological Section Analysis

`Geological Section Analysis` is a `Spatial` operator for interactive geological cross-section workflows. It consumes `Geological Body` and can optionally consume `Roadway`, `Borehole`, `Geological Structure`, and `Geological Attribute Model`.

Visual contributions:

- `3D Geological Section Layer`: section plane / slab, cutaway geological body context, and 3D intersection highlights.
- `2D Geological Section View`: projected section lines, block / volume slice samples, boreholes, structures, and roadway crossings.
- `Section Control Panel`: axis-aligned or vertical two-point section mode, axis, position, thickness, cutaway, layer toggles, color mode, active attribute, and recompute controls.
- `Section Legend`: geological unit / lithology / active attribute symbols plus borehole, structure, and roadway symbols.
- `Section Summary / Detail Panel`: section counts and selected section element detail.

The current implementation uses local clipping support for the 3D cutaway view and computes 2D section elements through triangle-plane intersection for meshes, with slab projection fallbacks for block models, boreholes, structures, and roadway paths. Shared context keys include `sectionFrame`, `selectedSectionElement`, `selectedSurface`, `selectedBorehole`, `selectedStructure`, `selectedBlock`, `selectedRoadwaySegment`, `activeGeologicalAttribute`, and `selection`.

## Borehole & Stratigraphy Correlation

`Borehole & Stratigraphy Correlation` is a `Spatial` operator for borehole-centered interpretation and multi-borehole stratigraphic comparison. It consumes `Borehole` and can optionally consume `Geological Body`, `Geological Structure`, `Geological Attribute Model`, and `Roadway`.

Visual contributions:

- `3D Borehole Correlation Layer`: borehole collar markers, trajectory segments, lithology-colored intervals, and selected borehole / interval highlight.
- `Borehole Log Panel`: selected borehole depth log with lithology intervals and optional active attribute samples.
- `Multi-borehole Correlation Canvas`: side-by-side borehole logs with unit / lithology correlation lines.
- `Correlation Control Panel`: borehole selection, display mode, depth reference, alignment, ordering, active attribute, and layer toggles.
- `Borehole / Interval Detail Panel`: selected borehole, interval, geological unit, and simple model match / mismatch details.
- `Borehole Legend`: lithology swatches, selected symbols, and correlation line style.

Shared context keys include `selectedBorehole`, `selectedBoreholeInterval`, `selectedGeologicalUnit`, `sectionFrame`, `activeGeologicalAttribute`, and `selection`. When `Geological Section Analysis` provides a `sectionFrame`, the correlation canvas can order boreholes by section distance.

## Geological Attribute Distribution Analysis

`Geological Attribute Distribution Analysis` is a `Spatial` operator for interactive analysis of grades, seam thickness, coal quality, resource attributes, risk values, and uncertainty fields from a `Geological Attribute Model`. It can optionally consume `Geological Body`, `Roadway`, `Borehole`, and `Geological Structure` as spatial context.

Visual contributions:

- `3D Attribute Distribution Layer`: block, voxel, sample, or surface attribute elements colored by the active attribute, with filtered target-zone highlighting.
- `Attribute Histogram / Distribution View`: histogram, value range marker, and range sliders for linked brushing.
- `Attribute Control Panel`: active attribute, colormap, filter mode, render mode, range inputs, max rendered elements, context toggles, and opacity.
- `Attribute Detail Panel`: selected block / sample / cell position, all available attribute values, lithology, unit or orebody relation, and category.
- `Attribute Summary Panel`: total/rendered/filtered counts, min/max/mean, and runtime target-zone statistics.
- `Attribute Legend`: active attribute colormap, value range, and target-zone symbol explanation.

Shared context keys include `activeGeologicalAttribute`, `attributeRangeFilter`, `selectedAttributeElement`, `selectedBlock`, `selectedGeologicalRegion`, and `selection`. The current runtime target-zone result is kept internal for future `GeologicalTargetZoneDataset` output.

## Roadway-Geology Relationship Analysis

`Roadway-Geology Relationship Analysis` is a `Spatial` operator for mapping geological bodies, structures, attribute fields, and borehole evidence onto the roadway graph. It consumes `Roadway` and can optionally consume `Geological Body`, `Geological Structure`, `Geological Attribute Model`, and `Borehole`.

Visual contributions:

- `3D Roadway-Geology Relationship Overlay`: roadway edges colored by risk, geological unit, structure distance, or active attribute.
- `Roadway-Geology Topology / Map View`: 2D roadway map with relation coloring and selected segment highlight.
- `Roadway Geological Profile Panel`: selected roadway edge profile with attribute curve and geological markers.
- `Roadway-Geology Relation Table`: edge relation rows with risk, nearest structure distance, and active attribute mean.
- `Detail Panel`: selected roadway segment length, geological units, nearest structure, attribute stats, nearby boreholes, risk level, and recommendation.
- `Legend / Summary`: color legend, total roadway length, risk length, structure-proximity count, and attribute-threshold count.
- `Control Panel`: analysis mode, active attribute, structure thresholds, attribute threshold, filters, context toggles, and section handoff.

Interactions include roadway segment selection, risk / unit / structure filtering, active attribute synchronization, and `Create Section Near Selected Roadway`, which writes a `sectionFrame` for `Geological Section Analysis`. The current relation result remains runtime-local for a future `RoadwayGeologyRelationStateDataset`.

## Runtime Concepts

- **Data Node**: semantic adaptor. It connects data sources, selects source adaptors, applies role mapping, materializes data templates, validates a semantic contract, and returns a dataset.
- **Dataset**: semantic runtime object consumed by operators. In MineVis, `Dataset = Semantic Contract + Data Templates`.
- **Semantic Contract**: dataset class, roles, required templates, and constraints. Demo contracts include monitoring, ventilation, and emergency response datasets.
- **Data Template**: internal structural form from the paper taxonomy: `Geometry`, `Graph`, `Registry`, `State`, `Field`, and `Relation`.
- **Role Mapping**: configurator-editable mapping from adaptor fields/paths to semantic roles, for example `observedEntity <- sensorID`.
- **Operator**: configurator-facing capability block. It consumes datasets, subscribes to module context, and emits visual contributions.
- **Module / Workspace**: end-user workspace that owns shared context and function toggles.
- **Function**: runtime concept inferred from a root operator connected to a module. There is no separate Function Node in the editor.
- **Visual Contribution**: visible artifact produced by an operator, such as scene layers, charts, controls, legends, or panels.

## Preview Workspace

Preview uses a full-screen Main Scene with an overlay dock workspace. The Three.js canvas always occupies the complete viewport. Function controls, charts, topology views, sections, profiles, legends, details, summaries, and the Visual Contributions manager are dockable UI contributions above the scene.

Panels can be resized, grouped as tabs, moved between the left/right/bottom regions, floated inside Preview, auto-hidden to an edge rail, closed, and restored. `Scene Focus` temporarily hides unpinned panels without disabling Functions, while `Reset Layout` restores the descriptor-driven layout for the active Module and viewport class.

The semantic and spatial responsibilities remain separate:

- `VisualContributionManager` owns contribution lifecycle, visibility, opacity, focus, pinning, order, and composition.
- `WorkspaceLayoutService` owns docking, tab groups, floating bounds, auto-hide, resize, and layout persistence.
- `SceneViewportInsets` keeps camera focus and orientation aids inside the currently unobstructed scene area.
- `ResponsiveViewHost` resizes visible charts and 2D views after dock changes without rebuilding Operator state.

Layout state is stored separately for each graph identity, Module, and wide/medium/compact viewport class. It is UI state and is never written to graph JSON. See [Preview Workspace and Visual Contribution Layout](docs/architecture/preview-workspace.md) for the contribution layout contract and extension rules.

## Data Node Semanticization Flow

Each Data Node follows the same pipeline:

````text
Optional Descriptor
  -> Source Slot Loading / Inspection
  -> Field Catalog
  -> Editable Role Resolution
  -> Dataset Materialization
  -> Data Template Validation
  -> Semantic Contract Validation
  -> Dataset Instance
```

Current source adaptors:

- `CSVTableAdaptor`: parses CSV tables, previews fields, suggests role mappings.
- `JSONGraphAdaptor`: parses roadway graph JSON, previews node/edge paths.
- `OBJGeometryAdaptor`: parses OBJ geometry, previews mesh part names.
- `VentilationNetworkJsonAdaptor`: parses ventilation nodes, branches, facilities, relations, and boundary conditions.
- `AirflowStateCsvAdaptor`: parses branch-based airflow state rows and suggests airflow role mappings.
- `PeopleJsonAdaptor`: parses personnel identities, positions, state, and roadway anchors.
- `EmergencyResourcesJsonAdaptor`: parses emergency resource identities, positions, resource attributes, and roadway anchors.
- `RoadwayHazardStateAdaptor`: parses imported roadway hazard state CSV or JSON for debugging and downstream response analysis.
- `LayeredGeologyJsonAdaptor`: parses layered geological body JSON with units, surfaces, meshes, attributes, and relations.
- `SurfaceMeshGeologyAdaptor`: previews OBJ / STL / glTF surface mesh parts for geological body and geological structure geometry support.
- `ResourceBlockGridJsonAdaptor`: reads resource block grid metadata such as dimensions, bounds, cell size, and binary attribute offsets.
- `ResourceBlockAttributeBinaryAdaptor`: reads resource block attribute arrays from `.bin` / `.raw` files.
- `VolumetricBlockModelJsonAdaptor`: parses volumetric block geological body JSON.
- `BlockModelCsvAdaptor`: parses CSV resource block models.
- `BoreholeJsonAdaptor` / `BoreholeCsvAdaptor` / `BoreholeTrajectoryJsonAdaptor`: parse borehole registry, collar positions, trajectory, interval logs, samples, and assays.
- `GeologicalStructureJsonAdaptor`: parses faults, fractures, folds, traces, surfaces, and structural zones.
- `GeologicalAttributeTableAdaptor`: parses generic geological attribute tables, coal seam attributes, and risk / uncertainty models.

Current contracts and templates:

- `RoadwayContract`: class `Roadway`; templates `Graph`, `Geometry`, `Relation`.
- `SensorRegistryContract`: class `SensorRegistry`; templates `Registry`, `Geometry`, `Relation`.
- `SensorReadingsContract`: class `EnvironmentalSensorReadings`; templates `State`, `Relation`.
- `VentilationNetworkContract`: class `VentilationNetwork`; templates `Graph`, `Registry`, `Relation`.
- `AirflowStateContract`: class `AirflowState`; templates `State`, `Field`, `Relation`.
- `PeopleContract`: class `People`; templates `Registry`, `Geometry`, `State`, `Relation`.
- `EmergencyResourcesContract`: class `EmergencyResources`; templates `Registry`, `Geometry`, `Relation`.
- `RoadwayHazardStateContract`: class `RoadwayHazardState`; templates `State`, `Field`, `Relation`.
- `GeologicalBodyContract`: class `GeologicalBody`; templates `Registry`, `Geometry`, `Relation`, recommended `Field`.
- `BoreholeContract`: class `Borehole`; templates `Registry`, `Geometry`, `Field`, `Relation`.
- `GeologicalStructureContract`: class `GeologicalStructure`; templates `Registry`, `Geometry`, `Relation`, optional `Field`.
- `GeologicalAttributeModelContract`: class `GeologicalAttributeModel`; templates `Geometry`, `Field`, recommended `Registry`, `Relation`.

The Inspector exposes configurator-facing semanticization controls by default:

- source paths
- editable role mapping
- validation report

Developer-oriented details such as resolved source adaptors, semantic contracts, output ports, and materialized data template summaries are available in the collapsed `Developer details` section.

## Source Layout

- `src/main.js`: editor bootstrap. Registers public node-definition facades, loads built-in graph presets, and opens Preview.
- `src/preview.js`: runtime page bootstrap and UI adapter. Workspace compilation and lifecycle behavior live in Module services.
- `src/core/adaptors/`: source adaptor registry and format adaptors. Every registered adaptor exposes `canLoad`, `load`, and `inspect`.
- `src/core/semantics/`: Data Template, Dataset definition/materializer, semanticization, and taxonomy registries.
- `src/core/datasets/<Dataset>/`: package-local contract, definition, materializer, runtime export, validators, and public index for each built-in Dataset.
- `src/core/nodes/DataNodes.js`: stable Data Node compatibility facade.
- `src/core/nodes/DataNodeRuntime.js`: compatibility parameter normalization and semanticization entry point.
- `src/core/nodes/DataNodePresetRegistry.js` and `src/core/nodes/presets/`: formal preset registry and built-in Data Node catalog.
- `src/core/operators/OperatorNodes.js`: compatibility facade that exports aggregated `OperatorNodeDefinitions`.
- `src/core/operators/environmental/`, `ventilation/`, `emergency/`, and `geology/`: family aggregators and independent Operator packages.
- `src/core/operators/manifests/`: explicit paper-level Operator manifests.
- `src/core/operators/shared/`: definition factory, execution context, lifecycle base, rendering utilities, and runtime composition.
- `src/core/modules/`: Module definition registry, Workspace compiler/runtime, Shared Context, Dataset Channel, contribution manager, and host registry.
- `src/core/graph/`: versioned graph model, migration reader, built-in graph registry, and node definition registry.
- `src/presets/graphs/`: source-controlled built-in Editor graph JSON files discovered automatically by Vite.
- `src/core/algorithms/` and `src/core/simulation/`: source-neutral analysis and simulation kernels.
- `src/scene/SceneManager.js`: Three.js scene ownership and shared scene services.
- `src/ui/`: editor, Inspector, chart, legend, runtime panel/control/list/table/canvas helpers, and related UI components.
- `public/data/`: bundled semanticization input data for the demo.

The formal paper symbols and their implementation interfaces are mapped in [D-O-M Architecture: Paper-to-Code Mapping](docs/architecture/dom-code-mapping.md).

## Extension Rules

- New Dataset capabilities must use a package under `src/core/datasets/<Dataset>/` with a Semantic Contract, template bindings, materializer, runtime Dataset export, and executable validators.
- New Data Template instances must use `Geometry`, `Graph`, `Registry`, `State`, `Field`, or `Relation`. Data Templates are never draggable nodes.
- New Data Node presets reference an existing Dataset ID and declare source slots, representation profile, descriptor support, and editable role mapping.
- New Operators must use `defineOperator()` and explicitly declare inputs, parameters, context, processing, contributions, interactions, and outputs.
- Every Operator declares one primary class: `Spatial`, `Topological`, `Temporal`, or `Simulation`.
- Source parsing belongs in adaptors. Domain meaning belongs in Dataset contracts and materializers. Operators consume Dataset accessors only.
- Module behavior belongs in `WorkspaceCompiler`, `WorkspaceRuntime`, `SharedContext`, `DatasetChannel`, or `VisualContributionManager`; `preview.js` must remain bootstrap-only.
- Existing type IDs, ports, Dataset types, graph schema migration, and compatibility facade import paths remain stable.

## Legacy Cleanup Note

Older prototype concepts such as fragmented `RoadwayTopology` / `RoadwayGeometry` contracts, facet outputs, explicit Function Nodes, `DataResource`, and `SensorDataset` have been removed from the active source tree. New extensions should add semantic datasets, configurator-facing operators, or module/workspace behavior instead of reintroducing the old facet/function-node pipeline.
