'use strict';

const { app, BrowserWindow, dialog, Menu, session, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const isPackaged = app.isPackaged;
let backend = null;
let appWindow = null;
let appUrl = null;
let isQuitting = false;
let backendClosePromise = null;
let backendStopPromise = null;
let quitCleanupStarted = false;
let allowQuit = false;
const PROJECT_ID = /^project-[a-z0-9]+$/;
const MAX_PROJECT_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_VERSIONS = 5;

function projectsDirectory() { return path.join(app.getPath('userData'), 'projects'); }
function projectFile(id) {
  if (typeof id !== 'string' || !PROJECT_ID.test(id)) throw new Error('شناسهٔ پروژه نامعتبر است.');
  return path.join(projectsDirectory(), `${id}.json`);
}
async function readProject(id) {
  try {
    const text = await fs.readFile(projectFile(id), 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_PROJECT_BYTES) throw new Error('فایل پروژه از سقف اندازه بیشتر است.');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function writeProjectAtomic(id, record) {
  const file = projectFile(id);
  const directory = projectsDirectory();
  await fs.mkdir(directory, { recursive: true });
  const text = JSON.stringify(record);
  if (Buffer.byteLength(text, 'utf8') > MAX_PROJECT_BYTES) throw new Error('حجم پروژه از سقف ۱۰۰ مگابایت بیشتر است؛ تصاویر بزرگ را کوچک کنید یا پروژه را به‌صورت فایل جدا نگه دارید.');
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' }); await fs.rename(temporary, file); }
  catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

function assertProjectIpc(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isAppUrl(event.senderFrame.url)) {
    throw new Error('درخواست ذخیره‌سازی از صفحهٔ معتبر نقش‌یار ارسال نشده است.');
  }
}

ipcMain.handle('naqsh:projects:list', async event => {
  assertProjectIpc(event);
  await fs.mkdir(projectsDirectory(), { recursive: true });
  const names = await fs.readdir(projectsDirectory());
  const records = await Promise.all(names.filter(name => PROJECT_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).map(name => readProject(name.slice(0, -5))));
  return records.filter(Boolean).map(record => ({ id: record.id, name: record.name, customerName: record.customerName, orderNumber: record.orderNumber, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, versions: (record.versions || []).length })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
});
ipcMain.handle('naqsh:projects:get', async (event, id) => { assertProjectIpc(event); return readProject(id); });
ipcMain.handle('naqsh:projects:save', async (event, id, payload) => {
  assertProjectIpc(event);
  if (!payload || payload.format !== 'naqsh-project' || Number(payload.schemaVersion) !== 2 || !payload.project || !Array.isArray(payload.project.sections) || !payload.project.sheet) throw new Error('ساختار نسخه‌بندی‌شدهٔ پروژه معتبر نیست.');
  const previous = await readProject(id);
  const data = JSON.stringify(payload);
  if (Buffer.byteLength(data, 'utf8') > MAX_PROJECT_BYTES) throw new Error('حجم پروژه از سقف ۱۰۰ مگابایت بیشتر است.');
  const versions = previous && Array.isArray(previous.versions) ? previous.versions.slice() : [];
  if (previous && previous.data !== data) { versions.push({ savedAt: previous.updatedAt, data: previous.data }); while (versions.length > MAX_PROJECT_VERSIONS) versions.shift(); }
  const p = payload.project;
  const record = { id, name: String(p.name || 'سفارش جدید'), customerName: String(p.customerName || ''), orderNumber: String(p.orderNumber || ''), status: String(p.status || 'draft'), createdAt: previous ? previous.createdAt : String(payload.createdAt || new Date().toISOString()), updatedAt: String(payload.updatedAt || new Date().toISOString()), data, versions };
  while (record.versions.length && Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_PROJECT_BYTES) record.versions.shift();
  await writeProjectAtomic(id, record);
  return record;
});
ipcMain.handle('naqsh:projects:remove', async (event, id) => { assertProjectIpc(event); try { await fs.unlink(projectFile(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } return true; });

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function terminateWindowsTree(child) {
  if (!child?.pid) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let killer;
    try {
      killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (_) {
      finish(false);
      return;
    }
    timer = setTimeout(() => finish(false), 5000);
    killer.once('error', () => finish(false));
    killer.once('close', code => finish(code === 0));
  });
}

function stopBackend() {
  if (backendStopPromise) return backendStopPromise;
  const child = backend;
  if (!child) return Promise.resolve();
  const closed = backendClosePromise || Promise.resolve();
  backendStopPromise = (async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        const treeStopped = await terminateWindowsTree(child);
        if (!treeStopped) {
          try { child.kill(); } catch (_) {}
        }
      } else {
        try { child.kill('SIGTERM'); } catch (_) {}
      }
      const stopped = await Promise.race([closed.then(() => true), delay(2000).then(() => false)]);
      if (!stopped) {
        if (process.platform === 'win32') await terminateWindowsTree(child);
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }
    await closed;
    if (backend === child) backend = null;
  })().finally(() => { backendStopPromise = null; });
  return backendStopPromise;
}

function backendCommand() {
  if (isPackaged) {
    const executable = path.join(process.resourcesPath, 'server', 'naqsh-server.exe');
    return { command: executable, args: ['--host', '127.0.0.1', '--port', '0'], cwd: process.resourcesPath };
  }

  const root = path.resolve(__dirname, '..');
  const server = path.join(root, 'server.py');
  if (process.env.NAQSH_PYTHON) {
    return { command: process.env.NAQSH_PYTHON, args: [server, '--host', '127.0.0.1', '--port', '0'], cwd: root };
  }
  if (process.platform === 'win32') {
    return { command: 'py', args: ['-3', server, '--host', '127.0.0.1', '--port', '0'], cwd: root };
  }
  return { command: 'python3', args: [server, '--host', '127.0.0.1', '--port', '0'], cwd: root };
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const spec = backendCommand();
    let output = '';
    let settled = false;
    let recentStderr = '';
    const timer = setTimeout(() => {
      stopBackend().finally(() => finish(new Error('راه‌اندازی سرویس محلی بیش از ۳۰ ثانیه طول کشید.')));
    }, 30000);
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(url);
    };

    try {
      backend = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
    } catch (error) {
      finish(error);
      return;
    }

    const child = backend;
    backendClosePromise = new Promise(resolve => {
      child.once('close', () => {
        if (backend === child) backend = null;
        backendClosePromise = null;
        resolve();
      });
    });
    backend.once('error', error => finish(new Error(`اجرای سرویس محلی ناموفق بود: ${error.message}`)));
    backend.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-12000);
      const match = output.match(/Naqsh Studio: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) finish(null, match[1]);
    });
    backend.stderr.on('data', chunk => { recentStderr = (recentStderr + chunk.toString()).slice(-5000); });
    backend.once('exit', (code, signal) => {
      if (!settled) finish(new Error(`سرویس محلی متوقف شد (${code ?? signal}). ${recentStderr}`));
      else if (!isQuitting && appWindow && !appWindow.isDestroyed()) {
        dialog.showErrorBox('نقش‌یار', 'سرویس محلی متوقف شد. برنامه بسته می‌شود.');
        app.quit();
      }
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok && (await response.json()).ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`سرویس محلی آماده نشد: ${lastError?.message || 'پاسخی دریافت نشد'}`);
}

