export async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.text();
}

export function extensionOf(path = '') {
  const clean = String(path).split('?')[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function collectObjectPaths(value, prefix = '', out = new Set(), depth = 0) {
  if (depth > 3 || value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value[0] && typeof value[0] === 'object') collectObjectPaths(value[0], prefix, out, depth + 1);
    return out;
  }
  Object.keys(value).forEach((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    collectObjectPaths(value[key], path, out, depth + 1);
  });
  return out;
}

export function pickSuggestedRoleMapping(contract, candidates) {
  const candidateSet = new Set(candidates);
  const lowerMap = new Map(candidates.map((candidate) => [candidate.toLowerCase(), candidate]));
  const mapping = {};
  (contract?.roles || []).forEach((role) => {
    const defaults = [role.defaultPath, ...(role.candidates || []), role.key, role.key.split('.').at(-1)].filter(Boolean);
    const picked = defaults.find((candidate) => candidateSet.has(candidate));
    if (picked) {
      mapping[role.key] = picked;
      return;
    }
    const lowerPicked = defaults.map((candidate) => lowerMap.get(String(candidate).toLowerCase())).find(Boolean);
    if (lowerPicked) mapping[role.key] = lowerPicked;
  });
  return mapping;
}
