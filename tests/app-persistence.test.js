'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ProjectStore = require('../shared/project-store.js');

function node(overrides = {}) {
  return Object.assign({
    textContent: '',
    value: '',
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren() {},
    appendChild() {},
    options: [],
    children: []
  }, overrides);
}

function makeSvgDomRecorder() {
  const parsed = [];
  class SvgNode {
    constructor(tagName = 'svg', attributes = {}, children = []) { this.tagName = tagName; this._attributes = new Map(Object.entries(attributes)); this.children = children; }
    get attributes() { return [...this._attributes].map(([name, value]) => ({ name, value })); }
    getAttribute(name) { return this._attributes.has(name) ? this._attributes.get(name) : null; }
    setAttribute(name, value) { this._attributes.set(name, String(value)); }
    removeAttribute(name) { this._attributes.delete(name); }
    remove() {}
  }
  class StubDOMParser {
    parseFromString(text) {
      parsed.push(text);
      const match = /<svg\b([^>]*)>/i.exec(text);
      const attributes = {};
      (match?.[1] || '').replace(/([:\w-]+)\s*=\s*["']([^"']*)["']/g, (_, name, value) => { attributes[name] = value; return ''; });
      const imageMatch = /<image\b([^>]*)\/?\s*>/i.exec(text);
      const imageAttributes = {};
      (imageMatch?.[1] || '').replace(/([:\w-]+)\s*=\s*["']([^"']*)["']/g, (_, name, value) => { imageAttributes[name] = value; return ''; });
      const documentElement = new SvgNode('svg', attributes, imageMatch ? [new SvgNode('image', imageAttributes)] : []);
      return {
        documentElement,
        querySelector(selector) { return selector === 'parsererror' ? null : null; },
        querySelectorAll(selector) { return selector === '*' ? [documentElement] : []; }
      };
    }
  }
  class StubXMLSerializer {
    serializeToString(svg) {
      const attributes = svg.attributes.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ');
      const children = svg.children.map(child => {
        const childAttributes = child.attributes.map(attribute => `${attribute.name}="${attribute.value}"`).join(' ');
        return `<${child.tagName}${childAttributes ? ` ${childAttributes}` : ''}/>`;
      }).join('');
      return `<svg${attributes ? ` ${attributes}` : ''}>${children}</svg>`;
    }
  }
  return { parsed, DOMParser: StubDOMParser, XMLSerializer: StubXMLSerializer };
}

function makeContext() {
  const nodes = new Map([
    ['#projectList', node()],
    ['#projectSearch', node()],
    ['#toast', node()]
  ]);
  const local = new Map();
  const window = {
    __test: null,
    NaqshProjectStore: ProjectStore,
    setTimeout() { return 0; },
    clearTimeout() {},
    confirm() { return false; },
    addEventListener() {}
  };
  const document = {
    querySelector(selector) { return nodes.get(selector) || node(); },
    querySelectorAll() { return []; },
    createElement() { return node(); }
  };
  const svgDom = makeSvgDomRecorder();
  const context = {
    window,
    document,
    localStorage: {
      getItem(key) { return local.has(key) ? local.get(key) : null; },
      setItem(key, value) { local.set(key, String(value)); },
      removeItem(key) { local.delete(key); }
    },
    console,
    fetch: async () => ({ ok: false, status: 404 }),
    Intl,
    JSON,
    Date,
    Math,
    Promise,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout
    ,DOMParser: svgDom.DOMParser
    ,XMLSerializer: svgDom.XMLSerializer
    ,atob(value) { return Buffer.from(value, 'base64').toString('latin1'); }
    ,btoa(value) { return Buffer.from(value, 'latin1').toString('base64'); }
  };
  context.__svgDom = svgDom;
  return vm.createContext(context);
}

