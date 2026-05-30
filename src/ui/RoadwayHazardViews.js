const viewState = new WeakMap();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const pointOf = (value = {}) => {
  if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
};

const edgeEndpoints = (edge) =>
  [edge?.from ?? edge?.source ?? edge?.j1, edge?.to ?? edge?.target ?? edge?.j2].filter(Boolean).map(String);

const distancePointToSegment = (point, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(point.x - x, point.y - y);
};

const pathLength = (points) => {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
};

const pointAtPathRatio = (points, ratio = 0.5) => {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const total = pathLength(points);
  const target = clamp(Number(ratio) || 0, 0, 1) * total;
  let traveled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (traveled + length >= target) {
      const t = length ? (target - traveled) / length : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    traveled += length;
  }
  return points[points.length - 1];
};

const slicePathByRatio = (points, startRatio = 0, endRatio = 1) => {
  if (points.length < 2) return points;
  const start = clamp(Number(startRatio), 0, 1);
  const end = clamp(Number(endRatio), 0, 1);
  if (Math.abs(end - start) < 0.001) return [pointAtPathRatio(points, start), pointAtPathRatio(points, end)];
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const total = pathLength(points);
  const sliced = [pointAtPathRatio(points, lo)];
  let traveled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const next = traveled + length;
    const ratio = total > 0 ? next / total : 0;
    if (ratio > lo && ratio < hi) sliced.push(b);
    traveled = next;
  }
  sliced.push(pointAtPathRatio(points, hi));
  return start <= end ? sliced : sliced.reverse();
};

const roadwayEdgePath = (roadway, edge) => {
  const raw = edge?.path?.length ? edge.path : edge?.verts?.length ? edge.verts : [];
  if (raw.length >= 2) return raw.map(pointOf);
  const [from, to] = edgeEndpoints(edge);
  return [roadway?.getNodePosition?.(from), roadway?.getNodePosition?.(to)].filter(Boolean).map(pointOf);
};

const hazardVisual = (state, style) => {
  const ratio = clamp(
    Number(
      style === 'fire_smoke' || style === 'emergency'
        ? state?.visualHazard ?? state?.hazardValue
        : state?.maxFillRatio ?? state?.hazardValue
    ) || 0,
    0,
    1
  );
  const passability = state?.passability || 'passable';
  const affected = ratio > 0.01 || Number(state?.hazardValue) > 0;
  const color =
    style === 'fire_smoke'
      ? passability === 'blocked'
        ? '#ff3724'
        : passability === 'risky'
          ? '#ff8a2a'
          : affected
            ? '#747d8a'
            : 'rgba(170, 181, 196, 0.34)'
      : style === 'emergency'
        ? passability === 'blocked'
          ? '#ff4d4d'
          : passability === 'risky'
            ? '#f2a51a'
            : affected
              ? '#9aa7b7'
              : 'rgba(170, 181, 196, 0.34)'
      : passability === 'blocked'
        ? '#0b5dff'
        : passability === 'risky'
          ? '#1597ff'
          : affected
            ? '#58d7ff'
            : 'rgba(170, 181, 196, 0.34)';
  return {
    affected,
    color,
    passability,
    ratio,
    width: affected ? Math.max(1.6, 1.1 + ratio * 5.5) : 0.9
  };
};

const ensureState = (canvas) => {
  if (!viewState.has(canvas)) {
    viewState.set(canvas, {
      zoom: 1,
      panX: 0,
      panY: 0,
      drag: null,
      moved: false,
      hoverEdgeId: null,
      hoverHit: null,
      hits: [],
      routeHits: [],
      entityHits: [],
      options: null
    });
  }
  return viewState.get(canvas);
};

const setupCanvas = (canvas) => {
  const width = canvas.clientWidth || 500;
  const height = canvas.clientHeight || 300;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
};

