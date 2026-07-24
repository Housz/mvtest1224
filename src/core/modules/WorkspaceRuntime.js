import { nowMs, yieldToMainThread } from '../runtime/CooperativeTaskScheduler.js';
export class WorkspaceRuntime {
  constructor({
    workspace,
    sceneManager,
    contributionManager,
    hostRegistry = null,
    onFunctionStateChange = null
  }) {
    this.workspace = workspace;
    this.sceneManager = sceneManager;
    this.contributionManager = contributionManager;
    this.hostRegistry = hostRegistry;
    this.onFunctionStateChange = onFunctionStateChange;
    this.dependencyRecords = new Map();
    this.rootRecords = new Map();
    this.activeFunction = null;
    this.disposed = false;
    workspace.runtimeSession = this;
  }

  exposureFor(operator) {
    return operator.operatorManifest?.dependencyExposure?.exposeWhenRootActive
      ? 'simulation-context'
      : 'none';
  }

  registerOperator(operator) {
    this.contributionManager.registerOwner(operator.id, operator.operatorManifest);
  }

  attachOptions(fn, operator, mode, exposure) {
    return {
      sceneManager: this.sceneManager,
      context: this.workspace.context,
      contributionRegistry: this.contributionManager,
      contributionManager: this.contributionManager,
      hostRegistry: this.hostRegistry,
      functionId: fn.id,
      mode,
      exposure,
      operatorManifest: operator.operatorManifest,
      workspaceId: this.workspace.id
    };
  }

  async attachDependency(fn, operator) {
    this.registerOperator(operator);
    const rootRecord = this.rootRecords.get(operator.id);
    if (rootRecord) {
      const record = this.dependencyRecords.get(operator.id) || {
        session: rootRecord.session,
        refs: new Set(),
        externalRoot: true
      };
      record.refs.add(fn.id);
      this.dependencyRecords.set(operator.id, record);
      return rootRecord.session;
    }
    const existing = this.dependencyRecords.get(operator.id);
    if (existing) {
      existing.refs.add(fn.id);
      return existing.session;
    }
    const session = await operator.attach(
      this.attachOptions(fn, operator, 'dependency', this.exposureFor(operator))
    );
    this.dependencyRecords.set(operator.id, {
      session,
      refs: new Set([fn.id]),
      externalRoot: false
    });
    return session;
  }

  releaseDependency(fn, operator, { keepPinned = true } = {}) {
    const record = this.dependencyRecords.get(operator.id);
    if (!record) return;
    record.refs.delete(fn.id);
    if (record.refs.size) return;
    if (record.externalRoot && this.rootRecords.has(operator.id)) {
      const rootRecord = this.rootRecords.get(operator.id);
      if (rootRecord?.rootClosed) {
        this.contributionManager.unregisterOwner(operator.id, { keepPinned });
        rootRecord.session?.cleanup?.();
        this.rootRecords.delete(operator.id);
      }
      this.dependencyRecords.delete(operator.id);
      return;
    }
    this.contributionManager.unregisterOwner(operator.id, { keepPinned });
    record.session?.cleanup?.();
    this.dependencyRecords.delete(operator.id);
  }

  async attachFunction(fn) {
    if (fn.enabled || this.disposed) return fn.session;
    if (fn.attachPromise) return fn.attachPromise;
    const startedAt = nowMs();
    fn.loading = true;
    fn.error = null;
    this.onFunctionStateChange?.(fn, fn.enabled);
    fn.attachPromise = this.performAttachFunction(fn);
    try {
      return await fn.attachPromise;
    } catch (error) {
      fn.error = error?.message || String(error);
      throw error;
    } finally {
      fn.loading = false;
      fn.attachPromise = null;
      fn.lastAttachDurationMs = nowMs() - startedAt;
      this.onFunctionStateChange?.(fn, fn.enabled);
    }
  }

  async performAttachFunction(fn) {
    fn.dependencySessions = [];
    try {
      for (const dependency of fn.dependencies || []) {
        await yieldToMainThread();
        const session = await this.attachDependency(fn, dependency);
        fn.dependencySessions.push({ operator: dependency, session });
      }
      this.registerOperator(fn.operator);
      await yieldToMainThread();
      const retainedDependency = this.dependencyRecords.get(fn.operator.id);
      const retainedRoot = this.rootRecords.get(fn.operator.id);
      if (retainedDependency && (!retainedRoot || retainedRoot.rootClosed)) {
        fn.session = retainedDependency.session;
        retainedDependency.externalRoot = true;
        fn.operator.functionId = fn.id;
        this.rootRecords.set(fn.operator.id, {
          session: fn.session,
          functionId: fn.id,
          rootClosed: false
        });
        this.contributionManager.reassignOwnerFunction(fn.operator.id, fn.id);
        fn.operator.updateViews?.();
        fn.operator.recomputeRoutes?.();
        fn.enabled = true;
        if (!this.activeFunction) this.sceneManager?.setActiveInteractionOwner?.(fn.operator.id);
        this.contributionManager.setFunctionLabels(this.workspace.functions);
        return fn.session;
      }
      fn.session = await fn.operator.attach(
        this.attachOptions(fn, fn.operator, 'root', 'full')
      );
      (fn.dependencies || []).forEach((dependency) => dependency.updateViews?.());
      fn.operator.recomputeRoutes?.();
      this.rootRecords.set(fn.operator.id, {
        session: fn.session,
        functionId: fn.id,
        rootClosed: false
      });
      fn.enabled = true;
      if (!this.activeFunction) this.sceneManager?.setActiveInteractionOwner?.(fn.operator.id);
      this.contributionManager.setFunctionLabels(this.workspace.functions);
      return fn.session;
    } catch (error) {
      if (fn.session) {
        this.contributionManager.unregisterOwner(fn.operator.id, { keepPinned: false });
        fn.session.cleanup?.();
        this.rootRecords.delete(fn.operator.id);
      }
      [...(fn.dependencies || [])].reverse().forEach((dependency) => {
        this.releaseDependency(fn, dependency, { keepPinned: false });
      });
      fn.dependencySessions = [];
      fn.session = null;
      fn.enabled = false;
      throw error;
    }
  }

