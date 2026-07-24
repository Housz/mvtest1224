import { createWorkspacePanel } from '../../../../ui/RuntimePanels.js';
import {
  installRoadwayHazardViewSelection,
  installRoadwayResponseViewSelection,
  renderRoadwayHazardViewPair
} from '../../../../ui/RoadwayHazardViews.js';
import { WaterInrushHydraulic1DSolver, projectRoadwayEdgeRatio } from '../../../simulation/WaterInrushHydraulic1DSolver.js';
import { FireSmoke1DSolver } from '../../../simulation/FireSmoke1DSolver.js';
import {
  edgeEndpoints,
  edgeLength,
  escapeHtml,
  formatScalar,
  installHazardRoadwayViewHandlers,
  selectedRoadwayEdgeId,
  selectHazardRoadwayEdge,
  updateHazardRoadwayViews
} from '../../shared/OperatorRuntimeUtils.js';
import { createRoadwayHazardDataset } from '../../../datasets/RoadwayHazardStateFactory.js';
import { downloadDataset } from '../../../datasets/DatasetExporter.js';

import {
  WaterInrushSimulationInputRequirements,
  FireAndSmokeSimulationInputRequirements,
  SafeRouteAnalysisInputRequirements
} from '../contracts.js';
import { loadRoadwayDataset } from '../../shared/OperatorRuntimeUtils.js';

export class SafeRouteAnalysisRuntime {
  constructor(nodeModel, inputs) {
    this.nodeModel = nodeModel;
    this.inputs = inputs;
    this.id = nodeModel.id;
    this.label = nodeModel.label || 'Safe Route Analysis';
    this.inputRequirements = SafeRouteAnalysisInputRequirements;
    this.params = {
      routeMode: nodeModel.params?.routeMode || 'nearest-safe',
      destinationMode: nodeModel.params?.destinationMode || 'nearest-resource',
      resourceTypes: nodeModel.params?.resourceTypes || ['refuge', 'exit'],
      selectedResourceId: nodeModel.params?.selectedResourceId || null,
      avoidRiskySegments: nodeModel.params?.avoidRiskySegments !== false,
      riskPenalty: Number(nodeModel.params?.riskPenalty ?? nodeModel.params?.riskWeight ?? 5),
      walkingSpeed: Number(nodeModel.params?.walkingSpeed ?? nodeModel.params?.travelSpeed ?? 1.2),
      showAllRoutes: nodeModel.params?.showAllRoutes !== false,
      showOnlyAtRiskPeople: nodeModel.params?.showOnlyAtRiskPeople === true,
      enableQuickHazardSketch: nodeModel.params?.enableQuickHazardSketch !== false,
      autoRecompute: nodeModel.params?.autoRecompute !== false,
      capacityAware: nodeModel.params?.capacityAware === true,
      manualMode: nodeModel.params?.manualMode === true,
      manualMarkMode: nodeModel.params?.manualMarkMode || 'blocked'
    };
    this.filters = { status: 'all', search: '', sort: 'risk' };
    this.manualConstraints = new Map();
    this.routes = [];
    this.selectedRouteId = null;
    this.selectedPersonId = null;
    this.selectedResourceId = this.params.selectedResourceId;
    this.focusSelectedRoute = false;
    this.disposers = [];
  }

  resolveInputDataset(input) {
    if (!input) return null;
    if (input.__operatorDatasetOutput) return input.getDataset?.() ?? null;
    return input;
  }

  hazardDataset() {
    return this.resolveInputDataset(this.inputs.hazardState) || this.context?.get?.('activeRoadwayHazardState') || null;
  }

  validateSemanticInputs() {
    const errors = [];
    Object.entries(this.inputRequirements).forEach(([key, req]) => {
      const dataset = this.resolveInputDataset(this.inputs[key]);
      if (!dataset) {
        if (!req.optional) errors.push(`Missing semantic dataset input: ${key}`);
        return;
      }
      const actualClass = dataset.contract?.class || dataset.semanticClass;
      if (actualClass !== req.class) errors.push(`Input ${key} expects ${req.class}, got ${actualClass}.`);
      if (dataset.validation?.errors?.length) errors.push(`Input ${key} has validation errors: ${dataset.validation.errors.join('; ')}`);
    });
    if (errors.length) throw new Error(errors.join('\n'));
  }

  async attach({ sceneManager, context, contributionRegistry, functionId }) {
    this.sceneManager = sceneManager;
    this.context = context;
    this.contributionRegistry = contributionRegistry;
    this.functionId = functionId ?? this.id;
    this.validateSemanticInputs();
    await this.initializeRoadway();
    this.createPanels();
    this.registerVisualContributions();
    this.installHandlers();
    this.recomputeRoutes();
    return { cleanup: () => this.cleanup() };
  }

  async initializeRoadway() {
    const roadway = this.inputs.roadway;
    await loadRoadwayDataset(this.sceneManager, roadway);
    this.sceneManager.setRoadwayVisibleForOwner(this.id, true);
    this.sceneManager.setRoadwayOpacityForOwner(this.id, 0.5);
  }

