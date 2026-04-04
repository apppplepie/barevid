import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Project } from '../components/Home';
import { deriveWorkflowSteps } from '../utils/workflowFromPipeline';

export function mergeProjectWorkflowState(
  project: Project,
  patch: Partial<Project>,
): Project {
  const next: Project = { ...project, ...patch };
  return {
    ...next,
    workflowSteps: deriveWorkflowSteps(
      next.pipeline,
      next.serverStatus,
      next.deckStatus,
      next.serverWorkflow,
      { pipelineAutoAdvance: next.pipelineAutoAdvance !== false },
    ),
  };
}

export function useProjectWorkflowState(
  setProjects: Dispatch<SetStateAction<Project[]>>,
) {
  const patchProjectWorkflowLocally = useCallback(
    (
      projectId: number,
      patcher: (project: Project) => Partial<Project>,
    ) => {
      const targetId = String(projectId);
      setProjects((prev) =>
        prev.map((project) =>
          project.id === targetId
            ? mergeProjectWorkflowState(project, patcher(project))
            : project,
        ),
      );
    },
    [setProjects],
  );

  const replaceProjectWorkflowLocally = useCallback(
    (projectId: number, patch: Partial<Project>) => {
      patchProjectWorkflowLocally(projectId, () => patch);
    },
    [patchProjectWorkflowLocally],
  );

  return {
    patchProjectWorkflowLocally,
    replaceProjectWorkflowLocally,
  };
}
