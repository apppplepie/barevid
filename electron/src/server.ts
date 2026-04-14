/**
 * server.ts
 * 在 Electron 主进程里跑一个本地 HTTP server：
 *  - 静态文件服务：serve SlideForge/frontend/dist（SPA fallback 到 index.html）
 *  - API 代理：/api/* 和 /media/* 透传到云端后端
 *  - 导出拦截：POST /api/projects/:id/export-video 由本地 worker 接管
 *
 * 返回实际监听的端口号。
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express, { Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ExportManager } from './export';

/** 前端 dist 目录（打包后在 extraResources/frontend，开发时在源码目录） */
function getFrontendDist(): string {
  const bundled = path.join(process.resourcesPath ?? '', 'frontend');
  if (fs.existsSync(bundled)) return bundled;

  // 开发时：相对于本文件位置找
  return path.resolve(__dirname, '../../SlideForge/frontend/dist');
}

export interface LocalServer {
  port: number;
  close: () => Promise<void>;
}

export interface StartLocalServerOptions {
  /** 若指定，在此端口监听本地 Express（否则随机端口） */
  listenPort?: number;
}

export async function startLocalServer(
  backendUrl: string,
  exportManager: ExportManager,
  opts?: StartLocalServerOptions
): Promise<LocalServer> {
  const expressApp = express();
  expressApp.use(express.json());

  const distDir = getFrontendDist();

  // ── 1. 拦截导出请求，交给本地 ExportManager ──────────────────────────────
  //    POST /api/projects/:pid/export-video
  expressApp.post(
    '/api/projects/:pid/export-video',
    (req: Request, res: Response) => {
      const pid = Number(req.params.pid);
      const body = req.body as Record<string, unknown>;

      const jobId = exportManager.enqueue(pid, body);
      res.json({ job_id: jobId, status: 'queued' });
    }
  );

  //    GET /api/projects/:pid/export-video/status
  expressApp.get(
    '/api/projects/:pid/export-video/status',
    (req: Request, res: Response) => {
      const pid = Number(req.params.pid);
      const status = exportManager.getStatus(pid);
      if (!status) {
        res.status(404).json({ error: 'no export job for this project' });
        return;
      }
      res.json(status);
    }
  );

  //    GET /api/projects/:pid/export-video/download  （导出完成后下载本地文件）
  expressApp.get(
    '/api/projects/:pid/export-video/download',
    (req: Request, res: Response) => {
      const pid = Number(req.params.pid);
      const filePath = exportManager.getOutputPath(pid);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: '文件不存在或导出未完成' });
        return;
      }
      res.download(filePath);
    }
  );

  // ── 2. 其余 /api 和 /media 代理到云端后端 ───────────────────────────────
  expressApp.use(
    ['/api', '/media'],
    createProxyMiddleware({
      target: backendUrl,
      changeOrigin: true,
      // 如果后端需要 cookie/session，开启这项
      // cookieDomainRewrite: 'localhost',
    })
  );

  // ── 3. 静态前端文件 + SPA fallback ──────────────────────────────────────
  if (fs.existsSync(distDir)) {
    expressApp.use(express.static(distDir));

    // 所有未匹配路由返回 index.html（history routing）
    expressApp.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    expressApp.get('*', (_req: Request, res: Response) => {
      res.status(503).send(
        `前端尚未构建。请先运行 npm run build:frontend。<br>期望路径：${distDir}`
      );
    });
  }

  // ── 4. 监听端口（可指定，便于与捆绑 API 的 EXPORT_FRONTEND_URL 对齐）────────
  const port =
    typeof opts?.listenPort === 'number' && opts.listenPort > 0
      ? opts.listenPort
      : await getFreePort();
  const server = http.createServer(expressApp);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('无法获取随机端口'));
        return;
      }
      srv.close(() => resolve(addr.port));
    });
  });
}
