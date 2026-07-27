import { describe, expect, test } from "bun:test";
import { ViewCooldown } from "./viewCooldown";

describe("view cooldown", () => {
  test("tracks cooldowns independently per visitor and post", () => {
    let now = 1_000;
    const cooldown = new ViewCooldown({
      now: () => now,
      cooldownMs: 30_000,
    });

    expect(cooldown.shouldCount("post-a", "visitor-a")).toBeTrue();
    expect(cooldown.shouldCount("post-a", "visitor-a")).toBeFalse();
    expect(cooldown.shouldCount("post-a", "visitor-b")).toBeTrue();
    expect(cooldown.shouldCount("post-b", "visitor-a")).toBeTrue();

    now += 30_001;
    expect(cooldown.shouldCount("post-a", "visitor-a")).toBeTrue();
  });

  test("bounds visitor state in memory", () => {
    const cooldown = new ViewCooldown({ maxEntries: 2 });

    expect(cooldown.shouldCount("post", "visitor-a")).toBeTrue();
    expect(cooldown.shouldCount("post", "visitor-b")).toBeTrue();
    expect(cooldown.shouldCount("post", "visitor-c")).toBeTrue();
    expect(cooldown.shouldCount("post", "visitor-a")).toBeTrue();
  });

  test("caps writes even when callers rotate visitor IDs", () => {
    let now = 1_000;
    const cooldown = new ViewCooldown({
      now: () => now,
      maxViewsPerWindow: 2,
      windowMs: 60_000,
    });

    expect(cooldown.shouldCount("post", "visitor-a")).toBeTrue();
    expect(cooldown.shouldCount("post", "visitor-b")).toBeTrue();
    expect(cooldown.shouldCount("post", "visitor-c")).toBeFalse();

    now += 60_001;
    expect(cooldown.shouldCount("post", "visitor-c")).toBeTrue();
  });
});