function loadApp() {
  const source = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  assert.match(source, /function cropSvg\(/, 'app must crop SVG through viewBox rather than canvas');
  assert.match(source, /isVector \? cropSvg\(/, 'SVG calibration must preserve vector data');
  assert.match(source, /safeDataImage/, 'SVG sanitization must retain only safe embedded raster data');
  const transformed = source.replace(
    "window.addEventListener('DOMContentLoaded', () => { bind(); load(); });",
    'window.__test = { state, projectPayload, mergeLibrary, saveLocal, cropSvg };'
  );
  assert.notEqual(transformed, source, 'the test transform must replace the final DOMContentLoaded registration');
  const context = makeContext();
  vm.runInContext(transformed, context, { filename: 'web/app.js' });
  assert.ok(context.window.__test, 'internal persistence helpers should be exposed by the in-memory transform');
  context.window.__test.__svgDom = context.__svgDom;
  return context.window.__test;
}

function project(name = 'پروژهٔ آزمون') {
  return {
    version: 1,
    name,
    sheet: { widthMm: 300, heightMm: 200, marginMm: 10, gutterMm: 5 },
    sections: []
  };
}

(async () => {
  const test = loadApp();
  const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><image href="data:image/png;base64,AAAA//=="/></svg>';
  const sourceData = `data:image/svg+xml;base64,${Buffer.from(sourceSvg, 'utf8').toString('base64')}`;
  const croppedData = test.cropSvg(sourceData, 10, 20, 50, 80, 100, 200);
  assert.equal(test.__svgDom.parsed[0], sourceSvg, 'cropSvg must decode the UTF-8 SVG data URI before parsing');
  assert.match(croppedData, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/, 'cropped SVG must remain a base64 data URI');
  const croppedSvg = Buffer.from(croppedData.split(',')[1], 'base64').toString('utf8');
  assert.match(croppedSvg, /viewBox="20 10 100 40"/, 'cropSvg must transform the source viewBox to the crop rectangle');
  assert.match(croppedSvg, /width="50"/, 'cropped SVG must carry the requested width');
  assert.match(croppedSvg, /height="80"/, 'cropped SVG must carry the requested height');
  assert.match(croppedSvg, /href="data:image\/png;base64,AAAA\/\/=="/, 'sanitization must retain validated safe data-image hrefs');
  const calibratedBuiltin = {
    code: 'BUILTIN-CALIBRATED',
    family: 'کالیبره‌شده',
    asset: 'assets/builtin.png',
    widthMm: 42,
    heightMm: 58,
    needsCalibration: false,
    physicalDimensionsReviewed: true,
    codeVerified: true,
    calibrationReviewedAt: '2026-11-17T00:00:00.000Z',
    calibrationOverride: {
      asset: 'data:image/png;base64,BUILTIN',
      widthMm: 42,
      heightMm: 58,
      crop: { x: 1, y: 2, width: 300, height: 400 }
    }
  };
  const existingCode = { code: 'EXISTING-CODE', family: 'قدیمی', asset: 'old.png', needsCalibration: true };
  test.state.library = { version: 1, motifs: [calibratedBuiltin, existingCode], sets: [] };
  test.state.customAssets = { 'CUSTOM-IMAGE': 'data:image/png;base64,CUSTOM' };
  test.state.project = project();
  test.state.projectId = 'project-persistence-test';
  test.state.store = { makeEnvelope: ProjectStore.makeEnvelope };

  const payload = test.projectPayload();
  const migrated = ProjectStore.migrate(payload);
  const migratedBuiltin = migrated.library.motifs.find(motif => motif.code === calibratedBuiltin.code);
  assert.deepEqual(migratedBuiltin, calibratedBuiltin, 'calibrated built-in motif metadata must survive payload migration');
  assert.equal(payload.customAssets['CUSTOM-IMAGE'], 'data:image/png;base64,CUSTOM');
  assert.ok(payload.library.motifs.some(motif => motif.code === calibratedBuiltin.code));

  test.mergeLibrary({ motifs: [{
    code: 'EXISTING-CODE',
    family: 'به‌روزشده',
    asset: 'data:image/png;base64,UPDATED',
    needsCalibration: false,
    widthMm: 31,
    heightMm: 47,
    calibrationOverride: { asset: 'data:image/png;base64,UPDATED' }
  }] });
  assert.deepEqual(test.state.library.motifs.find(motif => motif.code === 'EXISTING-CODE'), {
    code: 'EXISTING-CODE',
    family: 'به‌روزشده',
    asset: 'data:image/png;base64,UPDATED',
    needsCalibration: false,
    widthMm: 31,
    heightMm: 47,
    calibrationOverride: { asset: 'data:image/png;base64,UPDATED' }
  }, 'imported metadata for an existing code must update the built-in entry');

  let savedPayload;
  test.state.store = {
    makeEnvelope: ProjectStore.makeEnvelope,
    async save(id, value) { savedPayload = { id, value }; },
    async list() { return []; }
  };
  assert.equal(await test.saveLocal(false), true);
  assert.equal(savedPayload.id, 'project-persistence-test');
  assert.equal(savedPayload.value.format, 'naqsh-project');
  assert.equal(savedPayload.value.customAssets['CUSTOM-IMAGE'], 'data:image/png;base64,CUSTOM');

  test.state.store = {
    makeEnvelope: ProjectStore.makeEnvelope,
    async save() { throw new Error('simulated store failure'); },
    async list() { return []; }
  };
  assert.equal(await test.saveLocal(false), false, 'saveLocal must return false when the store rejects');

  console.log('PASS app persistence VM tests: calibrated metadata, custom assets, imported metadata merge, async save success/error');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