const makeProjector = (points, width, height, state, padding = 26) => {
  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!valid.length) {
    const project = () => ({ x: width * 0.5 + state.panX, y: height * 0.5 + state.panY });
    project.scale = 1;
    return project;
  }
  const bounds = valid.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      maxX: Math.max(acc.maxX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxY: Math.max(acc.maxY, point.y)
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const sx = (width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX);
  const sy = (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY);
  const baseScale = Math.min(sx, sy);
  const contentWidth = (bounds.maxX - bounds.minX) * baseScale * state.zoom;
  const contentHeight = (bounds.maxY - bounds.minY) * baseScale * state.zoom;
  const offsetX = (width - contentWidth) / 2 + state.panX;
  const offsetY = (height + contentHeight) / 2 + state.panY;
  const project = (point) => ({
    x: offsetX + (point.x - bounds.minX) * baseScale * state.zoom,
    y: offsetY - (point.y - bounds.minY) * baseScale * state.zoom
  });
  project.scale = baseScale * state.zoom;
  return project;
};

const buildTopologyLayout = (roadway, sourceEdgeId) => {
  const nodes = roadway?.getNodes?.() || [];
  const edges = roadway?.getEdges?.() || [];
  const adjacency = new Map(nodes.map((node) => [String(node.id), []]));
  edges.forEach((edge) => {
    const [from, to] = edgeEndpoints(edge);
    if (!from || !to) return;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push(to);
    adjacency.get(to).push(from);
  });
  const sourceEdge = edges.find((edge) => String(edge.id) === String(sourceEdgeId));
  const starts = edgeEndpoints(sourceEdge || edges[0] || {});
  const distances = new Map();
  const queue = [];
  starts.forEach((id) => {
    if (!id || distances.has(id)) return;
    distances.set(id, 0);
    queue.push(id);
  });
  while (queue.length) {
    const current = queue.shift();
    const nextDistance = distances.get(current) + 1;
    (adjacency.get(current) || []).forEach((next) => {
      if (distances.has(next)) return;
      distances.set(next, nextDistance);
      queue.push(next);
    });
  }
  const fallback = Math.max(1, ...[...distances.values(), 0]) + 1;
  const layers = new Map();
  nodes.forEach((node) => {
    const id = String(node.id);
    const layer = distances.get(id) ?? fallback;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push(node);
  });
  const layerKeys = [...layers.keys()].sort((a, b) => a - b);
  const positions = new Map();
  layerKeys.forEach((layer, layerIndex) => {
    const items = layers
      .get(layer)
      .sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
    const y = 30 + layerIndex * 76;
    items.forEach((node, index) => {
      const t = (index + 1) / (items.length + 1);
      const spread = 190 + Math.min(180, items.length * 18);
      positions.set(String(node.id), { x: (t - 0.5) * spread, y });
    });
  });
  return positions;
};

const drawPolyline = (ctx, points) => {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.stroke();
};

