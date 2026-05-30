const baseMaps = {
  rainbow: [
    { stop: 0, color: '#2c7bb6' },
    { stop: 0.25, color: '#00a6ca' },
    { stop: 0.5, color: '#00ccbc' },
    { stop: 0.75, color: '#90eb9d' },
    { stop: 1, color: '#f9d057' }
  ],
  viridis: [
    { stop: 0, color: '#440154' },
    { stop: 0.2, color: '#3b528b' },
    { stop: 0.4, color: '#21918c' },
    { stop: 0.6, color: '#5ec962' },
    { stop: 1, color: '#fde725' }
  ],
  heat: [
    { stop: 0, color: '#000004' },
    { stop: 0.25, color: '#51127c' },
    { stop: 0.5, color: '#b73779' },
    { stop: 0.75, color: '#fc8961' },
    { stop: 1, color: '#f9e721' }
  ]
};

export const ColorMaps = {
  ...baseMaps
};

export function colorLerp(c1, c2, t) {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const rgb = {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  };
  return `rgb(${rgb.r.toFixed(0)}, ${rgb.g.toFixed(0)}, ${rgb.b.toFixed(0)})`;
}

export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

export function sampleColor(map, t) {
  const points = ColorMaps[map] || ColorMaps.rainbow;
  const clamped = Math.max(0, Math.min(1, t));
  let left = points[0];
  let right = points[points.length - 1];
  for (let i = 0; i < points.length - 1; i++) {
    if (clamped >= points[i].stop && clamped <= points[i + 1].stop) {
      left = points[i];
      right = points[i + 1];
      break;
    }
  }
  const local = (clamped - left.stop) / (right.stop - left.stop || 1);
  return colorLerp(left.color, right.color, local);
}

export function generateCssGradient(map) {
  const points = ColorMaps[map] || ColorMaps.rainbow;
  const stops = points.map((p) => `${p.color} ${p.stop * 100}%`).join(',');
  return `linear-gradient(90deg, ${stops})`;
}

export function setCustomColorMap(mapName, stops) {
  if (!Array.isArray(stops) || !stops.length) return;
  const key = mapName || 'custom';
  ColorMaps[key] = stops
    .map((s, i) => ({
      stop: typeof s.stop === 'number' ? s.stop : i / Math.max(stops.length - 1, 1),
      color: s.color || '#ffffff'
    }))
    .sort((a, b) => a.stop - b.stop);
}

export function resetColorMap(mapName) {
  if (!mapName || !baseMaps[mapName]) return;
  ColorMaps[mapName] = baseMaps[mapName].map((p) => ({ ...p }));
}

export function getDefaultStops(mapName) {
  return (baseMaps[mapName] || baseMaps.rainbow).map((p) => ({ ...p }));
}
