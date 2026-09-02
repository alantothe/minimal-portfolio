/** Keyboard-accessible ordering actions for Projects in the Owner workspace. */

import type { Database } from "bun:sqlite";
import {
  ContentRepository,
  ProjectOrderMismatchError,
} from "../database/contentRepository";
import { PublicationRepository } from "../database/publicationRepository";
import { SystemStateRepository } from "../database/repository";
import { cutoverPolicy } from "../cutover/policy";
import type { RefreshOutcome } from "../published/site";

export type ProjectMoveDirection = "up" | "down";

export interface ProjectOrderingDependencies {
  database: Database;
  refreshPreview: () => RefreshOutcome | null;
}

export interface ProjectOrderPublicationDependencies {
  database: Database;
  actorGithubUserId: number;
  refreshPublished: () => RefreshOutcome | null;
  afterPublication?: () => void;
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
  input: {
    id: string;
    direction: ProjectMoveDirection;
    now?: Date;
  },
  dependencies: ProjectOrderingDependencies
): MoveProjectOutcome {
  try {
    const moved = dependencies.database.transaction(() => {
      const content = new ContentRepository(dependencies.database);
      const projects = content.list("project");
      const currentIndex = projects.findIndex(
        (project) => project.id === input.id
      );
      if (currentIndex === -1) return { status: "not-found" } as const;

      const nextIndex =
        input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
      const projectIds = projects.map((project) => project.id);
      if (nextIndex < 0 || nextIndex >= projectIds.length) {
        return { status: "unchanged", projectIds } as const;
      }

      [projectIds[currentIndex], projectIds[nextIndex]] = [
        projectIds[nextIndex]!,
        projectIds[currentIndex]!,
      ];
      content.reorderProjects(projectIds, input.now);
      return {
        status: "moved",
        projectIds,
      } as const;
    })();

    if (moved.status !== "moved") return moved;
    return { ...moved, preview: dependencies.refreshPreview() };
  } catch (cause) {
    if (cause instanceof ProjectOrderMismatchError) {
      return { status: "conflict" };
    }
    throw cause;
  }
}

export type PublishProjectOrderOutcome =
  | {
      status: "published";
      projectIds: string[];
      published: RefreshOutcome | null;
    }
  | { status: "unchanged"; projectIds: string[] }
  | { status: "disabled" };

/** Publishes only Project positions, never unrelated Content draft fields. */
export function publishProjectOrder(
  input: { now?: Date },
  dependencies: ProjectOrderPublicationDependencies
): PublishProjectOrderOutcome {
  if (
    !cutoverPolicy(
      new SystemStateRepository(dependencies.database).getCutoverPhase()
    ).publicationEnabled
  ) {
    return { status: "disabled" };
  }
  const result = dependencies.database.transaction(() => {
    const projectIds = new ContentRepository(dependencies.database)
      .list("project")
      .map((project) => project.id);
    const revisions = new PublicationRepository(
      dependencies.database
    ).publishProjectOrder({
      orderedIds: projectIds,
      actorGithubUserId: dependencies.actorGithubUserId,
      now: input.now ?? new Date(),
    });
    return {
      projectIds,
      publishedProjectIds: revisions.map((revision) => revision.contentId),
    };
  })();

  if (result.publishedProjectIds.length === 0) {
    return { status: "unchanged", projectIds: result.projectIds };
  }
  const published = dependencies.refreshPublished();
  dependencies.afterPublication?.();
  return { status: "published", projectIds: result.projectIds, published };
}
