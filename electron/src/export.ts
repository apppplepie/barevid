/**
 * export.ts
 * 管理本地视频导出任务。
 *
 * 每个导出任务：
 *   1. 导出前检测 ffmpeg / worker / Playwright（安装包内可捆绑，未捆绑时回退本机环境）
 *   2. 调用 export_video.py（或打包后的 worker.exe）作为子进程
 *   3. 输出存到 ~/Videos/Barevid/ 目录
 *   4. 状态通过 getStatus() 轮询，完成后通知 renderer
 */

import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app, BrowserWindow, dialog, shell } from 'electron';
import {
  getBrowsersPath,
  getEnvWithPythonPathHints,
  getExportPrerequisiteError,
} from './checker';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ExportJob {
  job_id: number;
  project_id: number;
  status: JobStatus;
  output_url?: string;   // 本地文件路径（done 时填）
  error_message?: string | null;
  /** 入队时间（毫秒），供前端轮询展示 */
  created_at?: number;
  started_at?: number;
  finished_at?: number;
  /** 仅 getStatus JSON：标识为本机内嵌导出 */
  worker_id?: string;
  proc?: cp.ChildProcess;
}

let _nextJobId = 1;
const _jobs = new Map<number /* pid */, ExportJob>();

export class ExportManager {
  private ffmpegPath: string;
  private pythonOrWorker: string;
  private exportScript: string;
  private frontendUrl: string;
  private backendUrl: string;
  /** 与捆绑 FastAPI 的 STORAGE_ROOT 一致（userData/storage） */
  private storageRoot: string;

  constructor(opts: {
    ffmpegPath: string;
    pythonOrWorker: string;
    exportScript: string;
    frontendUrl: string;
    backendUrl: string;
  }) {
    this.ffmpegPath = opts.ffmpegPath;
    this.pythonOrWorker = opts.pythonOrWorker;
    this.exportScript = opts.exportScript;
    this.frontendUrl = opts.frontendUrl;
    this.backendUrl = opts.backendUrl;
    this.storageRoot = path.join(app.getPath('userData'), 'storage');
  }

  /** 把一个导出任务排入队列并立刻开始，返回 job_id */
  enqueue(
    projectId: number,
    params: Record<string, unknown>,
    opts?: { authorization?: string }
  ): number {
    // 同一项目已有运行中的任务，直接返回该 job
    const existing = _jobs.get(projectId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      return existing.job_id;
    }

    const pre = getExportPrerequisiteError();
    const jobId = _nextJobId++;
    if (pre) {
      const job: ExportJob = {
        job_id: jobId,
        project_id: projectId,
        status: 'failed',
        error_message: pre,
        created_at: Date.now(),
        finished_at: Date.now(),
      };
      _jobs.set(projectId, job);
      dialog.showErrorBox('无法导出', pre);
      notifyRenderer('export:failed', { projectId, error: pre });
      return jobId;
    }

    const authHeader = (opts?.authorization ?? '').trim();
    if (!authHeader) {
      const fail: ExportJob = {
        job_id: jobId,
        project_id: projectId,
        status: 'failed',
        error_message:
          '无法导出：缺少登录凭证。请确认已登录，并通过应用内页面发起导出。',
        created_at: Date.now(),
        finished_at: Date.now(),
      };
      _jobs.set(projectId, fail);
      dialog.showErrorBox('无法导出', fail.error_message!);
      notifyRenderer('export:failed', { projectId, error: fail.error_message! });
      return jobId;
    }

    const job: ExportJob = {
      job_id: jobId,
      project_id: projectId,
      status: 'queued',
      created_at: Date.now(),
    };
    _jobs.set(projectId, job);

    // 异步启动，不 await
    this._run(job, params, authHeader).catch((err) => {
      job.status = 'failed';
      job.error_message = String(err);
      job.finished_at = Date.now();
    });

    return jobId;
  }

  getStatus(projectId: number): ExportJob | undefined {
    const job = _jobs.get(projectId);
    if (!job) return undefined;

    // 不暴露内部 proc 给外部
    const { proc: _proc, ...safe } = job;
    return { ...safe, worker_id: 'barevid-desktop' } as ExportJob;
  }

  getOutputPath(projectId: number): string | undefined {
    return _jobs.get(projectId)?.output_url;
  }

  cancel(projectId: number): boolean {
    const job = _jobs.get(projectId);
    if (!job || !job.proc) return false;

    job.proc.kill('SIGTERM');
    job.status = 'cancelled';
    job.finished_at = Date.now();
    return true;
  }

