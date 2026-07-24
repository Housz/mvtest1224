import createLucideElement from 'lucide/dist/esm/createElement.mjs';
import ArrowDown from 'lucide/dist/esm/icons/arrow-down.mjs';
import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs';
import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs';
import ArrowUp from 'lucide/dist/esm/icons/arrow-up.mjs';
import Box from 'lucide/dist/esm/icons/box.mjs';
import ChevronsDown from 'lucide/dist/esm/icons/chevrons-down.mjs';
import ChevronsUp from 'lucide/dist/esm/icons/chevrons-up.mjs';
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs';
import Focus from 'lucide/dist/esm/icons/focus.mjs';
import FolderOpen from 'lucide/dist/esm/icons/folder-open.mjs';
import Layers from 'lucide/dist/esm/icons/layers.mjs';
import Maximize from 'lucide/dist/esm/icons/maximize-2.mjs';
import PanelBottom from 'lucide/dist/esm/icons/panel-bottom.mjs';
import PanelLeft from 'lucide/dist/esm/icons/panel-left.mjs';
import PanelRight from 'lucide/dist/esm/icons/panel-right.mjs';
import PanelsTopLeft from 'lucide/dist/esm/icons/panels-top-left.mjs';
import PanelTop from 'lucide/dist/esm/icons/panel-top.mjs';
import Pin from 'lucide/dist/esm/icons/pin.mjs';
import RotateCcw from 'lucide/dist/esm/icons/rotate-ccw.mjs';
import Save from 'lucide/dist/esm/icons/save.mjs';
import X from 'lucide/dist/esm/icons/x.mjs';

const ICONS = Object.freeze({
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  box: Box,
  'chevrons-down': ChevronsDown,
  'chevrons-up': ChevronsUp,
  'external-link': ExternalLink,
  focus: Focus,
  'folder-open': FolderOpen,
  'layers-3': Layers,
  'maximize-2': Maximize,
  'panel-bottom': PanelBottom,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  'panels-top-left': PanelsTopLeft,
  'panel-top': PanelTop,
  pin: Pin,
  'rotate-ccw': RotateCcw,
  save: Save,
  x: X
});

export function createLucideIcon(name, attributes = {}) {
  const icon = ICONS[name];
  if (!icon) return document.createTextNode('');
  return createLucideElement(icon, {
    'aria-hidden': 'true',
    focusable: 'false',
    ...attributes
  });
}

export function renderLucideIcons(root = document) {
  root.querySelectorAll('[data-lucide]').forEach((placeholder) => {
    const icon = ICONS[placeholder.dataset.lucide];
    if (!icon) return;
    const attributes = {
      class: placeholder.getAttribute('class') || '',
      'aria-hidden': placeholder.getAttribute('aria-hidden') || 'true'
    };
    const svg = createLucideElement(icon, attributes);
    placeholder.replaceWith(svg);
  });
}
