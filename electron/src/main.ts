/**
 * main.ts
 * Electron 主进程入口。
 *
 * 启动流程：
 *   1. 读/写本地配置（后端 URL、worker key 等）
 *   2. ffmpeg / Playwright Chromium 由用户按需自行安装；仅在导出时检测并提示
 *   3. 若 resources/barevid-api/barevid-api.exe 存在 → 启动捆绑 FastAPI（SQLite 在 userData）
 *   4. 启动本地 HTTP server（前端静态文件 + API 代理 + 导出拦截）
 *   5. 打开主窗口加载 http://127.0.0.1:<port>
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  Menu,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomBytes } from 'crypto';

import { resolveFfmpeg, resolvePython } from './checker';
import {
  startLocalServer,
  getFreePort,
} from './server';
import {
  BUNDLED_API_PORT,
  resolveBundledBackendExe,
  startBundledBackend,
  waitForBundledApiReady,
  type BundledBackendHandle,
} from './bundledBackend';
import { ExportManager } from './export';

// ── 配置文件 ─────────────────────────────────────────────────────────────────

interface AppConfig {
  backendUrl: string;  // 云端后端，如 https://api.barevid.com
  /** 与 SlideForge EXPORT_WORKER_TOKEN 一致；捆绑后端时必填 */
  exportWorkerToken?: string;
  /** 与 backend DEEPSEEK_API_KEY 等一致；另有一份 api-secrets.env 供手动编辑 */
  deepseekApiKey?: string;
  doubaoTtsAppId?: string;
  doubaoTtsAccessToken?: string;
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

/** 与 config.json 同目录，KEY=value 形式；存在时覆盖 json 里同名三项（便于记事本编辑） */
function secretsEnvPath(): string {
  return path.join(app.getPath('userData'), 'api-secrets.env');
}

function parseDotEnvContent(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function readSecretsEnvOverlay(): Partial<
  Pick<AppConfig, 'deepseekApiKey' | 'doubaoTtsAppId' | 'doubaoTtsAccessToken'>
> {
  const p = secretsEnvPath();
  if (!fs.existsSync(p)) return {};
  try {
    const parsed = parseDotEnvContent(fs.readFileSync(p, 'utf-8'));
    const o: Partial<
      Pick<AppConfig, 'deepseekApiKey' | 'doubaoTtsAppId' | 'doubaoTtsAccessToken'>
    > = {};
    if (Object.prototype.hasOwnProperty.call(parsed, 'DEEPSEEK_API_KEY')) {
      o.deepseekApiKey = parsed.DEEPSEEK_API_KEY ?? '';
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'DOUBAO_TTS_APP_ID')) {
      o.doubaoTtsAppId = parsed.DOUBAO_TTS_APP_ID ?? '';
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'DOUBAO_TTS_ACCESS_TOKEN')) {
      o.doubaoTtsAccessToken = parsed.DOUBAO_TTS_ACCESS_TOKEN ?? '';
    }
    return o;
  } catch {
    return {};
  }
}

