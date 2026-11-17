/* Regression: labels created by renderSections/renderProperties must use current unit. */
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../web/app.js','utf8');
const engine=fs.readFileSync(__dirname+'/../shared/engine.js','utf8');
const html=fs.readFileSync(__dirname+'/../web/index.html','utf8');
assert.doesNotMatch(source,/tileWidthMm:\s*100/);
assert.doesNotMatch(engine,/tileWidthMm:100/);
assert.match(engine,/motif && motif\.needsCalibration === true/);
assert.match(engine,/span = fw \+ \(count - 1\) \* sx; x = \(r\.widthMm - span\) \/ 2/);
const engineContext={};vm.runInNewContext(engine,engineContext);
const normalize=source.match(/  function normalizeProject\(project\) \{[\s\S]*?\n  \}/);
assert(normalize,'normalizeProject exists');
const legacy={version:1,name:'قدیمی',sheet:{widthMm:100,heightMm:100},sections:[
  {id:'piece-1',name:'آستین راست',layers:[]},{id:'custom1',name:'حاشیه',layers:[]}
]};
const normalizeContext={legacy,clone:v=>JSON.parse(JSON.stringify(v)),uid:()=> 'generated',engine:()=>engineContext.NaqshEngine};
const normalized=vm.runInNewContext(normalize[0]+'\nnormalizeProject(legacy);',normalizeContext);
assert.equal(normalized.sections[0].partKind,'astin');assert.equal(normalized.sections[0].partCode,'Astin');assert.equal(normalized.sections[0].labelFa,'آستین');
assert.equal(normalized.sections[1].partKind,'custom');assert.equal(normalized.sections[1].partCode,'');assert.equal(normalized.sections[1].labelFa,'حاشیه');
for(const pair of [['astin','Astin / آستین'],['tak','tak / تک'],['pan','Pan / پانچک'],['zih','zih / زیح']])assert(html.includes(`value="${pair[0]}"`)&&html.includes(pair[1]));
assert(source.includes('profile: engine().PRINT_PROFILE'));
const fn=source.match(/  function renderAll\(\) \{[\s\S]*?\n  \}/);
assert(fn,'renderAll exists');
const labels=[{textContent:'mm'}],context={state:{unit:'cm'},$$:()=>labels,
  renderProjectMeta(){labels.forEach(n=>n.textContent='cm');},
  renderSections(){labels.push({textContent:'mm'});},renderLibrary(){},
  renderProperties(){labels.push({textContent:'mm'});},render(){}
};
vm.runInNewContext(fn[0]+'\nrenderAll();',context);
assert.equal(labels.length,3);assert(labels.every(n=>n.textContent==='cm'));
console.log('PASS fresh section/property labels match current display unit (1 regression test).');
