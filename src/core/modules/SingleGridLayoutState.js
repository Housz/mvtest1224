const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function unionArea(rects) {
  const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index];
    const right = xs[index + 1];
    if (right <= left) continue;
    const intervals = rects
      .filter((rect) => rect.x < right && rect.x + rect.width > left)
      .map((rect) => [rect.y, rect.y + rect.height])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let start = null;
    let end = null;
    intervals.forEach(([nextStart, nextEnd]) => {
      if (start == null) {
        start = nextStart;
        end = nextEnd;
      } else if (nextStart <= end) {
        end = Math.max(end, nextEnd);
      } else {
        covered += end - start;
        start = nextStart;
        end = nextEnd;
      }
    });
    if (start != null) covered += end - start;
    area += (right - left) * covered;
  }
  return area;
}

export function captureSingleGridSnapshot(service) {
  try {
    return {
      dockview: service.api.toJSON(),
      records: new Map([...service.records].map(([id, record]) => [id, {
        open: record.open,
        semanticVisible: record.semanticVisible,
        closedByUser: record.closedByUser,
        lastPlacement: record.lastPlacement ? structuredClone(record.lastPlacement) : null
      }]))
    };
  } catch {
    return null;
  }
}

export function validateSingleGridLayout(service, { geometry = true } = {}) {
  const errors = [];
  const panels = service.api.panels || [];
  const ids = panels.map((panel) => panel.id);
  if (new Set(ids).size !== ids.length) errors.push('Duplicate Dockview panel ids.');
  ids.forEach((id) => {
    const record = service.records.get(id);
    if (!record) errors.push(`Unknown Dockview panel ${id}.`);
    else if (!record.open || !record.semanticVisible) errors.push(`Closed panel ${id} remains in layout.`);
  });
  service.records.forEach((record) => {
    if (record.registered && record.open && record.semanticVisible && !ids.includes(record.id)) {
      errors.push(`Open panel ${record.id} is missing from Dockview.`);
    }
  });
  (service.api.groups || []).forEach((group) => {
    if (!(group.panels || []).length) errors.push(`Empty group ${group.id}.`);
    if (group.api?.location?.type === 'edge') errors.push(`Legacy Edge Group ${group.id} is not allowed.`);
  });
  if (!geometry || errors.length) return { valid: errors.length === 0, errors };

  const workspace = service.getWorkspaceBounds();
  const gridGroups = (service.api.groups || []).filter((group) => group.api?.location?.type !== 'floating');
  const rects = [];
  gridGroups.forEach((group) => {
    const box = service.getGroupBounds(group);
    if (!box?.width || !box?.height) {
      errors.push(`Group ${group.id} has no measurable bounds.`);
      return;
    }
    if (box.x < -1 || box.y < -1 ||
        box.x + box.width > workspace.width + 1 ||
        box.y + box.height > workspace.height + 1) {
      errors.push(`Grid group ${group.id} is outside the workspace.`);
    }
    const header = group.element?.querySelector?.('.dv-tabs-and-actions-container');
    const headerRect = header?.getBoundingClientRect?.();
    if (!headerRect || headerRect.width < 1 || headerRect.height < 1) {
      errors.push(`Panel group ${group.id} has no visible horizontal title bar.`);
    }
    rects.push(box);
  });
  (service.api.groups || [])
    .filter((group) => group.api?.location?.type === 'floating')
    .forEach((group) => {
      const box = service.getGroupBounds(group);
      if (box && (box.x < -1 || box.y < -1 ||
          box.x + box.width > workspace.width + 1 ||
          box.y + box.height > workspace.height + 1)) {
        errors.push(`Floating group ${group.id} is outside the workspace.`);
      }
    });

  if (rects.length && workspace.width > 1 && workspace.height > 1) {
    const clipped = rects.map((rect) => {
      const x = clamp(rect.x, 0, workspace.width);
      const y = clamp(rect.y, 0, workspace.height);
      return {
        x,
        y,
        width: Math.max(0, Math.min(workspace.width, rect.x + rect.width) - x),
        height: Math.max(0, Math.min(workspace.height, rect.y + rect.height) - y)
      };
    });
    const expected = workspace.width * workspace.height;
    const missing = expected - unionArea(clipped);
    if (missing > Math.max(4, expected * 0.012)) {
      errors.push(`Grid leaves leave ${Math.round(missing)}px? unassigned.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function serializeSingleGridLayout(service, version) {
  service.records.forEach((record) => {
    if (record.dockPanel) service.capturePlacement(record);
  });
  return {
    version,
    dockview: service.api.toJSON(),
    openPanelIds: [...service.records.values()]
      .filter((record) => record.open && record.semanticVisible)
      .map((record) => record.id),
    placements: Object.fromEntries(
      [...service.records.values()].map((record) => [record.id, record.lastPlacement || null])
    ),
    activePanels: (service.api.groups || []).map((group) => ({
      groupId: group.id,
      panelId: group.activePanel?.id || null
    })),
    floatingBounds: (service.api.groups || [])
      .filter((group) => group.api?.location?.type === 'floating')
      .map((group) => ({ groupId: group.id, ...service.getGroupBounds(group) })),
    systemChrome: service.systemChromeService?.layoutState?.() || {}
  };
}
