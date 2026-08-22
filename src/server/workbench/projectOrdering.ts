/** Keyboard-accessible ordering actions for Projects in the Owner workspace. */

import {
  ContentRepository,
  ProjectOrderMismatchError,
} from "../database/contentRepository";
import type { RefreshOutcome } from "../published/site";

export type ProjectMoveDirection = "up" | "down";

export interface ProjectOrderingDependencies {
  content: ContentRepository;
  refreshPreview: () => RefreshOutcome | null;
}

export type MoveProjectOutcome =
  | {
      status: "moved";
      projectIds: string[];
      preview: RefreshOutcome | null;
    }
  | { status: "unchanged"; projectIds: string[] }
  | { status: "conflict" }
  | { status: "not-found" };

export function moveProject(
  input: { id: string; direction: ProjectMoveDirection },
  dependencies: ProjectOrderingDependencies
): MoveProjectOutcome {
  const projects = dependencies.content.list("project");
  const currentIndex = projects.findIndex((project) => project.id === input.id);
  if (currentIndex === -1) return { status: "not-found" };

  const nextIndex =
    input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
  const projectIds = projects.map((project) => project.id);
  if (nextIndex < 0 || nextIndex >= projectIds.length) {
    return { status: "unchanged", projectIds };
  }

  [projectIds[currentIndex], projectIds[nextIndex]] = [
    projectIds[nextIndex]!,
    projectIds[currentIndex]!,
  ];
  try {
    dependencies.content.reorderProjects(projectIds);
  } catch (cause) {
    if (cause instanceof ProjectOrderMismatchError) {
      return { status: "conflict" };
    }
    throw cause;
  }

  return {
    status: "moved",
    projectIds,
    preview: dependencies.refreshPreview(),
  };
}
