/**
 * Identity, with determinism as the property under test.
 *
 * The RFC vector matters more than it looks: a home-grown UUIDv5 that is
 * *internally* consistent but wrong would pass every "same input, same output"
 * test here and still produce IDs no other tool agrees with. Checking a
 * published vector is what makes these real UUIDv5s.
 */

import { describe, expect, test } from "bun:test";
import {
  IMPORT_NAMESPACE_V1,
  SINGLETON_IDS,
  importedContentId,
  isSingletonType,
  newContentId,
  uuidV5,
  type ContentType,
} from "./identity";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidV5", () => {
  test("matches the published RFC 4122 test vector", () => {
    // The DNS namespace with the name "www.example.org" is the vector every
    // implementation publishes. If this passes, ours is interoperable.
    expect(
      uuidV5("www.example.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")
    ).toBe("74738ff5-5367-5958-9aee-98fffdcd1876");
  });

  test("sets the version and variant bits", () => {
    for (const name of ["a", "project:questurian", "", "ünïcode"]) {
      expect(uuidV5(name, IMPORT_NAMESPACE_V1)).toMatch(UUID_PATTERN);
    }
  });

  test("is a pure function of name and namespace", () => {
    expect(uuidV5("project:questurian", IMPORT_NAMESPACE_V1)).toBe(
      uuidV5("project:questurian", IMPORT_NAMESPACE_V1)
    );
  });

  test("a different namespace re-identifies everything", () => {
    // This is the escape hatch for changing the derivation later: it must not
    // silently collide with IDs derived under version 1.
    expect(uuidV5("project:questurian", IMPORT_NAMESPACE_V1)).not.toBe(
      uuidV5("project:questurian", "00000000-0000-4000-8000-000000000000")
    );
  });

  test("refuses a namespace that is not a UUID", () => {
    expect(() => uuidV5("x", "not-a-uuid")).toThrow();
  });
});

describe("imported content IDs", () => {
  test("re-running the import derives the same IDs", () => {
    // The whole reason for v5. If this fails, a second import duplicates
    // every entity instead of being a no-op.
    const first = importedContentId("project", "questurian");
    const second = importedContentId("project", "questurian");

    expect(first).toBe(second);
    expect(first).toMatch(UUID_PATTERN);
  });

  test("a Project and a Blog post may share a slug without sharing an ID", () => {
    // #32 permits this: slugs are unique inside a collection, not across.
    expect(importedContentId("project", "questurian")).not.toBe(
      importedContentId("blog_post", "questurian")
    );
  });

  test("different source keys derive different IDs", () => {
    expect(importedContentId("project", "questurian")).not.toBe(
      importedContentId("project", "minimal-portfolio")
    );
  });

  test("the real legacy keys all derive distinct IDs", () => {
    const ids = [
      importedContentId("project", "questurian"),
      importedContentId("project", "minimal-portfolio"),
      importedContentId(
        "blog_post",
        "who-is-alan-malpartida-software-engineer-and-founder"
      ),
      importedContentId("home", ""),
      importedContentId("about", ""),
      importedContentId("branding", ""),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("singletons use their well-known identity, not a derived one", () => {
    for (const type of ["home", "about", "branding"] as const) {
      // The legacy key is ignored on purpose: there cannot be a second Home,
      // so there is nothing to derive from.
      expect(importedContentId(type, "")).toBe(SINGLETON_IDS[type]);
      expect(importedContentId(type, "anything")).toBe(SINGLETON_IDS[type]);
    }
  });

  test("refuses to derive a collection ID from an empty key", () => {
    // An empty key would give every Project the same ID.
    for (const type of ["project", "blog_post"] as const) {
      expect(() => importedContentId(type, "")).toThrow();
    }
  });

  test("recognises which types are singletons", () => {
    const singletons: ContentType[] = ["home", "about", "branding"];
    const collections: ContentType[] = ["project", "blog_post"];

    for (const type of singletons) expect(isSingletonType(type)).toBe(true);
    for (const type of collections) expect(isSingletonType(type)).toBe(false);
  });
});

describe("owner-created content IDs", () => {
  test("are random, because nothing needs to recompute them", () => {
    expect(newContentId()).not.toBe(newContentId());
  });
});