function formatEnvLine(key: string, value: string): string {
  if (value === '') return `${key}=`;
  if (/^[\w.@+-]+$/.test(value)) return `${key}=${value}`;
  return `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function writeSecretsEnvFile(cfg: AppConfig): void {
  const body = [
    '# Barevid 桌面端 — DeepSeek 与豆包语音；与设置界面同步。',
    '# 修改后请重启应用，捆绑后端 barevid-api 才会加载新密钥。',
    formatEnvLine('DEEPSEEK_API_KEY', cfg.deepseekApiKey ?? ''),
    formatEnvLine('DOUBAO_TTS_APP_ID', cfg.doubaoTtsAppId ?? ''),
    formatEnvLine('DOUBAO_TTS_ACCESS_TOKEN', cfg.doubaoTtsAccessToken ?? ''),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(secretsEnvPath()), { recursive: true });
  fs.writeFileSync(secretsEnvPath(), body, 'utf-8');
}

function loadConfig(): AppConfig {
  const defaults: AppConfig = {
    backendUrl: 'http://127.0.0.1:8000',
  };
  let base: AppConfig;
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    base = { ...defaults, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    base = { ...defaults };
  }
  return { ...base, ...readSecretsEnvOverlay() };
}

function saveConfig(cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
  writeSecretsEnvFile(cfg);
}

function ensureExportWorkerToken(cfg: AppConfig): string {
  const cur = (cfg.exportWorkerToken ?? '').trim();
  if (cur.length >= 16) {
    return cur;
  }
  const token = randomBytes(24).toString('hex');
  cfg.exportWorkerToken = token;
  saveConfig(cfg);
  return token;
}

// ── 全局状态 ─────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let localPort: number | null = null;
let bundledBackendHandle: BundledBackendHandle | null = null;

// ── App 生命周期 ──────────────────────────────────────────────────────────────

app.whenReady().then(bootstrap).catch((err) => {
  dialog.showErrorBox('启动失败', String(err));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (bundledBackendHandle) {
    bundledBackendHandle.kill();
    bundledBackendHandle = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && localPort) {
    createMainWindow(localPort);
  }
});

// ── 启动流程 ──────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(buildMenu());

  const cfg = loadConfig();
  let backendUrl = cfg.backendUrl;

  // 占端口并启动捆绑后端，缩短「端口已分配但未监听」的窗口
  const bundledExe = resolveBundledBackendExe();
  const expressListenPort = await getFreePort();

  if (bundledExe) {
    const token = ensureExportWorkerToken(cfg);
    bundledBackendHandle = startBundledBackend(bundledExe, {
      expressPort: expressListenPort,
      exportWorkerToken: token,
      apiPort: BUNDLED_API_PORT,
      apiSecrets: {
        deepseekApiKey: cfg.deepseekApiKey,
        doubaoTtsAppId: cfg.doubaoTtsAppId,
        doubaoTtsAccessToken: cfg.doubaoTtsAccessToken,
      },
    });
    backendUrl = `http://127.0.0.1:${BUNDLED_API_PORT}`;
    cfg.backendUrl = backendUrl;
    saveConfig(cfg);
    try {
      await waitForBundledApiReady(BUNDLED_API_PORT);
    } catch (e) {
      bundledBackendHandle.kill();
      bundledBackendHandle = null;
      dialog.showErrorBox(
        '后端启动失败',
        `无法连接捆绑的 API（${backendUrl}）。请确认已按 electron/scripts/build-backend.ps1 构建 barevid-api.exe 并放入 resources/barevid-api/。\n\n${String(e)}`
      );
      app.quit();
      return;
    }
  } else if (backendUrlConflictsWithExpressPort(backendUrl, expressListenPort)) {
    dialog.showErrorBox(
      '后端地址配置错误',
      `当前「后端 URL」(${backendUrl}) 与 Electron 本地页面端口（${expressListenPort}）相同，API 请求会代理到自己，导致注册/登录失败。\n\n` +
        '请把后端改为 FastAPI 地址，例如：http://127.0.0.1:8000（或捆绑后端 http://127.0.0.1:18080），\n' +
        '并先在本机启动 uvicorn / barevid-api。\n\n' +
        '可删除用户目录下的 config.json 中的 backendUrl 后重试。'
    );
    app.quit();
    return;
  }

  // 2. 准备 ExportManager
  const ffmpeg = resolveFfmpeg() ?? 'ffmpeg';
  const python = resolvePython() ?? 'python';
  const exportScript = resolveExportScript();

  const exportManager = new ExportManager({
    ffmpegPath: ffmpeg,
    pythonOrWorker: python,
    exportScript,
    frontendUrl: `http://127.0.0.1:__PORT__`, // 稍后替换
    backendUrl,
  });

  // 3. 启动本地 server（端口需与捆绑后端的 EXPORT_FRONTEND_URL 一致）
  const srv = await startLocalServer(backendUrl, exportManager, {
    listenPort: expressListenPort,
  });
  localPort = srv.port;

  // 把真实端口注入 exportManager（用于 Playwright 录制本地前端）
  (exportManager as any).frontendUrl = `http://127.0.0.1:${localPort}`;

  // 4. 打开主窗口
  createMainWindow(localPort);

  // 5. 注册 IPC handlers
  registerIpc(cfg, exportManager);
}