  createPanels() {
    this.summaryPanel = createWorkspacePanel('Emergency Response Summary', 'emergency-response-summary-panel', '<div class="emergency-response-summary"></div>');
    this.mapPanel = createWorkspacePanel('2D Emergency Response Map', 'emergency-response-map-panel hazard-roadway-map-panel', '<canvas class="hazard-roadway-view emergency-response-map"></canvas>');
    this.listPanel = createWorkspacePanel(
      'Personnel Risk & Route List',
      'safe-route-list-panel',
      '<div class="safe-route-mode"></div><div class="personnel-list-tools"></div><div class="safe-route-list"></div>'
    );
    this.resourcePanel = createWorkspacePanel('Emergency Resource Panel', 'emergency-resource-panel', '<div class="emergency-resource-content"></div>');
    this.detailPanel = createWorkspacePanel('Route Detail', 'safe-route-detail-panel', '<div class="safe-route-detail"></div>');
    this.manualPanel = createWorkspacePanel(
      'Quick Hazard Sketch',
      'safe-route-manual-panel',
      `<label class="checkbox-row"><span>Enable quick sketch</span><input class="manual-enable" type="checkbox" /></label>
       <label class="field-row">Mark mode<select class="manual-mode"><option value="blocked">Blocked</option><option value="risky">Risky</option><option value="clear">Clear</option></select></label>
       <div class="button-row compact"><button class="manual-clear">Clear all</button><button class="manual-json">Export JSON</button><button class="manual-csv">Export CSV</button></div>
       <div class="manual-constraint-list"></div>`
    );
    this.legendPanel = createWorkspacePanel(
      'Emergency Response Legend',
      'route-legend-panel',
      '<div class="route-legend-list"><div><span class="legend-dot route-safe"></span>Safe person / route</div><div><span class="legend-dot route-risky"></span>At risk / risky route</div><div><span class="legend-dot route-blocked"></span>No route / trapped</div><div><span class="legend-dot exit"></span>Emergency resource</div></div>'
    );
  }

