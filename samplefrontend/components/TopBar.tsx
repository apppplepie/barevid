import { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  ArrowLeft,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react';
import { WorkflowProgressBar, WorkflowStep } from './WorkflowProgressBar';
import { AuthDialog } from './AuthDialog';

interface TopBarProps {
  projectName?: string;
  /** 进入工程编辑页时点击工程名打开详情弹窗 */
  onOpenProjectDetails?: () => void;
  onBackToHome?: () => void;
  steps?: WorkflowStep[];
  /** 与工程手动闸门一致，用于顶栏步骤「等待中 / 可开始」判断 */
  pipelineAutoAdvance?: boolean;
  manualOutlineConfirmed?: boolean;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  onCancelRunningStep?: (stepId: string) => void;
  cancellingStepId?: string | null;
  onReopenSuccessStep?: (stepId: string) => void;
  reopeningSuccessStepId?: string | null;
  downloadEnabled?: boolean;
  /** 与后端 pipeline.video 一致：有成片时顶栏为「下载」，否则为「导出」 */
  videoReady?: boolean;
  downloadLoading?: boolean;
  onDownloadClick?: () => void;
  username?: string | null;
  onLogin?: () => void;
  onLogout?: () => void;
  themeMode?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export function TopBar({
  projectName,
  onOpenProjectDetails,
  onBackToHome,
  steps,
  pipelineAutoAdvance = true,
  manualOutlineConfirmed = true,
  onRetryStep,
  retryingStepId = null,
  onCancelRunningStep,
  cancellingStepId = null,
  onReopenSuccessStep,
  reopeningSuccessStepId = null,
  downloadEnabled = false,
  videoReady = false,
  downloadLoading = false,
  onDownloadClick,
  username: controlledUsername,
  onLogin,
  onLogout,
  themeMode = 'dark',
  onToggleTheme,
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
    <header className="relative z-20 flex h-14 min-h-14 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 sf-border-base bg-zinc-950/80 sf-bg-panel px-3 backdrop-blur-md sm:gap-3 sm:px-4">
      {/* flex-shrink 更大：窄屏时优先压缩左侧工程名，流水线区域保留给下载按钮 */}
      <div className="flex min-w-0 flex-[1_2_0%] items-center gap-2 sm:gap-3">
        {onBackToHome ? (
          <button
            type="button"
            onClick={onBackToHome}
            className="-ml-2 flex items-center gap-2 rounded-md p-2 text-zinc-400 sf-text-secondary transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <div className="sf-topbar-logo-mark flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 shadow-[0_0_15px_rgba(168,85,247,0.4)]">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-col truncate">
            {projectName && onOpenProjectDetails ? (
              <button
                type="button"
                onClick={onOpenProjectDetails}
                className="min-h-10 min-w-0 max-w-full truncate rounded-lg px-3 py-2 text-left text-base font-medium leading-snug text-zinc-100 sf-text-primary outline-none ring-purple-500/40 transition-colors hover:bg-zinc-800/90 focus-visible:ring-2 sm:min-h-11 sm:px-3.5 sm:py-2.5 sm:text-[17px]"
              >
                {projectName}
              </button>
            ) : (
              <span className="truncate px-2 py-2 text-base font-medium leading-snug text-zinc-100 sf-text-primary sm:text-[17px]">
                {projectName || '工程管理'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className={
          projectName
            ? 'ml-2 flex min-w-0 flex-[2_1_0%] items-center justify-end gap-2 py-1 sm:ml-3 sm:gap-3 md:gap-4'
            : 'ml-2 flex min-w-0 flex-1 items-center justify-end gap-2 py-1 sm:ml-3 sm:gap-3 md:gap-4'
        }
      >
        {!projectName ? (
          <button
            type="button"
            onClick={onToggleTheme}
            className="shrink-0 rounded-md border border-zinc-700/90 sf-border-base bg-zinc-800/90 sf-bg-card px-2.5 py-1.5 text-sm font-medium text-zinc-200 sf-text-primary transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
            title={themeMode === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
            aria-label={themeMode === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
          >
            <span className="inline-flex items-center gap-1.5">
              {themeMode === 'light' ? (
                <Moon className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Sun className="h-3.5 w-3.5 shrink-0" />
              )}
              {/* <span>{themeMode === 'light' ? '暗色' : '亮色'}</span> */}
            </span>
          </button>
        ) : null}

        {projectName && steps && steps.length > 0 && onDownloadClick ? (
          <WorkflowProgressBar
            steps={steps}
            pipelineAutoAdvance={pipelineAutoAdvance}
            manualOutlineConfirmed={manualOutlineConfirmed}
            downloadEnabled={downloadEnabled}
            videoReady={videoReady}
            downloadLoading={downloadLoading}
            onDownloadClick={onDownloadClick}
            onRetryStep={onRetryStep}
            retryingStepId={retryingStepId}
            onCancelRunningStep={onCancelRunningStep}
            cancellingStepId={cancellingStepId}
            onReopenSuccessStep={onReopenSuccessStep}
            reopeningSuccessStepId={reopeningSuccessStepId}
          />
        ) : null}

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
                className="rounded-md bg-zinc-800 sf-bg-card px-4 py-1.5 text-sm font-medium text-zinc-300 sf-text-secondary transition-colors hover:bg-zinc-700 hover:text-white"
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
                  className="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-zinc-700/90 bg-zinc-800/90 px-2.5 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
                >
                  <span className="min-w-0 truncate">{displayUsername}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>

                {showDropdown && (
                  <div
                    className="absolute right-0 top-full mt-1.5 w-44 rounded-lg border border-zinc-700/90 bg-zinc-900 py-1 shadow-xl ring-1 ring-zinc-500/30"
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800/90"
                    >
                      <LogOut className="h-4 w-4 shrink-0 text-zinc-400" />
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
