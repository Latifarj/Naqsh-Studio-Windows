'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, '1.2.0-alpha.1');
assert.equal(pkg.main, 'desktop/main.cjs');
assert.equal(pkg.scripts.desktop, 'electron .');
assert.equal(pkg.build.appId, 'com.naqshstudio.desktop.alpha');
assert.equal(pkg.build.productName, 'Naqsh Studio 1.2 Alpha');
assert(pkg.build.files.includes('desktop/preload.cjs'));
assert.match(pkg.scripts['dist:win'], /build:server.*electron-builder --win nsis --x64/);
assert.equal(pkg.build.extraResources[0].to, 'server/naqsh-server.exe');
assert.equal(pkg.build.win.target[0].target, 'nsis');

const mainPath = path.join(root, 'desktop/main.cjs');
const syntax = spawnSync(process.execPath, ['--check', mainPath], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
const preloadSyntax = spawnSync(process.execPath, ['--check', path.join(root, 'desktop/preload.cjs')], { encoding: 'utf8' });
assert.equal(preloadSyntax.status, 0, preloadSyntax.stderr || preloadSyntax.stdout);
const main = fs.readFileSync(mainPath, 'utf8');
assert.match(main, /127\.0\.0\.1/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /sandbox:\s*true/);
assert.match(main, /taskkill\.exe/);
assert.match(main, /String\(child\.pid\), '\/T', '\/F'/);
assert.match(main, /event\.preventDefault\(\)/);
assert.match(main, /await closed/);
assert.match(main, /appData.*Naqsh Studio 1\.2 Alpha/);
assert.match(main, /com\.naqshstudio\.desktop\.alpha/);
assert.match(main, /MAX_PROJECT_VERSIONS = 5/);
assert.match(main, /assertProjectIpc/);

const spec = fs.readFileSync(path.join(root, 'desktop/server.spec'), 'utf8');
assert.match(spec, /PROJECT_ROOT\s*=\s*Path\(SPECPATH\)\.resolve\(\)\.parent\s*$/m);
assert.doesNotMatch(spec, /Path\(SPECPATH\)\.resolve\(\)\.parent\.parent/);

const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-windows.yml'), 'utf8');
assert.match(workflow, /windows-2022/);
assert.match(workflow, /npm run dist:win/);
assert.match(workflow, /technical-sheet-v1/);
assert.match(workflow, /technical-bw-v1/);
assert.match(workflow, /actions\/upload-artifact@v4/);
console.log('desktop packaging configuration: ok');
