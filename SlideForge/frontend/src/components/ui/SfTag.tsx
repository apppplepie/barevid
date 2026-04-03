import type { HTMLAttributes } from 'react';

/** 项目卡片状态条、母版号等小标签的统一配色（深浅色一套组件内维护） */
export type SfTagTone =
  | 'neutral'
  | 'violet'
  | 'red'
  | 'emerald'
  | 'blue'
  | 'cyan'
  | 'amber';

const TONE_CLASS: Record<SfTagTone, string> = {
  neutral:
    'border-zinc-600/50 bg-zinc-800/60 text-zinc-300 light:border-slate-300 light:bg-slate-200/90 light:text-slate-900',
  violet:
    'border-violet-500/50 bg-violet-950/50 text-violet-100 light:border-violet-400/55 light:bg-violet-100 light:text-violet-900',
  red: 'border-red-500/35 bg-red-950/40 text-red-200 light:border-red-400/45 light:bg-red-50 light:text-red-800',
  emerald:
    'border-emerald-500/40 bg-emerald-950/35 text-emerald-100 light:border-emerald-400/45 light:bg-emerald-50 light:text-emerald-800',
  blue: 'border-blue-500/35 bg-blue-950/25 text-blue-100 light:border-blue-400/45 light:bg-blue-50 light:text-blue-800',
  cyan: 'border-cyan-500/40 bg-cyan-950/30 text-cyan-100 light:border-cyan-400/45 light:bg-cyan-50 light:text-cyan-800',
  amber:
    'border-amber-500/35 bg-amber-950/25 text-amber-100 light:border-amber-400/45 light:bg-amber-50 light:text-amber-900',
};

export type ProjectPipelineTagInput = {
  serverStatus?: string;
  deckStatus?: string;
  pipeline?: { outline?: boolean; audio?: boolean; deck?: boolean; video?: boolean };
};

export function projectPipelineTagTone(project: ProjectPipelineTagInput): SfTagTone {
  const st = (project.serverStatus || '').toLowerCase();
  const pl = project.pipeline;
  if (st === 'failed') return 'red';
  if (pl?.video) return 'emerald';
  if (pl?.audio && pl?.deck) return 'blue';
  if (st === 'queued') return 'cyan';
  if (st === 'structuring' || st === 'synthesizing') return 'amber';
  return 'neutral';
}

type SfTagProps = HTMLAttributes<HTMLSpanElement> & {
  tone: SfTagTone;
  size?: 'xs' | 'sm';
  mono?: boolean;
};

export function SfTag({ tone, size = 'sm', mono, className = '', ...rest }: SfTagProps) {
  const sz = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border font-medium leading-tight ${sz} ${mono ? 'font-mono tabular-nums' : ''} ${TONE_CLASS[tone]} ${className}`.trim()}
      {...rest}
    />
  );
}
