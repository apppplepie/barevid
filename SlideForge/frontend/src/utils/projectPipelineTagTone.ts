import type { SfTagTone } from '../components/ui/SfTag';

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
  if (st === 'queued' || st === 'pending_text') return 'cyan';
  if (st === 'structuring' || st === 'synthesizing') return 'amber';
  return 'neutral';
}
