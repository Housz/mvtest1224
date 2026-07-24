import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataTemplateRegistry } from '../src/core/semantics/DataTemplateRegistry.js';
import {
  CanonicalDatasetTaxonomy,
  DatasetDefinitionRegistry
} from '../src/core/semantics/DatasetDefinitionRegistry.js';
import { BuiltInDatasetDefinitions } from '../src/core/datasets/definitions/index.js';
import {
  BuiltInDatasetMaterializers
} from '../src/core/semantics/DatasetMaterializers.js';
import {
  DataNodeDefinitions,
  DataNodePresetRegistry
} from '../src/core/nodes/DataNodes.js';
import {
  OperatorNodeDefinitions,
  OperatorManifestRegistry,
  validateOperatorDefinition
} from '../src/core/operators/OperatorNodes.js';
import {
  ModuleNodeDefinitions,
  ModuleDefinitionRegistry
} from '../src/core/modules/ModuleNodes.js';
import { SemanticContractRegistry } from '../src/core/semantics/SemanticContractRegistry.js';

const errors = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const operatorRoot = resolve(process.cwd(), 'src/core/operators');
const operatorPackages = {
  environmental: ['RoadwayScalarStateAnalysis'],
  ventilation: [
    'VentilationNetworkOverview',
    'AirflowDistributionAnalysis',
    'BranchAirflowTrendInspection',
    'VentilationAnomalyInspection'
  ],
  emergency: [
    'WaterInrushSimulation',
    'FireAndSmokeSimulation',
    'PersonnelEmergencyAnalysis',
    'SafeRouteAnalysis'
  ],
  geology: [
    'GeologicalModelOverview',
    'GeologicalSectionAnalysis',
    'BoreholeStratigraphyCorrelation',
    'GeologicalAttributeDistributionAnalysis',
    'RoadwayGeologyRelationshipAnalysis'
  ]
};

Object.entries(operatorPackages).forEach(([family, packages]) => {
  const familyIndex = resolve(operatorRoot, family, 'index.js');
  check(existsSync(familyIndex), `Operator family ${family} has no index.js.`);
  if (existsSync(familyIndex)) {
    check(readFileSync(familyIndex, 'utf8').split(/\r?\n/).length <= 40,
      `Operator family ${family} index contains implementation code.`);
  }
  packages.forEach((packageName) => {
    ['definition.js', 'runtime.js', 'index.js'].forEach((fileName) => {
      check(
        existsSync(resolve(operatorRoot, family, packageName, fileName)),
        `Operator package ${family}/${packageName} is missing ${fileName}.`
      );
    });
    const definitionPath = resolve(operatorRoot, family, packageName, 'definition.js');
    if (existsSync(definitionPath)) {
      check(
        readFileSync(definitionPath, 'utf8').includes('defineOperator('),
        `Operator package ${family}/${packageName} does not use defineOperator().`
      );
    }
  });
});

[
  resolve(operatorRoot, 'geology/GeologyOperators.js'),
  resolve(operatorRoot, 'ventilation/VentilationOperators.js'),
  resolve(operatorRoot, 'emergency/EmergencyOperators.js')
].forEach((legacyPath) => {
  check(!existsSync(legacyPath), `Legacy Operator family implementation still exists: ${legacyPath}.`);
});


function listJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

