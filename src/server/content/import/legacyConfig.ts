/**
 * Adapting `src/config/index.ts` into the shape the planner expects.
 *
 * Kept apart from the planner so that planning can be tested against a literal
 * fixture rather than against whatever the live configuration happens to say
 * today. This module is the only place that knows the legacy field names —
 * `photo` for the portrait, `year` for the period, `name` for a social link's
 * label, three numbered description fields for one body.
 */

import { aboutConfig, homeConfig, logoConfig } from "../../../config/index";
import type { LegacyConfig } from "./plan";

export function readLegacyConfig(): LegacyConfig {
  const personal = aboutConfig.sections.personal;
  const featured = aboutConfig.sections.questurian;

  return {
    logoPath: logoConfig.path,
    author: {
      name: homeConfig.author.name,
      email: homeConfig.author.email,
      githubUsername: homeConfig.author.githubUsername,
      photo: homeConfig.author.photo,
    },
    professional: {
      title: homeConfig.professional.title,
      intro: homeConfig.professional.intro,
      bio: homeConfig.professional.bio,
    },
    about: {
      intro: personal.intro,
      hobbies: personal.hobbies,
      socialLinks: personal.socialLinks.map((link) => ({
        name: link.name,
        url: link.url,
      })),
      featuredTitle: featured.title,
      // Order is the visible order, which #36 requires preserving.
      featuredParagraphs: [
        featured.description1,
        featured.description2,
        featured.description3,
      ].filter((paragraph) => paragraph.trim() !== ""),
    },
  };
}

/**
 * `homeConfig.author.firstName` and `homeConfig.metrics` are deliberately not
 * read.
 *
 * #32 derives the first name from the display name at render time, and the
 * metrics block is computed — GitHub activity, post count, and view totals are
 * read-only and would be stale the moment they were stored.
 */
export const EXCLUDED_LEGACY_FIELDS = [
  "homeConfig.author.firstName",
  "homeConfig.metrics",
] as const;
