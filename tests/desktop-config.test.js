'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.main, 'desktop/main.cjs');
assert.equal(pkg.scripts.desktop, 'electron .');
assert.match(pkg.scripts['dist:win'], /build:server.*electron-builder --win nsis --x64/);
assert.equal(pkg.build.extraResources[0].to, 'server/naqsh-server.exe');
assert.equal(pkg.build.win.target[0].target, 'nsis');

const mainPath = path.join(root, 'desktop/main.cjs');
const syntax = spawnSync(process.execPath, ['--check', mainPath], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
const main = fs.readFileSync(mainPath, 'utf8');
assert.match(main, /127\.0\.0\.1/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /sandbox:\s*true/);
assert.match(main, /taskkill\.exe/);
assert.match(main, /String\(child\.pid\), '\/T', '\/F'/);
assert.match(main, /event\.preventDefault\(\)/);
assert.match(main, /await closed/);

const spec = fs.readFileSync(path.join(root, 'desktop/server.spec'), 'utf8');
assert.match(spec, /PROJECT_ROOT\s*=\s*Path\(SPECPATH\)\.resolve\(\)\.parent\s*$/m);
assert.doesNotMatch(spec, /Path\(SPECPATH\)\.resolve\(\)\.parent\.parent/);

const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-windows.yml'), 'utf8');
assert.match(workflow, /windows-2022/);
assert.match(workflow, /npm run dist:win/);
assert.match(workflow, /actions\/upload-artifact@v4/);
console.log('desktop packaging configuration: ok');