  closeFunction(fn, { keepPinned = true, remember = true } = {}) {
    if (remember) fn.rememberedEnabled = fn.enabled;
    if (!fn.enabled) return;
    const dependencyRecord = this.dependencyRecords.get(fn.operator.id);
    const heldByDependency = dependencyRecord?.refs?.size > 0;
    if (!heldByDependency) {
      this.contributionManager.unregisterOwner(fn.operator.id, { keepPinned });
      fn.session?.cleanup?.();
      this.rootRecords.delete(fn.operator.id);
    } else {
      const rootRecord = this.rootRecords.get(fn.operator.id);
      if (rootRecord) {
        rootRecord.rootClosed = true;
        const dependencyFunctionId = dependencyRecord.refs.values().next().value || null;
        fn.operator.functionId = dependencyFunctionId || fn.operator.id;
        this.contributionManager.reassignOwnerFunction(
          fn.operator.id,
          dependencyFunctionId || fn.operator.id
        );
      }
    }
    (fn.dependencies || []).forEach((dependency) => {
      this.releaseDependency(fn, dependency, { keepPinned });
    });
    fn.dependencySessions = [];
    fn.session = null;
    fn.enabled = false;
    if (this.activeFunction?.id === fn.id) this.activeFunction = null;
    if (!this.activeFunction) this.sceneManager?.setActiveInteractionOwner?.(null);
    this.onFunctionStateChange?.(fn, false);
  }

  async toggleFunction(fn) {
    if (!fn.enabled) {
      await this.attachFunction(fn);
      fn.rememberedEnabled = true;
    } else {
      this.closeFunction(fn, { keepPinned: true, remember: false });
      fn.rememberedEnabled = false;
    }
    return fn.enabled;
  }

  focusFunction(fn) {
    this.activeFunction = fn || null;
    this.workspace.focusedFunctionId = fn?.id || null;
    this.contributionManager.setFocusedFunction(fn?.id || null);
    this.sceneManager?.setActiveInteractionOwner?.(fn?.operator?.id || null);
  }

  renderControls(fn, container) {
    container.innerHTML = '';
    if (!fn?.enabled) {
      return;
    }
    const exposedDependencies = (fn.dependencies || []).filter((operator) => (
      operator.operatorManifest?.dependencyExposure?.exposeWhenRootActive
    ));
    exposedDependencies.forEach((operator) => {
      if (typeof operator.renderControls !== 'function') return;
      const section = document.createElement('section');
      section.className = 'dependency-control-section';
      section.dataset.dependencyOperator = operator.id;
      operator.renderControls(section);
      container.appendChild(section);
    });
    const rootSection = document.createElement('section');
    rootSection.className = 'root-control-section';
    if (typeof fn.operator.renderControls === 'function') {
      fn.operator.renderControls(rootSection);
    } else {
      const title = document.createElement('div');
      title.className = 'panel-title';
      title.textContent = fn.label || fn.operator?.label || 'Function';
      const note = document.createElement('div');
      note.className = 'muted-note';
      note.textContent = 'This function does not expose workspace controls.';
      rootSection.append(title, note);
    }
    container.appendChild(rootSection);
  }

  suspend() {
    this.workspace.functions.forEach((fn) => {
      this.closeFunction(fn, { keepPinned: false, remember: true });
    });
    this.focusFunction(null);
  }

  async restore() {
    for (const fn of this.workspace.functions) {
      if (fn.rememberedEnabled) await this.attachFunction(fn);
    }
    const restored = this.workspace.functions.find((fn) => fn.enabled) || null;
    this.focusFunction(restored);
    return restored;
  }

  clearSelection(keys = null) {
    this.workspace.context.clearDeclaredSelection({
      keys,
      source: 'workspace-blank-pick'
    });
  }

  cleanup() {
    if (this.disposed) return;
    this.workspace.functions.forEach((fn) => {
      this.closeFunction(fn, { keepPinned: false, remember: false });
    });
    this.dependencyRecords.forEach((record, operatorId) => {
      this.contributionManager.unregisterOwner(operatorId, { keepPinned: false });
      record.session?.cleanup?.();
    });
    this.dependencyRecords.clear();
    this.rootRecords.clear();
    this.sceneManager?.setActiveInteractionOwner?.(null);
    this.workspace.datasetChannels?.forEach((channel) => channel.upstreamDispose?.());
    this.disposed = true;
  }
}