function isAppUrl(value) {
  try {
    const url = new URL(value);
    const expected = new URL(appUrl);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === expected.port;
  } catch (_) {
    return false;
  }
}

function installDownloadDialog() {
  session.defaultSession.on('will-download', (event, item) => {
    if (!appWindow || appWindow.isDestroyed()) {
      item.cancel();
      return;
    }

    const fileName = item.getFilename();
    const extension = path.extname(fileName).toLowerCase();
    const filterName = ({ '.pdf': 'PDF', '.svg': 'SVG', '.json': 'JSON' })[extension];
    item.pause();
    dialog.showSaveDialog(appWindow, {
      title: 'ذخیرهٔ خروجی',
      defaultPath: path.join(app.getPath('downloads'), fileName),
      ...(filterName ? { filters: [{ name: filterName, extensions: [extension.slice(1)] }, { name: 'همهٔ فایل‌ها', extensions: ['*'] }] } : {})
    }).then(result => {
      if (result.canceled || !result.filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(result.filePath);
      item.resume();
    }).catch(() => item.cancel());
  });
}

async function createWindow() {
  appUrl = await startBackend();
  await waitForHealth(appUrl);
  Menu.setApplicationMenu(null);
  appWindow = new BrowserWindow({
    title: 'نقش‌یار',
    width: 1520,
    height: 980,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f0e8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  appWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  appWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  appWindow.once('ready-to-show', () => appWindow.show());
  await appWindow.loadURL(`${appUrl}/`);
}

app.whenReady().then(async () => {
  app.setName('Naqsh Studio 1.1 Beta');
  app.setPath('userData', path.join(app.getPath('appData'), 'Naqsh Studio 1.1 Beta'));
  app.setAppUserModelId('com.naqshstudio.desktop.beta');
  installDownloadDialog();
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('اجرای نقش‌یار ناموفق بود', error.message);
    app.quit();
  }
});

app.on('before-quit', event => {
  if (allowQuit) return;
  isQuitting = true;
  if (!backend) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  stopBackend().then(() => {
    allowQuit = true;
    app.quit();
  }).catch(error => {
    quitCleanupStarted = false;
    dialog.showErrorBox('بستن سرویس محلی ناموفق بود', error.message);
  });
});

app.on('window-all-closed', () => app.quit());
