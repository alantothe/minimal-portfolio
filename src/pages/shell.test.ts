import { describe, expect, test } from "bun:test";

const shell = await Bun.file(import.meta.dir + "/shell.html").text();
const router = await Bun.file(
  import.meta.dir + "/../public/spa-router.js",
).text();

describe("SPA navigation", () => {
  test("does not fade page content during menu navigation", () => {
    expect(shell).not.toContain(".page-container.active.navigating");
    expect(router).not.toContain("pageContainer.classList.add('navigating')");
  });
});
