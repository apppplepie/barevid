import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../components/Home';
import { applyEditorPendingToSteps } from '../utils/workflowFromPipeline';
import { applyActionableWaitingToSteps } from '../utils/workflowStepDependencies';

export type ManualDialogId =
  | 'text'
  | 'outline'
  | 'deck_master'
  | 'deck_pages'
  | null;

export type ConfirmDialogKind = 'cancel' | 'reopen' | null;

export type ConfirmDialogState = {
  kind: ConfirmDialogKind;
  stepId: string | null;
};

type UseEditorWorkflowModelArgs = {
  currentView: 'home' | 'editor';
  currentProject?: Project;
  headerTextStructureKickoffPending: boolean;
  headerAudioRegenPending: boolean;
  headerDeckRegenPending: boolean;
  headerExportStaleAfterRegen: boolean;
  exportFailed: boolean;
  exportSubmitting: boolean;
};

function manualDialogForStep(stepId: string): ManualDialogId {
  if (stepId === 'text') return 'text';
  if (stepId === 'audio') return 'outline';
  if (stepId === 'deck_master') return 'deck_master';
  if (stepId === 'pages' || stepId === 'deck_render') return 'deck_pages';
  return null;
}

export function useEditorWorkflowModel({
  currentView,
  currentProject,
  headerTextStructureKickoffPending,
  headerAudioRegenPending,
  headerDeckRegenPending,
  headerExportStaleAfterRegen,
  exportFailed,
  exportSubmitting,
}: UseEditorWorkflowModelArgs) {
  const [activeManualDialog, setActiveManualDialog] = useState<ManualDialogId>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    kind: null,
    stepId: null,
  });
  const manualTextGateOpenedRef = useRef(false);
  const manualOutlineGateOpenedRef = useRef(false);
  const manualDeckPagesGateOpenedRef = useRef(false);

  useEffect(() => {
    manualTextGateOpenedRef.current = false;
    manualOutlineGateOpenedRef.current = false;
    manualDeckPagesGateOpenedRef.current = false;
    setActiveManualDialog(null);
    setConfirmDialog({ kind: null, stepId: null });
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProject) return;
    if (currentProject.pipelineAutoAdvance !== false) return;

    const textStep = currentProject.workflowSteps?.find((s) => s.id === 'text');
    const textOk = textStep?.state === 'success';
    const textRunning = textStep?.state === 'running';

    if (!textOk && !textRunning) {
      if (!manualTextGateOpenedRef.current) {
        manualTextGateOpenedRef.current = true;
        setActiveManualDialog('text');
      }
      return;
    }

    if (!currentProject.pipeline?.outline) return;
    if ((currentProject.manualOutlineConfirmed ?? true) !== false) return;
    if (manualOutlineGateOpenedRef.current) return;
    if (manualDeckPagesGateOpenedRef.current) return;
    manualOutlineGateOpenedRef.current = true;
    setActiveManualDialog('outline');
  }, [
    currentView,
    currentProject,
    currentProject?.manualOutlineConfirmed,
    currentProject?.pipeline?.outline,
    currentProject?.pipelineAutoAdvance,
    currentProject?.workflowSteps,
  ]);

  const displaySteps = useMemo(() => {
    let base = applyEditorPendingToSteps(currentProject?.workflowSteps ?? [], {
      text:
        headerTextStructureKickoffPending &&
        currentView === 'editor' &&
        Boolean(currentProject),
      audio: headerAudioRegenPending,
    });
    if (exportFailed) {
      base = base.map((s) =>
        s.id === 'export' && s.state !== 'success'
          ? { ...s, state: 'error' as const }
          : s,
      );
    }
    if (
      headerAudioRegenPending ||
      headerDeckRegenPending ||
      headerExportStaleAfterRegen
    ) {
      base = base.map((s) =>
        s.id === 'export' ? { ...s, state: 'pending' as const } : s,
      );
    }
    base = base.map((s) => {
      if (s.id === 'export' && exportSubmitting) {
        return { ...s, state: 'running' as const };
      }
      return s;
    });
    return applyActionableWaitingToSteps(base, {
      pipelineAutoAdvance: currentProject?.pipelineAutoAdvance !== false,
      manualOutlineConfirmed: currentProject?.manualOutlineConfirmed ?? true,
    });
  }, [
    currentProject,
    currentProject?.manualOutlineConfirmed,
    currentProject?.pipelineAutoAdvance,
    currentProject?.workflowSteps,
    currentView,
    exportFailed,
    exportSubmitting,
    headerAudioRegenPending,
    headerDeckRegenPending,
    headerExportStaleAfterRegen,
    headerTextStructureKickoffPending,
  ]);

  const timelineUnlocked = useMemo(() => {
    const text = displaySteps.find((s) => s.id === 'text');
    const audio = displaySteps.find((s) => s.id === 'audio');
    if (text && audio) {
      return text.state === 'success' && audio.state === 'success';
    }
    return Boolean(currentProject?.pipeline?.outline && currentProject?.pipeline?.audio);
  }, [currentProject?.pipeline?.audio, currentProject?.pipeline?.outline, displaySteps]);

  const preExportAllSuccess = useMemo(() => {
    const preExport = displaySteps.filter((x) => x.id !== 'export');
    return preExport.length >= 3 && preExport.every((x) => x.state === 'success');
  }, [displaySteps]);

  const exportStepState = useMemo(
    () => displaySteps.find((s) => s.id === 'export')?.state,
    [displaySteps],
  );

  const videoActionEnabled =
    preExportAllSuccess &&
    !exportSubmitting &&
    exportStepState !== 'running' &&
    !headerDeckRegenPending;

  const serverPipelineSatisfied = Boolean(
    currentProject?.pipeline?.outline &&
      currentProject?.pipeline?.audio &&
      currentProject?.pipeline?.deck,
  );

  const videoActionLoading =
    serverPipelineSatisfied && (exportSubmitting || exportStepState === 'running');

  const videoReady =
    Boolean(currentProject?.pipeline?.video) &&
    !headerAudioRegenPending &&
    !headerDeckRegenPending &&
    !headerExportStaleAfterRegen;

  const openManualDialogForStep = useCallback((stepId: string) => {
    const next = manualDialogForStep(stepId);
    if (!next) return;
    if (next === 'text') {
      manualTextGateOpenedRef.current = true;
    }
    if (next === 'outline') {
      manualOutlineGateOpenedRef.current = true;
    }
    if (next === 'deck_pages') {
      manualDeckPagesGateOpenedRef.current = true;
    }
    setActiveManualDialog(next);
  }, []);

  const closeManualDialog = useCallback(() => {
    setActiveManualDialog(null);
  }, []);

  const openConfirmDialog = useCallback(
    (kind: Exclude<ConfirmDialogKind, null>, stepId: string) => {
      setConfirmDialog({ kind, stepId });
    },
    [],
  );

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog({ kind: null, stepId: null });
  }, []);

  return {
    activeManualDialog,
    closeConfirmDialog,
    closeManualDialog,
    confirmDialog,
    displaySteps,
    openConfirmDialog,
    openManualDialogForStep,
    timelineUnlocked,
    videoActionEnabled,
    videoActionLoading,
    videoReady,
  };
}
