export function disposeSceneObject(object) {
  if (!object) return;
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => material.dispose?.());
  });
}

export function setObjectTreeVisible(object, visible) {
  if (object) object.visible = visible;
}
