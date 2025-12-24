import Papa from 'papaparse';
import { ContractRegistry } from '../core/contracts/ContractRegistry.js';

function createSection(title) {
  const wrap = document.createElement('div');
  wrap.className = 'section';
  const header = document.createElement('div');
  header.className = 'section-title';
  header.textContent = title;
  wrap.appendChild(header);
  return wrap;
}

export class Inspector {
  constructor(container) {
    this.container = container;
    this.currentNode = null;
    this.previewCache = new Map();
  }

  showNode(node) {
    const slot = this.container.querySelector('.node-config');
    if (!slot) return;
    slot.innerHTML = '';
    if (!node) {
      slot.textContent = 'Select a node';
      return;
    }
    if (node.kind === 'data' && !this.previewCache.has(node.id)) {
      this.loadPreview(node).then(() => {
        if (this.currentNode?.id === node.id) this.showNode(node);
      });
    }
    this.currentNode = node;
    const title = document.createElement('h4');
    title.textContent = node.label;
    slot.appendChild(title);

    if (node.kind === 'data') {
      this.renderDataNode(slot, node);
    } else {
      slot.appendChild(document.createTextNode('No editable params.'));
    }

    const deleteWrap = document.createElement('div');
    deleteWrap.className = 'section';
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete this node';
    delBtn.addEventListener('click', () => {
      window.minevisGraph?.removeNode(node.id);
      this.currentNode = null;
      this.showNode(null);
      window.minevisEditor?.render();
    });
    deleteWrap.appendChild(delBtn);
    slot.appendChild(deleteWrap);
  }

