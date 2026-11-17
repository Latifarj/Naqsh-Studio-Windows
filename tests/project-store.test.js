'use strict';
const assert = require('node:assert/strict');
const ProjectStore = require('../shared/project-store.js');

function storageMock() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

function legacyProject(name = 'پروژه قدیمی') {
  return { version: 1, name, sheet: { widthMm: 300, heightMm: 200, marginMm: 10, gutterMm: 5 }, sections: [{ id: 's1', name: 'آستین', widthMm: 80, heightMm: 100, quantity: 1, layers: [] }] };
}

(async () => {
  const migrated = ProjectStore.migrate(legacyProject());
  assert.equal(migrated.format, 'naqsh-project');
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.project.version, 1);
  assert.equal(migrated.project.status, 'draft');
  assert.ok(migrated.createdAt);

  const exchange = ProjectStore.migrate({ format: 'naqsh-project', version: 1, project: legacyProject('تبادل'), library: { motifs: [{ code: 'P1' }] }, assets: { P1: 'data:image/png;base64,AA==' } });
  assert.equal(exchange.schemaVersion, 2);
  assert.equal(exchange.library.motifs[0].code, 'P1');
  assert.equal(exchange.assets.P1, 'data:image/png;base64,AA==');
  assert.throws(() => ProjectStore.migrate({ format: 'naqsh-project', schemaVersion: 99, project: legacyProject() }), /نسخهٔ جدیدتر/);
  assert.throws(() => ProjectStore.migrate({ format: 'naqsh-project', schemaVersion: 1, project: { sections: [] } }), /شیت/);

  const storage = storageMock();
  const store = ProjectStore.create({ indexedDB: null, storage });
  const projectId = 'project-1';
  await store.save(projectId, ProjectStore.makeEnvelope(legacyProject('اول')));
  await store.save(projectId, ProjectStore.makeEnvelope(legacyProject('دوم')));
  let record = await store.get(projectId);
  assert.equal(JSON.parse(record.data).project.name, 'دوم');
  assert.equal(record.versions.length, 1);
  assert.equal((await store.list())[0].name, 'دوم');
  const restored = await store.restore(projectId, 0);
  assert.equal(restored.project.name, 'اول');
  record = await store.get(projectId);
  assert.equal(JSON.parse(record.data).project.name, 'اول');
  assert.equal(record.versions.length, 2);
  await store.remove(projectId);
  assert.equal(await store.get(projectId), null);
  assert.equal((await store.list()).length, 0);
  let desktopRecord = null;
  const desktop = {
    async listProjects() { return desktopRecord ? [{ id: desktopRecord.id, name: JSON.parse(desktopRecord.data).project.name, versions: 0 }] : []; },
    async getProject(id) { return desktopRecord?.id === id ? desktopRecord : null; },
    async saveProject(id, payload) { desktopRecord = { id, data: JSON.stringify(payload), versions: [] }; return desktopRecord; },
    async removeProject(id) { if (desktopRecord?.id === id) desktopRecord = null; return true; }
  };
  const desktopStore = ProjectStore.create({ desktop });
  await desktopStore.save('project-beta', legacyProject('ذخیرهٔ ویندوز'));
  assert.equal(JSON.parse((await desktopStore.get('project-beta')).data).schemaVersion, 2);
  assert.equal((await desktopStore.list())[0].name, 'ذخیرهٔ ویندوز');
  await desktopStore.remove('project-beta');
  assert.equal(await desktopStore.get('project-beta'), null);
  console.log('PASS versioned migration and project-history tests');
})().catch(error => { console.error(error); process.exitCode = 1; });
