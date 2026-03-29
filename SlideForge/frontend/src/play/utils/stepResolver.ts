import type { PlayPageMeta, PlayStep, StepAction } from '../types/slide';

export function totalTimelineMs(steps: PlayStep[]): number {
  if (steps.length === 0) return 0;
  const last = steps[steps.length - 1];
  return last.start_ms + Math.max(0, last.duration_ms);
}

export type VisibleMap = Record<string, StepAction>;

export function foldVisibleElements(
  stepActions: Record<string, StepAction[]>,
  currentStep: number,
): VisibleMap {
  const state: VisibleMap = {};
  for (let i = 0; i <= currentStep; i++) {
    const actions = stepActions[String(i)] ?? [];
    for (const action of actions) {
      const target = (action.target ?? '').trim();
      if (!target) continue;
      if (action.type === 'add') {
        state[target] = { ...action, target };
      } else if (action.type === 'remove') {
        delete state[target];
      } else if (action.type === 'update') {
        const prev = state[target];
        state[target] = {
          ...(prev ?? { type: 'add', target }),
          ...action,
          target,
        };
      }
    }
  }
  return state;
}

export function pickActivePage(
  meta: PlayPageMeta[],
  globalStep: number,
): PlayPageMeta {
  if (meta.length === 0) {
    return {
      page_id: 0,
      title: '',
      html: '',
      firstStepIndex: 0,
      lastStepIndex: -1,
    };
  }
  for (let i = meta.length - 1; i >= 0; i--) {
    const p = meta[i];
    if (globalStep < p.firstStepIndex) continue;
    if (globalStep > p.lastStepIndex) continue;
    return p;
  }
  for (let i = meta.length - 1; i >= 0; i--) {
    const p = meta[i];
    if (globalStep >= p.firstStepIndex) return p;
  }
  return meta[0];
}
