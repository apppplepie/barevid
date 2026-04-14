/**
 * preload.ts
 * 在隔离的 contextBridge 里暴露 electronAPI，让 renderer 安全调用主进程能力。
 * 不要在这里 require 任何 Node 模块（除了 electron 的 contextBridge/ipcRenderer）。
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  /** 取当前配置的云端后端 URL */
  getBackendUrl: () => Promise<string>;
  /** 手动触发一个导出（通常由拦截的 API 自动触发，这个供调试用） */
  exportVideo: (projectId: number, params?: Record<string, unknown>) => Promise<number>;
  /** 取消导出 */
  cancelExport: (projectId: number) => Promise<boolean>;
  /** 在资源管理器里打开输出目录 */
  openOutputDir: () => Promise<void>;
  /** 监听导出完成 */
  onExportDone: (cb: (data: { projectId: number; filePath: string }) => void) => () => void;
  /** 监听导出失败 */
  onExportFailed: (cb: (data: { projectId: number; error: string }) => void) => () => void;
  /** 监听实时日志 */
  onExportLog: (cb: (data: { projectId: number; line: string }) => void) => () => void;
  /** 是否运行在 Electron 里（永远为 true，用于前端判断） */
  isDesktop: true;
}

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,

  getBackendUrl: () => ipcRenderer.invoke('cfg:getBackendUrl'),

  exportVideo: (projectId: number, params?: Record<string, unknown>) =>
    ipcRenderer.invoke('export:start', { projectId, params }),

  cancelExport: (projectId: number) =>
    ipcRenderer.invoke('export:cancel', { projectId }),

  openOutputDir: () => ipcRenderer.invoke('export:openOutputDir'),

  onExportDone: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { projectId: number; filePath: string }) => cb(data);
    ipcRenderer.on('export:done', handler);
    return () => ipcRenderer.off('export:done', handler);
  },

  onExportFailed: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { projectId: number; error: string }) => cb(data);
    ipcRenderer.on('export:failed', handler);
    return () => ipcRenderer.off('export:failed', handler);
  },

  onExportLog: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { projectId: number; line: string }) => cb(data);
    ipcRenderer.on('export:log', handler);
    return () => ipcRenderer.off('export:log', handler);
  },
} satisfies ElectronAPI);
