export type PlayStep = {
  step: number;
  start_ms: number;
  duration_ms: number;
  audio_url: string;
  subtitle: string;
  kind?: 'step' | 'pause';
  /** 与编辑器时间轴 ClipData.pageId 一致，如 page-12 */
  pageId?: string;
  /** 当前页内第几块（与 HTML data-key="section-N" 对齐） */
  section_index: number;
  /** 本段口播全文（用于放映字幕） */
  narration_text?: string;
  /** 口播提要（结构化 brief） */
  narration_brief?: string;
  /** 豆包 TTS 字级时间戳等（与口播对齐，结构见后端 narration_alignment） */
  narration_alignment?: unknown;
};

/** 兼容旧 deck（add/remove/update）与 DOM 舞台（set_text、fade_in 等） */
export type StepAction = {
  type: string;
  target?: string;
  content?: string;
  animation?: string;
  url?: string;
};

/** API 返回的单步；板块切换由 section_index + 前端显隐完成 */
export type PlayPageStep = {
  step_id: number;
  timeline_index: number;
  section_index: number;
  kind: 'step' | 'pause';
  title: string;
  narration_text: string;
  narration_brief?: string | null;
  narration_alignment?: unknown;
  audio_url: string;
  duration_ms: number;
  start_ms: number;
};

export type PlayPage = {
  page_id: number;
  title: string;
  /** page 节点 NodeContent.page_code，整页 HTML */
  html?: string;
  steps: PlayPageStep[];
};

export type PlayManifest = {
  project_id: number;
  title: string;
  pages: PlayPage[];
};

export type PlayPageMeta = {
  page_id: number;
  title: string;
  html: string;
  firstStepIndex: number;
  lastStepIndex: number;
};

export type PlaySlide = {
  id: number;
  title: string;
  steps: PlayStep[];
  /** 无 page html 时的纯字幕轨（无动画 class） */
  legacyActions: Record<string, StepAction[]>;
  pageMeta: PlayPageMeta[];
};