const drawArrow = (ctx, points, color, scale = 1) => {
  if (points.length < 2) return;
  const total = pathLength(points);
  if (total < 8) return;
  const p = pointAtPathRatio(points, 0.62);
  const p2 = pointAtPathRatio(points, 0.62 + Math.min(0.08, 8 / total));
  const angle = Math.atan2(p2.y - p.y, p2.x - p.x);
  const size = Math.max(3, 6 * scale);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.48);
  ctx.lineTo(-size * 0.7, size * 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawLabel = (ctx, text, point, { selected = false, hovered = false } = {}) => {
  ctx.save();
  ctx.font = `${selected ? 600 : 500} 10px Inter, system-ui, sans-serif`;
  const width = ctx.measureText(text).width + 10;
  ctx.fillStyle = hovered ? 'rgba(20,25,36,0.82)' : 'rgba(8,12,20,0.72)';
  ctx.strokeStyle = selected ? 'rgba(255,209,102,0.8)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  const x = point.x + 7;
  const y = point.y - 16;
  ctx.beginPath();
  ctx.roundRect(x, y, width, 18, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = selected ? '#ffd166' : '#f4f7ff';
  ctx.fillText(text, x + 5, y + 12);
  ctx.restore();
};

const routeColor = (status) => {
  if (status === 'noRoute' || status === 'blocked') return '#ff4d4d';
  if (status === 'risky' || status === 'route_affected') return '#f2a51a';
  return '#4ade80';
};

const personColor = (status) => {
  if (status === 'noRoute' || status === 'inside_hazard' || status === 'trapped') return '#ff4d4d';
  if (status === 'risky' || status === 'at_risk' || status === 'route_affected') return '#f2a51a';
  return '#4ade80';
};

const resourceColor = (resource = {}) => {
  const status = String(resource.status || 'available').toLowerCase();
  if (status === 'unavailable') return '#8893a3';
  if (status === 'limited' || status === 'affected') return '#f2a51a';
  return '#42d392';
};

const drawResponseMarker = (ctx, point, color, { selected = false, kind = 'person', scale = 1 } = {}) => {
  const size = (kind === 'resource' ? 4.7 : 4.2) * scale;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.86)';
  ctx.lineWidth = selected ? 2.2 : 1.2;
  ctx.shadowColor = selected ? 'rgba(255,255,255,0.75)' : `${color}80`;
  ctx.shadowBlur = selected ? 10 : 5;
  ctx.beginPath();
  if (kind === 'resource') {
    ctx.roundRect(point.x - size, point.y - size, size * 2, size * 2, 3);
  } else {
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawResponseOverlay = (ctx, options, helpers) => {
  const {
    responseOverlay,
    roadway,
    glyphScale,
    edgeScreenPath,
    project,
    state
  } = helpers;
  if (!responseOverlay) return;
  const routes = responseOverlay.routes || [];
  const selectedRouteId = responseOverlay.selectedRouteId ? String(responseOverlay.selectedRouteId) : null;
  const sortedRoutes = [...routes].sort((a, b) => (String(a.routeId) === selectedRouteId ? 1 : 0) - (String(b.routeId) === selectedRouteId ? 1 : 0));
  const edgeMap = roadway?.edgeMap || new Map((roadway?.getEdges?.() || []).map((edge) => [String(edge.id), edge]));

  sortedRoutes.forEach((route) => {
    const selected = selectedRouteId && String(route.routeId) === selectedRouteId;
    const color = routeColor(route.status);
    const segments = route.segments?.length
      ? route.segments
      : (route.edgePath || []).map((edgeId) => ({ edgeId, startRatio: 0, endRatio: 1 }));
    const routeParts = [];
    segments.forEach((segment) => {
      const edgeId = segment.edgeId;
      const edge = edgeMap.get(String(edgeId));
      if (!edge) return;
      const fullPoints = edgeScreenPath(edge);
      const points = slicePathByRatio(fullPoints, segment.startRatio ?? 0, segment.endRatio ?? 1);
      if (points.length < 2) return;
      const current = routeParts[routeParts.length - 1];
      if (current?.length && Math.hypot(current[current.length - 1].x - points[0].x, current[current.length - 1].y - points[0].y) <= 18) {
        current.push(...points.slice(1));
      } else {
        routeParts.push([...points]);
      }
      for (let i = 0; i < points.length - 1; i += 1) {
        state.routeHits.push({
          type: 'route',
          routeId: route.routeId,
          personId: route.personId,
          edgeId: String(edgeId),
          a: points[i],
          b: points[i + 1],
          width: Math.max(4, (selected ? 6 : 4) * glyphScale)
        });
      }
    });
    routeParts.forEach((points) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.4, (selected ? 3.8 : 2.3) * glyphScale);
      ctx.globalAlpha = selected ? 0.96 : 0.72;
      if (route.status === 'noRoute') ctx.setLineDash([7 * glyphScale, 5 * glyphScale]);
      ctx.shadowColor = selected ? `${color}cc` : 'transparent';
      ctx.shadowBlur = selected ? 9 : 0;
      drawPolyline(ctx, points);
      ctx.restore();
    });
  });

  (responseOverlay.people || []).forEach((person) => {
    const point = project(pointOf(person.position));
    const selected = responseOverlay.selectedPersonId && String(person.personId) === String(responseOverlay.selectedPersonId);
    const color = personColor(person.riskStatus || person.routeStatus);
    const radius = Math.max(6, 7.5 * glyphScale);
    drawResponseMarker(ctx, point, color, { selected, kind: 'person', scale: glyphScale });
    state.entityHits.push({ type: 'person', id: person.personId, x: point.x, y: point.y, radius });
    if (selected || state.hoverHit?.type === 'person' && String(state.hoverHit.id) === String(person.personId)) {
      drawLabel(ctx, person.personId, point, { selected, hovered: !selected });
    }
  });

  (responseOverlay.resources || []).forEach((resource) => {
    const point = project(pointOf(resource.position));
    const selected = responseOverlay.selectedResourceId && String(resource.resourceId) === String(responseOverlay.selectedResourceId);
    const color = resourceColor(resource);
    const radius = Math.max(7, 8 * glyphScale);
    drawResponseMarker(ctx, point, color, { selected, kind: 'resource', scale: glyphScale });
    state.entityHits.push({ type: 'resource', id: resource.resourceId, x: point.x, y: point.y, radius });
    if (selected || state.hoverHit?.type === 'resource' && String(state.hoverHit.id) === String(resource.resourceId)) {
      drawLabel(ctx, resource.resourceId, point, { selected, hovered: !selected });
    }
  });
};

const renderCanvas = (canvas) => {
  const state = ensureState(canvas);
  const options = state.options;
  if (!options) return;
  const { ctx, width, height } = setupCanvas(canvas);
  const {
    roadway,
    states = [],
    selectedEdgeId,
    sourceEdgeId,
    sourceRatio = 0.5,
    style = 'water',
    mode = 'map',
    title = '',
    responseOverlay = null
  } = options;
  const edges = roadway?.getEdges?.() || [];
  const nodes = roadway?.getNodes?.() || [];
  const stateMap = new Map(states.filter((item) => item?.roadwayEdgeId).map((item) => [String(item.roadwayEdgeId), item]));
  const allPoints =
    mode === 'topology'
      ? [...buildTopologyLayout(roadway, sourceEdgeId).values()]
      : edges.flatMap((edge) => roadwayEdgePath(roadway, edge));
  const topologyLayout = mode === 'topology' ? buildTopologyLayout(roadway, sourceEdgeId) : null;
  const project = makeProjector(allPoints, width, height, state, 28);
  const glyphScale = clamp(state.zoom * (Math.min(width, height) / 320), 0.22, 2.2);
  state.hits = [];
  state.routeHits = [];
  state.entityHits = [];

  const edgeScreenPath = (edge) => {
    if (mode === 'topology') {
      const [from, to] = edgeEndpoints(edge);
      const a = topologyLayout.get(from);
      const b = topologyLayout.get(to);
      if (!a || !b) return [];
      const sameLayer = Math.abs(a.y - b.y) < 1;
      const curve = sameLayer ? Math.max(30, Math.abs(a.x - b.x) * 0.22) : 0;
      const c1 = sameLayer ? { x: a.x, y: a.y - curve } : { x: a.x, y: (a.y + b.y) * 0.5 };
      const c2 = sameLayer ? { x: b.x, y: b.y - curve } : { x: b.x, y: (a.y + b.y) * 0.5 };
      const samples = [];
      for (let i = 0; i <= 18; i += 1) {
        const t = i / 18;
        const mt = 1 - t;
        samples.push(
          project({
            x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
            y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y
          })
        );
      }
      return samples;
    }
    return roadwayEdgePath(roadway, edge).map(project);
  };

  edges.forEach((edge) => {
    const edgeId = String(edge.id);
    const points = edgeScreenPath(edge);
    if (points.length < 2) return;
    const visual = hazardVisual(stateMap.get(edgeId), style);
    const selected = selectedEdgeId && edgeId === String(selectedEdgeId);
    const source = sourceEdgeId && edgeId === String(sourceEdgeId);
    const hovered = state.hoverEdgeId === edgeId;
    ctx.save();
    ctx.strokeStyle = selected ? '#ffffff' : hovered ? '#edf3ff' : visual.color;
    ctx.lineWidth = Math.max(0.5, (selected ? visual.width + 2.3 : hovered ? visual.width + 1.5 : visual.width) * glyphScale);
    ctx.globalAlpha = visual.affected || selected || hovered || source ? 0.98 : 0.62;
    if (source) ctx.setLineDash([7 * glyphScale, 4 * glyphScale]);
    drawPolyline(ctx, points);
    ctx.restore();

    if (visual.affected || selected || hovered) {
      drawArrow(ctx, points, selected ? '#ffffff' : visual.color, glyphScale * 0.75);
    }

    for (let i = 0; i < points.length - 1; i += 1) state.hits.push({ edgeId, a: points[i], b: points[i + 1], width: ctx.lineWidth });

    if (selected || source || hovered || (state.zoom > 3.0 && visual.affected)) {
      drawLabel(ctx, edgeId, pointAtPathRatio(points, 0.5), { selected, hovered });
    }
  });

  nodes.forEach((node) => {
    const model = mode === 'topology' ? topologyLayout.get(String(node.id)) : pointOf(node.position ?? node);
    if (!model) return;
    const point = project(model);
    ctx.fillStyle = 'rgba(220,228,240,0.84)';
    ctx.strokeStyle = 'rgba(4,8,16,0.62)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(point.x, point.y, (mode === 'topology' ? 2.7 : 1.8) * glyphScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (mode === 'topology' && state.zoom > 3.2 && nodes.length < 120) drawLabel(ctx, String(node.id), point);
  });

  const sourceEdge = edges.find((edge) => String(edge.id) === String(sourceEdgeId));
  if (sourceEdge) {
    const points = edgeScreenPath(sourceEdge);
    if (points.length >= 2) {
      const point = pointAtPathRatio(points, sourceRatio);
      ctx.save();
      ctx.fillStyle = style === 'fire_smoke' ? '#ff4d1a' : '#58d7ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = style === 'fire_smoke' ? 'rgba(255,77,26,0.85)' : 'rgba(88,215,255,0.85)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(4, 5.2 * glyphScale), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawLabel(ctx, 'source', point, { selected: true });
    }
  }

  drawResponseOverlay(ctx, options, {
    responseOverlay,
    roadway,
    glyphScale,
    edgeScreenPath,
    project,
    state
  });

  const hoverState = state.hoverEdgeId ? stateMap.get(String(state.hoverEdgeId)) : null;
  const hoverText = state.hoverEdgeId
    ? `${state.hoverEdgeId} | ${hoverState?.passability || 'passable'} | ${((hazardVisual(hoverState, style).ratio || 0) * 100).toFixed(0)}%`
    : 'wheel: zoom | drag: pan | click edge: select';
  ctx.fillStyle = 'rgba(210,220,235,0.76)';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.fillText(title, 12, 20);
  ctx.fillText(hoverText, 12, height - 12);
};

const edgeAtCanvasEvent = (canvas, event) => {
  const hit = hitAtCanvasEvent(canvas, event);
  return hit?.edgeId || null;
};

const hitAtCanvasEvent = (canvas, event) => {
  const state = ensureState(canvas);
  const rect = canvas.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  for (let i = state.entityHits.length - 1; i >= 0; i -= 1) {
    const hit = state.entityHits[i];
    if (Math.hypot(point.x - hit.x, point.y - hit.y) <= hit.radius) return hit;
  }
  let best = null;
  let bestDistance = Infinity;
  state.routeHits.forEach((hit) => {
    const distance = distancePointToSegment(point, hit.a, hit.b);
    const tolerance = Math.max(7, (hit.width || 3) * 0.9 + 3);
    if (distance <= tolerance && distance < bestDistance) {
      best = hit;
      bestDistance = distance;
    }
  });
  if (best) return best;
  state.hits.forEach((hit) => {
    const distance = distancePointToSegment(point, hit.a, hit.b);
    const tolerance = Math.max(8, (hit.width || 2) * 0.8 + 4);
    if (distance <= tolerance && distance < bestDistance) {
      best = { type: 'edge', edgeId: hit.edgeId };
      bestDistance = distance;
    }
  });
  return best;
};

const installCanvasNavigation = (canvas) => {
  const state = ensureState(canvas);
  if (state.installed) return;
  state.installed = true;
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const oldZoom = state.zoom;
    state.zoom = clamp(state.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.35, 7);
    if (oldZoom !== state.zoom) renderCanvas(canvas);
  });
  canvas.addEventListener('dblclick', () => {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    renderCanvas(canvas);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    state.drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: state.panX,
      panY: state.panY,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (state.drag && state.drag.pointerId === event.pointerId) {
      const dx = event.clientX - state.drag.x;
      const dy = event.clientY - state.drag.y;
      if (Math.hypot(dx, dy) > 3) state.drag.moved = true;
      state.panX = state.drag.panX + dx;
      state.panY = state.drag.panY + dy;
      renderCanvas(canvas);
      return;
    }
    const hover = hitAtCanvasEvent(canvas, event);
    const hoverKey = hover ? `${hover.type}:${hover.id ?? hover.routeId ?? hover.edgeId}` : null;
    const currentKey = state.hoverHit ? `${state.hoverHit.type}:${state.hoverHit.id ?? state.hoverHit.routeId ?? state.hoverHit.edgeId}` : null;
    if (hoverKey !== currentKey) {
      state.hoverHit = hover;
      state.hoverEdgeId = hover?.edgeId || null;
      renderCanvas(canvas);
    }
  });
  const finish = (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    canvas.releasePointerCapture(event.pointerId);
    state.moved = state.drag.moved;
    state.drag = null;
    setTimeout(() => {
      state.moved = false;
    }, 0);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('mouseleave', () => {
    if (!state.hoverEdgeId) return;
    state.hoverEdgeId = null;
    state.hoverHit = null;
    renderCanvas(canvas);
  });
};

