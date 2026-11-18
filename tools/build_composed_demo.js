#!/usr/bin/env node
/* Build a new, self-contained detailed sample without overwriting legacy demos. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const E = require(path.join(__dirname, '..', 'shared', 'engine.js'));
const root = path.resolve(__dirname, '..');
const library = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'library.json'), 'utf8'));
const project = E.makeDefaultProject(library);
const manifest = E.layout(project, library);
const assets = {};
for (const section of manifest.sections) {
  for (const layer of section.layers) {
    for (const placement of layer.placements) {
      if (assets[placement.code]) continue;
      const motif = E.findMotif(library, placement.code);
      const file = path.resolve(root, motif.asset);
      if (!file.startsWith(root + path.sep)) throw new Error(`Asset outside project: ${placement.code}`);
      assets[placement.code] = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    }
  }
}
const output = path.join(root, 'examples');
fs.mkdirSync(output, { recursive: true });
const exchange = E.createExchange(project, library, assets);
fs.writeFileSync(path.join(output, 'sample-composed-project.json'), `${JSON.stringify(project, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'sample-composed.naqsh.json'), `${JSON.stringify(exchange, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'sample-composed.svg'), `${E.renderSvg(manifest, assets, { guides: true, labels: true, background: '#ffffff' })}\n`);
const python = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const pythonArgs = process.platform === 'win32' && !process.env.PYTHON ? ['-3'] : [];
const rendered = spawnSync(python, [...pythonArgs, path.join(__dirname, 'render_composed_preview.py')], { cwd: root, stdio: 'inherit' });
if (rendered.error) throw rendered.error;
if (rendered.status !== 0) process.exit(rendered.status || 1);
console.log(JSON.stringify({
  files: ['sample-composed-project.json', 'sample-composed.naqsh.json', 'sample-composed.svg', 'sample-composed-preview.png', 'web/starter-preview.png'],
  sections: manifest.sections.length,
  placementCount: manifest.placementCount,
  motifCodes: Object.keys(assets),
  sheet: manifest.sheet
}, null, 2));
