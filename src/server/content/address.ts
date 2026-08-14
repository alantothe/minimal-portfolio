/** Validation for collection fields stored beside the typed Content data. */

import { isSingletonType, type ContentType } from "./identity";
import {
  normalizeText,
  validatePublicationDate,
  validateSlug,
  type Finding,
  type ValidationMode,
} from "./validation";

export interface ContentAddress {
  type: ContentType;
  slug: string | null;
  displayOrder: number | null;
  publishedAt: string | null;
}

function required(field: string): Finding {
  return { field, code: "required", severity: "error" };
}

export function validateContentAddress(
  address: ContentAddress,
  mode: ValidationMode,
  today: Date = new Date()
): Finding[] {
  if (isSingletonType(address.type)) return [];

  const findings: Finding[] = [];
  const slug = normalizeText(address.slug ?? "");
  if (slug) {
    findings.push(...validateSlug("slug", slug));
  } else if (mode === "publish") {
    findings.push(required("slug"));
  }

  if (address.type === "project") {
    if (address.displayOrder === null) {
      if (mode === "publish") findings.push(required("displayOrder"));
    } else if (
      !Number.isSafeInteger(address.displayOrder) ||
      address.displayOrder < 0
    ) {
      findings.push({
        field: "displayOrder",
        code: "invalid_display_order",
        severity: "error",
      });
    }
  } else if (address.publishedAt) {
    findings.push(
      ...validatePublicationDate("publishedAt", address.publishedAt, today)
    );
  } else if (mode === "publish") {
    findings.push(required("publishedAt"));
  }

  return findings;
}