listJavaScriptFiles(operatorRoot)
  .filter((filePath) => filePath.endsWith('runtime.js'))
  .forEach((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    check(!/\badaptorResults\b/.test(source),
      `Operator runtime reads adaptorResults directly: ${filePath}.`);
    check(!/\bfetch\s*\(/.test(source),
      `Operator runtime fetches project sources directly: ${filePath}.`);
  });
const operatorFacadePath = resolve(operatorRoot, 'OperatorNodes.js');
check(readFileSync(operatorFacadePath, 'utf8').split(/\r?\n/).length <= 50,
  'OperatorNodes.js must remain a small compatibility facade.');

const previewSource = readFileSync(resolve(process.cwd(), 'src/preview.js'), 'utf8');
const layoutSource = readFileSync(resolve(process.cwd(), 'src/core/modules/WorkspaceLayoutServiceV6.js'), 'utf8');
check(previewSource.includes('core/modules/WorkspaceLayoutServiceV6.js'),
  'Preview must use the single-grid WorkspaceLayoutService v6.');
check(!layoutSource.includes('.setVisible('),
  'WorkspaceLayoutService must not call unsupported DockviewPanelApi.setVisible().');
check(!layoutSource.includes('addEdgeGroup') && !layoutSource.includes('documentRoot') &&
  !layoutSource.includes('autoHideRecord') && !layoutSource.includes('workspace-auto-hide-rail') &&
  !layoutSource.includes('MAIN_SCENE_ID') && !layoutSource.includes('toggleSceneFocus') &&
  !layoutSource.includes('registerSystemPanel'),
  'WorkspaceLayoutService v6 must use one Dockview grid without legacy layout modes.');
const singleGridPolicySource = readFileSync(
  resolve(process.cwd(), 'src/core/modules/SingleGridContributionLayoutPolicy.js'),
  'utf8'
);
check(!/\bzone\s*:/.test(singleGridPolicySource) &&
  !/\bdocumentRoot\s*:/.test(singleGridPolicySource) &&
  !/\bautoHide\s*:/.test(singleGridPolicySource) &&
  !/\ballowedDock\s*:/.test(singleGridPolicySource),
  'Single-grid Panel policy must not emit legacy panel categories or docking restrictions.');
check(layoutSource.includes('UnifiedPanelContentHost'),
  'WorkspaceLayoutService must use the unified panel content lifecycle.');
const contributionManagerSource = readFileSync(
  resolve(process.cwd(), 'src/core/modules/VisualContributionManager.js'),
  'utf8'
);
check(contributionManagerSource.includes('SingleGridContributionLayoutPolicy.js') &&
  !contributionManagerSource.includes("'./ContributionLayoutPolicy.js'"),
  'VisualContributionManager must normalize active panels through the single-grid policy.');
const previewWorkspaceCss = readFileSync(resolve(process.cwd(), 'src/ui/preview-workspace.css'), 'utf8');
check(!/workspace-auto-hide|workspace-main-scene|dv-groupview-edge/.test(previewWorkspaceCss),
  'Active Preview CSS must not contain legacy auto-hide, Edge Group, or Main Scene special cases.');
[
  'WorkspaceLayoutServiceV5.js', 'DockingPolicyV5.js', 'DockingDragControllerV5.js',
  'ContributionPanelHost.js', 'InteractiveCanvasHost.js', 'ResponsiveViewHost.js'
].forEach((fileName) => {
  check(!existsSync(resolve(process.cwd(), 'src/core/modules', fileName)),
    `Legacy Preview layout module still exists: ${fileName}.`);
});
const datasetRoot = resolve(process.cwd(), 'src/core/datasets');
const datasetPackages = [
  'Roadway',
  'SensorRegistry',
  'SensorReadings',
  'VentilationNetwork',
  'AirflowState',
  'People',
  'EmergencyResources',
  'RoadwayHazardState',
  'GeologicalBody',
  'Borehole',
  'GeologicalStructure',
  'GeologicalAttributeModel'
];
datasetPackages.forEach((packageName) => {
  ['definition.js', 'contract.js', 'materializer.js', 'runtime.js', 'validators.js', 'index.js']
    .forEach((fileName) => {
      check(
        existsSync(resolve(datasetRoot, packageName, fileName)),
        `Dataset package ${packageName} is missing ${fileName}.`
      );
    });
  const definitionPath = resolve(datasetRoot, packageName, 'definition.js');
  const contractPath = resolve(datasetRoot, packageName, 'contract.js');
  if (existsSync(definitionPath)) {
    check(readFileSync(definitionPath, 'utf8').includes('defineBuiltInDataset('),
      `Dataset package ${packageName} does not use defineBuiltInDataset().`);
  }
  if (existsSync(contractPath)) {
    check(readFileSync(contractPath, 'utf8').includes('defineSemanticContract('),
      `Dataset package ${packageName} does not use defineSemanticContract().`);
  }
});
check(readFileSync(resolve(datasetRoot, 'definitions/index.js'), 'utf8').split(/\r?\n/).length <= 50,
  'Dataset definition index must remain a small compatibility facade.');
check(readFileSync(resolve(process.cwd(), 'src/core/semantics/DatasetMaterializers.js'), 'utf8')
  .split(/\r?\n/).length <= 100,
  'DatasetMaterializers.js must remain a small registry facade.');
check(readFileSync(resolve(process.cwd(), 'src/core/semantics/SemanticContractRegistry.js'), 'utf8')
  .split(/\r?\n/).length <= 100,
  'SemanticContractRegistry.js must remain a small registry facade.');

const templateDefinitions = DataTemplateRegistry.list();
check(templateDefinitions.length === 6, `Expected 6 Data Template definitions, received ${templateDefinitions.length}.`);
templateDefinitions.forEach((definition) => {
  check(definition.kind, 'Data Template definition is missing kind.');
  check(definition.forms.length > 0, `Data Template ${definition.kind} has no forms.`);
  check(typeof definition.validate === 'function', `Data Template ${definition.kind} has no validator.`);
  definition.attributes.forEach((attribute) => {
    check(attribute.key && attribute.domain && attribute.multiplicity,
      `Data Template ${definition.kind} has an incomplete attribute schema.`);
  });
});

check(CanonicalDatasetTaxonomy.length === 8,
  `Expected 8 canonical Dataset taxonomy classes, received ${CanonicalDatasetTaxonomy.length}.`);
check(new Set(CanonicalDatasetTaxonomy.map((item) => item.id)).size === 8,
  'Canonical Dataset taxonomy IDs are not unique.');

check(BuiltInDatasetDefinitions.length === 12,
  `Expected 12 Dataset definitions, received ${BuiltInDatasetDefinitions.length}.`);
check(DatasetDefinitionRegistry.list().length === 12,
  `Dataset Definition Registry contains ${DatasetDefinitionRegistry.list().length} definitions.`);
check(Object.keys(BuiltInDatasetMaterializers).length === 12,
  `Expected 12 Dataset materializers, received ${Object.keys(BuiltInDatasetMaterializers).length}.`);
SemanticContractRegistry.list().forEach((contract) => {
  const definition = DatasetDefinitionRegistry.getByContract(contract.id);
  check(Boolean(definition), `Semantic contract ${contract.id} has no Dataset definition.`);
  check(!definition || definition.semanticClass === contract.class,
    `Dataset ${definition?.id || contract.id} semantic class does not match contract ${contract.id}.`);
  check((contract.constraints || []).every((constraint) => typeof constraint.validate === 'function'),
    `Semantic contract ${contract.id} contains a non-executable constraint.`);
});
BuiltInDatasetDefinitions.forEach((definition) => {
  check(Boolean(BuiltInDatasetMaterializers[definition.materializerId]),
    `Dataset ${definition.id} has no materializer ${definition.materializerId}.`);
  check(Object.keys(definition.templateBindings).length > 0,
    `Dataset ${definition.id} has no template bindings.`);
  check(definition.constraints.every((constraint) => typeof constraint.validate === 'function'),
    `Dataset ${definition.id} contains a non-executable constraint.`);
});

const dataNodeRoot = resolve(process.cwd(), 'src/core/nodes');
const dataNodeFacadePath = resolve(dataNodeRoot, 'DataNodes.js');
const dataNodeRuntimePath = resolve(dataNodeRoot, 'DataNodeRuntime.js');
const dataNodeCatalogPath = resolve(dataNodeRoot, 'presets/BuiltInDataNodePresets.js');
check(existsSync(dataNodeRuntimePath), 'Data Node runtime compatibility module is missing.');
check(existsSync(dataNodeCatalogPath), 'Built-in Data Node preset catalog is missing.');
check(readFileSync(dataNodeFacadePath, 'utf8').split(/\r?\n/).length <= 50,
  'DataNodes.js must remain a small compatibility facade.');
check(!readFileSync(dataNodeRuntimePath, 'utf8').includes('BuiltInDataNodeDefinitions'),
  'Data Node runtime must not depend on the built-in preset catalog.');
check(DataNodePresetRegistry.list().length === DataNodeDefinitions.length,
  'Data Node preset registry and public definitions have different sizes.');
DataNodeDefinitions.forEach((definition) => {
  const preset = DataNodePresetRegistry.get(definition.typeId);
  check(Boolean(preset), `Data Node ${definition.typeId} has no preset definition.`);
  check(Boolean(DatasetDefinitionRegistry.get(preset?.datasetId)),
    `Data Node ${definition.typeId} references an unknown Dataset.`);
  const output = definition.ports?.find((port) => port.direction === 'out');
  check(output?.type === preset?.output?.type,
    `Data Node ${definition.typeId} output does not match its preset.`);
});

check(OperatorNodeDefinitions.length === 18,
  `Expected 18 Operator definitions, received ${OperatorNodeDefinitions.length}.`);
check(OperatorManifestRegistry.list().length === 18,
  `Expected 18 explicit Operator manifests, received ${OperatorManifestRegistry.list().length}.`);
OperatorNodeDefinitions.forEach((definition) => {
  const validation = validateOperatorDefinition(definition, { requireExplicitManifest: true });
  validation.errors.forEach((message) => errors.push(message));
  const manifest = definition.operatorManifest;
  check(manifest.typeId === definition.typeId,
    `Operator manifest type mismatch for ${definition.typeId}.`);

  const runtime = definition.createRuntime().createOperator({
    id: `architecture:${definition.typeId}`,
    typeId: definition.typeId,
    label: definition.label,
    params: { ...(definition.defaultParams || {}) },
    ports: definition.ports
  }, {});
  check(runtime?.operatorRuntimeContractVersion === 1,
    `Operator ${definition.typeId} does not expose runtime contract version 1.`);
  ['beginExecution', 'publishOutput', 'getOutputDataset', 'subscribeOutput', 'cleanupBase']
    .forEach((method) => {
      check(typeof runtime?.[method] === 'function',
        `Operator ${definition.typeId} runtime is missing ${method}().`);
    });
    manifest.contributions.forEach((contribution) => {
    ['id', 'host', 'contributionKind', 'semanticRole', 'objectSystem'].forEach((key) => {
      check(Boolean(contribution[key]),
        `Operator ${definition.typeId} contribution is missing ${key}.`);
    });
    check(Boolean(contribution.visualChannels),
      `Operator ${definition.typeId} contribution ${contribution.id} has no visualChannels.`);
    check(Boolean(contribution.composition),
      `Operator ${definition.typeId} contribution ${contribution.id} has no composition.`);
    check(Boolean(contribution.layout?.content?.profile),
      `Operator ${definition.typeId} contribution ${contribution.id} has no content profile.`);
  });
});

check(ModuleNodeDefinitions.length === 1,
  `Expected one Module definition, received ${ModuleNodeDefinitions.length}.`);
check(ModuleDefinitionRegistry.list().length === ModuleNodeDefinitions.length,
  'Module Definition Registry and public definitions have different sizes.');
ModuleNodeDefinitions.forEach((definition) => {
  const manifest = definition.moduleManifest;
  ['workspace', 'functions', 'sharedContext', 'visualComposition', 'datasetClosure'].forEach((key) => {
    check(Boolean(manifest?.[key]), `Module ${definition.typeId} is missing manifest.${key}.`);
  });
});

const allDefinitions = [
  ...DataNodeDefinitions,
  ...OperatorNodeDefinitions,
  ...ModuleNodeDefinitions
];
const typeIds = allDefinitions.map((definition) => definition.typeId);
check(new Set(typeIds).size === typeIds.length, 'Node typeIds are not unique.');
allDefinitions.forEach((definition) => {
  check(typeof definition.createRuntime === 'function',
    `Node ${definition.typeId} has no runtime factory.`);
  (definition.ports || []).forEach((port) => {
    check(port.id && port.name && port.direction && port.type,
      `Node ${definition.typeId} has an incomplete port.`);
  });
});

if (errors.length) {
  console.error('MineVis architecture check failed:');
  errors.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log(
  `Architecture check passed: ${templateDefinitions.length} templates, ` +
  `${BuiltInDatasetDefinitions.length} datasets, ${DataNodeDefinitions.length} data presets, ` +
  `${OperatorNodeDefinitions.length} operators, ${ModuleNodeDefinitions.length} module.`
);
