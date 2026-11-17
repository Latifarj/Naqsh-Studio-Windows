/* Naqsh Studio geometry engine v1.0.0 — millimetres, y-down.
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
      if (s.shape === 'trapezoid' && !(number(s.topWidthMm, s.widthMm * 0.75) > 0 && number(s.topWidthMm, s.widthMm * 0.75) <= number(s.widthMm, 0))) { errors.push('عرض بالای ذوزنقه باید مثبت و حداکثر برابر عرض قطعه باشد.'); }
      if (s.rotateOnSheet) { errors.push('چرخش خودکار قطعه روی شیت در این نسخه فعال نیست؛ عرض/ارتفاع را آگاهانه تنظیم کنید.'); }
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
        p.push({code:motif.code,asset:motif.asset,xMm:round(r.xMm+xs[k].v+(fw-w)/2),yMm:round(r.yMm+ys[j].v+(fh-h)/2),widthMm:round(w),heightMm:round(h),rotation:round(a),mirrorX:mx,mirrorY:my,opacity:number(layer.opacity,1)});
      }
    }
    counter.count += p.length;
    if (motif.needsCalibration) { addUnique(warnings, 'محدودهٔ تکرار و مقیاس «' + motif.code + '» هنوز نیازمند کنترل یک‌باره است.'); }
    if (number(motif.pixelWidth, 0) > 0) {
      ppi = Math.min(motif.pixelWidth/(w/25.4),number(motif.pixelHeight,motif.pixelWidth)/(h/25.4));
      if (ppi < 150) { addUnique(warnings,'کیفیت مؤثر «' + motif.code + '» در این اندازه حدود ' + Math.round(ppi) + ' ppi است؛ بزرگ‌نمایی، جزئیات تازه ایجاد نمی‌کند.'); }
    }
    return {id:String(layer.id || 'layer'),name:String(layer.name || motif.code),region:r,placements:p};
  }
  function layout(project, library, options) {
    var check = validateProject(project,library), sheet = project.sheet || {}, margin = number(sheet.marginMm,10), gutter = number(sheet.gutterMm,10);
    var sw = number(sheet.widthMm,2500), sh = number(sheet.heightMm,1500), x = margin, y = margin, row = 0, out = [], warnings = check.warnings.slice(0), counter = {count:0};
    var sections = project.sections, i, j, k, s, qty, result, l, m, usedHeight, sectionW, sectionH;
    if (check.errors.length) { throw new Error(check.errors.join('\n')); }
    if (sw <= margin*2 || sh <= margin*2) { throw new Error('حاشیه از اندازهٔ قابل‌استفادهٔ شیت بزرگ‌تر است.'); }
    for (i = 0; i < sections.length; i++) {
      s = sections[i]; qty = number(s.quantity,1); sectionW = number(s.widthMm,0); sectionH = number(s.heightMm,0);
      if (sectionW > sw-margin*2+0.000001) { throw new Error('قطعهٔ «' + (s.name || i+1) + '» از عرض مفید شیت بزرگ‌تر است؛ هیچ تغییر اندازهٔ پنهانی انجام نشد.'); }
      for (j = 0; j < qty; j++) {
        if (out.length >= 500) { throw new Error('بیش از ۵۰۰ قطعه در یک شیت مجاز نیست.'); }
        if (x+sectionW > sw-margin+0.000001) { x = margin; y += row+gutter; row = 0; }
        result = {id:String(s.id || 'section'+i)+'-'+(j+1),sourceId:String(s.id || 'section'+i),name:String(s.name || 'قطعه')+(qty>1?' — '+(j+1):''),xMm:round(x),yMm:round(y),widthMm:sectionW,heightMm:sectionH,mirror:!!s.mirror,points:shapePoints(s),layers:[]};
        for (k = 0; k < (s.layers || []).length; k++) {
          l = s.layers[k]; if (l.enabled === false) { continue; } m = findMotif(library,l.code);
          result.layers.push(makePlacements(l,s,m,warnings,counter));
        }
        out.push(result); x += sectionW+gutter; row = Math.max(row,sectionH);
      }
    }
    usedHeight = y+row+margin;
    if (sheet.autoHeight) { sh = Math.max(margin*2+1,usedHeight); }
    else if (usedHeight > sh+0.000001) { throw new Error('قطعات در ارتفاع شیت جا نمی‌شوند؛ ارتفاع یا چیدمان را تغییر دهید یا ارتفاع خودکار را روشن کنید.'); }
    if (sh > 50000) { throw new Error('ارتفاع شیت بیش از حد مجاز است.'); }
    return {version:1,name:String(project.name || 'سفارش نقش'),guides:project.guides !== false,sheet:{widthMm:round(sw),heightMm:round(sh)},sections:out,warnings:warnings,placementCount:counter.count};
  }
  function pointsString(points) { var a = [], i; for (i = 0; i < points.length; i++) { a.push(round(points[i][0])+','+round(points[i][1])); } return a.join(' '); }
  function safeHref(value) {
    var s = String(value || '');
    if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\r\n]+$/i.test(s)) { return s; }
    if (/^\/?assets\/[A-Za-z0-9_./%\-]+$/.test(s) && s.indexOf('..') < 0) { return s.charAt(0)==='/'?s:'/'+s; }
    throw new Error('مسیر دارایی نامعتبر یا جاسازی‌نشده است.');
  }
  function renderSvg(manifest, assetMap, options) {
    var o = options || {}, map = assetMap || {}, W = manifest.sheet.widthMm, H = manifest.sheet.heightMm, parts = [], defs = [], art = [], guides = [], imageKeys = [], imageIds = [], i,j,k,z,s,l,p, sid,lid,href,transform, mirror, r, imageId;
    var showGuides = o.guides === undefined ? manifest.guides !== false : !!o.guides, showLabels = o.labels === undefined ? showGuides : !!o.labels;
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+round(W)+'mm" height="'+round(H)+'mm" viewBox="0 0 '+round(W)+' '+round(H)+'">');
    parts.push('<title>'+xml(manifest.name)+'</title><desc>Naqsh Studio — physical millimetres; catalog raster images preserve source pixels.</desc>');
    if (o.background !== null) { parts.push('<rect width="'+W+'" height="'+H+'" fill="'+xml(o.background || '#ffffff')+'"/>'); }
    for (i = 0; i < manifest.sections.length; i++) {
      s = manifest.sections[i]; sid = 'sectionClip'+i;
      defs.push('<clipPath id="'+sid+'" clipPathUnits="userSpaceOnUse"><polygon points="'+pointsString(s.points)+'"/></clipPath>');
      mirror = s.mirror ? 'translate('+s.widthMm+' 0) scale(-1 1)' : '';
      art.push('<g id="section-'+i+'" data-name="'+xml(s.name)+'" transform="translate('+s.xMm+' '+s.yMm+')"><g'+(mirror?' transform="'+mirror+'"':'')+' clip-path="url(#'+sid+')">');
      for (j = 0; j < s.layers.length; j++) {
        l = s.layers[j]; lid = 'regionClip'+i+'_'+j; r = l.region;
        defs.push('<clipPath id="'+lid+'" clipPathUnits="userSpaceOnUse"><rect x="'+round(r.xMm)+'" y="'+round(r.yMm)+'" width="'+round(r.widthMm)+'" height="'+round(r.heightMm)+'"/></clipPath>');
        art.push('<g data-name="'+xml(l.name)+'" clip-path="url(#'+lid+')">');
        for (k = 0; k < l.placements.length; k++) {
          p = l.placements[k]; href = map[p.code] || map[p.asset] || p.asset;
          imageId = '';
          for (z = 0; z < imageKeys.length; z++) { if (imageKeys[z] === p.code) { imageId = imageIds[z]; break; } }
          if (!imageId) {
            href = safeHref(href); imageId = 'motifImage'+imageKeys.length; imageKeys.push(p.code); imageIds.push(imageId);
            defs.push('<image id="'+imageId+'" x="-0.5" y="-0.5" width="1" height="1" preserveAspectRatio="none" xlink:href="'+xml(href)+'"/>');
          }
          transform = 'translate('+round(p.xMm+p.widthMm/2)+' '+round(p.yMm+p.heightMm/2)+') rotate('+round(p.rotation)+') scale('+round(p.widthMm*(p.mirrorX?-1:1))+' '+round(p.heightMm*(p.mirrorY?-1:1))+')';
          art.push('<use data-code="'+xml(p.code)+'" opacity="'+round(p.opacity)+'" transform="'+transform+'" xlink:href="#'+imageId+'"/>');
        }
        art.push('</g>');
      }
      art.push('</g></g>');
      if (showGuides) {
        guides.push('<g transform="translate('+s.xMm+' '+s.yMm+')">');
        guides.push('<polygon points="'+pointsString(s.points)+'"'+(mirror?' transform="'+mirror+'"':'')+' fill="none" stroke="#158779" stroke-width="0.25" stroke-dasharray="3 2"/>');
        guides.push('<path d="M -3 0 H -1 M 0 -3 V -1 M '+(s.widthMm+1)+' 0 H '+(s.widthMm+3)+' M '+s.widthMm+' -3 V -1 M -3 '+s.heightMm+' H -1 M 0 '+(s.heightMm+1)+' V '+(s.heightMm+3)+' M '+(s.widthMm+1)+' '+s.heightMm+' H '+(s.widthMm+3)+' M '+s.widthMm+' '+(s.heightMm+1)+' V '+(s.heightMm+3)+'" stroke="#333" stroke-width="0.2" fill="none"/>');
        if (showLabels) { guides.push('<text x="'+round(s.widthMm/2)+'" y="-2.5" text-anchor="middle" direction="rtl" font-family="Vazirmatn,Tahoma,sans-serif" font-size="3.2" fill="#3b4d4a">'+xml(s.name)+' · '+round(s.widthMm)+' × '+round(s.heightMm)+' mm</text>'); }
        guides.push('</g>');
      }
    }
    parts.push('<defs>'+defs.join('')+'</defs>');
    parts.push('<g id="artwork">'+art.join('')+'</g>');
    if (showGuides) { parts.push('<g id="cut-guides">'+guides.join('')+'</g>'); }
    parts.push('</svg>'); return parts.join('\n');
  }
  function makeSection(id, name, widthMm, heightMm, code) {
    return {id:String(id),name:String(name),widthMm:widthMm,heightMm:heightMm,quantity:1,shape:'rect',topWidthMm:widthMm*0.75,neckWidthMm:widthMm*0.3,neckDepthMm:heightMm*0.15,mirror:false,rotateOnSheet:false,layers:[{id:String(id)+'-l1',name:'نقش اصلی',code:code || '',enabled:true,xMm:0,yMm:0,widthMm:widthMm,heightMm:heightMm,mode:'repeatX',lockAspect:true,gapXmm:-0.2,gapYmm:-0.2,offsetXmm:0,offsetYmm:0,rotation:0,mirrorX:false,mirrorY:false,alternateX:false,alternateY:false,opacity:1}]};
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
    e=makeSection('gwatnam','گواتنام',180,220,G);e.layers[0].mode='contain';
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
    return {format:'naqsh-project',version:1,project:copy(project),library:{version:1,motifs:motifs},manifest:manifest,assets:assets};
  }
  return {version:'1.0.0',MAX_PLACEMENTS:MAX_PLACEMENTS,normalizeCode:normalizeCode,findMotif:findMotif,validateProject:validateProject,layout:layout,renderSvg:renderSvg,makeDefaultProject:makeDefaultProject,makeSection:makeSection,createExchange:createExchange,shapePoints:shapePoints};
}));
