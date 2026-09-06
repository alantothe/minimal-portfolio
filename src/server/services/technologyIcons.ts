import * as simpleIcons from "simple-icons";
import type { SimpleIcon } from "simple-icons";

/**
 * Deliberately small owner-facing catalogue. Simple Icons contains thousands
 * of brands; this list keeps the Project editor useful without turning it into
 * an icon directory. Free-form labels remain available for uncommon tools.
 */
export const TECHNOLOGY_LIBRARY = [
  "Angular",
  "Astro",
  "GitHub",
  "Bun",
  "GitLab",
  "Cloudflare",
  "CSS",
  "Deno",
  "Django",
  "Docker",
  ".NET",
  "Drizzle",
  "FastAPI",
  "Firebase",
  "Flask",
  "Git",
  "GitHub Actions",
  "Go",
  "Google Cloud",
  "GraphQL",
  "HTML5",
  "Vite",
  "JavaScript",
  "Kotlin",
  "Kubernetes",
  "Laravel",
  "MongoDB",
  "MySQL",
  "Next.js",
  "Node.js",
  "Payload CMS",
  "PayPal",
  "PHP",
  "PostgreSQL",
  "Prisma",
  "Python",
  "Railway",
  "React",
  "Redis",
  "Ruby",
  "Ruby on Rails",
  "Rust",
  "SQLite",
  "Stripe",
  "Supabase",
  "Svelte",
  "Swift",
  "Tailwind CSS",
  "TypeScript",
  "Vercel",
  "Vue.js",
  "WordPress",
] as const;

function key(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isSimpleIcon(value: unknown): value is SimpleIcon {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<SimpleIcon>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.slug === "string" &&
    typeof candidate.hex === "string" &&
    typeof candidate.path === "string"
  );
}

const iconsByName = new Map<string, SimpleIcon>();

for (const value of Object.values(simpleIcons)) {
  if (!isSimpleIcon(value)) continue;
  iconsByName.set(key(value.title), value);
  iconsByName.set(key(value.slug), value);
}

const technologyAliases = new Map<string, readonly string[]>([
  ["net", ["dotnet"]],
  ["azure", ["microsoftazure"]],
  ["ts", ["typescript"]],
  ["next", ["nextdotjs"]],
  ["nextjs", ["nextdotjs"]],
  ["payload", ["payloadcms"]],
  ["postgres", ["postgresql"]],
  ["fastapi", ["fastapi"]],
  ["vertexai", ["googlecloud"]],
  ["googlevertexai", ["googlecloud"]],
  ["bunjs", ["bun"]],
  ["html", ["html5"]],
  ["css3", ["css"]],
  ["htmlcss", ["html5", "css"]],
  ["md", ["markdown"]],
  ["railwayapp", ["railway"]],
]);

/**
 * Resolve owner-entered labels against Simple Icons. Exact brand titles and
 * slugs work automatically; aliases cover common shorthand and compound names.
 */
export function technologyIcons(label: string): readonly SimpleIcon[] {
  const normalized = key(label);
  const iconNames = technologyAliases.get(normalized) ?? [normalized];

  return iconNames
    .map((name) => iconsByName.get(name))
    .filter((icon): icon is SimpleIcon => icon !== undefined);
}
