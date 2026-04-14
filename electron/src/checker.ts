/**
 * checker.ts
 * 首次启动时检测 Playwright Chromium、ffmpeg、Python 是否可用。
 * 如果 Chromium 缺失，自动触发 `playwright install chromium`。
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

export interface CheckResult {
  ok: boolean;
  ffmpeg: string | null;
  python: string | null;
  chromiumReady: boolean;
  errors: string[];
}

/** Playwright 把浏览器装在这里，我们把它固定到 appData 下统一管理 */
export function getBrowsersPath(): string {
  return path.join(app.getPath('appData'), 'barevid', 'browsers');
}

/** 在打包产物里找 ffmpeg.exe，找不到再找 PATH */
export function resolveFfmpeg(): string | null {
  // 打包后在 extraResources 里
  const bundled = path.join(process.resourcesPath ?? '', 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;

  // 开发环境：找 PATH
  const which = tryWhich('ffmpeg');
  return which;
}

/** 找 Python 可执行文件：bundled worker.exe > python3 > python */
export function resolvePython(): string | null {
  // 打包后用 PyInstaller 生成的 worker.exe（不需要 Python）
  const workerExe = path.join(process.resourcesPath ?? '', 'worker.exe');
  if (fs.existsSync(workerExe)) return workerExe;

  // 开发环境找系统 Python
  return tryWhich('python3') ?? tryWhich('python');
}

/** 检查 Playwright Chromium 是否已安装 */
export function isChromiumInstalled(): boolean {
  const browsersPath = getBrowsersPath();
  if (!fs.existsSync(browsersPath)) return false;

  // Playwright 在 browsers/ 下建形如 chromium-XXXX 的目录
  const entries = fs.readdirSync(browsersPath);
  return entries.some((e) => e.startsWith('chromium'));
}

/**
 * 安装 Playwright Chromium。
 * @param onData 实时日志回调，用于展示进度。
 */
export function installChromium(
  python: string,
  onData: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const browsersPath = getBrowsersPath();
    fs.mkdirSync(browsersPath, { recursive: true });

    // 如果是 PyInstaller worker.exe，它内置了 playwright
    // 如果是普通 python，直接用 -m playwright
    const isWorkerExe = python.endsWith('worker.exe');
    const args = isWorkerExe
      ? ['playwright', 'install', 'chromium']
      : ['-m', 'playwright', 'install', 'chromium'];

    const proc = cp.spawn(python, args, {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
    });

    proc.stdout.on('data', (d) => onData(d.toString()));
    proc.stderr.on('data', (d) => onData(d.toString()));

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`playwright install chromium 退出码 ${code}`));
    });

    proc.on('error', reject);
  });
}

/** 完整的启动前检测，返回汇总结果 */
export async function runChecks(): Promise<CheckResult> {
  const errors: string[] = [];

  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) errors.push('找不到 ffmpeg，请确认已安装或放置 ffmpeg.exe 到应用目录');

  const python = resolvePython();
  if (!python) errors.push('找不到 Python，请安装 Python 3.10+ 并加入 PATH');

  const chromiumReady = isChromiumInstalled();
  // Chromium 缺失不算 error，调用方负责触发安装

  return {
    ok: errors.length === 0,
    ffmpeg,
    python,
    chromiumReady,
    errors,
  };
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

function tryWhich(cmd: string): string | null {
  try {
    const result = cp.execSync(
      process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.toString().trim().split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}
