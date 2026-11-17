/* Naqsh Studio geometry engine v1.2.0-alpha.1 — millimetres, y-down.
 * ES3-compatible UMD so the same calculations can run in browsers and ExtendScript.
 * Catalog raster art remains raster. No hidden resampling or vector tracing.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.NaqshEngine = api; }
}(this, function () {
  var MAX_PLACEMENTS = 10000;
  var PI = Math.PI;
  var PRINT_PROFILE = 'technical-bw-v1';
  var GARMENT_PARTS = [
    {kind:'astin',code:'Astin',nameFa:'آستین'},
    {kind:'tak',code:'tak',nameFa:'تک'},
    {kind:'pan',code:'Pan',nameFa:'پانچک'},
    {kind:'zih',code:'zih',nameFa:'زیح'}
  ];
  var GARMENT_PART_ALIASES = {
    astin:['sleeve','sleeve-left','sleeve-right'],
    tak:['tak-left','tak-right'],
    pan:['pan-left','pan-right'],
    zih:['zih-left','zih-right']
  };
  function number(v, fallback) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : fallback; }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function copy(o) {
    var out, i, k;
    if (o === null || typeof o !== 'object') { return o; }
    if (Object.prototype.toString.call(o) === '[object Array]') {
      out = []; for (i = 0; i < o.length; i++) { out.push(copy(o[i])); } return out;
    }
    out = {}; for (k in o) { if (own(o,k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') { out[k] = copy(o[k]); } } return out;
  }
  function round(n) { return Math.round(n * 1000000) / 1000000; }
  function xml(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
  function getGarmentPart(value) {
    var text = String(value === undefined || value === null ? '' : value).trim(), lower = text.toLowerCase(), i, j, part, aliases;
    for (i = 0; i < GARMENT_PARTS.length; i++) {
      part = GARMENT_PARTS[i];
      aliases = GARMENT_PART_ALIASES[part.kind] || [];
      if (lower === part.kind || lower === part.code.toLowerCase() || text === part.nameFa || (text.indexOf(part.nameFa) === 0 && /^[\s_-]/.test(text.slice(part.nameFa.length)))) { return copy(part); }
      for (j = 0; j < aliases.length; j++) { if (lower === aliases[j]) { return copy(part); } }
    }
    return null;
  }
  function garmentParts() { return copy(GARMENT_PARTS); }
  function normalizeCode(value) {
    var s = String(value === undefined || value === null ? '' : value), out = '', i, c, n;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i); n = s.charCodeAt(i);
      if (n >= 1776 && n <= 1785) { c = String(n - 1776); }
      if (n >= 1632 && n <= 1641) { c = String(n - 1632); }
      out += c;
    }
    return out.toUpperCase().replace(/[\s\u200c\u200e\u200f]/g, '').replace(/^([A-Z]+)[_\-]+([0-9]+)$/, '$1$2');
  }
  function codeKey(value) { var s = normalizeCode(value), m = /^([A-Z]+)0*([0-9]+)$/.exec(s); return m ? m[1] + String(parseInt(m[2], 10)) : s; }
  function findMotif(library, code) {
    var list = library && library.motifs ? library.motifs : [], key = codeKey(code), i;
    for (i = 0; i < list.length; i++) { if (codeKey(list[i].code) === key) { return list[i]; } }
    return null;
  }
  function addUnique(a, value) { var i; for (i = 0; i < a.length; i++) { if (a[i] === value) { return; } } a.push(value); }
  function regionFor(layer, section) {
    return {xMm:number(layer.xMm, 0), yMm:number(layer.yMm, 0), widthMm:number(layer.widthMm, section.widthMm), heightMm:number(layer.heightMm, section.heightMm)};
  }
  function dimensions(motif) {
    var w = number(motif.widthMm, 0), h = number(motif.heightMm, 0);
    if (motif && motif.needsCalibration === true) { return null; }
    if (w > 0 && h > 0) { return {widthMm:w, heightMm:h}; }
    return null;
  }
  function validateProject(project, library) {
    var errors = [], warnings = [], sheet, sections, s, l, r, m, i, j, k, q, pts, mode;
    if (!project || typeof project !== 'object') { return {errors:['پروژه معتبر نیست.'], warnings:[]}; }
    sheet = project.sheet || {}; sections = project.sections || [];
    if (!(number(sheet.widthMm, 0) > 0 && number(sheet.widthMm, 0) <= 50000)) { errors.push('عرض شیت باید بیشتر از صفر و حداکثر ۵۰۰۰۰ میلی‌متر باشد.'); }
    if (!(number(sheet.heightMm, 0) > 0 && number(sheet.heightMm, 0) <= 50000)) { errors.push('ارتفاع شیت باید بیشتر از صفر و حداکثر ۵۰۰۰۰ میلی‌متر باشد.'); }
    if (number(sheet.marginMm, 10) < 0 || number(sheet.gutterMm, 10) < 0) { errors.push('حاشیه و فاصلهٔ قطعات نباید منفی باشد.'); }
    if (!sections.length || sections.length > 100) { errors.push('پروژه باید بین ۱ تا ۱۰۰ تعریف قطعه داشته باشد.'); }
    for (i = 0; i < sections.length; i++) {
      s = sections[i]; q = number(s.quantity, 1);
      if (!(number(s.widthMm, 0) > 0 && number(s.heightMm, 0) > 0)) { errors.push('اندازهٔ قطعهٔ «' + (s.name || i + 1) + '» باید مثبت باشد.'); }
      if (!(q >= 1 && q <= 100 && q === Math.floor(q))) { errors.push('تعداد قطعه باید عدد صحیح بین ۱ تا ۱۰۰ باشد.'); }
      if (s.shape && !/^(rect|trapezoid|pentagon|neck|polygon)$/.test(s.shape)) { errors.push('شکل قطعه شناخته نیست.'); }
      if (s.positionMode !== undefined && !/^(auto|manual)$/.test(s.positionMode)) { errors.push('روش جایگذاری قطعه باید خودکار یا دستی باشد.'); }
      if (s.positionMode === 'manual') {
        if (q !== 1) { errors.push('برای جایگذاری دستی، تعداد قطعه باید دقیقاً ۱ باشد.'); }
        if (!isFinite(Number(s.sheetXmm)) || !isFinite(Number(s.sheetYmm))) { errors.push('مختصات دستی قطعه باید عدد معتبر باشند.'); }
      }
      if (s.shape === 'trapezoid' && !(number(s.topWidthMm, s.widthMm * 0.75) > 0 && number(s.topWidthMm, s.widthMm * 0.75) <= number(s.widthMm, 0))) { errors.push('عرض بالای ذوزنقه باید مثبت و حداکثر برابر عرض قطعه باشد.'); }
      if (s.rotateOnSheet !== undefined && typeof s.rotateOnSheet !== 'boolean') { errors.push('گزینهٔ چرخش قطعه روی شیت باید روشن یا خاموش باشد.'); }
      if (s.shape === 'polygon') {
        pts = s.points || [];
        if (pts.length < 3 || pts.length > 512) { errors.push('چندضلعی سفارشی باید ۳ تا ۵۱۲ نقطه داشته باشد.'); }
        for (k = 0; k < pts.length; k++) {
          if (!pts[k] || !isFinite(Number(pts[k][0])) || !isFinite(Number(pts[k][1])) || Number(pts[k][0]) < 0 || Number(pts[k][1]) < 0 || Number(pts[k][0]) > s.widthMm || Number(pts[k][1]) > s.heightMm) { errors.push('نقطهٔ چندضلعی بیرون از ابعاد قطعه یا نامعتبر است.'); break; }
        }
      }
      if (!s.layers || !s.layers.length) { warnings.push('قطعهٔ «' + (s.name || i + 1) + '» هنوز نقش ندارد.'); }
      for (j = 0; j < (s.layers || []).length; j++) {
        l = s.layers[j]; if (l.enabled === false) { continue; }
        if (!normalizeCode(l.code)) { errors.push('کد نقش لایهٔ «' + (l.name || j + 1) + '» خالی است.'); continue; }
        m = findMotif(library, l.code);
        if (!m || !m.asset) { errors.push('کد «' + l.code + '» در کتابخانهٔ قابل‌استفاده پیدا نشد.'); continue; }
        r = regionFor(l, s);
        if (!(r.widthMm > 0 && r.heightMm > 0)) { errors.push('ناحیهٔ لایهٔ «' + (l.name || l.code) + '» باید عرض و ارتفاع مثبت داشته باشد.'); }
        mode = l.mode || 'repeatX';
        if (!/^(single|contain|cover|repeatX|repeatY|grid)$/.test(mode)) { errors.push('روش چیدمان «' + mode + '» شناخته نیست.'); }
        if ((l.tileWidthMm !== undefined && !(number(l.tileWidthMm, 0) >= 0.1)) || (l.tileHeightMm !== undefined && !(number(l.tileHeightMm, 0) >= 0.1))) { errors.push('اندازهٔ واحد نقش باید حداقل ۰٫۱ میلی‌متر باشد.'); }
        if (number(l.opacity, 1) < 0 || number(l.opacity, 1) > 1) { errors.push('شفافیت باید بین صفر و یک باشد.'); }
      }
    }
    return {errors:errors, warnings:warnings};
  }
  function shapePoints(s) {
    var w = number(s.widthMm, 1), h = number(s.heightMm, 1), tw, nw, nd, points = [], i, a;
    if (s.shape === 'polygon') { return copy(s.points); }
    if (s.shape === 'trapezoid') { tw = Math.max(0.1, Math.min(w, number(s.topWidthMm, w * 0.75))); return [[(w-tw)/2,0],[(w+tw)/2,0],[w,h],[0,h]]; }
    if (s.shape === 'pentagon') { return [[w/2,0],[w,h*0.18],[w,h],[0,h],[0,h*0.18]]; }
    if (s.shape === 'neck') {
      nw = Math.max(0.1, Math.min(w * 0.95, number(s.neckWidthMm, w * 0.35)));
      nd = Math.max(0.1, Math.min(h * 0.9, number(s.neckDepthMm, h * 0.2)));
      points.push([0,0]);
      for (i = 0; i <= 32; i++) { a = PI - PI * i / 32; points.push([round(w/2 + nw/2 * Math.cos(a)),round(nd * Math.sin(a))]); }
      points.push([w,0],[w,h],[0,h]); return points;
    }
    return [[0,0],[w,0],[w,h],[0,h]];
  }
  function makePlacements(layer, section, motif, warnings, counter) {
    var r = regionFor(layer, section), natural = dimensions(motif), mode = layer.mode || 'repeatX';
    var a = number(layer.rotation, 0) % 360, rad = a * PI / 180, cs = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
    var requestedW = number(layer.tileWidthMm, 0), requestedH = number(layer.tileHeightMm, 0);
    var aspect = number(motif.pixelWidth, 0) > 0 && number(motif.pixelHeight, 0) > 0 ? number(motif.pixelWidth, 0) / number(motif.pixelHeight, 0) : (natural ? natural.widthMm / natural.heightMm : 0);
    var w = 0, h = 0, scale;
    var fw, fh, sx, sy, ox = number(layer.offsetXmm, 0), oy = number(layer.offsetYmm, 0), gx = number(layer.gapXmm, 0), gy = number(layer.gapYmm, 0);
    var xs = [], ys = [], x, y, ix, iy, j, k, count, span, p = [], mx, my, ppi;
    if (mode === 'contain' || mode === 'cover') {
      if (natural) { w = natural.widthMm; h = natural.heightMm; }
      else if (aspect > 0) { w = aspect; h = 1; }
      else { throw new Error('نسبت تصویر «' + motif.code + '» مشخص نیست؛ ابعاد فیزیکی را کالیبره کنید.'); }
      fw = w * cs + h * sn; fh = w * sn + h * cs;
      scale = mode === 'contain' ? Math.min(r.widthMm/fw,r.heightMm/fh) : Math.max(r.widthMm/fw,r.heightMm/fh);
      w = w * scale; h = h * scale;
    } else if (layer.lockAspect !== false) {
      if (requestedW > 0) { w = requestedW; h = aspect > 0 ? w / aspect : requestedH; }
      else if (requestedH > 0) { h = requestedH; w = aspect > 0 ? h * aspect : 0; }
      else if (natural) { w = natural.widthMm; h = natural.heightMm; }
      if (!(w > 0 && h > 0)) { throw new Error('نقش «' + motif.code + '» ابعاد فیزیکی تأییدشده ندارد؛ اندازهٔ واحد را وارد کنید یا کالیبراسیون را کامل کنید.'); }
    } else {
      w = requestedW > 0 ? requestedW : (natural ? natural.widthMm : 0);
      h = requestedH > 0 ? requestedH : (natural ? natural.heightMm : 0);
      if (!(w > 0 && h > 0)) { throw new Error('نقش «' + motif.code + '» ابعاد فیزیکی تأییدشده ندارد؛ عرض و ارتفاع واحد را وارد کنید یا کالیبراسیون را کامل کنید.'); }
    }
    fw = w * cs + h * sn; fh = w * sn + h * cs; sx = fw + gx; sy = fh + gy;
    if (!(w >= 0.1 && h >= 0.1 && fw > 0 && fh > 0)) { throw new Error('اندازهٔ نقش «' + motif.code + '» معتبر نیست.'); }
    if ((mode === 'repeatX' || mode === 'grid') && !(sx >= 0.1)) { throw new Error('فاصلهٔ افقی باعث گام تکرار صفر یا منفی شده است.'); }
    if ((mode === 'repeatY' || mode === 'grid') && !(sy >= 0.1)) { throw new Error('فاصلهٔ عمودی باعث گام تکرار صفر یا منفی شده است.'); }
    if (mode === 'repeatX' || mode === 'grid') {
      count = Math.max(1, Math.ceil((r.widthMm + 2 * Math.abs(ox)) / sx));
      if (count > MAX_PLACEMENTS) { throw new Error('تعداد تکرار افقی بیش از حد مجاز است.'); }
      span = fw + (count - 1) * sx; x = (r.widthMm - span) / 2 + ox; ix = -Math.floor((count - 1) / 2);
      for (j = 0; j < count; j++) { xs.push({v:x,i:ix}); x += sx; ix++; }
    } else { xs.push({v:(r.widthMm-fw)/2+ox,i:0}); }
    if (mode === 'repeatY' || mode === 'grid') {
      count = Math.max(1, Math.ceil((r.heightMm + 2 * Math.abs(oy)) / sy));
      if (count > MAX_PLACEMENTS) { throw new Error('تعداد تکرار عمودی بیش از حد مجاز است.'); }
      span = fh + (count - 1) * sy; y = (r.heightMm - span) / 2 + oy; iy = -Math.floor((count - 1) / 2);
      for (j = 0; j < count; j++) { ys.push({v:y,i:iy}); y += sy; iy++; }
    } else { ys.push({v:(r.heightMm-fh)/2+oy,i:0}); }
    if (counter.count + xs.length * ys.length > MAX_PLACEMENTS) { throw new Error('بیش از ۱۰۰۰۰ کپی ایجاد می‌شود؛ واحد نقش یا فاصله‌ها را بزرگ‌تر کنید.'); }
    for (j = 0; j < ys.length; j++) {
      for (k = 0; k < xs.length; k++) {
        mx = !!layer.mirrorX; my = !!layer.mirrorY;
        if (layer.alternateX && Math.abs(xs[k].i) % 2 === 1) { mx = !mx; }
        if (layer.alternateY && Math.abs(ys[j].i) % 2 === 1) { my = !my; }
        p.push({code:motif.code,asset:motif.asset,xMm:round(r.xMm+xs[k].v+(fw-w)/2),yMm:round(r.yMm+ys[j].v+(fh-h)/2),widthMm:round(w),heightMm:round(h),sourcePixelWidth:number(motif.pixelWidth,0),sourcePixelHeight:number(motif.pixelHeight,0),sourceVector:/\.svg(?:$|[?#])/i.test(String(motif.asset||''))||/^data:image\/svg\+xml/i.test(String(motif.asset||'')),rotation:round(a),mirrorX:mx,mirrorY:my,opacity:number(layer.opacity,1)});
      }
    }
    counter.count += p.length;
    if (motif.needsCalibration) { addUnique(warnings, 'محدودهٔ تکرار و مقیاس «' + motif.code + '» هنوز نیازمند کنترل یک‌باره است.'); }
    if (number(motif.pixelWidth, 0) > 0) {
      ppi = Math.min(motif.pixelWidth/(w/25.4),number(motif.pixelHeight,motif.pixelWidth)/(h/25.4));
      if (ppi < 300) { addUnique(warnings,'کیفیت مؤثر «' + motif.code + '» در این اندازه حدود ' + Math.round(ppi) + ' ppi است؛ برای PDF فنی حداقل ۳۰۰ PPI لازم است.'); }
    }
    return {id:String(layer.id || 'layer'),name:String(layer.name || motif.code),region:r,placements:p};
  }
  function layout(project, library, options) {
    var check = validateProject(project,library), sheet = project.sheet || {}, margin = number(sheet.marginMm,10), gutter = number(sheet.gutterMm,10);
    var sw = number(sheet.widthMm,2500), sh = number(sheet.heightMm,1500), x = margin, y = margin, row = 0, out = [], warnings = check.warnings.slice(0), counter = {count:0};
    var sections = project.sections, i, j, k, s, qty, result, l, m, usedHeight, sectionW, sectionH, placedW, placedH, rotated, availableW, availableH, normalFits, rotatedFits, occupiedArea = 0, usableArea, occupied = [], manual, candidate, a, autoX, autoY, maxBottom = margin;
    if (check.errors.length) { throw new Error(check.errors.join('\n')); }
    if (sw <= margin*2 || sh <= margin*2) { throw new Error('حاشیه از اندازهٔ قابل‌استفادهٔ شیت بزرگ‌تر است.'); }
    for (i = 0; i < sections.length; i++) {
      s = sections[i]; qty = number(s.quantity,1); sectionW = number(s.widthMm,0); sectionH = number(s.heightMm,0);
      for (j = 0; j < qty; j++) {
        if (out.length >= 500) { throw new Error('بیش از ۵۰۰ قطعه در یک شیت مجاز نیست.'); }
        manual = s.positionMode === 'manual';
        if (manual && j > 0) { throw new Error('برای جایگذاری دستی، تعداد قطعه باید دقیقاً ۱ باشد.'); }
        autoX = x; autoY = y;
        availableW = sw - margin - x; availableH = sheet.autoHeight ? 50000 : sh - margin - y;
        normalFits = sectionW <= availableW + 0.000001 && sectionH <= availableH + 0.000001;
        rotatedFits = !!s.rotateOnSheet && sectionH <= availableW + 0.000001 && sectionW <= availableH + 0.000001;
        rotated = !!s.rotateOnSheet && !normalFits && rotatedFits;
        placedW = rotated ? sectionH : sectionW; placedH = rotated ? sectionW : sectionH;
        if (!manual && x+placedW > sw-margin+0.000001) {
          x = margin; y += row+gutter; row = 0;
          availableW = sw-margin*2; availableH = sheet.autoHeight ? 50000 : sh-margin-y;
          normalFits = sectionW <= availableW + 0.000001 && sectionH <= availableH + 0.000001;
          rotatedFits = !!s.rotateOnSheet && sectionH <= availableW + 0.000001 && sectionW <= availableH + 0.000001;
          rotated = !!s.rotateOnSheet && !normalFits && rotatedFits;
          placedW = rotated ? sectionH : sectionW; placedH = rotated ? sectionW : sectionH;
        }
        if (manual) {
          if (s.rotateOnSheet) { placedW = sectionH; placedH = sectionW; rotated = true; }
          x = number(s.sheetXmm, NaN); y = number(s.sheetYmm, NaN);
          if (!(isFinite(x) && isFinite(y) && x >= margin - 0.000001 && y >= margin - 0.000001 && x + placedW <= sw - margin + 0.000001)) { throw new Error('مختصات دستی قطعهٔ «' + (s.name || i+1) + '» باید داخل حاشیهٔ شیت باشند.'); }
          if (!sheet.autoHeight && y + placedH > sh - margin + 0.000001) { throw new Error('مختصات دستی قطعهٔ «' + (s.name || i+1) + '» باید داخل حاشیهٔ شیت باشند.'); }
          if (sheet.autoHeight) { sh = Math.max(sh, y + placedH + margin); }
        } else if (placedW > sw-margin*2+0.000001) { throw new Error('قطعهٔ «' + (s.name || i+1) + '» از عرض مفید شیت بزرگ‌تر است؛ چرخش ۹۰ درجه هم مناسب نیست و هیچ تغییر اندازهٔ پنهانی انجام نشد.'); }
        result = {id:String(s.id || 'section'+i)+'-'+(j+1),sourceId:String(s.id || 'section'+i),name:String(s.name || 'قطعه')+(qty>1?' — '+(j+1):''),partKind:String(s.partKind || 'custom'),partCode:String(s.partCode || ''),labelFa:String(s.labelFa || s.name || ''),xMm:round(x),yMm:round(y),widthMm:sectionW,heightMm:sectionH,placedWidthMm:placedW,placedHeightMm:placedH,rotationOnSheet:rotated?90:0,mirror:!!s.mirror,points:shapePoints(s),layers:[]};
        for (k = 0; k < (s.layers || []).length; k++) {
          l = s.layers[k]; if (l.enabled === false) { continue; } m = findMotif(library,l.code);
          result.layers.push(makePlacements(l,s,m,warnings,counter));
        }
        candidate = {x: x, y: y, width: placedW, height: placedH};
        for (k = 0; k < occupied.length; k++) { a = occupied[k]; if (candidate.x < a.x + a.width - 0.000001 && candidate.x + candidate.width > a.x + 0.000001 && candidate.y < a.y + a.height - 0.000001 && candidate.y + candidate.height > a.y + 0.000001) { throw new Error('قطعهٔ «' + (s.name || i+1) + '» با قطعهٔ دیگری هم‌پوشانی دارد؛ مختصات دستی یا چیدمان شیت را اصلاح کنید.'); } }
        occupied.push(candidate); out.push(result); occupiedArea += placedW*placedH; if (!manual) { x += placedW+gutter; row = Math.max(row,placedH); }
        maxBottom = Math.max(maxBottom, candidate.y + placedH);
        if (manual) { x = autoX; y = autoY; }
      }
    }
    usedHeight = maxBottom+margin;
    if (sheet.autoHeight) { sh = Math.max(margin*2+1,usedHeight); }
    else if (usedHeight > sh+0.000001) { throw new Error('قطعات در ارتفاع شیت جا نمی‌شوند؛ ارتفاع یا چیدمان را تغییر دهید یا ارتفاع خودکار را روشن کنید.'); }
    if (sh > 50000) { throw new Error('ارتفاع شیت بیش از حد مجاز است.'); }
    usableArea = Math.max(0,(sw-margin*2)*(sh-margin*2));
    return {version:1,name:String(project.name || 'سفارش نقش'),guides:project.guides !== false,sheet:{widthMm:round(sw),heightMm:round(sh),marginMm:round(margin),gutterMm:round(gutter)},sections:out,warnings:warnings,placementCount:counter.count,nesting:{method:'deterministic-shelf',optimized:false,sheetCount:1,occupiedAreaMm2:round(occupiedArea),usableAreaMm2:round(usableArea),wasteAreaMm2:round(Math.max(0,usableArea-occupiedArea)),utilizationPercent:usableArea?round(Math.min(100,occupiedArea/usableArea*100)):0}};
  }
  function pointsString(points) { var a = [], i; for (i = 0; i < points.length; i++) { a.push(round(points[i][0])+','+round(points[i][1])); } return a.join(' '); }
  function safeHref(value) {
    var s = String(value || '');
    if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\r\n]+$/i.test(s)) { return s; }
    if (/^\/?assets\/[A-Za-z0-9_./%\-]+$/.test(s) && s.indexOf('..') < 0) { return s.charAt(0)==='/'?s:'/'+s; }
    throw new Error('مسیر دارایی نامعتبر یا جاسازی‌نشده است.');
  }
  function renderSvg(manifest, assetMap, options) {
    var o = options || {}, map = assetMap || {}, W = manifest.sheet.widthMm, H = manifest.sheet.heightMm, parts = [], defs = [], art = [], guides = [], labels = [], imageKeys = [], imageIds = [], i,j,k,z,s,l,p, sid,lid,href,transform, mirror, r, imageId,vectorAsset,labelX,labelY;
    var showGuides = o.guides === undefined ? manifest.guides !== false : !!o.guides, showLabels = o.labels === undefined ? showGuides : !!o.labels;
    var printProfile = o.profile === PRINT_PROFILE, guideColor = printProfile ? '#000000' : '#158779', markColor = printProfile ? '#000000' : '#333333', labelColor = printProfile ? '#000000' : '#3b4d4a';
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+round(W)+'mm" height="'+round(H)+'mm" viewBox="0 0 '+round(W)+' '+round(H)+'"'+(printProfile?' data-print-profile="'+PRINT_PROFILE+'"':'')+'>');
    parts.push('<title>'+xml(manifest.name)+'</title><desc>Naqsh Studio — physical millimetres; '+(printProfile?'technical black on white print profile':'catalog raster images preserve source pixels')+'.</desc>');
    if (o.background !== null) { parts.push('<rect width="'+W+'" height="'+H+'" fill="'+xml(o.background || '#ffffff')+'"/>'); }
    for (i = 0; i < manifest.sections.length; i++) {
      s = manifest.sections[i]; sid = 'sectionClip'+i;
      defs.push('<clipPath id="'+sid+'" clipPathUnits="userSpaceOnUse"><polygon points="'+pointsString(s.points)+'"/></clipPath>');
      mirror = s.mirror ? 'translate('+s.widthMm+' 0) scale(-1 1)' : '';
      art.push('<g id="section-'+i+'" data-name="'+xml(s.name)+'" transform="'+(s.rotationOnSheet?'translate('+round(s.xMm+s.heightMm)+' '+round(s.yMm)+') rotate(90)':'translate('+s.xMm+' '+s.yMm+')')+'"><g'+(mirror?' transform="'+mirror+'"':'')+' clip-path="url(#'+sid+')">');
      for (j = 0; j < s.layers.length; j++) {
        l = s.layers[j]; lid = 'regionClip'+i+'_'+j; r = l.region;
        defs.push('<clipPath id="'+lid+'" clipPathUnits="userSpaceOnUse"><rect x="'+round(r.xMm)+'" y="'+round(r.yMm)+'" width="'+round(r.widthMm)+'" height="'+round(r.heightMm)+'"/></clipPath>');
        art.push('<g data-name="'+xml(l.name)+'" clip-path="url(#'+lid+')">');
        for (k = 0; k < l.placements.length; k++) {
          p = l.placements[k]; href = map[p.code] || map[p.asset] || p.asset;
          imageId = '';
          for (z = 0; z < imageKeys.length; z++) { if (imageKeys[z] === p.code) { imageId = imageIds[z]; break; } }
          if (!imageId) {
            href = safeHref(href); vectorAsset=/\.svg(?:$|[?#])/i.test(String(href))||/^data:image\/svg\+xml/i.test(String(href)); imageId = 'motifImage'+imageKeys.length; imageKeys.push(p.code); imageIds.push(imageId);
            defs.push('<image id="'+imageId+'" data-source-width-px="'+number(p.sourcePixelWidth,0)+'" data-source-height-px="'+number(p.sourcePixelHeight,0)+'" data-raster="'+(vectorAsset?'false':'true')+'" x="-0.5" y="-0.5" width="1" height="1" preserveAspectRatio="none" xlink:href="'+xml(href)+'"/>');
          }
          transform = 'translate('+round(p.xMm+p.widthMm/2)+' '+round(p.yMm+p.heightMm/2)+') rotate('+round(p.rotation)+') scale('+round(p.widthMm*(p.mirrorX?-1:1))+' '+round(p.heightMm*(p.mirrorY?-1:1))+')';
          art.push('<use data-code="'+xml(p.code)+'" data-output-width-mm="'+round(p.widthMm)+'" data-output-height-mm="'+round(p.heightMm)+'" opacity="'+round(p.opacity)+'" transform="'+transform+'" xlink:href="#'+imageId+'"/>');
        }
        art.push('</g>');
      }
      art.push('</g></g>');
      if (showGuides) {
        guides.push('<g transform="'+(s.rotationOnSheet?'translate('+round(s.xMm+s.heightMm)+' '+round(s.yMm)+') rotate(90)':'translate('+s.xMm+' '+s.yMm+')')+'">');
        guides.push('<polygon points="'+pointsString(s.points)+'"'+(mirror?' transform="'+mirror+'"':'')+' fill="none" stroke="'+guideColor+'" stroke-width="0.25" stroke-dasharray="3 2"/>');
        guides.push('<path d="M -3 0 H -1 M 0 -3 V -1 M '+(s.widthMm+1)+' 0 H '+(s.widthMm+3)+' M '+s.widthMm+' -3 V -1 M -3 '+s.heightMm+' H -1 M 0 '+(s.heightMm+1)+' V '+(s.heightMm+3)+' M '+(s.widthMm+1)+' '+s.heightMm+' H '+(s.widthMm+3)+' M '+s.widthMm+' '+(s.heightMm+1)+' V '+(s.heightMm+3)+'" stroke="'+markColor+'" stroke-width="0.2" fill="none"/>');
        guides.push('</g>');
      }
      if (showLabels) {
        labelX = s.rotationOnSheet ? s.xMm+s.heightMm/2 : s.xMm+s.widthMm/2; labelY = s.yMm;
        labels.push('<text x="'+round(labelX)+'" y="'+round(labelY-6.1)+'" text-anchor="middle" direction="ltr" unicode-bidi="plaintext" font-family="Vazirmatn,Tahoma,sans-serif" font-size="3.2" fill="'+labelColor+'">'+xml(s.partCode || s.name)+'</text>');
        labels.push('<text x="'+round(labelX)+'" y="'+round(labelY-2.5)+'" text-anchor="middle" direction="rtl" unicode-bidi="plaintext" font-family="Vazirmatn,Tahoma,sans-serif" font-size="3.2" fill="'+labelColor+'">'+xml(s.labelFa || s.name)+' · '+round(s.widthMm)+' × '+round(s.heightMm)+' mm</text>');
      }
    }
    parts.push('<defs>'+defs.join('')+'</defs>');
    parts.push('<g id="artwork">'+art.join('')+'</g>');
    if (showGuides) { parts.push('<g id="cut-guides">'+guides.join('')+'</g>'); }
    if (labels.length) { parts.push('<g id="cut-labels">'+labels.join('')+'</g>'); }
    parts.push('</svg>'); return parts.join('\n');
  }
  function makeSection(id, name, widthMm, heightMm, code) {
    var part = getGarmentPart(id) || getGarmentPart(name);
    return {id:String(id),name:String(name),partKind:part?part.kind:'custom',partCode:part?part.code:'',labelFa:part?part.nameFa:String(name),widthMm:widthMm,heightMm:heightMm,quantity:1,shape:'rect',topWidthMm:widthMm*0.75,neckWidthMm:widthMm*0.3,neckDepthMm:heightMm*0.15,mirror:false,rotateOnSheet:false,layers:[{id:String(id)+'-l1',name:'نقش اصلی',code:code || '',enabled:true,xMm:0,yMm:0,widthMm:widthMm,heightMm:heightMm,mode:'repeatX',lockAspect:true,gapXmm:-0.2,gapYmm:-0.2,offsetXmm:0,offsetYmm:0,rotation:0,mirrorX:false,mirrorY:false,alternateX:false,alternateY:false,opacity:1}]};
  }
  function makeDefaultProject(library) {
    var motifs = library && library.motifs ? library.motifs : [], pick = function (preferred,family) { var m=findMotif(library,preferred),i; if(m){return m.code;} for(i=0;i<motifs.length;i++){if(motifs[i].family===family){return motifs[i].code;}} return motifs.length?motifs[0].code:''; };
    var P=pick('P1775','P'),D=pick('D1282','D'),Z=pick('Z347','Z'),V=pick('V006','V'),B=pick('B737','B'),G=pick('G1276','G'), a,b,c,d,e,l;
    a=makeSection('sleeve','آستین',450,650,P); a.quantity=2; a.shape='trapezoid'; a.topWidthMm=350;
    a.layers[0].heightMm=120; a.layers[0].yMm=530; a.layers[0].tileWidthMm=150;
    l=copy(a.layers[0]); l.id='sleeve-background'; l.name='زمینه'; l.code=V; l.xMm=0;l.yMm=0;l.widthMm=450;l.heightMm=530;l.mode='grid';l.tileWidthMm=30;l.gapXmm=100;l.gapYmm=85; a.layers.unshift(l);
    b=makeSection('pan','پانچک',450,1000,P); b.quantity=2; b.layers[0].heightMm=120; b.layers[0].tileWidthMm=150;
    l=copy(b.layers[0]); l.id='pan-background';l.name='زمینهٔ میانی';l.code=Z;l.xMm=190;l.yMm=140;l.widthMm=70;l.heightMm=840;l.mode='repeatY';l.tileWidthMm=55;l.gapYmm=100; b.layers.unshift(l);
    l=copy(b.layers[1]);l.id='pan-border';l.name='نوار کناری';l.code=B;l.xMm=0;l.yMm=0;l.widthMm=25;l.heightMm=1000;l.mode='repeatY';l.tileWidthMm=90;l.rotation=90;b.layers.push(l);
    c=makeSection('tak','تک',150,600,D);c.quantity=2;c.layers[0].mode='cover';
    d=makeSection('zih','زیح',300,700,D);d.shape='pentagon';d.layers[0].mode='contain';
    e=makeSection('gwatnam','گواتنام',180,220,G);e.partCode='Gwatnam';e.layers[0].mode='contain';
    return {version:1,name:'نمونهٔ آزمایشی — ابعاد فرضی',sheet:{widthMm:2500,heightMm:1500,autoHeight:false,gutterMm:12,marginMm:10},guides:true,metadata:{sample:true,note:'اندازه‌های این نمونه فرضی‌اند؛ پیش از تولید، اندازه و محدودهٔ تکرار هر نقش را کنترل کنید.'},sections:[a,b,c,d,e]};
  }
  function createExchange(project,library,assetMap) {
    var manifest=layout(project,library), used=[], motifs=[], assets={}, i,j,k,p,m,href;
    for(i=0;i<manifest.sections.length;i++){for(j=0;j<manifest.sections[i].layers.length;j++){for(k=0;k<manifest.sections[i].layers[j].placements.length;k++){p=manifest.sections[i].layers[j].placements[k];addUnique(used,p.code);}}}
    for(i=0;i<used.length;i++){
      m=findMotif(library,used[i]);href=assetMap&&(assetMap[m.code]||assetMap[m.asset]);
      if(!href || !/^data:image\//i.test(href)){throw new Error('برای پروژهٔ قابل‌انتقال، تصویر «'+used[i]+'» باید جاسازی شود.');}
      safeHref(href);assets[m.code]=href;motifs.push(copy(m));
    }
    return {format:'naqsh-project',version:2,schemaVersion:2,appVersion:'1.2.0-alpha.1',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),project:copy(project),library:{version:1,motifs:motifs},manifest:manifest,assets:assets};
  }
  function productionCheck(project, library, manifest) {
    var errors = [], warnings = [], used = {}, motifs = [], i, j, k, section, layer, motif, code, list = library && library.motifs ? library.motifs : [], ppi, minPpi, placements;
    var validation = validateProject(project, library);
    errors = validation.errors.slice(0); warnings = validation.warnings.slice(0);
    try { manifest = manifest || layout(project, library); } catch (error) { errors.push(error.message); }
    for (i = 0; i < (project.sections || []).length; i++) {
      section = project.sections[i];
      if (manifest && manifest.sections && manifest.sections[i] && number(manifest.sections[i].yMm,0) < 9) { errors.push('حاشیهٔ بالای ورق برای برچسب دوزبانهٔ «'+(section.name||i+1)+'» کافی نیست؛ دست‌کم ۹ میلی‌متر لازم است.'); }
      var part = getGarmentPart(section.partKind);
      if (part) {
        if (section.partCode !== part.code || section.labelFa !== part.nameFa) { errors.push('برچسب دوزبانهٔ قطعهٔ «'+(section.name||i+1)+'» با فهرست استاندارد برابر نیست.'); }
      } else if (section.partKind !== 'custom' || !/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(String(section.partCode||'')) || !String(section.labelFa||'').trim()) {
        errors.push('قطعهٔ «'+(section.name||i+1)+'» باید کد انگلیسی و نام فارسی معتبر داشته باشد.');
      }
      for (j = 0; j < (section.layers || []).length; j++) {
        layer = section.layers[j]; if (layer.enabled === false || !layer.code) { continue; }
        code = normalizeCode(layer.code); if (used[code]) { continue; } used[code] = true;
        motif = findMotif(library, code);
        if (!motif) { errors.push('کد نقش «'+code+'» در کتابخانه نیست.'); continue; }
        motifs.push(code);
        if (motif.needsCalibration === true || !(number(motif.widthMm,0)>0 && number(motif.heightMm,0)>0)) { errors.push('«'+code+'»: اندازهٔ فیزیکی تأییدشده ندارد؛ پیش از خروجی تولیدی کالیبره کنید.'); }
        if (motif.associationReview === true || motif.codeVerified === false) { errors.push('«'+code+'»: تطبیق کد و تصویر تأیید نشده است.'); }
        if (motif.productionApproved !== true) { warnings.push('«'+code+'»: تأیید نهایی تولید برای این نقش ثبت نشده است.'); }
        if (motif.seamlessVerified !== true) { warnings.push('«'+code+'»: seamless بودن نقش تأیید نشده است؛ درز تکرار را بررسی کنید.'); }
        minPpi = Infinity;
        if (manifest && manifest.sections) {
          for (k = 0; k < manifest.sections.length; k++) {
            var layers = manifest.sections[k].layers || [];
            for (var li = 0; li < layers.length; li++) {
              if (normalizeCode(layers[li].name) === normalizeCode(motif.code)) { /* Names are not a stable key; placement codes below are authoritative. */ }
              placements = layers[li].placements || [];
              for (var pi = 0; pi < placements.length; pi++) {
                if (normalizeCode(placements[pi].code) !== code) { continue; }
                ppi = Math.min(number(motif.pixelWidth,0)/(placements[pi].widthMm/25.4), number(motif.pixelHeight,0)/(placements[pi].heightMm/25.4));
                if (ppi > 0) minPpi = Math.min(minPpi, ppi);
              }
            }
          }
        }
        if (minPpi === Infinity) { errors.push('«'+code+'»: وضوح مؤثر تصویر قابل محاسبه نیست؛ برای چاپ فنی منبع پیکسلی معتبر لازم است.'); }
        else if (minPpi < 300) { errors.push('«'+code+'»: وضوح مؤثر '+Math.round(minPpi)+' ppi است؛ برای PDF فنی اندازه را کوچک‌تر یا منبع باکیفیت‌تر کنید (حداقل ۳۰۰ PPI).'); }
        else if (minPpi < 600) { warnings.push('«'+code+'»: وضوح مؤثر حدود '+Math.round(minPpi)+' ppi است؛ ۳۰۰ PPI حداقل چاپ است و ۶۰۰ PPI کیفیت بیشتری می‌دهد.'); }
      }
    }
    warnings.push('این نسخه چیدمان صنعتیِ بهینه، چندشیتی، CMYK یا PDF/X را تضمین نمی‌کند.');
    if (manifest && manifest.nesting && manifest.nesting.method === 'deterministic-shelf') { warnings.push('چیدمان شیت ردیفی و غیر‌بهینه است؛ درصد استفاده فقط برآورد مستطیلی است.'); }
    return {ready:errors.length===0,errors:errors,warnings:warnings,usedMotifs:motifs,nesting:manifest&&manifest.nesting?copy(manifest.nesting):null};
  }
  function renderPrintScaleSvg() {
    var parts=['<?xml version="1.0" encoding="UTF-8"?>','<svg xmlns="http://www.w3.org/2000/svg" data-print-profile="'+PRINT_PROFILE+'" width="120mm" height="45mm" viewBox="0 0 120 45">','<rect width="120" height="45" fill="#ffffff"/>','<text x="60" y="8" text-anchor="middle" font-family="sans-serif" font-size="3.5" fill="#000000">Naqsh Studio · تست مقیاس ۱۰۰٪</text>','<path d="M 10 25 H 110" stroke="#000000" stroke-width="0.35"/>'];
    var i; for(i=0;i<=10;i++){var x=10+i*10;parts.push('<path d="M '+x+' 25 V '+(i%5===0?18:21)+'" stroke="#000" stroke-width="0.25"/>');if(i%2===0)parts.push('<text x="'+x+'" y="31" text-anchor="middle" font-family="sans-serif" font-size="2.5">'+(i*10)+'</text>');}
    parts.push('<text x="60" y="39" text-anchor="middle" font-family="sans-serif" font-size="2.6">خط بین ۰ و ۱۰۰ باید دقیقاً ۱۰۰ میلی‌متر باشد · چاپ بدون Fit to page</text></svg>');
    return parts.join('\n');
  }
  return {version:'1.2.0-alpha.1',PRINT_PROFILE:PRINT_PROFILE,MAX_PLACEMENTS:MAX_PLACEMENTS,normalizeCode:normalizeCode,findMotif:findMotif,getGarmentPart:getGarmentPart,garmentParts:garmentParts,validateProject:validateProject,layout:layout,renderSvg:renderSvg,makeDefaultProject:makeDefaultProject,makeSection:makeSection,createExchange:createExchange,shapePoints:shapePoints,productionCheck:productionCheck,renderPrintScaleSvg:renderPrintScaleSvg};
}));
