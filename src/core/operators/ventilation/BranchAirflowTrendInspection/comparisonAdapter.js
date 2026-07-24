export class VentilationBranchComparisonAdapter {
  constructor({ ventilationNetwork, airflowState, sceneManager, valueKey = 'airQuantity' } = {}) {
    this.ventilationNetwork = ventilationNetwork;
    this.airflowState = airflowState;
    this.sceneManager = sceneManager;
    this.valueKey = valueKey;
  }

  setValueKey(valueKey) {
    this.valueKey = valueKey;
  }

  listComparableEntities() {
    return (this.ventilationNetwork?.listBranches?.() || []).map((branch) => ({
      id: String(branch.id),
      label: branch.name || branch.label || String(branch.id),
      entity: branch
    }));
  }

  getTimeSeries(entityId) {
    return this.airflowState?.getSeries?.(String(entityId), this.valueKey) || [];
  }

  getWorldAnchor(entityId) {
    const id = String(entityId);
    const entry = this.sceneManager?.airflowBranchObjects?.get?.(id)
      || this.sceneManager?.ventilationBranchObjects?.get?.(id);
    if (!entry?.points?.length) return null;
    return entry.points[Math.floor((entry.points.length - 1) * 0.5)] || null;
  }
}
