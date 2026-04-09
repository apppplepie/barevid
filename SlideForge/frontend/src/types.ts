export type ClipType = 'audio' | 'video';

export type PageKind = 'overview' | 'signals' | 'ops';

export interface ClipNode {
  id: string;
  title: string;
  time: number;
}

export interface ClipData {
  id: string;
  type: ClipType;
  label: string;
  start: number;
  width: number;
  duration: string;
  content: string;
  style?: string;
  nodes?: ClipNode[];
  pageId?: string;
  locked?: boolean;
  /** 相对站点的音频 URL（如 /media/...），由放映 manifest 提供 */
  audioUrl?: string;
}

export interface PageMetric {
  label: string;
  value: string;
  delta?: string;
}

export interface PageData {
  id: string;
  title: string;
  subtitle?: string;
  kind: PageKind;
  accent: string;
  metrics?: PageMetric[];
  bullets?: string[];
  chart?: number[];
  html?: string;
}

export interface AudioSegmentData {
  id: string;
  pageId: string;
  title: string;
  script: string;
  durationMs: number;
}
