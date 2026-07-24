/**
 * Composes a runtime capability without creating another attached runtime session.
 * State is initialized once and prototype methods execute against the owning runtime.
 */
export function initializeRuntimeCapability(target, RuntimeClass, ...args) {
  Object.assign(target, new RuntimeClass(...args));
  return target;
}

export function composeRuntimePrototype(TargetClass, CapabilityClass, {
  exclude = []
} = {}) {
  const excluded = new Set(['constructor', ...exclude]);
  Object.getOwnPropertyNames(CapabilityClass.prototype).forEach((name) => {
    if (excluded.has(name) || Object.prototype.hasOwnProperty.call(TargetClass.prototype, name)) return;
    const descriptor = Object.getOwnPropertyDescriptor(CapabilityClass.prototype, name);
    Object.defineProperty(TargetClass.prototype, name, descriptor);
  });
  return TargetClass;
}
