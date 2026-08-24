import { describe, expect, test } from "bun:test";

const projectStyles = await Bun.file(
  import.meta.dir + "/projects/styles.css"
).text();

function mediaBody(query: string): string {
  const start = projectStyles.indexOf(`@media ${query}`);
  if (start === -1) return "";

  const open = projectStyles.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < projectStyles.length; index += 1) {
    if (projectStyles[index] === "{") depth += 1;
    if (projectStyles[index] === "}") depth -= 1;
    if (depth === 0) return projectStyles.slice(open + 1, index);
  }
  return "";
}

describe("Project card interaction on phones", () => {
  test("touch hover cannot activate the orbit lighting", () => {
    const phoneStyles = mediaBody("(max-width: 480px)");

    expect(phoneStyles).toMatch(
      /\.project-card:is\(:hover, :focus-within\)::before\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*0;/
    );
    expect(phoneStyles).toMatch(
      /\.project-card:is\(:hover, :focus-within\)\s*\{[^}]*background:\s*#0c0c0c;/
    );
    expect(phoneStyles).toMatch(
      /\.project-card:is\(:hover, :focus-within\) \.project-arrow-ring-progress\s*\{[^}]*animation:\s*none;[^}]*stroke-dashoffset:\s*100;/
    );
  });
});
