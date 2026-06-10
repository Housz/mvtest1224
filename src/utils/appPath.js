const EXTERNAL_OR_SPECIAL_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function appBaseUrl() {
  const base = import.meta.env?.BASE_URL || '/';
  if (typeof window === 'undefined' || !window.location?.href) return base;
  return new URL(base, window.location.href).href;
}

export function appPath(path = '') {
  const value = String(path || '').trim();
  if (!value || EXTERNAL_OR_SPECIAL_URL.test(value)) return value;

  const normalized = value.replace(/^\/+/, '').replace(/^\.\//, '');
  if (!normalized) return appBaseUrl();

  if (typeof window === 'undefined' || !window.location?.href) {
    const base = import.meta.env?.BASE_URL || '/';
    return `${base.replace(/\/?$/, '/')}${normalized}`;
  }

  return new URL(normalized, appBaseUrl()).href;
}

export function appPagePath(path = '') {
  return appPath(path);
}
