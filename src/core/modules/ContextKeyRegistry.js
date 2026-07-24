export const ContextKeys = Object.freeze({
  selection: 'selection',
  selectionSet: 'selectionSet',
  hoveredSelection: 'hoveredSelection',
  timeCursor: 'timeCursor',
  selectedRoadwaySegment: 'selectedRoadwaySegment',
  selectedSensor: 'selectedSensor',
  selectedVentilationBranch: 'selectedVentilationBranch',
  selectedVentilationFacility: 'selectedVentilationFacility',
  activeAirflowVariable: 'activeAirflowVariable',
  selectedHazardSource: 'selectedHazardSource',
  selectedHazardSegment: 'selectedHazardSegment',
  activeRoadwayHazardState: 'activeRoadwayHazardState',
  selectedPerson: 'selectedPerson',
  selectedEmergencyResource: 'selectedEmergencyResource',
  selectedEvacuationRoute: 'selectedEvacuationRoute',
  selectedGeologicalUnit: 'selectedGeologicalUnit',
  selectedGeologicalBody: 'selectedGeologicalBody',
  selectedSurface: 'selectedSurface',
  selectedBorehole: 'selectedBorehole',
  selectedBoreholeInterval: 'selectedBoreholeInterval',
  selectedStructure: 'selectedStructure',
  selectedBlock: 'selectedBlock',
  selectedAttributeElement: 'selectedAttributeElement',
  selectedSectionElement: 'selectedSectionElement',
  selectedGeologicalRegion: 'selectedGeologicalRegion',
  activeGeologicalAttribute: 'activeGeologicalAttribute',
  attributeRangeFilter: 'attributeRangeFilter',
  attributeRangePreview: 'attributeRangePreview',
  attributeCategoryFilter: 'attributeCategoryFilter',
  roadwayGeologyAnalysisMode: 'roadwayGeologyAnalysisMode',
  sectionFrame: 'sectionFrame'
});

const LEGACY_ALIASES = Object.freeze({
  time: ContextKeys.timeCursor,
  selectedBranch: ContextKeys.selectedVentilationBranch,
  selectedFacility: ContextKeys.selectedVentilationFacility,
  selectedResource: ContextKeys.selectedEmergencyResource,
  selectedRoute: ContextKeys.selectedEvacuationRoute
});

const SELECTION_KEYS = new Set([
  ContextKeys.selection,
  ContextKeys.selectionSet,
  ContextKeys.hoveredSelection,
  ContextKeys.selectedRoadwaySegment,
  ContextKeys.selectedSensor,
  ContextKeys.selectedVentilationBranch,
  ContextKeys.selectedVentilationFacility,
  ContextKeys.selectedHazardSource,
  ContextKeys.selectedHazardSegment,
  ContextKeys.selectedPerson,
  ContextKeys.selectedEmergencyResource,
  ContextKeys.selectedEvacuationRoute,
  ContextKeys.selectedGeologicalUnit,
  ContextKeys.selectedGeologicalBody,
  ContextKeys.selectedSurface,
  ContextKeys.selectedBorehole,
  ContextKeys.selectedBoreholeInterval,
  ContextKeys.selectedStructure,
  ContextKeys.selectedBlock,
  ContextKeys.selectedAttributeElement,
  ContextKeys.selectedSectionElement,
  ContextKeys.selectedGeologicalRegion
]);

export function canonicalContextKey(key) {
  const value = String(key || '');
  return LEGACY_ALIASES[value] || value;
}

export function canonicalizeContextKeys(keys = []) {
  return [...new Set(keys.map(canonicalContextKey).filter(Boolean))];
}

export function isSelectionContextKey(key) {
  return SELECTION_KEYS.has(canonicalContextKey(key));
}

export function contextKeyAliases() {
  return { ...LEGACY_ALIASES };
}