// ── 主窗口 ────────────────────────────────────────────────────────────────────

function createMainWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Barevid',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 允许本地 server 的内容访问剪贴板等
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接在默认浏览器里打开，不在 Electron 窗口内跳转
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

function registerIpc(cfg: AppConfig, exportManager: ExportManager): void {
  ipcMain.handle('cfg:getBackendUrl', () => cfg.backendUrl);

  ipcMain.handle(
    'cfg:setBackendUrl',
    (_e, url: string) => {
      cfg.backendUrl = url;
      saveConfig(cfg);
    }
  );

  ipcMain.handle('cfg:getApiSecrets', () => {
    const m = loadConfig();
    return {
      deepseekApiKey: m.deepseekApiKey ?? '',
      doubaoTtsAppId: m.doubaoTtsAppId ?? '',
      doubaoTtsAccessToken: m.doubaoTtsAccessToken ?? '',
    };
  });

  ipcMain.handle(
    'cfg:setApiSecrets',
    (
      _e,
      s: {
        deepseekApiKey?: string;
        doubaoTtsAppId?: string;
        doubaoTtsAccessToken?: string;
      }
    ) => {
      cfg.deepseekApiKey = s.deepseekApiKey ?? '';
      cfg.doubaoTtsAppId = s.doubaoTtsAppId ?? '';
      cfg.doubaoTtsAccessToken = s.doubaoTtsAccessToken ?? '';
      saveConfig(cfg);
    }
  );

  ipcMain.handle('cfg:openSecretsEnvFile', () => {
    const p = secretsEnvPath();
    shell.openPath(p);
  });

  ipcMain.handle('cfg:revealUserDataFolder', () => {
    shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle(
    'export:start',
    (
      _e,
      {
        projectId,
        params,
        authorization,
      }: {
        projectId: number;
        params?: Record<string, unknown>;
        authorization?: string;
      }
    ) => {
      return exportManager.enqueue(projectId, params ?? {}, {
        authorization,
      });
    }
  );

  ipcMain.handle('export:cancel', (_e, { projectId }: { projectId: number }) => {
    return exportManager.cancel(projectId);
  });

  ipcMain.handle('export:openOutputDir', () => {
    const dir = path.join(os.homedir(), 'Videos', 'Barevid');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });
}

// ── 菜单 ──────────────────────────────────────────────────────────────────────

function buildMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: 'API 密钥与语音服务…',
          click: () => {
            mainWindow?.webContents.send('open-api-secrets');
          },
        },
        {
          label: '打开导出目录',
          click: () => {
            const dir = path.join(os.homedir(), 'Videos', 'Barevid');
            fs.mkdirSync(dir, { recursive: true });
            shell.openPath(dir);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Barevid',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'Barevid',
              message: `Barevid Desktop\n版本 ${app.getVersion()}\n\n视频输出目录：\n${path.join(os.homedir(), 'Videos', 'Barevid')}`,
            });
          },
        },
      ],
    },
  ]);
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** 后端 URL 误填成与 Electron 本地 HTTP 同一端口时，代理会打到页面服务自身 */
function backendUrlConflictsWithExpressPort(
  apiUrlStr: string,
  expressPort: number
): boolean {
  try {
    const u = new URL(apiUrlStr);
    const h = u.hostname.toLowerCase();
    if (h !== '127.0.0.1' && h !== 'localhost') {
      return false;
    }
    const port = u.port
      ? Number(u.port)
      : u.protocol === 'https:'
        ? 443
        : 80;
    return port === expressPort;
  } catch {
    return false;
  }
}

function resolveExportScript(): string {
  // 打包后 worker.exe 不需要指向 .py 文件
  const workerExe = path.join(process.resourcesPath ?? '', 'worker.exe');
  if (fs.existsSync(workerExe)) return workerExe;

  // 开发时找源码
  const candidates = [
    path.resolve(__dirname, '../../worker/export_video.py'),
    path.join(app.getAppPath(), '../worker/export_video.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'export_video.py';
}
