/**
 * Names for content that survive being computed twice.
 *
 * The import has to be re-runnable. A rehearsal into a disposable database, a
 * second rehearsal, and eventually the production run all read the same
 * repository files, and every one of them must produce the *same* entity IDs —
 * otherwise "re-running identical input is a no-op" is impossible to check, and
 * a second run silently duplicates every Project and Blog post.
 *
 * Random UUIDs cannot do that, so imported entities get a UUIDv5: a hash of a
 * namespace and a name, which is a pure function of its inputs. Entities the
 * Owner creates later still get random v4 IDs — they have no source key to
 * derive from, and nothing needs to recompute them.
 *
 * The namespace is versioned. If the derivation ever has to change, bumping the
 * namespace makes that a visible, deliberate re-identification of everything
 * rather than a silent collision between old and new IDs.
 */

import { createHash, randomUUID } from "node:crypto";

/**
 * Version 1 of the import namespace, itself a UUID.
 *
 * Never edit this. Changing it changes every derived ID, which after the
 * production import would orphan every published revision, view count, and
 * media reference that points at one.
 */
export const IMPORT_NAMESPACE_V1 = "6b1d1f8a-9c2e-4f77-8b34-2f0a5c9e1d43";

/** The kinds of content that can be addressed. */
export type ContentType =
  "home" | "about" | "branding" | "project" | "blog_post";

export type CollectionType = "project" | "blog_post";

/**
 * The singletons, which have well-known identities rather than derived ones.
 *
 * They are fixed strings, not UUIDs, and that is deliberate: there is exactly
 * one Home, it can never be duplicated or deleted, and a readable primary key
 * makes that obvious in the table and impossible to get wrong in a query.
 */
export const SINGLETON_IDS = {
  home: "singleton:home",
  about: "singleton:about",
  branding: "singleton:branding",
} as const;

export type SingletonType = keyof typeof SINGLETON_IDS;

export function isSingletonType(type: ContentType): type is SingletonType {
  return type === "home" || type === "about" || type === "branding";
}

export function isCollectionType(type: string): type is CollectionType {
  return type === "project" || type === "blog_post";
}

export function collectionRoute(type: CollectionType): "/projects" | "/blog" {
  return type === "project" ? "/projects" : "/blog";
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");

  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error("Namespace must be a UUID");
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * RFC 4122 version 5: SHA-1 over the namespace bytes followed by the name.
 *
 * Implemented here rather than pulled in as a dependency — it is twenty lines
 * over `node:crypto`, and the identity of every imported entity is not a thing
 * to hand to a transitive dependency.
 *
 * SHA-1's collision weakness does not matter here. The inputs are our own
 * source keys, not attacker-supplied values, and nothing about this grants
 * authority — an attacker who could force a collision would need write access
 * to the repository first, at which point they can edit content directly.
 */
export function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);

  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes, 0);
  input.set(nameBytes, namespaceBytes.length);

  // `subarray` then copy: a Buffer's `.buffer` is a shared pool, so slicing it
  // directly would read whatever else happens to be in that pool.
  const digest = Uint8Array.from(
    createHash("sha1").update(input).digest().subarray(0, 16)
  );

  // Version 5 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;

  return formatUuid(digest);
}

/**
 * The stable ID for a piece of imported content.
 *
 * The name is `type:key` rather than the bare key so that a Project and a Blog
 * post sharing a slug — which #32 explicitly permits — cannot derive the same
 * ID. The legacy key is the directory name for Projects and the filename for
 * Blog posts, both of which are already the stable public address.
 */
export function importedContentId(
  type: ContentType,
  legacyKey: string,
  namespace: string = IMPORT_NAMESPACE_V1
): string {
  if (isSingletonType(type)) {
    // Singletons are addressed by their well-known identity. Deriving one from
    // a key would imply there could be a second Home.
    return SINGLETON_IDS[type];
  }

  if (legacyKey === "") {
    throw new Error("A legacy key is required to derive a content ID");
  }

  return uuidV5(`${type}:${legacyKey}`, namespace);
}

/**
 * The ID for content the Owner creates in the workspace.
 *
 * Random, because there is no source to re-derive it from and nothing will ever
 * need to compute it twice.
 */
export function newContentId(): string {
  return randomUUID();
}
