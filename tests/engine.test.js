'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../shared/engine.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS', name); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
const lib = {version:1,motifs:[
  {code:'P1',family:'P',asset:'assets/motifs/P1.png',widthMm:20,heightMm:10,pixelWidth:200,pixelHeight:100,needsCalibration:false},
  {code:'V006',family:'V',asset:'assets/motifs/V006.png',widthMm:5,heightMm:10,pixelWidth:50,pixelHeight:100,needsCalibration:false}
]};
function project() {
  const s=E.makeSection('s','آستین',30,20,'P1');
  s.layers[0].mode='single';s.layers[0].tileWidthMm=10;s.layers[0].tileHeightMm=5;
  return {version:1,name:'test',guides:false,sheet:{widthMm:100,heightMm:100,marginMm:5,gutterMm:5,autoHeight:false},sections:[s]};
}
function layer(p) {return p.sections[0].layers[0];}
function placements(p) {return E.layout(p,lib).sections[0].layers[0].placements;}
const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

test('Persian/Arabic digits and separators normalize',()=>{
 assert.equal(E.normalizeCode(' p-۱۷۷۵ '),'P1775');assert.equal(E.normalizeCode('V٠٠٦'),'V006');
});
test('leading zeros match but missing codes do not substitute',()=>{
 assert.equal(E.findMotif(lib,'v6').code,'V006');assert.equal(E.findMotif(lib,'P999'),null);
 const p=project();layer(p).code='P999';assert.throws(()=>E.layout(p,lib),/P999/);
});
test('garment-part catalog exposes the requested bilingual codes exactly',()=>{
 assert.deepEqual(E.garmentParts().map(p=>[p.code,p.nameFa]),[['Astin','آستین'],['tak','تک'],['Pan','پانچک'],['zih','زیح']]);
 assert.equal(E.getGarmentPart('آستین').kind,'astin');assert.equal(E.getGarmentPart('Pan').nameFa,'پانچک');assert.equal(E.getGarmentPart('sleeve-left').code,'Astin');assert.equal(E.getGarmentPart('unknown'),null);
});
test('millimetres and aspect ratio remain exact',()=>{
 const p=project();const a=placements(p)[0];
 assert.equal(a.widthMm,10);assert.equal(a.heightMm,5);assert.equal(a.xMm,10);assert.equal(a.yMm,7.5);
});
test('grid creates full region copies and optional alternation',()=>{
 const p=project();layer(p).mode='grid';layer(p).alternateX=true;layer(p).alternateY=true;
 const a=placements(p);assert.equal(a.length,20);assert.equal(a[0].mirrorX,true);assert.equal(a[1].mirrorX,false);assert.equal(a[4].mirrorY,true);
});
test('repetition is centered and offset shifts the centered phase',()=>{
 const p=project();layer(p).mode='repeatX';layer(p).offsetXmm=2;
 const a=placements(p);assert.equal(a.length,4);assert.deepEqual(a.map(x=>x.xMm),[-2.7,7.1,16.9,26.7]);
});
test('90 degree rotation uses rotated footprint for repeats',()=>{
 const p=project();layer(p).mode='grid';layer(p).rotation=90;
 const a=placements(p);assert.equal(a.length,21);assert.equal(a[0].widthMm,10);assert.equal(a[0].heightMm,5);assert.equal(a[0].rotation,90);
});
test('repeatY and cover are distinct',()=>{
 const p=project();layer(p).mode='repeatY';assert.equal(placements(p).length,5);
 layer(p).mode='cover';const a=placements(p)[0];assert.equal(a.widthMm,40);assert.equal(a.heightMm,20);
 layer(p).mode='contain';const b=placements(p)[0];assert.equal(b.widthMm,30);assert.equal(b.heightMm,15);
});
test('shelf packing duplicates with exact gutters and wraps',()=>{
 const p=project();p.sections[0].widthMm=40;p.sections[0].quantity=3;
 const a=E.layout(p,lib).sections;assert.deepEqual(a.map(s=>[s.xMm,s.yMm]),[[5,5],[50,5],[5,30]]);
});
test('manual section positioning is independent of shelf packing',()=>{
 const p=project();p.sections[0].positionMode='manual';p.sections[0].sheetXmm=60;p.sections[0].sheetYmm=70;
 const a=E.layout(p,lib).sections[0];assert.deepEqual([a.xMm,a.yMm],[60,70]);
});
test('manual placement preserves automatic cursor and maximum sheet extent',()=>{
 const p=project();p.sections[0].positionMode='manual';p.sections[0].sheetXmm=60;p.sections[0].sheetYmm=70;
 const automatic=clone(p.sections[0]);automatic.id='auto';automatic.positionMode='auto';p.sections.push(automatic);
 const m=E.layout(p,lib);assert.deepEqual(m.sections.map(s=>[s.xMm,s.yMm]),[[60,70],[5,5]]);
 p.sheet.autoHeight=true;const higher=clone(p.sections[0]);higher.id='higher';higher.sheetYmm=30;p.sections.push(higher);
 assert.equal(E.layout(p,lib).sheet.heightMm,95);
});
test('manual section positioning validates bounds, quantity, and overlap',()=>{
 const p=project();p.sections[0].positionMode='manual';p.sections[0].sheetXmm=0;p.sections[0].sheetYmm=5;assert.throws(()=>E.layout(p,lib),/داخل حاشیه/);
 const q=project();q.sections[0].positionMode='manual';q.sections[0].quantity=2;q.sections[0].sheetXmm=5;q.sections[0].sheetYmm=5;assert.throws(()=>E.layout(q,lib),/دقیقاً ۱/);
 const r=project();r.sections[0].positionMode='manual';r.sections[0].sheetXmm=5;r.sections[0].sheetYmm=5;const second=clone(r.sections[0]);second.id='s2';second.sheetXmm=20;second.sheetYmm=10;r.sections.push(second);assert.throws(()=>E.layout(r,lib),/هم‌پوشانی/);
});
test('numeric strings do not concatenate packing coordinates',()=>{
 const p=project();p.sections[0].widthMm='30';p.sections[0].heightMm='20';p.sections[0].quantity=2;
 const a=E.layout(p,lib).sections;assert.equal(a[1].xMm,40);assert.equal(a[0].widthMm,30);
});
test('optional 90 degree piece rotation fits the current shelf without rescaling',()=>{
 const p=project();p.sheet.widthMm=80;p.sheet.heightMm=120;p.sections[0].widthMm=40;p.sections[0].heightMm=20;
 const second=clone(p.sections[0]);second.id='s2';second.name='یقه';second.widthMm=60;second.heightMm=20;second.rotateOnSheet=true;p.sections.push(second);
 const m=E.layout(p,lib), placed=m.sections[1];assert.equal(placed.rotationOnSheet,90);assert.equal(placed.placedWidthMm,20);assert.equal(placed.placedHeightMm,60);assert.equal(placed.widthMm,60);
 const svg=E.renderSvg(m,{P1:data},{guides:true});assert(svg.includes('translate(70 5) rotate(90)'));
 assert.equal(m.nesting.method,'deterministic-shelf');assert.equal(m.nesting.sheetCount,1);assert(m.nesting.utilizationPercent>0);
});
test('piece rotation can satisfy remaining sheet height without scaling',()=>{
 const p=project();p.sheet.widthMm=100;p.sheet.heightMm=80;p.sections[0].widthMm=40;p.sections[0].heightMm=80;p.sections[0].rotateOnSheet=true;
 const placed=E.layout(p,lib).sections[0];assert.equal(placed.rotationOnSheet,90);assert.equal(placed.placedWidthMm,80);assert.equal(placed.placedHeightMm,40);
});
test('a wrapped piece keeps its unrotated orientation when it fits the new row',()=>{
 const p=project();p.sections[0].widthMm=50;p.sections[0].heightMm=20;const second=clone(p.sections[0]);second.id='s2';second.widthMm=50;second.heightMm=40;second.rotateOnSheet=true;p.sections.push(second);
 const placed=E.layout(p,lib).sections[1];assert.equal(placed.xMm,5);assert.equal(placed.rotationOnSheet,0);assert.equal(placed.placedWidthMm,50);
});
test('undersized sheets never silently rescale',()=>{
 const p=project();p.sections[0].widthMm=95;assert.throws(()=>E.layout(p,lib),/عرض/);
 const q=project();q.sheet.heightMm=20;assert.throws(()=>E.layout(q,lib),/ارتفاع/);q.sheet.autoHeight=true;assert.equal(E.layout(q,lib).sheet.heightMm,30);
});
test('bad dimensions and nonpositive repeat stride are rejected',()=>{
 const p=project();p.sections[0].widthMm=0;assert.throws(()=>E.layout(p,lib));
 const q=project();layer(q).mode='grid';layer(q).gapXmm=-10;assert.throws(()=>E.layout(q,lib),/گام/);
});
test('neck, trapezoid and custom polygon masks validate',()=>{
 const p=project();p.sections[0].shape='neck';assert(E.layout(p,lib).sections[0].points.length>30);
 p.sections[0].shape='trapezoid';p.sections[0].topWidthMm=20;assert.deepEqual(E.layout(p,lib).sections[0].points[0],[5,0]);
 p.sections[0].shape='polygon';p.sections[0].points=[[0,0],[31,0],[0,20]];assert.throws(()=>E.layout(p,lib),/چندضلعی/);
});
test('SVG embeds each source once and reuses native SVG references',()=>{
 const p=project();layer(p).mode='grid';const m=E.layout(p,lib);const svg=E.renderSvg(m,{P1:data},{guides:false});
 assert.equal((svg.match(/<image /g)||[]).length,1);assert.equal((svg.match(/<use /g)||[]).length,20);assert(svg.includes('width="100mm"'));assert(svg.includes('clipPath'));assert(!svg.includes('id="cut-guides"'));
 const vector='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
 assert(E.renderSvg(m,{P1:vector},{guides:false}).includes('data-raster="false"'));
});
test('technical profile marks the SVG, uses only black vector guides, and prints bilingual labels',()=>{
 const p=project(),m=E.layout(p,lib),svg=E.renderSvg(m,{P1:data},{profile:E.PRINT_PROFILE,guides:true,labels:true,background:'#ffffff'});
 assert(svg.includes('data-print-profile="technical-bw-v1"'));assert(svg.includes('stroke="#000000"'));assert(svg.includes('Astin'));assert(svg.includes('آستین'));
 assert(!svg.includes('#158779'));assert(!svg.includes('#3b4d4a'));assert(svg.includes('data-output-width-mm="10"'));assert(svg.includes('data-source-width-px="200"'));
});
test('print labels stay horizontal on rotated pieces and require at least 9 mm top margin',()=>{
 const p=project();p.sheet.widthMm=45;p.sheet.heightMm=50;p.sheet.marginMm=9;p.sections[0].rotateOnSheet=true;
 const m=E.layout(p,lib);assert.ok(m.sections[0].rotationOnSheet);
 const svg=E.renderSvg(m,{P1:data},{profile:E.PRINT_PROFILE,guides:true,labels:true});
 const labelGroup=svg.match(/<g id="cut-labels">([\s\S]*?)<\/g>/);assert(labelGroup);assert(labelGroup[1].includes('direction="ltr"'));assert(labelGroup[1].includes('direction="rtl"'));
 const shallow=project();shallow.sheet.marginMm=5;const check=E.productionCheck(shallow,lib);assert(!check.ready);assert(check.errors.some(e=>e.includes('۹ میلی‌متر')));
});
test('SVG escapes metadata and rejects external asset paths',()=>{
 const p=project();p.name='<script>alert(1)</script>';const m=E.layout(p,lib);const svg=E.renderSvg(m,{P1:data});assert(!svg.includes('<script>'));assert(svg.includes('&lt;script&gt;'));
 assert.throws(()=>E.renderSvg(m,{P1:'https://example.com/a.png'}),/دارایی/);
});
test('exchange is portable, contains used motifs only, and roundtrips',()=>{
 const p=project();const x=E.createExchange(p,lib,{P1:data});assert.equal(x.format,'naqsh-project');assert.equal(x.library.motifs.length,1);assert.equal(x.assets.P1,data);assert.deepEqual(E.layout(x.project,x.library),x.manifest);
 assert.throws(()=>E.createExchange(p,lib,{}),/جاسازی/);
});
test('layout does not mutate user project',()=>{const p=project(),before=clone(p);E.layout(p,lib);assert.deepEqual(p,before);});
test('placement guard stops accidental huge repeats',()=>{
 const p=project();layer(p).mode='grid';layer(p).tileWidthMm=0.2;layer(p).tileHeightMm=0.1;layer(p).gapXmm=0;layer(p).gapYmm=0;assert.throws(()=>E.layout(p,lib),/۱۰۰۰۰/);
});
test('new sections have no implicit 100 mm tile size and use 0.2 mm overlap',()=>{
 const s=E.makeSection('new','بخش',30,20,'P1');
 assert.equal(Object.hasOwn(s.layers[0],'tileWidthMm'),false);
 assert.equal(Object.hasOwn(s.layers[0],'tileHeightMm'),false);
 assert.equal(s.layers[0].gapXmm,-0.2);assert.equal(s.layers[0].gapYmm,-0.2);
});
test('unconfirmed catalog display dimensions do not become physical output dimensions',()=>{
 const unconfirmed={version:1,motifs:[{code:'U1',family:'P',asset:'assets/motifs/U1.png',widthMm:114.3,heightMm:38.1,pixelWidth:300,pixelHeight:100,needsCalibration:true}]};
 const s=E.makeSection('s','قطعه',30,20,'U1');
 const p={version:1,sheet:{widthMm:100,heightMm:100,marginMm:5,gutterMm:5},sections:[s]};
 assert.throws(()=>E.layout(p,unconfirmed),/ابعاد فیزیکی تأییدشده/);
 s.layers[0].tileWidthMm=12;
 const placed=E.layout(p,unconfirmed).sections[0].layers[0].placements[0];
 assert.equal(placed.widthMm,12);assert.equal(placed.heightMm,4);
});
test('production check blocks uncalibrated art and names raster/approval limitations',()=>{
 const p=project();const unconfirmed={version:1,motifs:[{code:'P1',asset:'assets/motifs/P1.png',needsCalibration:true,pixelWidth:200,pixelHeight:100}]};
 assert.equal(E.productionCheck(p,unconfirmed).ready,false);
 const readyProject=project();readyProject.sheet.marginMm=9;const ready=E.productionCheck(readyProject,lib);assert.equal(ready.ready,true);assert(ready.warnings.some(w=>w.includes('تأیید نهایی تولید')));assert(ready.warnings.some(w=>w.includes('CMYK')));
});
test('vector sources with no pixel metadata bypass PPI but keep calibration checks',()=>{
 const vectorLib={version:1,motifs:[{code:'P1',asset:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 50\"><path d=\"M0 0h100v50H0z\"/></svg>').toString('base64'),widthMm:20,heightMm:10,pixelWidth:0,pixelHeight:0,needsCalibration:false,codeVerified:true,associationReview:false}]};
 const vectorProject=project(); vectorProject.sheet.marginMm=9;
 const vectorReport=E.productionCheck(vectorProject,vectorLib);
 assert.equal(vectorReport.ready,true); assert(!vectorReport.errors.some(error=>error.includes('PPI')));
 const uncalibrated=clone(vectorLib); uncalibrated.motifs[0].needsCalibration=true;
 assert.equal(E.productionCheck(vectorProject,uncalibrated).ready,false);
});
test('technical preflight blocks missing bilingual labels and raster below 300 PPI',()=>{
 const p=project();p.sections[0].partKind='custom';p.sections[0].partCode='';p.sections[0].labelFa='';
 const report=E.productionCheck(p,lib);assert.equal(report.ready,false);assert(report.errors.some(x=>x.includes('کد انگلیسی')));
 const q=project();lib.motifs[0].pixelWidth=80;lib.motifs[0].pixelHeight=40;
 const low=E.productionCheck(q,lib);assert.equal(low.ready,false);assert(low.errors.some(x=>x.includes('حداقل ۳۰۰ PPI')));
 lib.motifs[0].pixelWidth=200;lib.motifs[0].pixelHeight=100;
});
test('100 percent scale-test SVG declares exact physical dimensions and a 100 mm line',()=>{
 const svg=E.renderPrintScaleSvg();assert(svg.includes('width="120mm" height="45mm"'));assert(svg.includes('M 10 25 H 110'));assert(svg.includes('۱۰۰ میلی‌متر'));
});
test('full garment demo includes the five verified part names',()=>{
 const p=E.makeDefaultProject(lib),m=E.layout(p,lib);assert.equal(p.sections.length,5);assert.equal(m.sections.length,8);assert.equal(p.sections.find(s=>s.name==='گواتنام').partCode,'Gwatnam');assert.equal(m.sections.find(s=>s.sourceId==='sleeve').partCode,'Astin');assert.equal(m.sections.find(s=>s.sourceId==='pan').partCode,'Pan');assert.equal(m.sheet.widthMm,2500);assert.equal(m.sheet.heightMm,1500);
});
test('Illustrator bundle is byte-identical to the shared engine',()=>{
 assert.equal(fs.readFileSync(require.resolve('../illustrator/lib/engine.js'),'utf8'),fs.readFileSync(require.resolve('../shared/engine.js'),'utf8'));
});
console.log(`\n${passed} engine tests passed.`);
