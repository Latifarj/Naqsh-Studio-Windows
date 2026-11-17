(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.NaqshProjectStore = api; }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var FORMAT = 'naqsh-project';
  var SCHEMA_VERSION = 2;
  var APP_VERSION = '1.2.0-alpha.1';
  var DB_NAME = 'naqsh-studio-projects';
  var DB_VERSION = 1;
  var FALLBACK_KEY = 'naqsh-project-store-v2';
  var MAX_VERSIONS = 5;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function timestamp(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString(); }
  function projectOf(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ساختار فایل پروژه معتبر نیست.');
    var project = input.project && typeof input.project === 'object' ? input.project : input;
    if (!Array.isArray(project.sections) || !project.sheet || typeof project.sheet !== 'object') throw new Error('فایل باید شامل شیت و فهرست قطعات پروژه باشد.');
    return project;
  }
  function migrate(input, now) {
    var source = clone(input), isEnvelope = source.format === FORMAT && source.project && typeof source.project === 'object';
    var legacyExchange = source.format === FORMAT && source.project && typeof source.project === 'object';
    var schema = Number(source.schemaVersion || source.version || (isEnvelope ? 1 : 1));
    if (!Number.isInteger(schema) || schema < 1) throw new Error('شمارهٔ نسخهٔ فایل پروژه معتبر نیست.');
    if (schema > SCHEMA_VERSION) throw new Error('این پروژه با نسخهٔ جدیدتری از نقش‌یار ساخته شده و در این نسخه قابل ویرایش نیست.');
    var project = clone(projectOf(source));
    var createdAt = timestamp(source.createdAt || project.createdAt || now);
    var updatedAt = timestamp(source.updatedAt || project.updatedAt || createdAt);
    project.version = 1;
    project.createdAt = createdAt;
    project.updatedAt = updatedAt;
    project.customerName = String(project.customerName || (source.metadata && source.metadata.customerName) || '');
    project.orderNumber = String(project.orderNumber || (source.metadata && source.metadata.orderNumber) || '');
    project.status = String(project.status || (source.metadata && source.metadata.status) || 'draft');
    if (!/^(draft|approved|print-ready|delivered)$/.test(project.status)) project.status = 'draft';
    var result = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: String(source.appVersion || APP_VERSION),
      createdAt: createdAt,
      updatedAt: updatedAt,
      metadata: {
        customerName: project.customerName,
        orderNumber: project.orderNumber,
        status: project.status
      },
      project: project
    };
    if (legacyExchange || source.library) result.library = source.library || { version: 1, motifs: [] };
    if (source.assets && typeof source.assets === 'object') result.assets = source.assets;
    if (source.customAssets && typeof source.customAssets === 'object') result.customAssets = source.customAssets;
    if (source.manifest && typeof source.manifest === 'object') result.manifest = source.manifest;
    return result;
  }
  function envelope(project, options) {
    var opts = options || {}, p = clone(project), now = timestamp(opts.updatedAt || new Date().toISOString());
    var createdAt = timestamp(opts.createdAt || p.createdAt || now);
    p.version = 1;
    p.createdAt = createdAt;
    p.updatedAt = now;
    var metadata = {
      customerName: String(p.customerName || ''),
      orderNumber: String(p.orderNumber || ''),
      status: /^(draft|approved|print-ready|delivered)$/.test(p.status) ? p.status : 'draft'
    };
    p.status = metadata.status;
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      createdAt: createdAt,
      updatedAt: now,
      metadata: metadata,
      project: p
    };
  }
  function openDb(indexedDB) {
    return new Promise(function (resolve, reject) {
      var request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { reject(error); return; }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          var store = db.createObjectStore('projects', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('باز کردن پایگاه پروژه ناموفق بود.')); };
    });
  }
  function req(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('عملیات پایگاه پروژه ناموفق بود.')); };
    });
  }
  function create(options) {
    var opts = options || {};
    var idb = Object.prototype.hasOwnProperty.call(opts, 'indexedDB') ? opts.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var storage = Object.prototype.hasOwnProperty.call(opts, 'storage') ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    var desktop = Object.prototype.hasOwnProperty.call(opts, 'desktop') ? opts.desktop : (typeof globalThis !== 'undefined' ? globalThis.NaqshDesktopStore : null);
    var dbPromise = null;
    function getDb() {
      if (!idb) return Promise.reject(new Error('IndexedDB در دسترس نیست.'));
      if (!dbPromise) dbPromise = openDb(idb).catch(function (error) { dbPromise = null; throw error; });
      return dbPromise;
    }
    function fallbackRead() {
      if (!storage) return [];
      try { var parsed = JSON.parse(storage.getItem(FALLBACK_KEY) || '[]'); return Array.isArray(parsed) ? parsed : []; }
      catch (_) { return []; }
    }
    function fallbackWrite(records) {
      if (!storage) throw new Error('ذخیره‌سازی پروژه در این محیط در دسترس نیست.');
      try { storage.setItem(FALLBACK_KEY, JSON.stringify(records)); }
      catch (_) { throw new Error('فضای ذخیرهٔ محلی پر شده است؛ از «خروجی JSON تبادل» پشتیبان بگیرید.'); }
    }
    function idbGet(id) {
      return getDb().then(function (db) { return req(db.transaction('projects', 'readonly').objectStore('projects').get(id)); });
    }
    function idbList() {
      return getDb().then(function (db) { return req(db.transaction('projects', 'readonly').objectStore('projects').getAll()); });
    }
    function persist(record) {
      var serialized = JSON.stringify(record);
      return getDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').put(record);
          tx.oncomplete = function () { resolve(record); };
          tx.onerror = function () { reject(tx.error || new Error('ذخیرهٔ پروژه ناموفق بود.')); };
          tx.onabort = function () { reject(tx.error || new Error('ذخیرهٔ پروژه لغو شد.')); };
        });
      }).catch(function () {
        var records = fallbackRead();
        var index = records.findIndex(function (item) { return item.id === record.id; });
        if (index >= 0) records[index] = record; else records.push(record);
        fallbackWrite(records);
        return record;
      });
    }
    return {
      async list() {
        if (desktop) return desktop.listProjects();
        var records;
        try { records = await idbList(); } catch (_) { records = fallbackRead(); }
        return records.map(function (r) { return { id: r.id, name: r.name, customerName: r.customerName, orderNumber: r.orderNumber, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, versions: (r.versions || []).length }; }).sort(function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
      },
      async get(id) {
        if (desktop) return desktop.getProject(id);
        var record;
        try { record = await idbGet(id); } catch (_) { record = fallbackRead().find(function (item) { return item.id === id; }); }
        return record || null;
      },
      async save(id, payload) {
        if (!id) throw new Error('شناسهٔ پروژه تعیین نشده است.');
        var normalized = migrate(payload);
        if (desktop) return desktop.saveProject(id, normalized);
        var previous = await this.get(id);
        var data = JSON.stringify(normalized);
        var versions = previous && Array.isArray(previous.versions) ? previous.versions.slice() : [];
        if (previous && previous.data !== data) {
          versions.push({ savedAt: previous.updatedAt, data: previous.data });
          versions = versions.slice(-MAX_VERSIONS);
        }
        var createdAt = previous ? previous.createdAt : normalized.createdAt;
        var project = normalized.project;
        var record = {
          id: id,
          name: String(project.name || 'سفارش جدید'),
          customerName: project.customerName,
          orderNumber: project.orderNumber,
          status: project.status,
          createdAt: createdAt,
          updatedAt: normalized.updatedAt,
          data: data,
          versions: versions
        };
        return persist(record);
      },
      async remove(id) {
        if (desktop) return desktop.removeProject(id);
        try {
          var db = await getDb();
          await new Promise(function (resolve, reject) {
            var tx = db.transaction('projects', 'readwrite');
            tx.objectStore('projects').delete(id);
            tx.oncomplete = resolve;
            tx.onerror = function () { reject(tx.error); };
          });
        } catch (_) {
          fallbackWrite(fallbackRead().filter(function (item) { return item.id !== id; }));
        }
      },
      async restore(id, versionIndex) {
        var record = await this.get(id);
        if (!record || !Array.isArray(record.versions) || !record.versions[versionIndex]) throw new Error('نسخهٔ پشتیبان پیدا نشد.');
        var restored = migrate(JSON.parse(record.versions[versionIndex].data));
        await this.save(id, restored);
        return restored;
      },
      migrate: migrate,
      makeEnvelope: envelope,
      constants: { format: FORMAT, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, maxVersions: MAX_VERSIONS }
    };
  }
  return { create: create, migrate: migrate, makeEnvelope: envelope, constants: { format: FORMAT, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, maxVersions: MAX_VERSIONS } };
}));