  registerVisualContributions() {
    this.contributionRegistry.register({
      id: `${this.id}:roadway-model`,
      label: 'Roadway 3D Model',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      semanticRole: 'base',
      visible: true,
      opacity: 0.5,
      show: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, true),
      hide: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false),
      setOpacity: (value) => this.sceneManager.setRoadwayOpacityForOwner(this.id, value),
      cleanup: () => this.sceneManager.setRoadwayVisibleForOwner(this.id, false)
    });
    this.contributionRegistry.register({
      id: `${this.id}:route-overlay`,
      label: '3D Emergency Response Overlay',
      ownerId: this.id,
      functionId: this.functionId,
      type: 'scene-layer',
      host: 'main-3d-scene',
      semanticRole: 'response',
      objectSystem: 'personnelEmergencyResponse',
      visualChannels: { color: 'riskStatus', line: 'routeStatus', icon: 'entityType' },
      composition: { mergePolicy: 'compose', focusBehavior: 'primary-when-focused', defaultOpacity: 0.95 },
      visible: true,
      opacity: 0.95,
      show: () => this.sceneManager.setSafeRouteOverlayVisible(true),
      hide: () => this.sceneManager.setSafeRouteOverlayVisible(false),
      setOpacity: (value) => this.sceneManager.setSafeRouteOverlayOpacity(value),
      cleanup: () => this.sceneManager.clearSafeRouteOverlay()
    });
    [
      ['summary', 'Emergency Response Summary', this.summaryPanel, 'panel'],
      ['response-map', '2D Emergency Response Map', this.mapPanel, 'topology-view'],
      ['route-list', 'Personnel Risk & Route List', this.listPanel, 'panel'],
      ['resources', 'Emergency Resource Panel', this.resourcePanel, 'panel'],
      ['route-detail', 'Route Detail Panel', this.detailPanel, 'panel'],
      ['manual', 'Quick Hazard Sketch', this.manualPanel, 'panel'],
      ['legend', 'Emergency Response Legend', this.legendPanel, 'legend']
    ].forEach(([suffix, label, panel, type]) => {
      this.contributionRegistry.register({
        id: `${this.id}:${suffix}`,
        label,
        ownerId: this.id,
        functionId: this.functionId,
        type,
        element: panel,
        visible: true,
        show: () => (panel.style.display = 'block'),
        hide: () => (panel.style.display = 'none'),
        onResize: () => {
          if (panel === this.mapPanel) this.updateViews();
        },
        cleanup: () => panel.remove()
      });
    });
  }

  installHandlers() {
    this.disposers.push(this.context.subscribe('time', () => this.recomputeRoutes()));
    this.disposers.push(this.context.subscribe('activeRoadwayHazardState', () => this.recomputeRoutes()));
    this.disposers.push(this.context.subscribe('selectedRoute', (routeId) => {
      this.selectedRouteId = routeId;
      const route = this.routes.find((item) => item.routeId === routeId);
      if (route) {
        this.selectedPersonId = route.personId;
        this.selectedResourceId = route.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
      }
      this.updateViews();
    }));
    this.disposers.push(this.context.subscribe('selectedPerson', (personId) => {
      if (!personId) {
        this.selectedPersonId = null;
        this.selectedRouteId = null;
        this.focusSelectedRoute = false;
        this.updateViews();
        return;
      }
      if (personId === this.selectedPersonId) return;
      this.selectedPersonId = personId;
      const route = this.routes.find((item) => item.personId === personId);
      if (route) {
        this.selectedRouteId = route.routeId;
        this.selectedResourceId = route.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
      }
      this.updateViews();
    }));
    this.disposers.push(this.context.subscribe('selectedResource', (resourceId) => {
      if (!resourceId) {
        this.selectedResourceId = null;
        this.updateViews();
        return;
      }
      if (resourceId === this.selectedResourceId) return;
      this.selectedResourceId = resourceId;
      this.updateViews();
    }));
    if (this.inputs.hazardState?.__operatorDatasetOutput) this.disposers.push(this.inputs.hazardState.subscribe(() => this.recomputeRoutes()));
    this.disposers.push(this.sceneManager.registerInteractionHandler('person', this.id, (personId) => {
      const route = this.routes.find((item) => item.personId === personId);
      this.selectedPersonId = personId;
      if (route) {
        this.selectedRouteId = route.routeId;
        this.selectedResourceId = route.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
      }
      this.context.set('selectedPerson', personId);
      this.context.set('selectedRoute', route?.routeId || null);
      this.context.set('selection', { type: 'person', id: personId });
      this.updateViews();
      return true;
    }));
    this.disposers.push(this.sceneManager.registerInteractionHandler('emergency-resource', this.id, (resourceId) => {
      this.selectedResourceId = resourceId;
      this.context.set('selectedResource', resourceId);
      this.context.set('selection', { type: 'emergencyResource', id: resourceId });
      this.updateViews();
      return true;
    }));
    this.disposers.push(this.sceneManager.registerInteractionHandler('safe-route', this.id, (routeId, personId) => {
      const route = this.routes.find((item) => item.routeId === routeId);
      this.selectedRouteId = routeId;
      this.selectedPersonId = route?.personId || personId || null;
      this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
      this.focusSelectedRoute = true;
      this.context.set('selectedRoute', routeId);
      this.context.set('selectedPerson', this.selectedPersonId);
      this.context.set('selection', { type: 'evacuationRoute', id: routeId, personId: this.selectedPersonId });
      this.updateViews();
      return true;
    }));
    this.disposers.push(this.sceneManager.registerInteractionHandler('roadway', this.id, (entity) => {
      if (!this.params.manualMode || entity.type !== 'edge') return false;
      this.applyManualConstraint(entity.edgeId);
      return true;
    }));
    this.disposers.push(installRoadwayResponseViewSelection([this.mapPanel], {
      onPerson: (personId) => {
        const route = this.routes.find((item) => item.personId === personId);
        this.selectedPersonId = personId;
        this.selectedRouteId = route?.routeId || this.selectedRouteId;
        this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
        this.context.set('selectedPerson', personId);
        this.context.set('selectedRoute', route?.routeId || null);
        this.context.set('selection', { type: 'person', id: personId });
        this.updateViews();
      },
      onResource: (resourceId) => {
        this.selectedResourceId = resourceId;
        this.context.set('selectedResource', resourceId);
        this.context.set('selection', { type: 'emergencyResource', id: resourceId });
        this.updateViews();
      },
      onRoute: (routeId, personId, edgeId) => {
        if (this.params.manualMode && edgeId) {
          this.applyManualConstraint(edgeId);
          return;
        }
        const route = this.routes.find((item) => item.routeId === routeId);
        this.selectedRouteId = routeId;
        this.selectedPersonId = route?.personId || personId || this.selectedPersonId;
        this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
        this.context.set('selectedRoute', routeId);
        this.context.set('selectedPerson', this.selectedPersonId);
        this.context.set('selection', { type: 'evacuationRoute', id: routeId, personId: this.selectedPersonId });
        this.updateViews();
      },
      onEdge: (edgeId) => {
        if (this.params.manualMode) this.applyManualConstraint(edgeId);
        else {
          this.context.set('selectedRoadwaySegment', { type: 'edge', id: edgeId });
          this.context.set('selectedHazardSegment', edgeId);
          this.context.set('selection', { type: 'roadwayHazardSegment', id: edgeId });
          this.sceneManager?.highlightRoadwayEdges?.([edgeId]);
          this.updateViews();
        }
      },
      onBlank: () => {
        this.context.set('selectedPerson', null);
        this.context.set('selectedRoute', null);
        this.context.set('selectedResource', null);
        this.context.set('selectedRoadwaySegment', null);
        this.context.set('selectedHazardSegment', null);
        this.context.set('selection', null);
        this.sceneManager?.highlightRoadwayEdges?.([]);
        this.updateViews();
      }
    }));
    const enable = this.manualPanel.querySelector('.manual-enable');
    const mode = this.manualPanel.querySelector('.manual-mode');
    enable.checked = this.params.manualMode;
    mode.value = this.params.manualMarkMode;
    enable.addEventListener('change', () => {
      this.params.manualMode = enable.checked;
      this.recomputeRoutes();
    });
    mode.addEventListener('change', () => (this.params.manualMarkMode = mode.value));
    this.manualPanel.querySelector('.manual-clear').addEventListener('click', () => {
      this.manualConstraints.clear();
      this.recomputeRoutes();
    });
    this.manualPanel.querySelector('.manual-json').addEventListener('click', () => downloadDataset(this.manualHazardDataset(), 'json', 'manual_roadway_hazard_state.json'));
    this.manualPanel.querySelector('.manual-csv').addEventListener('click', () => downloadDataset(this.manualHazardDataset(), 'csv', 'manual_roadway_hazard_state.csv'));
  }

  applyManualConstraint(edgeId) {
    if (!edgeId) return;
    if (this.params.manualMarkMode === 'clear') this.manualConstraints.delete(edgeId);
    else this.manualConstraints.set(String(edgeId), this.params.manualMarkMode);
    this.context.set('selectedRoadwaySegment', { type: 'edge', id: String(edgeId) });
    this.context.set('selectedHazardSegment', String(edgeId));
    this.context.set('selection', { type: 'roadwayHazardSegment', id: String(edgeId) });
    this.recomputeRoutes();
  }

  manualHazardDataset() {
    const time = this.context.get('time') ?? 0;
    const rows = [...this.manualConstraints.entries()].map(([edgeId, passability]) => ({
      time,
      timeValue: time,
      roadwayEdgeId: edgeId,
      roadwayNodeId: null,
      hazardType: 'manual_constraint',
      hazardValue: passability === 'blocked' ? 1 : passability === 'risky' ? 0.5 : 0,
      severity: passability === 'blocked' ? 'high' : passability === 'risky' ? 'medium' : 'none',
      passability: passability === 'clear' ? 'passable' : passability,
      arrivalTime: time,
      scenarioId: 'manual_constraints',
      sourceId: edgeId
    }));
    return createRoadwayHazardDataset(rows, { generatedBy: 'Safe Route Analysis', generationMode: 'manualConstraints' });
  }

  hazardForEdge(edgeId) {
    const time = this.context.get('time') ?? 0;
    const base = this.hazardDataset()?.getEdgeState?.(edgeId, time, Infinity) ?? null;
    const manual = this.manualConstraints.get(String(edgeId));
    if (!manual) return base;
    if (manual === 'blocked') return { ...base, roadwayEdgeId: edgeId, passability: 'blocked', severity: 'high', hazardValue: 1 };
    if (manual === 'risky') return { ...base, roadwayEdgeId: edgeId, passability: base?.passability === 'blocked' ? 'blocked' : 'risky', severity: base?.passability === 'blocked' ? 'high' : 'medium', hazardValue: Math.max(0.5, Number(base?.hazardValue) || 0) };
    return base;
  }

  edgeCost(edge) {
    const hazard = this.hazardForEdge(edge.id);
    const length = Math.max(1, edgeLength(this.inputs.roadway, edge));
    if (hazard?.passability === 'blocked') return Infinity;
    return hazard?.passability === 'risky' && this.params.avoidRiskySegments ? length * this.params.riskPenalty : length;
  }

  anchorRatio(anchor) {
    return Math.max(0, Math.min(1, Number(anchor?.ratio ?? anchor?.roadwayAnchor?.ratio ?? 0.5)));
  }

  edgeEndpointRatio(edge, nodeId) {
    const [from, to] = edgeEndpoints(edge);
    if (String(nodeId) === String(from)) return 0;
    if (String(nodeId) === String(to)) return 1;
    return null;
  }

  anchorEndpointOptions(anchor) {
    if (!anchor) return [];
    if (anchor.nodeId) return [{ nodeId: String(anchor.nodeId), cost: 0, length: 0, segments: [] }];
    const edgeId = anchor.edgeId ?? anchor.roadwayEdgeId;
    const edge = this.inputs.roadway.edgeMap.get(String(edgeId));
    if (!edge) return [];
    const [from, to] = edgeEndpoints(edge);
    const ratio = this.anchorRatio(anchor);
    const length = Math.max(1, edgeLength(this.inputs.roadway, edge));
    const weightedCost = this.edgeCost(edge);
    return [
      { nodeId: from, endpointRatio: 0 },
      { nodeId: to, endpointRatio: 1 }
    ]
      .filter((option) => option.nodeId != null)
      .map((option) => {
        const fraction = Math.abs(ratio - option.endpointRatio);
        return {
          nodeId: String(option.nodeId),
          cost: Number.isFinite(weightedCost) ? weightedCost * fraction : Infinity,
          length: length * fraction,
          segments:
            fraction > 0.001
              ? [{ edgeId: String(edge.id), startRatio: ratio, endRatio: option.endpointRatio, role: 'anchor-connector' }]
              : []
        };
      });
  }

  anchorToNode(anchor) {
    if (!anchor) return null;
    if (anchor.nodeId) return anchor.nodeId;
    const edge = this.inputs.roadway.edgeMap.get(String(anchor.edgeId ?? anchor.roadwayEdgeId));
    return edge?.from ?? edge?.source ?? edge?.j1 ?? null;
  }

  pathSegments(path) {
    return (path.edgePath || [])
      .map((edgeId, index) => {
        const edge = this.inputs.roadway.edgeMap.get(String(edgeId));
        if (!edge) return null;
        const fromNode = path.nodePath?.[index];
        const toNode = path.nodePath?.[index + 1];
        const startRatio = this.edgeEndpointRatio(edge, fromNode);
        const endRatio = this.edgeEndpointRatio(edge, toNode);
        if (startRatio == null || endRatio == null) return null;
        return { edgeId: String(edgeId), startRatio, endRatio, fromNodeId: String(fromNode), toNodeId: String(toNode), role: 'network-path' };
      })
      .filter(Boolean);
  }

  collapseEdgePath(segments = []) {
    return segments
      .map((segment) => String(segment.edgeId))
      .filter((edgeId, index, list) => edgeId && edgeId !== list[index - 1]);
  }

  directAnchorRoute(person, resource) {
    const start = person?.roadwayAnchor;
    const end = resource?.roadwayAnchor;
    const startEdgeId = start?.edgeId ?? start?.roadwayEdgeId;
    const endEdgeId = end?.edgeId ?? end?.roadwayEdgeId;
    if (!startEdgeId || !endEdgeId || String(startEdgeId) !== String(endEdgeId)) return null;
    const edge = this.inputs.roadway.edgeMap.get(String(startEdgeId));
    if (!edge) return null;
    const weightedCost = this.edgeCost(edge);
    if (!Number.isFinite(weightedCost)) return null;
    const startRatio = this.anchorRatio(start);
    const endRatio = this.anchorRatio(end);
    const fraction = Math.abs(endRatio - startRatio);
    const length = Math.max(1, edgeLength(this.inputs.roadway, edge)) * fraction;
    const segments = fraction > 0.001 ? [{ edgeId: String(edge.id), startRatio, endRatio, role: 'direct-anchor' }] : [];
    return {
      resource,
      destination: null,
      nodePath: [],
      edgePath: this.collapseEdgePath(segments),
      segments,
      distance: length,
      cost: weightedCost * fraction
    };
  }

  bestRouteForPerson(person, resources) {
    let best = null;
    for (const resource of resources) {
      const direct = this.directAnchorRoute(person, resource);
      if (direct && (!best || direct.cost < best.cost)) best = direct;
      const startOptions = this.anchorEndpointOptions(person.roadwayAnchor).filter((option) => Number.isFinite(option.cost));
      const endOptions = this.anchorEndpointOptions(resource.roadwayAnchor).filter((option) => Number.isFinite(option.cost));
      for (const start of startOptions) {
        for (const end of endOptions) {
          const path = this.shortestPath(start.nodeId, [end.nodeId]);
          if (!path) continue;
          const segments = [
            ...start.segments,
            ...this.pathSegments(path),
            ...end.segments.map((segment) => ({
              ...segment,
              startRatio: segment.endRatio,
              endRatio: segment.startRatio,
              role: 'destination-connector'
            }))
          ];
          const networkLength = path.edgePath.reduce(
            (sum, edgeId) => sum + edgeLength(this.inputs.roadway, this.inputs.roadway.edgeMap.get(String(edgeId))),
            0
          );
          const candidate = {
            resource,
            destination: path.destination,
            nodePath: path.nodePath,
            edgePath: this.collapseEdgePath(segments),
            segments,
            distance: start.length + networkLength + end.length,
            cost: start.cost + path.cost + end.cost
          };
          if (!best || candidate.cost < best.cost) best = candidate;
        }
      }
    }
    return best;
  }

  availableResources() {
    const allowed = new Set((this.params.resourceTypes || ['refuge', 'exit']).map((type) => String(type).toLowerCase()));
    let resources = this.inputs.emergencyResources
      .listResources()
      .filter((resource) => String(resource.status).toLowerCase() !== 'unavailable')
      .filter((resource) => !allowed.size || allowed.has(String(resource.resourceType).toLowerCase()));
    if (!resources.length) resources = this.inputs.emergencyResources.getExits().filter((resource) => String(resource.status).toLowerCase() !== 'unavailable');
    if (this.params.destinationMode === 'selected-resource' && this.selectedResourceId) {
      const selected = resources.find((resource) => resource.resourceId === this.selectedResourceId);
      if (selected) return [selected];
    }
    if (this.params.destinationMode === 'nearest-exit') return resources.filter((resource) => String(resource.resourceType).toLowerCase() === 'exit');
    if (this.params.destinationMode === 'nearest-refuge') return resources.filter((resource) => String(resource.resourceType).toLowerCase() === 'refuge');
    return resources;
  }

  edgeHazard(edgeId) {
    return edgeId ? this.hazardForEdge(edgeId) : null;
  }

  assessPersonRisk(person, path, riskyEdges = []) {
    const anchorEdge = person.roadwayAnchor?.edgeId;
    const startHazard = this.edgeHazard(anchorEdge);
    if (startHazard?.passability === 'blocked') return 'inside_hazard';
    if (!path) return 'no_route';
    if (startHazard?.passability === 'risky') return 'at_risk';
    if (riskyEdges.length) return 'route_affected';
    return 'safe';
  }

  routeStatusForRisk(riskStatus, riskyEdges = []) {
    if (riskStatus === 'inside_hazard' || riskStatus === 'no_route') return 'noRoute';
    if (riskStatus === 'at_risk' || riskStatus === 'route_affected' || riskyEdges.length) return 'risky';
    return 'safe';
  }

  buildAdjacency() {
    const adjacency = new Map(this.inputs.roadway.getNodes().map((node) => [String(node.id), []]));
    this.inputs.roadway.getEdges().forEach((edge) => {
      const [a, b] = edgeEndpoints(edge);
      if (!a || !b) return;
      const cost = this.edgeCost(edge);
      adjacency.get(a)?.push({ nodeId: b, edgeId: edge.id, cost });
      adjacency.get(b)?.push({ nodeId: a, edgeId: edge.id, cost });
    });
    return adjacency;
  }

  shortestPath(startNodeId, destinationNodeIds) {
    const destinations = new Set(destinationNodeIds.map(String));
    const adjacency = this.buildAdjacency();
    const dist = new Map([...adjacency.keys()].map((id) => [id, Infinity]));
    const prev = new Map();
    const open = new Set(adjacency.keys());
    dist.set(String(startNodeId), 0);
    while (open.size) {
      let current = null;
      let best = Infinity;
      open.forEach((id) => {
        if ((dist.get(id) ?? Infinity) < best) {
          best = dist.get(id);
          current = id;
        }
      });
      if (!current || !Number.isFinite(best)) break;
      if (destinations.has(current)) break;
      open.delete(current);
      for (const next of adjacency.get(current) || []) {
        if (!Number.isFinite(next.cost)) continue;
        const candidate = best + next.cost;
        if (candidate < (dist.get(next.nodeId) ?? Infinity)) {
          dist.set(next.nodeId, candidate);
          prev.set(next.nodeId, { nodeId: current, edgeId: next.edgeId });
        }
      }
    }
    const destination = [...destinations].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))[0];
    if (!destination || !Number.isFinite(dist.get(destination))) return null;
    const nodePath = [destination];
    const edgePath = [];
    let cursor = destination;
    while (cursor !== String(startNodeId)) {
      const p = prev.get(cursor);
      if (!p) break;
      edgePath.unshift(p.edgeId);
      nodePath.unshift(p.nodeId);
      cursor = p.nodeId;
    }
    return { destination, nodePath, edgePath, cost: dist.get(destination) };
  }

  routeMode() {
    const hasHazard = Boolean(this.hazardDataset());
    const hasManual = this.manualConstraints.size > 0;
    if (hasHazard && hasManual) return 'Derived Hazard + Manual Constraints';
    if (hasHazard) return this.inputs.hazardState?.__operatorDatasetOutput ? 'Derived Hazard' : 'Imported Hazard';
    if (hasManual) return 'Manual Constraints';
    return 'No Hazard State';
  }

  recomputeRoutes() {
    const resources = this.availableResources();
    this.routes = this.inputs.people.listPeople().map((person) => {
      const path = resources.length ? this.bestRouteForPerson(person, resources) : null;
      if (!path) {
        const riskStatus = this.assessPersonRisk(person, null, []);
        return {
          routeId: `route:${person.personId}`,
          personId: person.personId,
          person,
          destinationResourceId: null,
          riskStatus,
          status: 'noRoute',
          edgePath: [],
          nodePath: [],
          segments: [],
          distance: Infinity,
          riskCost: Infinity,
          estimatedTime: Infinity,
          riskyEdges: [],
          blockedEdges: person.roadwayAnchor?.edgeId ? [person.roadwayAnchor.edgeId].filter((edgeId) => this.edgeHazard(edgeId)?.passability === 'blocked') : [],
          mode: this.routeMode()
        };
      }
      const riskyEdges = path.edgePath.filter((edgeId) => this.hazardForEdge(edgeId)?.passability === 'risky');
      const destinationResource = path.resource;
      const riskStatus = this.assessPersonRisk(person, path, riskyEdges);
      return {
        routeId: `route:${person.personId}`,
        personId: person.personId,
        person,
        destinationResourceId: destinationResource?.resourceId ?? null,
        resourceType: destinationResource?.resourceType ?? null,
        riskStatus,
        status: this.routeStatusForRisk(riskStatus, riskyEdges),
        edgePath: path.edgePath,
        nodePath: path.nodePath,
        segments: path.segments,
        distance: path.distance,
        riskCost: path.cost,
        estimatedTime: path.distance / Math.max(0.1, this.params.walkingSpeed),
        riskyEdges,
        blockedEdges: [],
        mode: this.routeMode()
      };
    });
    if (!this.selectedRouteId && this.routes[0]) this.selectedRouteId = this.routes[0].routeId;
    this.updateViews();
  }

  visibleRoutes() {
    if (this.focusSelectedRoute && this.selectedRouteId) {
      return this.routes.filter((route) => route.routeId === this.selectedRouteId || route.personId === this.selectedPersonId);
    }
    return this.params.showAllRoutes
      ? this.routes
      : this.routes.filter((route) => route.routeId === this.selectedRouteId || route.personId === this.selectedPersonId);
  }

  updateViews() {
    if (!this.sceneManager) return;
    const visibleRoutes = this.visibleRoutes();
    const people = this.inputs.people.listPeople().map((person) => {
      const route = this.routes.find((item) => item.personId === person.personId);
      return { ...person, routeStatus: route?.status || 'safe', riskStatus: route?.riskStatus || 'safe' };
    });
    this.sceneManager.addSafeRoutes({
      roadway: this.inputs.roadway,
      routes: visibleRoutes,
      people: this.params.showOnlyAtRiskPeople ? people.filter((person) => person.riskStatus !== 'safe') : people,
      resources: this.availableResources(),
      selectedRouteId: this.selectedRouteId
    });
    if (this.contributionRegistry?.get(`${this.id}:route-overlay`)?.visible === false) this.sceneManager.setSafeRouteOverlayVisible(false);
    this.renderSummary();
    this.renderMap();
    this.renderRouteList();
    this.renderResourcePanel();
    this.renderRouteDetail();
    this.renderManualList();
  }

  responseSummary() {
    const total = this.routes.length;
    const safe = this.routes.filter((route) => route.riskStatus === 'safe').length;
    const atRisk = this.routes.filter((route) => ['at_risk', 'inside_hazard', 'route_affected'].includes(route.riskStatus)).length;
    const noRoute = this.routes.filter((route) => route.status === 'noRoute').length;
    const resources = this.availableResources();
    const affectedResources = resources.filter((resource) => this.edgeHazard(resource.roadwayAnchor?.edgeId)?.passability === 'blocked').length;
    const blockedEdges = this.inputs.roadway.getEdges().filter((edge) => this.edgeHazard(edge.id)?.passability === 'blocked');
    const blockedLength = blockedEdges.reduce((sum, edge) => sum + edgeLength(this.inputs.roadway, edge), 0);
    return { total, safe, atRisk, noRoute, resources: resources.length, affectedResources, blockedLength };
  }

  renderSummary() {
    const content = this.summaryPanel?.querySelector('.emergency-response-summary');
    if (!content) return;
    const summary = this.responseSummary();
    content.innerHTML = `
      <div class="summary-grid compact">
        <div><span>People</span><strong>${summary.total}</strong></div>
        <div><span>Safe</span><strong>${summary.safe}</strong></div>
        <div><span>At risk</span><strong>${summary.atRisk}</strong></div>
        <div><span>No route</span><strong>${summary.noRoute}</strong></div>
        <div><span>Resources</span><strong>${summary.resources}</strong></div>
        <div><span>Affected resources</span><strong>${summary.affectedResources}</strong></div>
      </div>
      <div class="detail-row"><span>Blocked roadway length</span><strong>${formatScalar(summary.blockedLength, 1)}</strong></div>
      <div class="detail-row"><span>Mode</span><strong>${this.routeMode()}</strong></div>`;
  }

  renderMap() {
    const visibleRoutes = this.visibleRoutes();
    const people = this.inputs.people.listPeople().map((person) => {
      const route = this.routes.find((item) => item.personId === person.personId);
      return { ...person, routeStatus: route?.status || 'safe', riskStatus: route?.riskStatus || 'safe' };
    });
    const states = this.inputs.roadway.getEdges().map((edge) => {
      const hazard = this.hazardForEdge(edge.id);
      return hazard
        ? { ...hazard, roadwayEdgeId: String(edge.id), visualHazard: hazard.passability === 'blocked' ? 1 : hazard.passability === 'risky' ? 0.62 : Number(hazard.hazardValue) || 0 }
        : { roadwayEdgeId: String(edge.id), hazardValue: 0, passability: 'passable', severity: 'none' };
    });
    renderRoadwayHazardViewPair({
      roadway: this.inputs.roadway,
      states,
      mapPanel: this.mapPanel,
      topologyPanel: null,
      selectedEdgeId: selectedRoadwayEdgeId(this.context),
      style: 'emergency',
      mapTitle: '2D Emergency Response Map',
      responseOverlay: {
        routes: visibleRoutes,
        people: this.params.showOnlyAtRiskPeople ? people.filter((person) => person.riskStatus !== 'safe') : people,
        resources: this.availableResources(),
        selectedRouteId: this.selectedRouteId,
        selectedPersonId: this.selectedPersonId,
        selectedResourceId: this.selectedResourceId
      }
    });
  }

  renderRouteList() {
    const mode = this.listPanel.querySelector('.safe-route-mode');
    const tools = this.listPanel.querySelector('.personnel-list-tools');
    const list = this.listPanel.querySelector('.safe-route-list');
    const noHazardText = this.routeMode() === 'No Hazard State'
      ? 'No hazard state is active. Routes are computed without hazard constraints. Enable Quick Hazard Sketch or connect a simulation output for hazard-aware analysis.'
      : `Route Mode: ${this.routeMode()}`;
    mode.textContent = noHazardText;
    tools.innerHTML = `
      <select class="personnel-filter-status">
        <option value="all">All statuses</option>
        <option value="safe">Safe</option>
        <option value="at_risk">At risk</option>
        <option value="route_affected">Route affected</option>
        <option value="inside_hazard">Inside hazard</option>
        <option value="no_route">No route</option>
      </select>
      <select class="personnel-sort">
        <option value="risk">Risk</option>
        <option value="distance">Distance</option>
        <option value="time">Travel time</option>
        <option value="person">Person ID</option>
      </select>
      <input class="personnel-search" placeholder="Search person..." value="${this.filters.search}" />
    `;
    const filtered = this.filteredRoutes();
    list.innerHTML = filtered.length
      ? filtered.map((route) => `<button class="route-item ${route.routeId === this.selectedRouteId ? 'selected' : ''}" data-route="${route.routeId}">
        <span><strong>${route.personId}</strong><em>${route.person?.team || ''}</em></span>
        <span class="route-status ${route.status}">${route.riskStatus.replace(/_/g, ' ')}</span>
        <span><strong>${route.destinationResourceId || '-'}</strong><em>${route.resourceType || ''}</em></span>
        <span>${Number.isFinite(route.distance) ? formatScalar(route.distance, 1) : '-'}</span>
      </button>`)
        .join('')
      : '<div class="empty-state">No personnel routes match the current filters.</div>';
    tools.querySelector('.personnel-filter-status').value = this.filters.status;
    tools.querySelector('.personnel-sort').value = this.filters.sort;
    tools.querySelector('.personnel-filter-status').addEventListener('change', (event) => {
      this.filters.status = event.target.value;
      this.renderRouteList();
    });
    tools.querySelector('.personnel-sort').addEventListener('change', (event) => {
      this.filters.sort = event.target.value;
      this.renderRouteList();
    });
    tools.querySelector('.personnel-search').addEventListener('input', (event) => {
      this.filters.search = event.target.value;
      this.renderRouteList();
    });
    list.querySelectorAll('.route-item').forEach((button) => {
      button.addEventListener('click', () => {
        const route = this.routes.find((item) => item.routeId === button.dataset.route);
        this.selectedRouteId = route?.routeId || null;
        this.selectedPersonId = route?.personId || null;
        this.selectedResourceId = route?.destinationResourceId || this.selectedResourceId;
        this.focusSelectedRoute = true;
        this.context.set('selectedRoute', this.selectedRouteId);
        this.context.set('selectedPerson', route?.personId || null);
        this.context.set('selectedResource', route?.destinationResourceId || null);
        this.context.set('selection', { type: 'evacuationRoute', id: this.selectedRouteId, personId: route?.personId });
        this.updateViews();
      });
    });
  }

  filteredRoutes() {
    const riskRank = { inside_hazard: 0, no_route: 1, at_risk: 2, route_affected: 3, safe: 4 };
    const query = this.filters.search.trim().toLowerCase();
    const routes = this.routes.filter((route) => {
      if (this.filters.status !== 'all' && route.riskStatus !== this.filters.status && route.status !== this.filters.status) return false;
      if (query && !String(route.personId).toLowerCase().includes(query)) return false;
      return true;
    });
    const sorters = {
      risk: (a, b) => (riskRank[a.riskStatus] ?? 9) - (riskRank[b.riskStatus] ?? 9) || String(a.personId).localeCompare(String(b.personId)),
      distance: (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
      time: (a, b) => (a.estimatedTime ?? Infinity) - (b.estimatedTime ?? Infinity),
      person: (a, b) => String(a.personId).localeCompare(String(b.personId))
    };
    return [...routes].sort(sorters[this.filters.sort] || sorters.risk);
  }

  renderResourcePanel() {
    const content = this.resourcePanel?.querySelector('.emergency-resource-content');
    if (!content) return;
    const assignedCounts = new Map();
    this.routes.forEach((route) => {
      if (!route.destinationResourceId) return;
      assignedCounts.set(route.destinationResourceId, (assignedCounts.get(route.destinationResourceId) || 0) + 1);
    });
    const resources = this.inputs.emergencyResources.listResources();
    if (!resources.length) {
      content.innerHTML = '<div class="empty-state">No emergency resources available.</div>';
      return;
    }
    content.innerHTML = resources
      .map((resource) => {
        const anchor = resource.roadwayAnchor || {};
        const hazard = this.edgeHazard(anchor.edgeId);
        const affected = hazard?.passability === 'blocked';
        const selected = resource.resourceId === this.selectedResourceId ? 'selected' : '';
        const status = affected ? 'affected' : resource.status || 'available';
        return `<button class="resource-item ${selected}" data-resource="${resource.resourceId}">
          <span><strong>${resource.resourceId}</strong><em>${resource.label || resource.resourceType || ''}</em></span>
          <span class="resource-type">${resource.resourceType || 'resource'}</span>
          <span class="route-status ${affected ? 'noRoute' : status === 'available' ? 'safe' : 'risky'}">${status}</span>
          <span>${assignedCounts.get(resource.resourceId) || 0} assigned</span>
        </button>`;
      })
      .join('');
    content.querySelectorAll('.resource-item').forEach((button) => {
      button.addEventListener('click', () => {
        const resourceId = button.dataset.resource;
        this.selectedResourceId = resourceId;
        this.context.set('selectedResource', resourceId);
        this.context.set('selection', { type: 'emergencyResource', id: resourceId });
        this.updateViews();
      });
    });
  }

  renderRouteDetail() {
    const content = this.detailPanel.querySelector('.safe-route-detail');
    const route = this.routes.find((item) => item.routeId === this.selectedRouteId) || this.routes[0];
    if (!route) {
      content.innerHTML = '<div class="empty-state">No routes available.</div>';
      return;
    }
    const resource = this.inputs.emergencyResources.getResource(route.destinationResourceId);
    const reason =
      route.status === 'noRoute'
        ? route.riskStatus === 'inside_hazard'
          ? 'The person is located on a blocked roadway segment.'
          : 'No reachable emergency resource under current hazard constraints.'
        : route.riskyEdges.length
          ? 'The route remains reachable but passes through risky roadway segments.'
          : 'The route avoids blocked and risky roadway segments at the current time.';
    content.innerHTML = `
      <div class="detail-row"><span>Person</span><strong>${route.personId}</strong></div>
      <div class="detail-row"><span>Team / type</span><strong>${route.person?.team || route.person?.personType || '-'}</strong></div>
      <div class="detail-row"><span>Risk status</span><strong>${route.riskStatus.replace(/_/g, ' ')}</strong></div>
      <div class="detail-row"><span>Destination</span><strong>${resource ? `${resource.resourceId} - ${resource.resourceType}` : '-'}</strong></div>
      <div class="detail-row"><span>Route status</span><strong>${route.status}</strong></div>
      <div class="detail-row"><span>Distance</span><strong>${Number.isFinite(route.distance) ? `${formatScalar(route.distance, 2)} m` : '-'}</strong></div>
      <div class="detail-row"><span>Travel time</span><strong>${Number.isFinite(route.estimatedTime) ? `${formatScalar(route.estimatedTime, 1)} s` : '-'}</strong></div>
      <div class="detail-row"><span>Risk cost</span><strong>${Number.isFinite(route.riskCost) ? formatScalar(route.riskCost, 2) : '-'}</strong></div>
      <div class="detail-row"><span>Risky edges</span><strong>${route.riskyEdges.join(', ') || '-'}</strong></div>
      <div class="detail-row"><span>Blocked edges</span><strong>${route.blockedEdges.join(', ') || '-'}</strong></div>
      <div class="detail-row stacked"><span>Path</span><strong>${route.edgePath.join(' -> ') || '-'}</strong></div>
      <div class="muted-note">${reason}</div>`;
  }

  renderManualList() {
    const list = this.manualPanel.querySelector('.manual-constraint-list');
    list.innerHTML = [...this.manualConstraints.entries()].map(([edgeId, state]) => `<div class="detail-row"><span>${edgeId}</span><strong>${state}</strong></div>`).join('') || '<div class="muted-note">No manual constraints.</div>';
  }

  renderControls(container) {
    const resourceOptions = this.inputs.emergencyResources
      .listResources()
      .map((resource) => `<option value="${resource.resourceId}">${resource.resourceId} - ${resource.resourceType || 'resource'}</option>`)
      .join('');
    container.innerHTML = `
      <div class="panel-title">${this.label}</div>
      <div class="control-grid">
        <label class="field-row">Route mode<select class="route-route-mode"><option value="nearest-safe">Nearest safe</option><option value="shortest">Shortest</option><option value="lowest-risk">Lowest risk</option></select></label>
        <label class="field-row">Destination<select class="route-destination-mode"><option value="nearest-resource">Nearest resource</option><option value="selected-resource">Selected resource</option><option value="nearest-exit">Nearest exit</option><option value="nearest-refuge">Nearest refuge</option></select></label>
        <label class="field-row">Selected resource<select class="route-resource"><option value="">Auto</option>${resourceOptions}</select></label>
        <label class="field-row">Risk weight<input class="route-risk" type="number" step="0.5" /></label>
        <label class="field-row">Travel speed (m/s)<input class="route-speed" type="number" step="0.1" /></label>
        <label class="field-row">Sketch mark<select class="route-mode"><option value="blocked">Blocked</option><option value="risky">Risky</option><option value="clear">Clear</option></select></label>
      </div>
      <div class="control-grid control-grid-checks">
        <label class="checkbox-row"><span>Avoid risky segments</span><input class="route-avoid-risky" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show all routes</span><input class="route-show-all" type="checkbox" /></label>
        <label class="checkbox-row"><span>Show only at-risk people</span><input class="route-only-risk" type="checkbox" /></label>
        <label class="checkbox-row"><span>Quick hazard sketch</span><input class="route-manual" type="checkbox" /></label>
      </div>
      <div class="button-row compact"><button class="route-refresh">Recompute routes</button></div>`;
    const routeMode = container.querySelector('.route-route-mode');
    const destinationMode = container.querySelector('.route-destination-mode');
    const selectedResource = container.querySelector('.route-resource');
    const risk = container.querySelector('.route-risk');
    const speed = container.querySelector('.route-speed');
    const avoidRisky = container.querySelector('.route-avoid-risky');
    const showAll = container.querySelector('.route-show-all');
    const showOnlyRisk = container.querySelector('.route-only-risk');
    const manual = container.querySelector('.route-manual');
    const mode = container.querySelector('.route-mode');
    routeMode.value = this.params.routeMode;
    destinationMode.value = this.params.destinationMode;
    selectedResource.value = this.selectedResourceId || '';
    risk.value = this.params.riskPenalty;
    speed.value = this.params.walkingSpeed;
    avoidRisky.checked = this.params.avoidRiskySegments;
    showAll.checked = this.params.showAllRoutes;
    showOnlyRisk.checked = this.params.showOnlyAtRiskPeople;
    manual.checked = this.params.manualMode;
    mode.value = this.params.manualMarkMode;
    const update = () => {
      this.params.routeMode = routeMode.value;
      this.params.destinationMode = destinationMode.value;
      this.selectedResourceId = selectedResource.value || null;
      this.params.selectedResourceId = this.selectedResourceId;
      this.params.riskPenalty = Number(risk.value);
      this.params.walkingSpeed = Number(speed.value);
      this.params.avoidRiskySegments = avoidRisky.checked;
      this.params.showAllRoutes = showAll.checked;
      if (this.params.showAllRoutes) this.focusSelectedRoute = false;
      this.params.showOnlyAtRiskPeople = showOnlyRisk.checked;
      this.params.manualMode = manual.checked;
      this.params.manualMarkMode = mode.value;
      this.manualPanel.querySelector('.manual-enable').checked = this.params.manualMode;
      this.manualPanel.querySelector('.manual-mode').value = this.params.manualMarkMode;
      this.recomputeRoutes();
    };
    [routeMode, destinationMode, selectedResource, risk, speed, avoidRisky, showAll, showOnlyRisk, manual, mode].forEach((element) =>
      element.addEventListener('change', update)
    );
    container.querySelector('.route-refresh').addEventListener('click', () => this.recomputeRoutes());
  }

  cleanup() {
    this.disposers.splice(0).forEach((dispose) => dispose?.());
    this.sceneManager?.clearSafeRouteOverlay?.();
    this.summaryPanel?.remove();
    this.mapPanel?.remove();
    this.listPanel?.remove();
    this.resourcePanel?.remove();
    this.detailPanel?.remove();
    this.manualPanel?.remove();
    this.legendPanel?.remove();
  }
}
