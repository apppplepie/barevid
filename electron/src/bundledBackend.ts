/**
 * 启动/停止安装包内捆绑的 FastAPI（PyInstaller 生成的 barevid-api.exe）。
 * 与 scripts/work.ps1 一致使用 uvicorn，但通过环境变量注入 SQLite 与导出相关配置。
 */

import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { execSync } from 'child_process';
import { app } from 'electron';

/** 与主进程约定的本机 API 端口（勿与常见 8000 冲突） */
export const BUNDLED_API_PORT = 18080;

export interface BundledBackendHandle {
  kill: () => void;
}

function sqliteUrlForPath(absDbPath: string): string {
  const norm = absDbPath.replace(/\\/g, '/');
  // 与 engine 注释一致：绝对路径用 sqlite+aiosqlite:///<path>（含 Unix / 与 Windows C:/）
  return `sqlite+aiosqlite:///${norm}`;
}

export function resolveBundledBackendExe(): string | null {
  if (process.env.BAREVID_SKIP_BUNDLED_BACKEND === '1') {
    return null;
  }
  const name = process.platform === 'win32' ? 'barevid-api.exe' : 'barevid-api';
  const p = path.join(process.resourcesPath ?? '', 'barevid-api', name);
  if (fs.existsSync(p)) {
    return p;
  }
  return null;
}

function httpGetJson(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/**
 * 若本机端口上仍有可响应的旧 barevid-api（例如上次异常退出未随 Electron 退出），
 * 先结束占用进程，避免新实例继承不到新环境变量或端口冲突。
 */
export async function clearStaleBundledApiIfResponding(
  port: number = BUNDLED_API_PORT
): Promise<void> {
  try {
    await httpGetJson(`http://127.0.0.1:${port}/api/health`, 1500);
  } catch {
    return;
  }
  console.warn(
    `[barevid-api] 检测到 ${port} 上仍有进程响应 /api/health，尝试清理残留实例…`
  );
  if (process.platform === 'win32') {
    killWindowsProcessListeningOnPort(port);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** 解析 netstat -ano，结束监听指定端口的进程（Windows）。 */
function killWindowsProcessListeningOnPort(port: number): void {
  try {
    const out = execSync('netstat -ano', {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.includes('LISTENING')) continue;
      if (!t.includes(`:${port}`)) continue;
      const parts = t.split(/\s+/).filter(Boolean);
      const pid = parts[parts.length - 1];
      if (!/^\d+$/.test(pid)) continue;
      try {
        execSync(`taskkill /PID ${pid} /T /F`, {
          encoding: 'utf-8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        console.warn(`[barevid-api] 已结束占用端口 ${port} 的进程 PID=${pid}`);
      } catch {
        /* 可能已退出或权限不足 */
      }
      return;
    }
  } catch (e) {
    console.warn('[barevid-api] killWindowsProcessListeningOnPort', e);
  }
}

/** 轮询直到 /api/health 可用 */
export async function waitForBundledApiReady(
  port: number,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const intervalMs = opts?.intervalMs ?? 400;
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      await httpGetJson(url, 3000);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(
    `捆绑后端在 ${timeoutMs}ms 内未就绪（${String(lastErr)}）`
  );
}

export interface StartBundledBackendParams {
  /** Electron 本地 Express 端口（供 EXPORT_FRONTEND_URL） */
  expressPort: number;
  /** 与后端 EXPORT_WORKER_TOKEN 一致 */
  exportWorkerToken: string;
  apiPort?: number;
  /** 与 FastAPI Settings 一致，经环境变量注入（见 backend/app/config.py） */
  apiSecrets?: {
    deepseekApiKey?: string;
    doubaoTtsAppId?: string;
    doubaoTtsAccessToken?: string;
  };
}

/**
 * 启动子进程；调用方应在 bootstrap 中先选定 expressPort，再传此处。
 */
export function startBundledBackend(
  exePath: string,
  params: StartBundledBackendParams
): BundledBackendHandle {
  const apiPort = params.apiPort ?? BUNDLED_API_PORT;
  const userData = app.getPath('userData');
  const dbFile = path.join(userData, 'slideforge.db');
  const storageRoot = path.join(userData, 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });

  const databaseUrl = sqliteUrlForPath(dbFile);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const feOrigin = `http://127.0.0.1:${params.expressPort}`;

  const sk = params.apiSecrets;
  const env = {
    ...process.env,
    BAREVID_API_PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    STORAGE_ROOT: storageRoot,
    EXPORT_API_URL: apiOrigin,
    EXPORT_PUBLIC_BASE_URL: apiOrigin,
    EXPORT_FRONTEND_URL: feOrigin,
    EXPORT_WORKER_TOKEN: params.exportWorkerToken,
    SLIDEFORGE_WORKER_KEY: params.exportWorkerToken,
    SLIDEFORGE_PUBLIC_BASE_URL: apiOrigin,
    /** 显式写入（含空串）避免子进程继承 shell 里残留的同名变量 */
    ...(sk
      ? {
          DEEPSEEK_API_KEY: (sk.deepseekApiKey ?? '').trim(),
          DOUBAO_TTS_APP_ID: (sk.doubaoTtsAppId ?? '').trim(),
          DOUBAO_TTS_ACCESS_TOKEN: (sk.doubaoTtsAccessToken ?? '').trim(),
        }
      : {}),
  };

  const child = cp.spawn(exePath, [], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logLine = (buf: Buffer, stream: 'stdout' | 'stderr') => {
    const s = buf.toString().trimEnd();
    if (!s) return;
    console.log(`[barevid-api ${stream}]`, s);
  };
  child.stdout?.on('data', (d) => logLine(d, 'stdout'));
  child.stderr?.on('data', (d) => logLine(d, 'stderr'));

  child.on('error', (err) => {
    console.error('[barevid-api] spawn error', err);
  });

  return {
    kill: () => {
      if (child.pid && process.platform === 'win32') {
        cp.exec(`taskkill /pid ${child.pid} /T /F`, () => {});
      } else {
        child.kill('SIGTERM');
      }
    },
  };
}
