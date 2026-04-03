import React, { Fragment, useRef, type ReactNode, type RefObject } from 'react';
import { Play, Pause, SkipBack, SkipForward, Mic, Video, Captions } from 'lucide-react';
import { ClipData, ClipNode } from '../types';

interface TimelineProps {
  height: number;
  clips: ClipData[];
  selectedClipId: string;
  onSelectClip: (id: string) => void;
  isPlaying: boolean;
  currentTime: number; // 0 to 100
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  isGenerating?: boolean;
  onClipChange: (id: string, updates: Partial<ClipData>) => void;
  onVideoClipDoubleClick?: (clip: ClipData) => void;
  totalDurationMs?: number;
  /** 预览区是否叠加口播字幕 */
  subtitlesVisible?: boolean;
  onSubtitlesVisibleChange?: (visible: boolean) => void;
}

export function Timeline({
  height,
  clips,
  selectedClipId,
  onSelectClip,
  isPlaying,
  currentTime,
  onTogglePlay,
  onSeek,
  isGenerating,
  onClipChange,
  onVideoClipDoubleClick,
  totalDurationMs = 100000,
  subtitlesVisible = false,
  onSubtitlesVisibleChange,
}: TimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);

  if (isGenerating) {
    return (
      <div style={{ height }} className="flex w-full min-h-0 min-w-0 shrink-0 flex-col items-center justify-center border-t border-zinc-800 light:border-slate-200 bg-zinc-900/80 light:bg-white/90 text-sm text-sf-muted backdrop-blur-md z-30">
        时间轴将在生成后可用
      </div>
    );
  }

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    onSeek(percentage);
  };

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onSeek(percentage);
    };
    
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const formatTime = (percent: number) => {
    const seconds = (percent / 100) * (totalDurationMs / 1000);
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    const frames = Math.floor((seconds % 1) * 30).toString().padStart(2, '0');
    return `00:${mins}:${secs}:${frames}`;
  };

  const formatTimeLabel = (percent: number) => {
    const seconds = Math.floor((percent / 100) * (totalDurationMs / 1000));
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `00:${mins}:${secs}`;
  };

  return (
    <div style={{ height }} className="flex w-full min-h-0 min-w-0 shrink-0 flex-col border-t border-zinc-800 light:border-slate-200 bg-zinc-900/80 light:bg-white/95 backdrop-blur-md z-30">
      <div className="flex h-12 min-h-12 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 light:border-slate-200 bg-zinc-950/50 light:bg-slate-50/80 px-2 sm:px-4">
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => onSeek(0)}
            className="shrink-0 rounded-md p-2 text-zinc-400 light:text-slate-500 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-white light:hover:text-slate-900"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="shrink-0 rounded-md p-2 text-zinc-100 light:text-slate-800 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-white light:hover:text-slate-900"
          >
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
          </button>
          <button
            type="button"
            onClick={() => onSeek(100)}
            className="shrink-0 rounded-md p-2 text-zinc-400 light:text-slate-500 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-white light:hover:text-slate-900"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <div className="ml-2 shrink-0 whitespace-nowrap rounded border border-zinc-800 light:border-slate-200 bg-zinc-900 light:bg-white px-2 py-1 font-mono text-[10px] text-purple-400 light:text-purple-600 shadow-inner sm:ml-4 sm:px-3 sm:text-xs">
            {formatTime(currentTime)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            aria-pressed={subtitlesVisible}
            title={subtitlesVisible ? '关闭预览字幕' : '显示预览字幕'}
            onClick={() => onSubtitlesVisibleChange?.(!subtitlesVisible)}
            className={[
              'shrink-0 rounded-md p-2 transition-colors',
              subtitlesVisible
                ? 'border border-purple-500/40 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25'
                : 'border border-transparent text-zinc-400 light:text-slate-500 hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-white light:hover:text-slate-900',
            ].join(' ')}
          >
            <Captions className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tracks Area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {/* Time Ruler */}
        <div className="h-6 border-b border-zinc-800 light:border-slate-200 flex relative text-[10px] text-sf-muted font-mono select-none bg-zinc-950/30 light:bg-slate-50/50">
          <div className="w-24 shrink-0 border-r border-zinc-800 light:border-slate-200" />
          <div className="flex-1 relative overflow-hidden cursor-text" onClick={handleTimelineClick} ref={timelineRef}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-l border-zinc-800/50 light:border-slate-300/50 flex flex-col justify-end pb-0.5 pl-1" style={{ left: `${i * 5}%` }}>
                {formatTimeLabel(i * 5)}
              </div>
            ))}
          </div>
        </div>

        <div className="relative min-h-0 min-w-0 flex-1 space-y-2 p-2">
          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-px bg-purple-500 z-30 shadow-[0_0_10px_rgba(168,85,247,1)] transition-all duration-75"
            style={{ left: `calc(6rem + (100% - 6rem) * ${currentTime / 100})` }}
          >
            <div 
              onMouseDown={handlePlayheadMouseDown}
              className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-purple-500 rounded-sm flex items-center justify-center cursor-ew-resize hover:scale-110 transition-transform"
            >
              <div className="w-0.5 h-2 bg-white/80 rounded-full pointer-events-none" />
            </div>
          </div>

          <Track name="Web" icon={<Video className="w-3 h-3" />} color="blue">
            {clips.filter(c => c.type === 'video').map(clip => (
              <Fragment key={clip.id}>
                <TrackClip
                  clip={clip}
                  clips={clips}
                  color="blue"
                  isSelected={selectedClipId === clip.id}
                  onClick={() => {
                    onSelectClip(clip.id);
                    onSeek(clip.start);
                  }}
                  onDoubleClick={() => onVideoClipDoubleClick?.(clip)}
                  onChange={(updates) => onClipChange(clip.id, updates)}
                  timelineRef={timelineRef}
                  isResizable={!clip.locked}
                />
              </Fragment>
            ))}
          </Track>
          <Track name="Audio 1" icon={<Mic className="w-3 h-3" />} color="purple">
            {clips.filter(c => c.type === 'audio').map(clip => (
              <Fragment key={clip.id}>
                <TrackClip
                  clip={clip}
                  clips={clips}
                  color="purple"
                  isSelected={selectedClipId === clip.id}
                  onClick={() => {
                    onSelectClip(clip.id);
                    onSeek(clip.start);
                  }}
                  onChange={(updates) => onClipChange(clip.id, updates)}
                  timelineRef={timelineRef}
                  isResizable={!clip.locked}
                />
              </Fragment>
            ))}
          </Track>
        </div>
      </div>
    </div>
  );
}

