/* Regression: labels created by renderSections/renderProperties must use current unit. */
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../web/app.js','utf8');
const engine=fs.readFileSync(__dirname+'/../shared/engine.js','utf8');
assert.doesNotMatch(source,/tileWidthMm:\s*100/);
assert.doesNotMatch(engine,/tileWidthMm:100/);
assert.match(engine,/motif && motif\.needsCalibration === true/);
assert.match(engine,/span = fw \+ \(count - 1\) \* sx; x = \(r\.widthMm - span\) \/ 2/);
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
