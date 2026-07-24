import { test, expect } from '@playwright/test';

test('manual node expansion overrides every automatic LOD state', async ({ page }) => {
  await page.goto('/');
  const nodeId = await page.evaluate(() => {
    const editor = window.minevisEditor;
    return editor.graph.nodes.find((node) => editor.nodeDefinition(node)?.inlineControls?.length)?.id;
  });
  expect(nodeId).toBeTruthy();

  const setAutomaticLod = async (zoom) => {
    await page.evaluate(({ nodeId: id, zoom: nextZoom }) => {
      const editor = window.minevisEditor;
      const node = editor.graph.getNode(id);
      delete node.params.uiCollapsed;
      editor.updateNodeView(id);
      editor.graph.view.zoom = nextZoom;
      editor.graph.view.panX = 360 - node.position.x * nextZoom;
      editor.graph.view.panY = 220 - node.position.y * nextZoom;
      editor.requestFrame({ camera: true, culling: true, allEdges: true });
      editor.flushScheduledFrameNow();
    }, { nodeId, zoom });
  };

  const state = () => page.evaluate((id) => {
    const editor = window.minevisEditor;
    editor.flushScheduledFrameNow();
    const node = editor.graph.getNode(id);
    const element = editor.nodeElements.get(id);
    const toggle = element.querySelector('.node-collapse-toggle');
    const controls = element.querySelector('.node-inline-controls');
    return {
      lod: editor.currentLod,
      preference: element.dataset.nodeExpansion,
      collapsed: editor.nodeEffectivelyCollapsed(node),
      buttonDisplay: getComputedStyle(toggle).display,
      ariaExpanded: toggle.getAttribute('aria-expanded'),
      controlsDisplay: controls ? getComputedStyle(controls).display : null,
      position: { ...node.position },
      selectedNodeId: editor.selectedNodeId
    };
  }, nodeId);

  for (const scenario of [
    { zoom: 1, lod: 'full', initiallyCollapsed: false },
    { zoom: 0.65, lod: 'compact', initiallyCollapsed: true },
    { zoom: 0.5, lod: 'overview', initiallyCollapsed: true }
  ]) {
    await setAutomaticLod(scenario.zoom);
    const initial = await state();
    expect(initial.lod).toBe(scenario.lod);
    expect(initial.preference).toBe('auto');
    expect(initial.collapsed).toBe(scenario.initiallyCollapsed);
    expect(initial.buttonDisplay).not.toBe('none');

    const beforePosition = initial.position;
    const beforeSelection = initial.selectedNodeId;
    await page.locator(`.node[data-id="${nodeId}"] .node-collapse-toggle`).click();
    const toggled = await state();
    expect(toggled.collapsed).toBe(!scenario.initiallyCollapsed);
    expect(toggled.preference).toBe(scenario.initiallyCollapsed ? 'expanded' : 'collapsed');
    expect(toggled.ariaExpanded).toBe(String(scenario.initiallyCollapsed));
    expect(toggled.controlsDisplay).toBe(scenario.initiallyCollapsed ? 'flex' : null);
    expect(toggled.position).toEqual(beforePosition);
    expect(toggled.selectedNodeId).toBe(beforeSelection);

    await page.locator(`.node[data-id="${nodeId}"] .node-collapse-toggle`).click();
    const toggledBack = await state();
    expect(toggledBack.collapsed).toBe(scenario.initiallyCollapsed);
    expect(toggledBack.preference).toBe(scenario.initiallyCollapsed ? 'collapsed' : 'expanded');
  }
});