  async renderDataNode(slot, node) {
    const rerender = () => {
      this.showNode(node);
      window.minevisEditor?.render();
    };
    const contractSelect = createSection('Contract');
    const select = document.createElement('select');
    ContractRegistry.list().forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name}`;
      if (node.params.contractId === c.id) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      node.params.contractId = select.value;
      node.params.roleMapping = {};
      node.params.facets = [];
      const picked = ContractRegistry.get(select.value);
      if (picked) node.label = picked.name;
      node.runtime.updateFacets(node);
      rerender();
    });
    contractSelect.appendChild(select);
    slot.appendChild(contractSelect);

    const sourceSection = createSection('Source');
    const sourceInput = document.createElement('input');
    sourceInput.value = node.params.source?.path || '';
    sourceInput.placeholder = 'File URL or relative path';
    sourceInput.addEventListener('input', async () => {
      node.params.source = { type: 'file', path: sourceInput.value };
      await this.loadPreview(node);
      rerender();
    });
    sourceSection.appendChild(sourceInput);
    const upload = document.createElement('input');
    upload.type = 'file';
    upload.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      let data = text;
      if (file.name.endsWith('.csv')) {
        data = Papa.parse(text, { header: true, dynamicTyping: true }).data;
      } else {
        data = JSON.parse(text);
      }
      node.params.source = { type: 'inline', name: file.name, data };
      await this.loadPreview(node, data);
      rerender();
    });
    sourceSection.appendChild(upload);
    const preview = document.createElement('div');
    preview.className = 'source-preview';
    const cached = this.previewCache.get(node.id);
    if (cached?.previewText) preview.textContent = cached.previewText;
    sourceSection.appendChild(preview);
    slot.appendChild(sourceSection);

    const contract = ContractRegistry.get(node.params.contractId);
    if (contract && node.label !== contract.name) node.label = contract.name;
    if (contract?.id === 'RoadwayGeometry') {
      const autoBtn = document.createElement('button');
      autoBtn.textContent = 'Generate from topology binding';
      autoBtn.addEventListener('click', async () => {
        node.params.source = { type: 'auto' };
        await this.loadPreview(node);
        rerender();
      });
      sourceSection.appendChild(autoBtn);
    }
    if (contract) {
      const roleSection = createSection('Role Mapping');
      const fields = this.getPreviewFields(node);
      contract.required_roles.forEach((role) => {
        const row = document.createElement('div');
        row.className = 'field-row';
        const label = document.createElement('span');
        label.textContent = role.label;
        row.appendChild(label);
        const controls = document.createElement('div');
        controls.className = 'field-control';
        const selectField = document.createElement('select');
        selectField.innerHTML = '<option value="">(pick field)</option>';
        fields.forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f;
          opt.textContent = f;
          selectField.appendChild(opt);
        });
        const current = node.params.roleMapping?.[role.roleKey] || role.defaultField || '';
        if (fields.includes(current)) selectField.value = current;
        const custom = document.createElement('input');
        custom.placeholder = 'Custom path';
        custom.value = fields.includes(current) ? '' : current;
        selectField.addEventListener('change', () => {
          node.params.roleMapping = node.params.roleMapping || {};
          node.params.roleMapping[role.roleKey] = selectField.value;
          custom.value = '';
          rerender();
        });
        custom.addEventListener('input', () => {
          node.params.roleMapping = node.params.roleMapping || {};
          node.params.roleMapping[role.roleKey] = custom.value;
          selectField.value = '';
          rerender();
        });
        controls.appendChild(selectField);
        controls.appendChild(custom);
        row.appendChild(controls);
        roleSection.appendChild(row);
      });
      slot.appendChild(roleSection);

      const bindingSection = createSection('Binding');
      contract.binding_requirements.forEach((b) => {
        const row = document.createElement('label');
        row.className = 'field-row';
        row.innerHTML = `<span>${b.description || `${b.fromRoleKey} → ${b.toRoleKey}`}</span>`;
        const selectTarget = document.createElement('select');
        selectTarget.innerHTML = '<option value="">(none)</option>';
        const candidates = window.minevisGraph?.nodes.filter((n) => n.params?.contractId === b.toContractId) || [];
        candidates.forEach((n) => {
          const opt = document.createElement('option');
          opt.value = n.id;
          opt.textContent = `${n.label} (${b.toContractId})`;
          if (node.bindings?.[b.fromRoleKey] === n.id) opt.selected = true;
          selectTarget.appendChild(opt);
        });
        selectTarget.addEventListener('change', async () => {
          node.bindings = node.bindings || {};
          node.bindings[b.fromRoleKey] = selectTarget.value;
          await this.loadPreview(node);
          rerender();
        });
        row.appendChild(selectTarget);
        bindingSection.appendChild(row);
      });
      slot.appendChild(bindingSection);

      const facetSection = createSection('Facets / Outputs');
      const list = document.createElement('div');
      list.className = 'facet-list';
      node.params.facets?.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'facet-row';
        row.textContent = `${f.facetType}: ${f.label}`;
        list.appendChild(row);
      });
      if (!node.params.facets?.length) {
        const btn = document.createElement('button');
        btn.textContent = 'Reset default facets';
        btn.addEventListener('click', () => {
          node.runtime.updateFacets(node);
          rerender();
        });
        list.appendChild(btn);
      }
      facetSection.appendChild(list);
      slot.appendChild(facetSection);
    }
  }

  getPreviewFields(node) {
    const cached = this.previewCache.get(node.id);
    if (cached?.fields) return cached.fields;
    return [];
  }

  async loadPreview(node, inlineData) {
    let data = inlineData;
    if (!data) {
      const src = node.params.source || {};
      if (src.type === 'inline') data = src.data;
      else if (src.path) {
        if (src.path.endsWith('.csv')) {
          const text = await fetch(src.path).then((r) => r.text());
          data = Papa.parse(text, { header: true, dynamicTyping: true }).data;
        } else {
          data = await fetch(src.path).then((r) => r.json());
        }
      }
    }
    if (!data) return;
    const fields = this.collectFields(data);
    const previewText = Array.isArray(data)
      ? JSON.stringify(data.slice(0, 3), null, 2)
      : JSON.stringify(data, null, 2).slice(0, 200) + '...';
    this.previewCache.set(node.id, { fields, previewText });
  }

  collectFields(data) {
    const fields = new Set();
    const push = (k) => {
      if (k) fields.add(k);
    };
    const walk = (obj, prefix = '') => {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach((k) => {
        const val = obj[k];
        const path = prefix ? `${prefix}.${k}` : k;
        push(path);
        if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, path);
      });
    };
    if (Array.isArray(data)) {
      data.slice(0, 5).forEach((row) => walk(row));
    } else if (data?.nodes || data?.edges) {
      (data.nodes || []).slice(0, 5).forEach((n) => walk(n));
      (data.edges || []).slice(0, 5).forEach((e) => walk(e));
    } else if (data && typeof data === 'object') {
      walk(data);
    }
    return Array.from(fields);
  }
}