function Track({ name, icon, color, children }: { name: string, icon: React.ReactNode, color: string, children: React.ReactNode }) {
  return (
    <div className="flex h-12 min-h-12 min-w-0 overflow-hidden rounded-md border border-zinc-800/50 light:border-slate-200 bg-zinc-950/50 light:bg-slate-50/80 group">
      <div className="flex w-24 shrink-0 flex-col justify-center border-r border-zinc-800 light:border-slate-200 bg-zinc-900/80 light:bg-white px-2 z-10 transition-colors group-hover:bg-zinc-800 light:group-hover:bg-slate-100">
        <div className="flex items-center gap-1.5 text-zinc-400 light:text-slate-500">
          {icon}
          <span className="text-[10px] font-medium uppercase tracking-wider truncate">{name}</span>
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        {/* Grid lines */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTE5LjUgMEwxOS41IDIwIiBzdHJva2U9IiMzZjNmNDYiIHN0cm9rZS13aWR0aD0iMSIgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMC4yIi8+PC9zdmc+')] opacity-10" />
        {children}
      </div>
    </div>
  );
}

function TrackClip({
  clip,
  clips,
  color,
  isSelected,
  onClick,
  onDoubleClick,
  onChange,
  timelineRef,
  isResizable = true,
}: {
  clip: ClipData;
  clips: ClipData[];
  color: 'blue' | 'purple' | 'emerald' | 'orange';
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onChange: (updates: Partial<ClipData>) => void;
  timelineRef: RefObject<HTMLDivElement | null>;
  isResizable?: boolean;
}) {
  const colorMap = {
    blue: 'bg-blue-500/20 border-blue-500/50 text-blue-200',
    purple: 'bg-purple-500/20 border-purple-500/50 text-purple-200',
    emerald: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200',
    orange: 'bg-orange-500/20 border-orange-500/50 text-orange-200',
  };

  const selectedMap = {
    blue: 'ring-2 ring-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)] z-20',
    purple: 'ring-2 ring-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.5)] z-20',
    emerald: 'ring-2 ring-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)] z-20',
    orange: 'ring-2 ring-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.5)] z-20',
  };

  const handleResizeLeft = (e: React.MouseEvent) => {
    if (!isResizable) return;
    e.stopPropagation();
    onClick?.();
    
    const startX = e.clientX;
    const initialStart = clip.start;
    const initialWidth = clip.width;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / rect.width) * 100;
      
      let newStart = initialStart + deltaPercent;
      let newWidth = initialWidth - deltaPercent;
      
      // Magnetic snapping
      const snapPoints = [0, 100];
      clips.forEach(c => {
        if (c.id !== clip.id) {
          snapPoints.push(c.start);
          snapPoints.push(c.start + c.width);
        }
      });
      
      for (const point of snapPoints) {
        if (Math.abs(newStart - point) < 1.5) {
          newWidth = newWidth + (newStart - point);
          newStart = point;
          break;
        }
      }
      
      if (newWidth < 1) {
        newWidth = 1;
        newStart = initialStart + initialWidth - 1;
      }
      if (newStart < 0) {
        newStart = 0;
        newWidth = initialStart + initialWidth;
      }
      
      onChange({ start: newStart, width: newWidth });
    };
    
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeRight = (e: React.MouseEvent) => {
    if (!isResizable) return;
    e.stopPropagation();
    onClick?.();
    
    const startX = e.clientX;
    const initialWidth = clip.width;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / rect.width) * 100;
      
      let newWidth = initialWidth + deltaPercent;
      
      // Magnetic snapping
      const snapPoints = [0, 100];
      clips.forEach(c => {
        if (c.id !== clip.id) {
          snapPoints.push(c.start);
          snapPoints.push(c.start + c.width);
        }
      });
      
      for (const point of snapPoints) {
        if (Math.abs(clip.start + newWidth - point) < 1.5) {
          newWidth = point - clip.start;
          break;
        }
      }
      
      if (newWidth < 1) {
        newWidth = 1;
      }
      if (clip.start + newWidth > 100) {
        newWidth = 100 - clip.start;
      }
      
      onChange({ width: newWidth });
    };
    
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    onDoubleClick={(e) => {
      e.stopPropagation();
      onDoubleClick?.();
    }}
    title={`${clip.duration} - ${clip.content}${clip.locked ? ' (locked)' : ''}`}
    className={`absolute top-1 bottom-1 rounded border ${colorMap[color]} ${isSelected ? selectedMap[color] : ''} flex items-center px-2 overflow-hidden group/clip cursor-pointer hover:brightness-125 transition-all shadow-sm`}
    style={{ left: `${clip.start}%`, width: `${clip.width}%` }}
  >
      <span className="text-[10px] font-medium truncate z-10 drop-shadow-md pointer-events-none">{clip.label}</span>
      
      {/* Nodes Visualization */}
      {clip.nodes && clip.nodes.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {clip.nodes.map(node => {
            const relativePos = ((node.time - clip.start) / clip.width) * 100;
            return (
              <div 
                key={node.id} 
                className="absolute top-0 bottom-0 w-px bg-blue-400/50 z-10"
                style={{ left: `${relativePos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.8)]" />
              </div>
            );
          })}
        </div>
      )}

      {/* Handles */}
      {isResizable ? (
        <>
          <div 
            onMouseDown={handleResizeLeft}
            className="absolute left-0 top-0 bottom-0 w-2 bg-white/0 group-hover/clip:bg-white/30 cursor-ew-resize transition-colors z-20" 
          />
          <div 
            onMouseDown={handleResizeRight}
            className="absolute right-0 top-0 bottom-0 w-2 bg-white/0 group-hover/clip:bg-white/30 cursor-ew-resize transition-colors z-20" 
          />
        </>
      ) : null}
    </div>
  );
}
