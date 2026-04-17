import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, LogOut, Info } from 'lucide-react';
import { WorkflowProgressBar, WorkflowStep } from './WorkflowProgressBar';
import { APP_BRAND } from '../brand';
import { AuthDialog } from './AuthDialog';

interface TopBarProps {
  projectName?: string;
  onBackToHome?: () => void;
  steps?: WorkflowStep[];
  downloadEnabled?: boolean;
  /** 与后端 pipeline.video 一致：有成片时顶栏为「下载」，否则为「导出」 */
  videoReady?: boolean;
  downloadLoading?: boolean;
  downloadPreparing?: boolean;
  onDownloadClick?: () => void;
  onRetryWorkflowStep?: (stepId: string) => void;
  retryingWorkflowStepId?: string | null;
  onCancelRunningWorkflowStep?: (stepId: string) => void;
  cancellingRunningWorkflowStepId?: string | null;
  /** 顶栏已完成步骤点击勾选 → 打开回退确认 */
  onRequestReopenSuccessStep?: (stepId: string) => void;
  reopeningWorkflowStepId?: string | null;
  pipelineAutoAdvance?: boolean;
  manualOutlineConfirmed?: boolean;
  username?: string | null;
  onLogin?: () => void;
  onLogout?: () => void;
  // onToggleTheme?: () => void; // 暂不需要浅色切换入口
  onOpenProjectDetails?: () => void;
  editorTopBarExtras?: ReactNode;
}

export function TopBar({
  projectName,
  onBackToHome,
  steps,
  downloadEnabled = false,
  videoReady = false,
  downloadLoading = false,
  downloadPreparing = false,
  onDownloadClick,
  onRetryWorkflowStep,
  retryingWorkflowStepId = null,
  onCancelRunningWorkflowStep,
  cancellingRunningWorkflowStepId = null,
  onRequestReopenSuccessStep,
  reopeningWorkflowStepId = null,
  pipelineAutoAdvance = true,
  manualOutlineConfirmed = true,
  username: controlledUsername,
  onLogin,
  onLogout,
  onOpenProjectDetails,
  editorTopBarExtras,
}: TopBarProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDropdown(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showDropdown]);

  const displayUsername = controlledUsername;

  const handleLogin = () => {
    setAuthOpen(true);
  };

  const handleLogout = () => {
    onLogout?.();
    setShowDropdown(false);
  };

  return (
    <header className="relative z-20 flex h-14 min-h-14 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 light:border-slate-200 bg-zinc-950/80 light:bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4">
      {/* flex-shrink 更大：窄屏时优先压缩左侧工程名，流水线区域保留给下载按钮 */}
      <div className="flex min-w-0 flex-[1_2_0%] items-center gap-2 sm:gap-3">
        {onBackToHome ? (
          <button
            type="button"
            onClick={onBackToHome}
            className="-ml-2 flex items-center gap-2 rounded-md p-2 text-zinc-400 light:text-slate-500 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-zinc-100 light:hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg shadow-[0_0_15px_rgba(168,85,247,0.4)] ring-1 ring-white/10">
            <img src="/favicon.ico" alt="" className="h-full w-full object-contain" width={32} height={32} />
          </div>
        )}
        <div className="flex min-w-0 flex-col truncate">
          <span className="truncate text-sm font-medium leading-tight text-zinc-100 light:text-slate-900">{projectName || APP_BRAND}</span>
          {projectName && <span className="text-[10px] leading-tight text-sf-muted"> </span>}
        </div>
        {projectName && onOpenProjectDetails ? (
          <button
            type="button"
            onClick={onOpenProjectDetails}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-zinc-100 light:hover:text-slate-800"
            title="项目详情"
            aria-label="项目详情"
          >
            <Info className="h-4 w-4" />
          </button>
        ) : null}
        {editorTopBarExtras}
      </div>

      <div
        className={
          projectName
            ? 'ml-2 flex min-w-0 flex-[2_1_0%] items-center justify-end gap-2 py-1 sm:ml-3 sm:gap-3 md:gap-4'
            : 'ml-2 flex min-w-0 flex-1 items-center justify-end gap-2 py-1 sm:ml-3 sm:gap-3 md:gap-4'
        }
      >
        {projectName && steps && steps.length > 0 && onDownloadClick ? (
          <WorkflowProgressBar
            steps={steps}
            downloadEnabled={downloadEnabled}
            videoReady={videoReady}
            downloadLoading={downloadLoading}
            downloadPreparing={downloadPreparing}
            onDownloadClick={onDownloadClick}
            onRetryStep={onRetryWorkflowStep}
            retryingStepId={retryingWorkflowStepId}
            onCancelRunningStep={onCancelRunningWorkflowStep}
            cancellingStepId={cancellingRunningWorkflowStepId}
            onRequestReopenSuccessStep={onRequestReopenSuccessStep}
            reopeningWorkflowStepId={reopeningWorkflowStepId}
            pipelineAutoAdvance={pipelineAutoAdvance}
            manualOutlineConfirmed={manualOutlineConfirmed}
          />
        ) : null}

        {/* 浅色/深色切换按钮暂时不用，恢复时取消注释并接回 onToggleTheme
        <button
          type="button"
          onClick={onToggleTheme}
          className="shrink-0 rounded-md p-1.5 text-zinc-400 light:text-slate-500 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-zinc-100 light:hover:text-slate-800"
          aria-label={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          title={theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        */}

        {/* 仅首页（工程管理）显示登录/用户；进入具体工程编辑页不占用顶栏 */}
        {!projectName ? (
          <div className="relative z-30 shrink-0" ref={dropdownRef}>
            <AuthDialog
              open={authOpen}
              onClose={() => setAuthOpen(false)}
              onSuccess={() => {
                onLogin?.();
              }}
            />
            {!displayUsername ? (
              <button
                type="button"
                onClick={handleLogin}
                className="rounded-md bg-zinc-800 light:bg-slate-100 px-4 py-1.5 text-sm font-medium text-zinc-300 light:text-slate-700 transition-colors hover:bg-zinc-700 light:hover:bg-slate-200 hover:text-white light:hover:text-slate-900"
              >
                Login
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowDropdown(!showDropdown)}
                  aria-expanded={showDropdown}
                  aria-haspopup="menu"
                  className="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-zinc-700/90 light:border-slate-300 bg-zinc-800/90 light:bg-slate-100 px-2.5 py-1.5 text-sm font-medium text-zinc-200 light:text-slate-700 transition-colors hover:border-zinc-600 light:hover:border-slate-400 hover:bg-zinc-800 light:hover:bg-slate-200 hover:text-white light:hover:text-slate-900"
                >
                  <span className="min-w-0 truncate">{displayUsername}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-sf-muted transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>

                {showDropdown && (
                  <div
                    className="absolute right-0 top-full mt-1.5 w-44 rounded-lg border border-zinc-700/90 light:border-slate-200 bg-zinc-900 light:bg-white py-1 shadow-xl ring-1 ring-black/40 light:ring-slate-200/60"
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800/90 light:hover:bg-slate-50"
                    >
                      <LogOut className="h-4 w-4 shrink-0 text-sf-muted" />
                      退出登录
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
