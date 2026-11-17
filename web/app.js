(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const fa = value => new Intl.NumberFormat('fa-IR').format(value);
  const uid = prefix => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const engine = () => window.NaqshEngine;

  const state = {
    library: { version: 1, motifs: [], sets: [] },
    baseLibrary: { version: 1, motifs: [], sets: [] },
    project: null,
    selectedSection: null,
    selectedLayer: null,
    history: [],
    future: [],
    store: null,
    projectId: null,
    visible: 24,
    zoom: 1,
    unit: 'mm',
    grid: false,
    customAssets: {},
    warnings: []
  };
  let autoSaveTimer = null;
  let saveQueue = Promise.resolve();
  let projectListCache = [];

  function toast(message) {
    const node = $('#toast');
    node.textContent = String(message);
    node.classList.add('show');
    window.setTimeout(() => node.classList.remove('show'), 3200);
  }

  function selectedSection() {
    return state.project?.sections.find(section => section.id === state.selectedSection) || null;
  }

  function selectedLayer() {
    return selectedSection()?.layers?.find(layer => layer.id === state.selectedLayer) || null;
  }

  function remember() {
    if (!state.project) return;
    state.history.push(clone(state.project));
    if (state.history.length > 40) state.history.shift();
    state.future = [];
  }

  function commit() {
    renderAll();
    scheduleSave();
  }

  function makeFallback() {
    return {
      version: 1, name: 'سفارش جدید',
      sheet: { widthMm: 1000, heightMm: 700, autoHeight: false, gutterMm: 12, marginMm: 10 },
      guides: true, sections: []
    };
  }

  function normalizeProject(project) {
    const p = clone(project);
    p.version = 1;
    p.name = String(p.name || 'سفارش جدید');
    p.createdAt = p.createdAt || new Date().toISOString();
    p.updatedAt = new Date().toISOString();
    p.customerName = String(p.customerName || '');
    p.orderNumber = String(p.orderNumber || '');
    p.status = /^(draft|approved|print-ready|delivered)$/.test(p.status) ? p.status : 'draft';
    p.sheet = Object.assign({ widthMm: 1000, heightMm: 700, autoHeight: false, gutterMm: 12, marginMm: 10 }, p.sheet || {});
    p.sections = Array.isArray(p.sections) ? p.sections : [];
    p.sections.forEach(section => {
      section.id = String(section.id || uid('s'));
      section.name = String(section.name || 'بخش جدید');
      const standardPart = engine()?.getGarmentPart(section.partKind) || engine()?.getGarmentPart(section.id) || engine()?.getGarmentPart(section.name);
      section.partKind = standardPart?.kind || section.partKind || 'custom';
      section.partCode = String(section.partCode ?? standardPart?.code ?? '');
      section.labelFa = String(section.labelFa ?? standardPart?.nameFa ?? section.name);
      if (standardPart) section.name = standardPart.nameFa;
      section.layers = Array.isArray(section.layers) ? section.layers : [];
      section.layers.forEach(layer => {
        layer.id = String(layer.id || uid('l'));
        layer.name = String(layer.name || 'لایه');
        layer.enabled = layer.enabled !== false;
        layer.opacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1;
      });
    });
    return p;
  }

  async function load() {
    state.store = window.NaqshProjectStore?.create();
    try {
      const response = await fetch('/assets/library.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.baseLibrary = await response.json();
      state.library = clone(state.baseLibrary);
      $('#statusPill').textContent = `آلفا ۱.۲ · ${fa(state.library.motifs?.length || 0)} نقش`;
      $('#statusPill').classList.add('ok');
    } catch (error) {
      $('#statusPill').textContent = 'خطا در بارگذاری کتابخانه';
      $('#renderMessage').textContent = `library.json در دسترس نیست: ${error.message}`;
    }

    if (state.store) {
      try {
        projectListCache = await state.store.list();
        let activeId = null;
        try { activeId = localStorage.getItem('naqsh-active-project-id'); } catch (_) {}
        let saved = activeId ? await state.store.get(activeId) : null;
        if (!saved && projectListCache.length) saved = await state.store.get(projectListCache[0].id);
        if (saved) {
          state.projectId = saved.id;
          const migrated = state.store.migrate(JSON.parse(saved.data));
          state.project = normalizeProject(migrated.project);
          state.customAssets = migrated.customAssets || migrated.assets || {};
          mergeLibrary(migrated.library);
        }
      } catch (error) { toast(`بازکردن پروژه‌های ذخیره‌شده ناموفق بود: ${error.message}`); }
    }
    if (!state.project) {
      const old = readLocal();
      state.library = clone(state.baseLibrary);
      if (old?.project) {
        state.project = normalizeProject(old.project);
        state.customAssets = old.customAssets || {};
        mergeLibrary(old.library);
      } else state.project = makeFallback();
      state.projectId = uid('project-');
      await saveLocal(false);
    }
    try { localStorage.setItem('naqsh-active-project-id', state.projectId); } catch (_) {}
    selectFirst();
    renderAll();
    await refreshProjectList();
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem('naqsh-project')); } catch (_) { return null; }
  }

  function projectPayload() {
    const envelope = window.NaqshProjectStore.makeEnvelope(state.project);
    envelope.library = { version: 1, motifs: (state.library.motifs || []).filter(m => String(m.code).startsWith('CUSTOM-') || m.calibrationOverride || state.customAssets[m.code]) };
    envelope.customAssets = state.customAssets;
    return envelope;
  }

  async function saveLocal(notify = true) {
    clearTimeout(autoSaveTimer);
    if (!state.store) { toast('پایگاه پروژه در دسترس نیست؛ فایل JSON را پشتیبان بگیرید.'); return false; }
    state.project.updatedAt = new Date().toISOString();
    const id = state.projectId; const payload = clone(projectPayload());
    const operation = saveQueue.then(() => state.store.save(id, payload));
    saveQueue = operation.catch(() => {});
    try {
      await operation;
      try { localStorage.setItem('naqsh-active-project-id', state.projectId); } catch (_) {}
      if (notify) toast('پروژه در پایگاه محلی ذخیره شد.');
      await refreshProjectList(); return true;
    } catch (error) { toast(`ذخیره ناموفق بود: ${error.message}`); return false; }
  }

  function scheduleSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => { saveLocal(false); }, 450);
  }

  async function refreshProjectList() {
    if (!state.store) return;
    try {
      projectListCache = await state.store.list();
      const box = $('#projectList');
      const term = ($('#projectSearch').value || '').trim().toLowerCase();
      box.replaceChildren();
      projectListCache.filter(item => !term || [item.name, item.customerName, item.orderNumber].join(' ').toLowerCase().includes(term)).forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.name || 'بدون نام'} · ${item.orderNumber || item.customerName || 'بدون سفارش'} · ${fa(item.versions)} نسخه`;
        if (item.id === state.projectId) option.selected = true;
        box.appendChild(option);
      });
      if (!box.options.length) { const empty = document.createElement('option'); empty.textContent = 'پروژه‌ای ذخیره نشده است'; empty.disabled = true; box.appendChild(empty); }
    } catch (_) { /* Saving remains available even if the list cannot be refreshed. */ }
  }

  function mergeLibrary(extra) {
    if (!extra?.motifs) return;
    extra.motifs.forEach(motif => {
      const current = state.library.motifs.find(m => m.code === motif.code);
      if (current) Object.assign(current, clone(motif));
      else state.library.motifs.push(clone(motif));
    });
  }

  function selectFirst() {
    const section = state.project?.sections?.[0];
    state.selectedSection = section?.id || null;
    state.selectedLayer = section?.layers?.[0]?.id || null;
  }

  function renderAll() {
    renderProjectMeta();
    renderSections();
    renderLibrary();
    renderProperties();
    render();
    $$('.unit-label').forEach(label => { label.textContent = state.unit; });
  }

  function renderProjectMeta() {
    if (!state.project) return;
    $('#projectName').value = state.project.name || '';
    $('#customerName').value = state.project.customerName || '';
    $('#orderNumber').value = state.project.orderNumber || '';
    $('#projectStatus').value = state.project.status || 'draft';
    $('#sheetW').value = displayMm(state.project.sheet.widthMm);
    $('#sheetH').value = displayMm(state.project.sheet.heightMm);
    $('#unitSelector').value = state.unit;
    $$('.unit-label').forEach(label => { label.textContent = state.unit; });
    $('#autoHeight').checked = !!state.project.sheet.autoHeight;
    $('#guidesToggle').checked = state.project.guides !== false;
  }

  function displayMm(value) { return state.unit === 'cm' ? Number(value || 0) / 10 : Number(value || 0); }
  function parseMm(value) { const number = Number(value); return state.unit === 'cm' ? number * 10 : number; }
  function displayLabel(label) { return `${label} (${state.unit})`; }

  function createLayerItem(section, layer) {
    const item = document.createElement('div');
    item.className = `layer-item ${layer.id === state.selectedLayer ? 'selected' : ''}`;
    const text = document.createElement('span');
    text.textContent = `${layer.code || 'نقش انتخاب نشده'} · ${layer.name || 'لایه'}`;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.title = 'حذف لایه'; remove.textContent = '×';
    remove.onclick = event => {
      event.stopPropagation(); remember(); section.layers = section.layers.filter(itemLayer => itemLayer.id !== layer.id);
      state.selectedLayer = section.layers[0]?.id || null; commit();
    };
    item.append(text, remove);
    item.onclick = () => { state.selectedSection = section.id; state.selectedLayer = layer.id; renderAll(); };
    return item;
  }

  function renderSections() {
    const box = $('#sectionsList'); box.replaceChildren();
    (state.project?.sections || []).forEach(section => {
      const fragment = document.importNode($('#sectionTemplate').content, true);
      const card = $('.section-card', fragment);
      if (section.id === state.selectedSection) card.classList.add('selected');
      $('.section-select', fragment).textContent = `${section.partCode || '—'} / ${section.labelFa || section.name || 'بدون نام'}`;
      $('.section-kind', fragment).value = section.partKind || 'custom';
      $('.section-code', fragment).value = section.partCode || '';
      $('.section-name', fragment).value = section.labelFa || section.name || '';
      const standardPart = engine()?.getGarmentPart(section.partKind);
      $('.section-code', fragment).readOnly = !!standardPart;
      $('.section-name', fragment).readOnly = !!standardPart;
      $('.section-shape', fragment).value = section.shape || 'rect';
      $('.section-w', fragment).value = displayMm(section.widthMm);
      $('.section-h', fragment).value = displayMm(section.heightMm);
      $('.section-q', fragment).value = section.quantity || 1;
      $('.section-top', fragment).value = displayMm(section.topWidthMm ?? section.widthMm * 0.75);
      $('.section-neck', fragment).value = displayMm(section.neckWidthMm ?? section.widthMm * 0.3);
      $('.section-depth', fragment).value = displayMm(section.neckDepthMm ?? section.heightMm * 0.15);
      $('.section-mirror', fragment).checked = !!section.mirror;
      $('.section-rotate', fragment).checked = !!section.rotateOnSheet;
      const layers = $('.layer-mini', fragment);
      (section.layers || []).forEach(layer => layers.appendChild(createLayerItem(section, layer)));
      $('.section-select', fragment).onclick = () => { state.selectedSection = section.id; state.selectedLayer = section.layers?.[0]?.id || null; renderAll(); };
      $('.duplicate', fragment).onclick = () => {
        remember(); const copy = clone(section); copy.id = uid('s'); copy.name = `${copy.name || 'بخش'} کپی`;
        copy.layers.forEach(layer => { layer.id = uid('l'); }); state.project.sections.push(copy);
        state.selectedSection = copy.id; state.selectedLayer = copy.layers[0]?.id || null; commit();
      };
      $('.delete', fragment).onclick = () => {
        if (state.project.sections.length < 2 && !window.confirm('آخرین بخش حذف شود؟')) return;
        remember(); state.project.sections = state.project.sections.filter(item => item.id !== section.id); selectFirst(); commit();
      };
      $('.move-up', fragment).onclick = () => moveSection(section.id, -1);
      $('.move-down', fragment).onclick = () => moveSection(section.id, 1);
      $('.add-layer', fragment).onclick = () => {
        remember(); const layer = defaultLayer(section); section.layers.push(layer);
        state.selectedSection = section.id; state.selectedLayer = layer.id; commit();
      };
      $('.section-kind', fragment).onchange = event => {
        remember(); section.partKind = event.target.value;
        const part = engine()?.getGarmentPart(section.partKind);
        if (part) { section.partCode = part.code; section.labelFa = part.nameFa; section.name = part.nameFa; }
        else { section.partCode = ''; section.labelFa = section.labelFa || section.name || ''; }
        commit();
      };
      $('.section-code', fragment).onchange = event => { remember(); section.partCode = event.target.value.trim(); commit(); };
      $('.section-name', fragment).onchange = event => { remember(); section.labelFa = event.target.value.trim(); section.name = section.labelFa; commit(); };
      [['.section-shape', 'shape'], ['.section-w', 'widthMm'], ['.section-h', 'heightMm'], ['.section-q', 'quantity'], ['.section-top', 'topWidthMm'], ['.section-neck', 'neckWidthMm'], ['.section-depth', 'neckDepthMm'], ['.section-mirror', 'mirror'], ['.section-rotate', 'rotateOnSheet']].forEach(([selector, key]) => {
        $(selector, fragment).onchange = event => { remember(); section[key] = ['name', 'shape'].includes(key) ? event.target.value : event.target.type === 'checkbox' ? event.target.checked : ['widthMm','heightMm','topWidthMm','neckWidthMm','neckDepthMm'].includes(key) ? parseMm(event.target.value) : Number(event.target.value); commit(); };
      });
      box.appendChild(fragment);
    });
  }

  function moveSection(id, delta) {
    const index = state.project.sections.findIndex(section => section.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= state.project.sections.length) return;
    remember(); [state.project.sections[index], state.project.sections[next]] = [state.project.sections[next], state.project.sections[index]]; commit();
  }

  function defaultLayer(section) {
    return { id: uid('l'), name: 'لایه جدید', code: '', enabled: true, xMm: 0, yMm: 0, widthMm: section.widthMm, heightMm: section.heightMm, mode: 'repeatX', lockAspect: true, gapXmm: -0.2, gapYmm: -0.2, offsetXmm: 0, offsetYmm: 0, rotation: 0, mirrorX: false, mirrorY: false, alternateX: false, alternateY: false, opacity: 1 };
  }

  function findMotif(code) { return engine()?.findMotif(state.library, code) || null; }

  function renderLibrary() {
    const box = $('#libraryList'); box.replaceChildren();
    const term = ($('#librarySearch').value || '').trim().toLowerCase();
    const sets = (state.library.sets || []).filter(set => String(set.code).toLowerCase().includes(term) || (set.motifCodes || []).some(code => String(code).toLowerCase().includes(term)));
    const setCodes = new Set(sets.flatMap(set => set.motifCodes || []));
    let motifs = (state.library.motifs || []).filter(motif => !term || String(motif.code).toLowerCase().includes(term) || setCodes.has(motif.code));
    motifs.slice(0, state.visible).forEach(motif => {
      const article = document.createElement('article'); article.className = 'motif-card';
      const image = document.createElement('img'); image.className = 'thumb'; image.loading = 'lazy'; image.alt = String(motif.code);
      image.src = assetPreviewUrl(motif.asset); image.onerror = () => { image.style.opacity = '.25'; image.alt = 'تصویر موجود نیست'; };
      const info = document.createElement('div'); const code = document.createElement('b'); code.textContent = motif.code;
      const dimensions = document.createElement('small'); dimensions.textContent = motif.needsCalibration ? `اندازهٔ فیزیکی نامشخص · ${motif.family || '—'}` : `${motif.widthMm}×${motif.heightMm} mm · ${motif.family || '—'}`;
      info.append(code, dimensions);
      if (motif.needsCalibration) { const warning = document.createElement('small'); warning.className = 'uncal'; warning.textContent = 'نیازمند کالیبراسیون'; info.appendChild(warning); }
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'افزودن'; button.onclick = () => addMotif(motif.code);
      article.append(image, info, button); box.appendChild(article);
    });
    if (!box.children.length) { const hint = document.createElement('div'); hint.className = 'hint'; const code = engine()?.normalizeCode(term) || term.toUpperCase(); const referenced = (state.library.sets || []).some(set => (set.motifCodes || []).some(item => engine()?.normalizeCode(item) === code)); const available = (state.library.motifs || []).some(motif => engine()?.normalizeCode(motif.code) === code); hint.textContent = referenced && !available ? `کد ${code} در مرجع کاتالوگ ثبت شده، اما تصویر قابل‌استفاده ندارد؛ نقش جایگزین یا ساختگی ارائه نمی‌شود.` : 'نقشی پیدا نشد. کد را دقیق بررسی کنید.'; box.appendChild(hint); }
    $('#loadMoreBtn').style.display = motifs.length > state.visible ? 'block' : 'none';
  }

  function assetPreviewUrl(asset) {
    if (/^data:image\//i.test(String(asset || ''))) return asset;
    return `/${String(asset || '').replace(/^\/+/, '')}`;
  }

  function addMotif(code) {
    const motif = findMotif(code);
    if (!motif) { toast('کد نقش در کتابخانه موجود نیست؛ جایگزینی انجام نشد.'); return; }
    remember();
    if (!state.project.sections.length) {
      const section = engine()?.makeSection ? engine().makeSection(uid('s'), 'بخش جدید', 350, 550, '') : makeFallbackSection('');
      section.layers = []; state.project.sections.push(section); state.selectedSection = section.id; state.selectedLayer = null;
    }
    const section = selectedSection() || state.project.sections[0];
    const layer = defaultLayer(section); layer.name = `نقش ${motif.code}`; layer.code = motif.code;
    section.layers.push(layer); state.selectedSection = section.id; state.selectedLayer = layer.id; commit(); showProperties();
    toast(`نقش ${motif.code} به لایه افزوده شد.`);
  }

  function makeFallbackSection(code) { return { id: uid('s'), name: 'بخش جدید', widthMm: 350, heightMm: 550, quantity: 1, shape: 'rect', layers: [{ ...defaultLayer({ widthMm: 350, heightMm: 550 }), code }] }; }

  function field(label, key, value, type = 'number') {
    const row = document.createElement('div'); row.className = 'prop-row';
    const caption = document.createElement('label'); caption.textContent = label; row.appendChild(caption);
    const input = document.createElement('input'); input.dataset.key = key; input.type = type; input.value = value ?? '';
    if (type === 'number') { input.step = 'any'; input.min = ['gapXmm','gapYmm'].includes(key) ? '-10000' : '0'; }
    row.appendChild(input); return row;
  }

  function selectField(label, key, value, options) {
    const row = document.createElement('div'); row.className = 'prop-row'; const caption = document.createElement('label'); caption.textContent = label; row.appendChild(caption);
    const select = document.createElement('select'); select.dataset.key = key; options.forEach(([v, text]) => { const option = document.createElement('option'); option.value = v; option.textContent = text; select.appendChild(option); }); select.value = value; row.appendChild(select); return row;
  }

  function checkbox(label, key, checked) {
    const row = document.createElement('div'); row.className = 'prop-row'; const caption = document.createElement('label'); caption.textContent = label; row.appendChild(caption);
    const input = document.createElement('input'); input.dataset.key = key; input.type = 'checkbox'; input.checked = !!checked; row.appendChild(input); return row;
  }

  function renderProperties() {
    const box = $('#propertiesPanel'); box.replaceChildren(); const section = selectedSection(); const layer = selectedLayer();
    if (!section) { const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'برای شروع یک بخش اضافه کنید یا از کتابخانه نقش انتخاب کنید.'; box.appendChild(hint); return; }
    if (!layer) { const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'این بخش لایه‌ای ندارد. از «افزودن لایه نقش» استفاده کنید.'; box.appendChild(hint); return; }
    const form = document.createElement('div'); form.className = 'property-form'; const title = document.createElement('h3'); title.textContent = layer.code || 'نقش انتخاب نشده'; form.appendChild(title);
    const motif = findMotif(layer.code); if (motif?.needsCalibration) { const warning = document.createElement('div'); warning.className = 'warning'; warning.textContent = 'این نقش نیازمند کنترل ابعاد فیزیکی و محدوده تکرار است؛ برای بازبینی calibration را باز کنید.'; form.appendChild(warning); const calibrate = document.createElement('button'); calibrate.className = 'small-btn'; calibrate.textContent = 'بازبینی کالیبراسیون'; calibrate.onclick = () => openCalibration(motif); form.appendChild(calibrate); }
    if (motif?.associationReview || /association|associationReview|مطابقت/i.test(motif?.note || '')) { const association = document.createElement('div'); association.className = 'warning'; association.textContent = 'مطابقت کد و تصویر این نقش هنوز بازبینی نشده است؛ اصالت seamless ادعا نمی‌شود.'; form.appendChild(association); }
    if (motif?.variants?.length > 1) { const variant = selectField('واریانت تصویری', 'variantIndex', String(layer.variantIndex ?? 0), motif.variants.map((item, index) => [String(index), `واریانت ${index + 1} · اندازهٔ کاتالوگ ${displayMm(item.widthMm)}×${displayMm(item.heightMm)} ${state.unit}`])); const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'small-btn'; apply.textContent = 'اعمال واریانت به override نقش'; apply.onclick = () => { const selected = motif.variants[Number($('[data-key="variantIndex"]', variant).value)]; if (!selected) return; remember(); layer.variantIndex = Number($('[data-key="variantIndex"]', variant).value); motif.sourceAsset = motif.sourceAsset || motif.asset; motif.asset = selected.asset; motif.widthMm = selected.widthMm; motif.heightMm = selected.heightMm; motif.pixelWidth = selected.pixelWidth; motif.pixelHeight = selected.pixelHeight; motif.needsCalibration = true; state.customAssets[motif.code] = selected.asset; commit(); }; form.append(variant, apply); }
    form.append(field('نام لایه', 'name', layer.name, 'text'), field('کد نقش', 'code', layer.code, 'text'));
    form.append(selectField('روش چیدمان', 'mode', layer.mode, [['single','تکی'],['contain','درون‌گرا'],['cover','پوشان'],['repeatX','تکرار افقی'],['repeatY','تکرار عمودی'],['grid','شبکه']]));
    [['ناحیه X','xMm'],['ناحیه Y','yMm'],['عرض ناحیه','widthMm'],['ارتفاع ناحیه','heightMm'],['عرض کاشی','tileWidthMm'],['ارتفاع کاشی','tileHeightMm'],['فاصله افقی (منفی=همپوشانی)','gapXmm'],['فاصله عمودی (منفی=همپوشانی)','gapYmm'],['جابجایی X','offsetXmm'],['جابجایی Y','offsetYmm'],['چرخش','rotation'],['شفافیت','opacity']].forEach(([label, key]) => { const mm = ['xMm','yMm','widthMm','heightMm','tileWidthMm','tileHeightMm','gapXmm','gapYmm','offsetXmm','offsetYmm'].includes(key); const value = ['tileWidthMm','tileHeightMm'].includes(key) && layer[key] == null ? '' : (mm ? displayMm(layer[key]) : layer[key]); form.append(field(mm ? displayLabel(label) : label, key, value)); });
    form.append(checkbox('فعال', 'enabled', layer.enabled), checkbox('قفل تناسب', 'lockAspect', layer.lockAspect), checkbox('آینه افقی', 'mirrorX', layer.mirrorX), checkbox('آینه عمودی', 'mirrorY', layer.mirrorY), checkbox('آینه متناوب افقی', 'alternateX', layer.alternateX), checkbox('آینه متناوب عمودی', 'alternateY', layer.alternateY));
    $$('[data-key]', form).forEach(input => input.onchange = () => { remember(); const key = input.dataset.key; if (['tileWidthMm','tileHeightMm'].includes(key) && input.value.trim() === '') delete layer[key]; else layer[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (['xMm','yMm','widthMm','heightMm','tileWidthMm','tileHeightMm','gapXmm','gapYmm','offsetXmm','offsetYmm'].includes(key) ? parseMm(input.value) : Number(input.value)) : input.value; commit(); });
    box.appendChild(form);
  }

  function showProperties() { $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === 'properties')); $('#libraryTab').classList.add('hidden'); $('#propertiesTab').classList.remove('hidden'); renderProperties(); }

  function render() {
    if (!state.project) return;
    $('#emptyState').style.display = state.project.sections.length ? 'none' : 'block';
    try {
      if (!engine()?.layout || !engine()?.renderSvg) throw new Error('NaqshEngine بارگذاری نشده است');
      const manifest = engine().layout(state.project, state.library);
      const svg = engine().renderSvg(manifest, undefined, { guides: state.project.guides !== false, labels: true, background: '#ffffff', profile: engine().PRINT_PROFILE });
      $('#svgHost').innerHTML = svg; state.warnings = manifest.warnings || [];
      $('#placementInfo').textContent = `${fa(manifest.placementCount || 0)} جایگذاری · ${fa(manifest.nesting?.utilizationPercent || 0)}٪ استفادهٔ تقریبی`;
      $('#warningInfo').textContent = state.warnings.length ? `${fa(state.warnings.length)} هشدار` : 'آماده';
      $('#warningDetails').replaceChildren(); state.warnings.forEach(warning => { const item = document.createElement('li'); item.textContent = warning; $('#warningDetails').appendChild(item); });
      $('#renderMessage').textContent = '';
    } catch (error) {
      $('#svgHost').replaceChildren(); $('#renderMessage').textContent = error.message; $('#warningInfo').textContent = 'خطا'; $('#warningDetails').replaceChildren();
    }
  }

  async function fetchDataUrl(src) {
    if (/^data:image\//i.test(src)) return src;
    const response = await fetch(`/${String(src).replace(/^\/+/, '')}`);
    if (!response.ok) throw new Error(`دارایی ${src} دریافت نشد (${response.status})`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('خواندن دارایی ناموفق بود')); reader.readAsDataURL(blob); });
  }

  async function assetMapForExport() {
    const map = {}; const used = new Set();
    state.project.sections.forEach(section => (section.layers || []).forEach(layer => { if (layer.enabled !== false && layer.code) used.add(layer.code); }));
    for (const code of used) {
      const motif = findMotif(code); if (!motif?.asset) throw new Error(`کد «${code}» دارایی ندارد؛ خروجی متوقف شد.`);
      const source = state.customAssets[motif.code] || motif.asset;
      const data = await fetchDataUrl(source);
      map[motif.code] = data; map[motif.asset] = data;
    }
    return map;
  }

  function download(filename, data, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([data], { type })); link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); }

  async function exportWhat(kind, productionApproved = false) {
    $('#exportMenu').classList.add('hidden');
    if (kind === 'pdf' && !productionApproved) { openProductionCheck('pdf'); return; }
    try {
      if (kind === 'project') { const envelope = projectPayload(); download(`${state.project.name || 'naqsh'}-project.json`, JSON.stringify(envelope, null, 2), 'application/json'); return; }
      const manifest = engine().layout(state.project, state.library); const assets = await assetMapForExport();
      if (kind === 'exchange') { const exchange = engine().createExchange(state.project, state.library, assets); exchange.library.motifs.forEach(motif => { if (state.customAssets[motif.code]) motif.asset = state.customAssets[motif.code]; }); exchange.assets = Object.assign(exchange.assets, state.customAssets); download('naqsh-self-contained-exchange.json', JSON.stringify(exchange, null, 2), 'application/json'); return; }
      const svg = engine().renderSvg(manifest, assets, { guides: state.project.guides !== false, labels: true, background: '#ffffff', profile: engine().PRINT_PROFILE });
      if (kind === 'svg') { download(`${state.project.name || 'naqsh'}.svg`, svg, 'image/svg+xml'); return; }
      const response = await fetch('/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg, filename: state.project.name || 'naqsh', profile: engine().PRINT_PROFILE, expected_width_mm: manifest.sheet.widthMm, expected_height_mm: manifest.sheet.heightMm }) });
      if (!response.ok) { let message = `سرور PDF خطا داد (${response.status})`; try { const body = await response.json(); message = body.error || body.message || message; } catch (_) {} throw new Error(message); }
      download(`${state.project.name || 'naqsh'}.pdf`, await response.blob(), 'application/pdf');
    } catch (error) { toast(`خروجی انجام نشد: ${error.message}`); }
  }

  function sanitizeSvg(text) {
    const parser = new DOMParser(); const documentNode = parser.parseFromString(text, 'image/svg+xml');
    if (documentNode.querySelector('parsererror')) throw new Error('SVG خراب است.');
    const forbidden = 'script,style,foreignObject,iframe,object,embed,link'.split(','); forbidden.forEach(tag => documentNode.querySelectorAll(tag).forEach(node => node.remove()));
    documentNode.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase(); const value = attribute.value.trim();
      if (name.startsWith('on') || ['href', 'xlink:href'].includes(name) && (!/^#[A-Za-z0-9_.:-]+$/.test(value))) node.removeAttribute(attribute.name);
      if (name === 'style' || /url\s*\(|https?:|\/\//i.test(value)) node.removeAttribute(attribute.name);
    }));
    const svg = documentNode.documentElement; if (svg.tagName.toLowerCase() !== 'svg') throw new Error('ریشه SVG معتبر نیست.');
    return new XMLSerializer().serializeToString(svg);
  }

  function readImage(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود')); reader.readAsDataURL(file); });
  }

  async function importAsset(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) { toast('فقط PNG، JPEG یا SVG مجاز است.'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('فایل بزرگ‌تر از ۱۰MB رد شد.'); return; }
    try {
      let data = await readImage(file);
      if (file.type === 'image/svg+xml') data = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(sanitizeSvg(await file.text()))))}`;
      const image = new Image(); image.src = data; await image.decode();
      if (image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('تصویر بزرگ‌تر از ۴۰ مگاپیکسل رد شد.');
      const code = `CUSTOM-${Date.now().toString(36).toUpperCase()}`;
      const motif = { code, family: 'CUSTOM', asset: data, pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight, sourcePages: [], collectionCodes: [], needsCalibration: true, variants: [{ asset: data, pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight }], note: 'تصویر واردشده؛ تا ثبت اندازهٔ واقعی و بازبینی، اندازهٔ چاپ نامشخص است.' };
      state.library.motifs.push(motif); state.customAssets[code] = data; saveLocal(false); renderLibrary(); addMotif(code); openCalibration(motif);
    } catch (error) { toast(`تصویر وارد نشد: ${error.message}`); }
  }

  let calibration = null;
  function openCalibration(motif) {
    const dialog = $('#calibrationDialog'); if (!dialog) return; calibration = { motif, source: state.customAssets[motif.code] || motif.asset };
    $('#calibrationTitle').textContent = `کالیبراسیون ${motif.code}`; $('#calibrationPreview').src = assetPreviewUrl(calibration.source); $('#calibrationReviewed').checked = false; $('#calibrationX').value = 0; $('#calibrationY').value = 0; $('#calibrationW').value = motif.pixelWidth || 1; $('#calibrationH').value = motif.pixelHeight || 1; $('#physicalW').value = motif.needsCalibration ? '' : displayMm(motif.widthMm || ''); $('#physicalH').value = motif.needsCalibration ? '' : displayMm(motif.heightMm || '');
    const collection = $('#calibrationCollection'); collection.replaceChildren(); const codes = motif.collectionCodes || [];
    codes.forEach((code, index) => { const option = document.createElement('option'); option.value = code; option.textContent = `صفحهٔ مرجع ${code}`; collection.appendChild(option); });
    const reference = $('#calibrationReference'); const referenceWrap = $('#calibrationReferenceWrap');
    const showReference = () => { const code = collection.value; if (code) { reference.src = `/assets/sets/${encodeURIComponent(code)}.jpg`; reference.alt = `صفحهٔ مرجع ${code}`; referenceWrap.classList.remove('hidden'); } else { reference.removeAttribute('src'); referenceWrap.classList.add('hidden'); } };
    collection.disabled = !codes.length; collection.onchange = showReference; showReference(); dialog.showModal();
  }

  async function applyCalibration() {
    if (!calibration) return; const image = new Image(); image.src = calibration.source; await image.decode();
    const x = Number($('#calibrationX').value), y = Number($('#calibrationY').value), w = Number($('#calibrationW').value), h = Number($('#calibrationH').value);
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > image.naturalWidth || y + h > image.naturalHeight) { toast('مستطیل pixel خارج از تصویر است.'); return; }
    const physicalW = parseMm($('#physicalW').value), physicalH = parseMm($('#physicalH').value);
    if (!(physicalW > 0 && physicalH > 0)) { toast('عرض و ارتفاع واقعی نقش را وارد کنید؛ اندازهٔ کاتالوگ به‌عنوان اندازهٔ تولید فرض نمی‌شود.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(image, x, y, w, h, 0, 0, w, h);
    const data = canvas.toDataURL('image/png'); const motif = calibration.motif; const reviewed = $('#calibrationReviewed').checked; motif.sourceAsset = motif.sourceAsset || motif.asset; motif.asset = data; motif.widthMm = physicalW; motif.heightMm = physicalH; motif.pixelWidth = w; motif.pixelHeight = h; motif.needsCalibration = !reviewed; motif.codeVerified = reviewed; motif.physicalDimensionsReviewed = reviewed; motif.associationReview = !reviewed; motif.associationIssues = reviewed ? [] : ['physical dimensions and code/image association remain unconfirmed']; motif.calibrationReviewedAt = reviewed ? new Date().toISOString() : null; motif.productionApproved = false; motif.variants = motif.variants || []; motif.calibrationOverride = { asset: data, widthMm: motif.widthMm, heightMm: motif.heightMm, pixelWidth: w, pixelHeight: h, crop: { x, y, width: w, height: h }, referenceCollection: $('#calibrationCollection').value || null }; state.customAssets[motif.code] = data; saveLocal(false); $('#calibrationDialog').close(); commit(); toast(reviewed ? 'ابعاد واقعی و تطبیق کد/تصویر ثبت شد؛ تأیید نهایی تولید جداگانه است.' : 'اندازه ذخیره شد؛ نقش همچنان برای تولید تأیید نشده است.');
  }

  let pendingProductionExport = null;
  function openProductionCheck(kind = null) {
    const dialog = $('#productionDialog');
    const summary = $('#productionSummary'); const list = $('#productionIssues'); const ack = $('#productionAck'); const proceed = $('#productionContinue');
    let manifest = null; let report;
    try { manifest = engine().layout(state.project, state.library); report = engine().productionCheck(state.project, state.library, manifest); }
    catch (error) { report = { ready: false, errors: [error.message], warnings: [], usedMotifs: [], nesting: null }; }
    pendingProductionExport = report.ready ? kind : null;
    summary.className = `production-report ${report.ready ? 'ready' : 'blocked'}`;
    summary.replaceChildren();
    const heading = document.createElement('b'); heading.textContent = report.ready ? 'هندسه قابل محاسبه است؛ تأیید انسانی هنوز لازم است.' : 'خروجی چاپ متوقف شد تا خطاها برطرف شوند.'; summary.appendChild(heading);
    if (manifest?.nesting) { const metrics = document.createElement('span'); metrics.className = 'metric'; metrics.textContent = `روش ${manifest.nesting.method} · استفادهٔ برآوردی ${fa(manifest.nesting.utilizationPercent)}٪ · یک شیت`; summary.appendChild(document.createElement('br')); summary.appendChild(metrics); }
    list.replaceChildren();
    [...report.errors.map(text => `خطا: ${text}`), ...report.warnings].forEach(text => { const item = document.createElement('li'); item.textContent = text; list.appendChild(item); });
    if (!list.children.length) { const item = document.createElement('li'); item.textContent = 'موردی برای هشدار خودکار پیدا نشد؛ همچنان یک چاپ آزمایشی انجام دهید.'; list.appendChild(item); }
    $('#productionIntro').textContent = 'PDF فنی با زمینهٔ سفید، اجزای برداری مشکی و تبدیل آستانه‌ای ثابت ۱۲۸ برای تصاویر به سیاه‌وسفید ساخته می‌شود. وضوح مؤثر هر نقش باید حداقل ۳۰۰ PPI باشد؛ صحت اندازه را با چاپ خط‌کش ۱۰۰ میلی‌متری و خاموش‌کردن Fit to page بررسی کنید.';
    ack.checked = false; ack.disabled = !report.ready; proceed.hidden = !kind; proceed.disabled = true;
    dialog.showModal();
  }

  function exportScaleTest() {
    const svg = engine().renderPrintScaleSvg();
    fetch('/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg, filename: 'naqsh-scale-test', profile: engine().PRINT_PROFILE, expected_width_mm: 120, expected_height_mm: 45 }) })
      .then(async response => { if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `سرور PDF خطا داد (${response.status})`); } download('naqsh-scale-test-100-percent.pdf', await response.blob(), 'application/pdf'); toast('PDF تست مقیاس آماده است؛ خط‌کش ۱۰۰ میلی‌متری را پس از چاپ اندازه بگیرید.'); })
      .catch(error => toast(`ساخت PDF تست مقیاس ناموفق بود: ${error.message}`));
  }

  function bind() {
    $('#projectName').onchange = e => { remember(); state.project.name = e.target.value; commit(); };
    $('#customerName').onchange = e => { remember(); state.project.customerName = e.target.value.trim(); commit(); };
    $('#orderNumber').onchange = e => { remember(); state.project.orderNumber = e.target.value.trim(); commit(); };
    $('#projectStatus').onchange = e => { remember(); state.project.status = e.target.value; commit(); };
    [['#sheetW', 'widthMm'], ['#sheetH', 'heightMm']].forEach(([id, key]) => $(id).onchange = e => { remember(); state.project.sheet[key] = parseMm(e.target.value); commit(); });
    $('#autoHeight').onchange = e => { remember(); state.project.sheet.autoHeight = e.target.checked; commit(); };
    $('#guidesToggle').onchange = e => { state.project.guides = e.target.checked; commit(); };
    $('#librarySearch').oninput = () => { state.visible = 24; renderLibrary(); }; $('#clearSearch').onclick = () => { $('#librarySearch').value = ''; renderLibrary(); }; $('#loadMoreBtn').onclick = () => { state.visible += 24; renderLibrary(); };
    $('#addSectionBtn').onclick = () => { remember(); const section = { id: uid('s'), name: 'قطعهٔ سفارشی', partKind: 'custom', partCode: '', labelFa: 'قطعهٔ سفارشی', widthMm: 350, heightMm: 550, quantity: 1, shape: 'rect', topWidthMm: 280, neckWidthMm: 90, neckDepthMm: 100, mirror: false, rotateOnSheet: false, layers: [] }; state.project.sections.push(section); state.selectedSection = section.id; state.selectedLayer = null; commit(); };
    $('#loadSampleBtn').onclick = () => { remember(); state.project = engine().makeDefaultProject(state.library); selectFirst(); commit(); toast('نمونهٔ نمایشی بارگذاری شد؛ اندازه‌های آن فرضی‌اند.'); };
    $('#saveBtn').onclick = () => saveLocal(true); $('#newProjectBtn').onclick = async () => { if (window.confirm('پروژهٔ فعلی حفظ می‌شود و یک پروژهٔ خالی تازه ساخته خواهد شد. ادامه؟')) { if (!await saveLocal(false)) return; state.library = clone(state.baseLibrary); state.customAssets = {}; state.history = []; state.future = []; state.project = makeFallback(); state.projectId = uid('project-'); selectFirst(); commit(); } };
    $('#undoBtn').onclick = () => { if (!state.history.length) return; state.future.push(clone(state.project)); state.project = state.history.pop(); selectFirst(); renderAll(); scheduleSave(); }; $('#redoBtn').onclick = () => { if (!state.future.length) return; state.history.push(clone(state.project)); state.project = state.future.pop(); selectFirst(); renderAll(); scheduleSave(); };
    $('#fitBtn').onclick = () => fitCanvas(); $('#zoomIn').onclick = () => zoomBy(.1); $('#zoomOut').onclick = () => zoomBy(-.1); $('#gridBtn').onclick = () => $('#canvasWrap').classList.toggle('no-grid');
    $('#exportMenuBtn').onclick = () => $('#exportMenu').classList.toggle('hidden'); $('#exportSvgBtn').onclick = () => exportWhat('svg'); $('#exportProjectBtn').onclick = () => exportWhat('project'); $('#exportExchangeBtn').onclick = () => exportWhat('exchange'); $('#exportPdfBtn').onclick = () => exportWhat('pdf'); $('#exportScaleTestBtn').onclick = () => { $('#exportMenu').classList.add('hidden'); exportScaleTest(); };
    $$('.tab').forEach(tab => tab.onclick = () => tab.dataset.tab === 'library' ? (showLibrary()) : showProperties()); $('#importProjectBtn').onclick = () => $('#projectFile').click(); $('#projectFile').onchange = e => importJSON(e.target.files[0]); $('#projectDrop').ondragover = e => e.preventDefault(); $('#projectDrop').ondrop = e => { e.preventDefault(); importJSON(e.dataTransfer.files[0]); }; $('#assetFile').onchange = e => importAsset(e.target.files[0]);
    $('#unitSelector').onchange = e => { state.unit = e.target.value; renderAll(); };
    $('#calibrationApply').onclick = applyCalibration; $('#calibrationCancel').onclick = () => $('#calibrationDialog').close();
    $('#productionCheckBtn').onclick = () => openProductionCheck(); $('#productionAck').onchange = () => { $('#productionContinue').disabled = !$('#productionAck').checked; };
    $('#productionCancel').onclick = () => $('#productionDialog').close(); $('#productionContinue').onclick = () => { if (!$('#productionAck').checked || !pendingProductionExport) return; const kind = pendingProductionExport; $('#productionDialog').close(); pendingProductionExport = null; exportWhat(kind, true); };
    $('#projectSearch').oninput = refreshProjectList; $('#refreshProjectsBtn').onclick = refreshProjectList;
    $('#openProjectBtn').onclick = async () => { const id = $('#projectList').value; if (!id || id === state.projectId) return; if (!await saveLocal(false)) return; const record = await state.store.get(id); if (!record) { toast('پروژه انتخاب‌شده پیدا نشد.'); return; } try { const migrated = state.store.migrate(JSON.parse(record.data)); state.library = clone(state.baseLibrary); state.history = []; state.future = []; state.projectId = record.id; state.project = normalizeProject(migrated.project); state.customAssets = migrated.customAssets || migrated.assets || {}; mergeLibrary(migrated.library); (migrated.library?.motifs || []).forEach(motif => { const current = findMotif(motif.code); if (current) Object.assign(current, motif); }); selectFirst(); renderAll(); localStorage.setItem('naqsh-active-project-id', state.projectId); toast('پروژه باز شد.'); } catch (error) { toast(`پروژه باز نشد: ${error.message}`); } };
    $('#duplicateProjectBtn').onclick = async () => { if (!await saveLocal(false)) return; state.project = normalizeProject(clone(state.project)); state.project.name = `${state.project.name || 'پروژه'} · کپی`; state.projectId = uid('project-'); selectFirst(); commit(); toast('نسخهٔ جداگانه ساخته شد؛ پروژهٔ قبلی حفظ شده است.'); };
    $('#restoreProjectBtn').onclick = async () => { const record = await state.store?.get($('#projectList').value); if (!record?.versions?.length) { toast('برای این پروژه نسخهٔ قبلی ثبت نشده است.'); return; } const choice = window.prompt(`شمارهٔ نسخه برای بازیابی (۱ تا ${record.versions.length}، ۱ جدیدترین نسخهٔ قبلی):`, '1'); if (choice === null) return; const index = record.versions.length - Number(choice); if (!Number.isInteger(index) || index < 0 || index >= record.versions.length) { toast('شمارهٔ نسخه معتبر نیست.'); return; } try { const selectedVersion = state.store.migrate(JSON.parse(record.versions[index].data)); if (!await saveLocal(false)) return; await state.store.save(record.id, selectedVersion); const migrated = selectedVersion; state.library = clone(state.baseLibrary); state.history = []; state.future = []; state.projectId = record.id; state.project = normalizeProject(migrated.project); state.customAssets = migrated.customAssets || migrated.assets || {}; mergeLibrary(migrated.library); (migrated.library?.motifs || []).forEach(motif => { const current = findMotif(motif.code); if (current) Object.assign(current, motif); }); selectFirst(); renderAll(); try { localStorage.setItem('naqsh-active-project-id', state.projectId); } catch (_) {} await refreshProjectList(); toast('نسخهٔ قبلی بازیابی شد؛ نسخهٔ فعلی در تاریخچه باقی ماند.'); } catch (error) { toast(`بازیابی ناموفق بود: ${error.message}`); } };
  }

  function fitCanvas() { state.zoom = 1; const host = $('#svgHost'); host.style.transform = 'scale(1)'; $('#zoomLabel').textContent = '۱۰۰٪'; }
  function zoomBy(delta) { state.zoom = Math.max(.3, Math.min(2.5, state.zoom + delta)); $('#svgHost').style.transform = `scale(${state.zoom})`; $('#zoomLabel').textContent = `${fa(Math.round(state.zoom * 100))}٪`; }
  function showLibrary() { $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === 'library')); $('#libraryTab').classList.remove('hidden'); $('#propertiesTab').classList.add('hidden'); }

  function importJSON(file) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { toast('فایل پروژه بیش از ۱۰۰ مگابایت است و برای جلوگیری از مصرف بیش‌ازحد حافظه رد شد.'); return; }
    const reader = new FileReader(); reader.onload = async () => {
      try {
        const exchange = JSON.parse(reader.result); const migrated = window.NaqshProjectStore.migrate(exchange); const project = migrated.project;
        if (!await saveLocal(false)) return; state.library = clone(state.baseLibrary); state.history = []; state.future = []; state.project = normalizeProject(project); state.projectId = uid('project-'); state.customAssets = Object.assign({}, migrated.customAssets || {}, migrated.assets || {}); mergeLibrary(migrated.library);
        Object.entries(migrated.assets || {}).forEach(([code, asset]) => { const motif = engine().findMotif(state.library, code); if (motif) { motif.asset = asset; state.customAssets[motif.code] = asset; } });
        selectFirst(); const saved = await saveLocal(false); renderAll(); if (!saved) return; toast('پروژه به‌عنوان پروندهٔ جداگانه وارد شد؛ پروژهٔ قبلی حفظ شد.');
      } catch (error) { toast(`ورود پروژه ناموفق: ${error.message}`); }
    }; reader.readAsText(file);
  }

  window.addEventListener('DOMContentLoaded', () => { bind(); load(); });
})();
