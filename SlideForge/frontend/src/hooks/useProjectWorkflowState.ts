import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Project } from '../components/Home';
import { mergeProjectWorkflowState } from '../utils/workflowProject';

export function useProjectWorkflowState(
  setProjects: Dispatch<SetStateAction<Project[]>>,
) {
  const patchProjectWorkflowLocally = useCallback(
    (projectId: number, patcher: (project: Project) => Partial<Project>) => {
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
