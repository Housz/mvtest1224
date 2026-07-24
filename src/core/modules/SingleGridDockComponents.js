import { createLucideIcon } from '../../ui/LucideIcons.js';

export class SingleGridContentRenderer {
  constructor(service, id) {
    this.service = service;
    this.id = id;
    this.element = document.createElement('div');
    this.element.className = 'minevis-dock-content';
  }

  init(params) {
    this.params = params;
    this.service.mountRenderer(this.id, this.element, params);
  }

  onShow() {
    this.service.setRecordActive(this.id, true);
    this.service.requestRecordResize(this.id);
  }

  onHide() {
    this.service.setRecordActive(this.id, false);
  }

  layout() {
    this.service.requestRecordResize(this.id);
  }

  dispose() {
    this.service.unmountRenderer(this.id, this.element);
  }
}

export class SingleGridTabRenderer {
  constructor(service, id) {
    this.service = service;
    this.id = id;
    this.element = document.createElement('div');
    this.element.className = 'minevis-dock-tab';
  }

  init(params) {
    this.params = params;
    this.title = document.createElement('span');
    this.title.className = 'minevis-dock-tab-title';
    this.actions = document.createElement('span');
    this.actions.className = 'minevis-dock-tab-actions';
    this.close = document.createElement('button');
    this.close.type = 'button';
    this.close.dataset.action = 'close';
    this.close.title = 'Close panel';
    this.close.setAttribute('aria-label', 'Close panel');
    this.close.appendChild(createLucideIcon('x'));
    this.actions.appendChild(this.close);
    this.element.append(this.title, this.actions);

    this.element.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) {
        event.stopPropagation();
        return;
      }
      this.service.startPanelDrag(this.id, event);
    });
    this.element.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="close"]')) {
        event.preventDefault();
        event.stopPropagation();
        this.service.closeRecord(this.id);
        return;
      }
      if (!this.service.dragController?.shouldSuppressClick()) this.service.activateRecordFromTab(this.id);
    });
    this.unsubscribe = this.service.subscribeRecord(this.id, () => this.render());
    this.render();
  }

  render() {
    const record = this.service.getRecord(this.id);
    this.title.textContent = record?.title || this.params?.title || this.id;
    this.close.hidden = record?.layout?.closable === false;
  }

  dispose() {
    this.unsubscribe?.();
  }
}