  private async _run(
    job: ExportJob,
    _params: Record<string, unknown>,
    authorizationHeader: string
  ): Promise<void> {
    const outputDir = getOutputDir();
    fs.mkdirSync(outputDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(outputDir, `project_${job.project_id}_${ts}.mp4`);
    const browsersPath = getBrowsersPath();

    const isWorkerExe =
      path.basename(this.pythonOrWorker).toLowerCase() === 'worker.exe';
    const cmd = this.pythonOrWorker;
    const args = buildArgs({
      isWorkerExe,
      exportScript: this.exportScript,
      projectId: job.project_id,
      outputFile: outFile,
      frontendUrl: this.frontendUrl,
      backendUrl: this.backendUrl,
      storageRoot: this.storageRoot,
      mediaBaseUrl: this.backendUrl.replace(/\/$/, ''),
    });

    job.status = 'running';
    job.started_at = Date.now();

    await new Promise<void>((resolve, reject) => {
      const ffmpegDir = path.dirname(this.ffmpegPath);
      const ffprobeGuess = path.join(
        ffmpegDir,
        process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
      );
      const mediaBase = this.backendUrl.replace(/\/$/, '');
      const env: NodeJS.ProcessEnv = {
        ...getEnvWithPythonPathHints(),
        FFMPEG_PATH: this.ffmpegPath,
        PLAYWRIGHT_BROWSERS_PATH: browsersPath,
        STORAGE_ROOT: this.storageRoot,
        BAREVID_DOTENV_DIR: path.dirname(app.getPath('exe')),
        // 与浏览器请求 play-manifest 一致：须为当前登录用户的 Bearer JWT
        SLIDEFORGE_EXPORT_AUTHORIZATION: authorizationHeader,
        // 本地 storage 与后端不一致时，从 API 同源拉取 /media/... 音频（export_video._ensure_audio_file_local）
        SLIDEFORGE_MEDIA_BASE_URL: mediaBase,
      };
      if (fs.existsSync(ffprobeGuess)) {
        env.FFPROBE_PATH = ffprobeGuess;
      }

      const proc = cp.spawn(cmd, args, {
        env,
        windowsHide: true,
      });

      job.proc = proc;

      let stderrCapture = '';
      let stdoutCapture = '';

      proc.stdout?.on('data', (d) => {
        const s = d.toString();
        stdoutCapture = appendProcessLogCapture(stdoutCapture, s);
        broadcastLog(job.project_id, s);
      });
      proc.stderr?.on('data', (d) => {
        const s = d.toString();
        stderrCapture = appendProcessLogCapture(stderrCapture, s);
        broadcastLog(job.project_id, s);
      });

      proc.on('close', (code) => {
        job.finished_at = Date.now();
        delete job.proc;

        if (code === 0 && fs.existsSync(outFile)) {
          job.status = 'succeeded';
          job.output_url = outFile;
          // 导出完成：在文件管理器里高亮
          shell.showItemInFolder(outFile);
          notifyRenderer('export:done', { projectId: job.project_id, filePath: outFile });
          resolve();
        } else if (job.status !== 'cancelled') {
          job.status = 'failed';
          job.error_message = formatExportExitError(
            code,
            cmd,
            stderrCapture,
            stdoutCapture
          );
          console.error(
            '[barevid-export] failed',
            { code, cmd, stderrTail: stderrCapture.slice(-8000) }
          );
          notifyRenderer('export:failed', { projectId: job.project_id, error: job.error_message });
          reject(new Error(job.error_message));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        job.status = 'failed';
        job.error_message = err.message;
        job.finished_at = Date.now();
        delete job.proc;
        reject(err);
      });
    });
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

const PROCESS_LOG_CAPTURE_MAX = 48_000;

function appendProcessLogCapture(prev: string, chunk: string): string {
  const next = prev + chunk;
  return next.length <= PROCESS_LOG_CAPTURE_MAX
    ? next
    : next.slice(-PROCESS_LOG_CAPTURE_MAX);
}

function formatExportExitError(
  code: number | null,
  cmd: string,
  stderrAll?: string,
  stdoutAll?: string
): string {
  const err = (stderrAll ?? '').trim();
  const out = (stdoutAll ?? '').trim();
  const combined =
    err && out
      ? `--- stderr ---\n${err}\n\n--- stdout ---\n${out}`
      : err || out || '';
  const tail =
    combined.length > 4500 ? combined.slice(-4500) : combined;
  const logSuffix = tail
    ? `\n\n—— 进程输出（截取末尾）——\n${tail}`
    : '';

  if (process.platform === 'win32' && code === 9009) {
    return (
      '无法启动导出进程（退出码 9009：通常表示未找到可执行文件）。\n' +
      `已尝试：${cmd}\n` +
      '请在终端执行 `py -3 --version` 或 `where python`，确保不是仅 Microsoft Store 占位。\n' +
      '建议从 python.org 安装并勾选「Add python.exe to PATH」，或确保 `py` 启动器可用。' +
      logSuffix
    );
  }

  return (
    `导出进程失败（退出码 ${code ?? 'unknown'}）。` +
    logSuffix +
    (tail
      ? ''
      : '\n\n若此处无详细日志，请打开主进程控制台（或开发者工具里若有导出日志通道）查看完整输出。')
  );
}

function getOutputDir(): string {
  return path.join(os.homedir(), 'Videos', 'Barevid');
}

function buildArgs(opts: {
  isWorkerExe: boolean;
  exportScript: string;
  projectId: number;
  outputFile: string;
  frontendUrl: string;
  backendUrl: string;
  storageRoot: string;
  /** 与 FastAPI 同源，用于下载 /media/...（本地 STORAGE_ROOT 与后端不一致时必需） */
  mediaBaseUrl: string;
}): string[] {
  const scriptArgs = [
    '--project-id', String(opts.projectId),
    '--output', opts.outputFile,
    '--frontend-url', opts.frontendUrl,
    '--api-url', opts.backendUrl,
    '--storage-root', opts.storageRoot,
    '--media-base-url', opts.mediaBaseUrl,
  ];

  // PyInstaller onefile：直接传与 python export_video.py 相同的参数
  if (opts.isWorkerExe) {
    return scriptArgs;
  }
  return [opts.exportScript, ...scriptArgs];
}

/** 向所有 BrowserWindow 广播日志 */
function broadcastLog(projectId: number, line: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('export:log', { projectId, line });
  }
}

/** 向所有 BrowserWindow 发送通知 */
function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}
