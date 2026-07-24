# Preview Workspace and Visual Contribution Layout

The Preview is a full-screen visual-analytics workspace. The Three.js Main Scene is a permanent underlay; controls, charts, legends, details, and other Operator outputs are overlay contributions managed by a dock layout.

## Layer Model

```text
Runtime shell
  Main Scene underlay
    Three.js canvas (always full viewport)
  Dock overlay
    left, right, and bottom dock groups
    tab groups and floating panels
    auto-hide rails
  Global overlay
    module toolbar
    scene-focus and reset actions
    tooltips and modal UI
```

Docking never changes the renderer or Canvas dimensions. A panel intercepts pointer and wheel input inside its own bounds; uncovered areas continue to reach Three.js picking and camera navigation.

## Separation of Responsibilities

`VisualContributionManager` owns semantic composition:

- contribution lifecycle and ownership;
- visibility, opacity, order, focus, and pin state;
- role complementarity and focus behavior;
- interaction locks and cleanup.

`WorkspaceLayoutService` owns spatial presentation:

- dock region, tab group, floating bounds, and panel size;
- close, restore, auto-hide, maximize, and reset layout;
- per-workspace layout persistence;
- responsive panel placement.

Dockview is an implementation detail of `WorkspaceLayoutService`. Operators and the semantic composition manager do not call Dockview APIs directly.

## Contribution Layout Contract

Every panel contribution may extend its descriptor with layout and relation metadata:

```js
{
  layout: {
    role: 'control',
    preferredRegion: 'right',
    preferredSize: { width: 320, height: 360 },
    minSize: { width: 250, height: 160 },
    maxViewportRatio: { width: 0.46, height: 0.86 },
    tabGroup: 'right-controls',
    priority: 50,
    dockable: true,
    floatable: true,
    resizable: true,
    closable: true,
    autoHide: false
  },
  relations: {
    controlsFor: ['attribute-layer'],
    legendFor: [],
    detailsFor: [],
    coordinatesWith: ['attribute-histogram'],
    contextKeys: ['activeGeologicalAttribute', 'attributeRangeFilter']
  }
}
```

Legacy contributions are normalized by `ContributionLayoutPolicy`:

- controls go to the upper-right group;
- details, summaries, and legends share right-side inspector tabs;
- charts, topology views, sections, profiles, and timelines share bottom tabs;
- scene layers remain in the Main Scene and do not become panels;
- the contribution manager uses a right-side auto-hide entry.

## Coordination Semantics

The layout follows the paper's visual-contribution coordination model:

1. Semantic consistency: panels and scene layers consume the same Module-scoped context keys.
2. Role complementarity: controls, primary views, legends, and details receive distinct default regions.
3. Focus response: focusing a Function activates its control and primary-view tabs while dependency UI stays hidden.
4. Control-display coupling: descriptor relations identify the scene layers or views affected by a control panel.

Enabling a Function registers contributions. Focusing changes composition and active tabs. Disabling removes unpinned contributions and releases their layout slots. Scene Focus temporarily hides unpinned panels without disabling Operators or destroying Datasets.

## Safe Scene Viewport

The scene remains full-screen even when panels cover its edges. `SceneViewportInsets` computes the unobstructed rectangle from visible dock groups and the toolbar. `SceneManager` uses this safe rectangle for object focus, camera fitting, and orientation-widget placement so a selected object is not centered behind a control or chart.

## Responsive and Persistent Layout

Layouts are stored independently from graph JSON by graph identity, Module ID, and viewport class:

- `wide`: 1400px and above;
- `medium`: 1100px to 1399px;
- `compact`: below 1100px.

On compact viewports, left and non-control right panels begin on auto-hide rails while the current controls remain available. Crossing a viewport-class boundary saves the current layout and restores the layout for the new class. Reset Layout removes the saved state for the active scope and rebuilds descriptor-driven defaults.

`ResponsiveViewHost` observes dock content size. It emits one animation-frame-coalesced resize event only when a visible host has non-zero dimensions. ECharts, Canvas, SVG, and other views use this event to update their backing size without rebuilding Operator runtime state.

## Operator Extension Rule

An Operator creates panel content with the shared runtime UI helpers and registers the actual root element on its visual contribution. It must not hardcode screen coordinates, implement its own drag/resize loop, or manipulate Dockview. Scene contributions continue to register Three.js objects with `host: 'main-3d-scene'` and do not provide a panel element.
