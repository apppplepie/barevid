/**
 * main.ts
 * Electron 主进程入口。
 *
 * 启动流程：
 *   1. 读/写本地配置（后端 URL、worker key 等）
 *   2. 检测 ffmpeg / Python / Playwright Chromium
 *   3. 如果 Chromium 缺失 → 显示安装进度窗口，安装完毕后继续
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

import {
  runChecks,
  installChromium,
  resolveFfmpeg,
  resolvePython,
} from './checker';
import { startLocalServer } from './server';
import { ExportManager } from './export';

// ── 配置文件 ─────────────────────────────────────────────────────────────────

interface AppConfig {
  backendUrl: string;  // 云端后端，如 https://api.barevid.com
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig(): AppConfig {
  const defaults: AppConfig = {
    backendUrl: 'http://127.0.0.1:8000',
  };
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return { ...defaults, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return defaults;
  }
}

function saveConfig(cfg: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── 全局状态 ─────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
let localPort: number | null = null;

// ── App 生命周期 ──────────────────────────────────────────────────────────────

app.whenReady().then(bootstrap).catch((err) => {
  dialog.showErrorBox('启动失败', String(err));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

  // 1. 检测依赖
  const checks = await runChecks();

  if (checks.errors.length > 0) {
    const msg = checks.errors.join('\n');
    const choice = await dialog.showMessageBox({
      type: 'warning',
      title: '依赖缺失',
      message: '部分依赖未就绪，导出功能将不可用：\n\n' + msg,
      buttons: ['仍然启动', '退出'],
      defaultId: 0,
    });
    if (choice.response === 1) {
      app.quit();
      return;
    }
  }

  // 2. 如果 Chromium 缺失，弹安装进度窗口
  if (!checks.chromiumReady && checks.python) {
    await showSetupAndInstall(checks.python);
  }

  // 3. 准备 ExportManager
  const ffmpeg = resolveFfmpeg() ?? 'ffmpeg';
  const python = resolvePython() ?? 'python';
  const exportScript = resolveExportScript();

  const exportManager = new ExportManager({
    ffmpegPath: ffmpeg,
    pythonOrWorker: python,
    exportScript,
    frontendUrl: `http://127.0.0.1:__PORT__`, // 稍后替换
    backendUrl: cfg.backendUrl,
  });

  // 4. 启动本地 server
  const srv = await startLocalServer(cfg.backendUrl, exportManager);
  localPort = srv.port;

  // 把真实端口注入 exportManager（用于 Playwright 录制本地前端）
  (exportManager as any).frontendUrl = `http://127.0.0.1:${localPort}`;

  // 5. 打开主窗口
  createMainWindow(localPort);

  // 6. 注册 IPC handlers
  registerIpc(cfg, exportManager);
}

// ── 安装进度窗口 ──────────────────────────────────────────────────────────────

function showSetupAndInstall(python: string): Promise<void> {
  return new Promise((resolve) => {
    setupWindow = new BrowserWindow({
      width: 540,
      height: 360,
      resizable: false,
      title: 'Barevid – 首次初始化',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const html = buildSetupHtml();
    setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    setupWindow.setMenu(null);

    setupWindow.webContents.once('did-finish-load', async () => {
      const send = (msg: string) => {
        setupWindow?.webContents.executeJavaScript(
          `document.getElementById('log').textContent += ${JSON.stringify(msg + '\n')};` +
          `document.getElementById('log').scrollTop = document.getElementById('log').scrollHeight;`
        ).catch(() => {});
      };

      send('正在安装 Playwright Chromium，首次约需下载 150MB...');

      try {
        await installChromium(python, (line) => send(line.trimEnd()));
        send('\n✅ Chromium 安装完成，正在启动应用...');
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err) {
        send(`\n❌ 安装失败：${err}`);
        await dialog.showMessageBox(setupWindow!, {
          type: 'error',
          title: '安装失败',
          message: `Playwright Chromium 安装失败：\n${err}\n\n导出功能不可用。`,
          buttons: ['继续'],
        });
      } finally {
        setupWindow?.close();
        setupWindow = null;
        resolve();
      }
    });
  });
}

function buildSetupHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>初始化</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d1117; color: #e6edf3; font-family: 'Segoe UI', system-ui, sans-serif;
         display: flex; flex-direction: column; height: 100vh; padding: 24px; }
  h2 { font-size: 1rem; font-weight: 600; margin-bottom: 8px; color: #58a6ff; }
  p  { font-size: 0.8rem; color: #8b949e; margin-bottom: 16px; }
  #log { flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 6px;
         padding: 12px; font-family: monospace; font-size: 0.75rem; line-height: 1.6;
         white-space: pre-wrap; overflow-y: auto; color: #c9d1d9; }
</style>
</head>
<body>
  <h2>⚙️ 首次初始化</h2>
  <p>正在准备视频渲染所需的 Chromium 浏览器，仅需执行一次。</p>
  <div id="log">请稍候...</div>
</body>
</html>`;
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

  ipcMain.handle(
    'export:start',
    (_e, { projectId, params }: { projectId: number; params?: Record<string, unknown> }) => {
      return exportManager.enqueue(projectId, params ?? {});
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