export function renderRoadwayHazardViewPair(options) {
  [
    { panel: options.mapPanel, mode: 'map', title: options.mapTitle || '2D Map' },
    { panel: options.topologyPanel, mode: 'topology', title: options.topologyTitle || 'Topology' }
  ].forEach(({ panel, mode, title }) => {
    const canvas = panel?.querySelector?.('canvas');
    if (!canvas) return;
    const state = ensureState(canvas);
    state.options = { ...options, mode, title };
    installCanvasNavigation(canvas);
    renderCanvas(canvas);
  });
}

export function installRoadwayHazardViewSelection(panels, onSelect) {
  const disposers = [];
  panels.filter(Boolean).forEach((panel) => {
    const canvas = panel.querySelector?.('canvas');
    if (!canvas) return;
    const click = (event) => {
      const state = ensureState(canvas);
      if (state.moved) return;
      const edgeId = edgeAtCanvasEvent(canvas, event);
      event.preventDefault();
      event.stopPropagation();
      onSelect?.(edgeId || null);
    };
    canvas.addEventListener('click', click);
    disposers.push(() => canvas.removeEventListener('click', click));
  });
  return () => disposers.splice(0).forEach((dispose) => dispose());
}

export function installRoadwayResponseViewSelection(panels, callbacks = {}) {
  const disposers = [];
  panels.filter(Boolean).forEach((panel) => {
    const canvas = panel.querySelector?.('canvas');
    if (!canvas) return;
    const click = (event) => {
      const state = ensureState(canvas);
      if (state.moved) return;
      const hit = hitAtCanvasEvent(canvas, event);
      event.preventDefault();
      event.stopPropagation();
      if (!hit) {
        callbacks.onBlank?.();
        return;
      }
      if (hit.type === 'person') callbacks.onPerson?.(String(hit.id));
      else if (hit.type === 'resource') callbacks.onResource?.(String(hit.id));
      else if (hit.type === 'route') callbacks.onRoute?.(String(hit.routeId), hit.personId ? String(hit.personId) : null, hit.edgeId);
      else if (hit.type === 'edge') callbacks.onEdge?.(String(hit.edgeId));
    };
    canvas.addEventListener('click', click);
    disposers.push(() => canvas.removeEventListener('click', click));
  });
  return () => disposers.splice(0).forEach((dispose) => dispose());
}
