/**
 * Projects API handlers for listing projects and fetching individual projects
 */

import { readMarkdownFile, generateSlug } from "../services/markdown";
import { fileExists } from "../core/file";
import { createSeoMetadata } from "../services/seo";
import { readdirSync } from "fs";
import { join } from "path";
import { DELIVERY_HOST } from "../media/config";
import { technologyIcons } from "../services/technologyIcons";

const PROJECTS_CONTENT_DIR = "./src/content/projects";

export interface ProjectSummary {
  slug: string;
  title: string;
  description?: string;
  technologies?: string[];
  image?: string;
  date?: string;
  order?: number;
}

export interface ProjectDetail {
  slug: string;
  metadata: Record<string, any>;
  html: string;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function projectTechnologies(metadata: Record<string, any>): string[] {
  const raw = Array.isArray(metadata.technologies)
    ? metadata.technologies
    : Array.isArray(metadata.stack)
      ? metadata.stack
      : [];

  return raw
    .filter(
      (technology): technology is string => typeof technology === "string"
    )
    .map((technology) => technology.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function renderTechnologyBadges(
  technologies: readonly string[]
): string {
  const normalized = projectTechnologies({ technologies });
  if (normalized.length === 0) return "";

  return `<ul class="project-technologies project-technologies--article" aria-label="Technologies used">
    ${normalized
      .map((technology) => {
        const icons = technologyIcons(technology);
        const brand = icons[0]?.hex ?? "596873";
        const logos = icons
          .map(
            (icon) =>
              `<span class="technology-badge__logo-frame" style="--technology-icon: #${icon.hex}"><svg class="technology-badge__logo" data-brand="${escapeHtml(icon.title)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="${icon.path}"></path></svg></span>`
          )
          .join("");

        return `<li class="technology-badge${icons.length === 0 ? " technology-badge--unbranded" : ""}" style="--technology-brand: #${brand}">${logos ? `<span class="technology-badge__logos">${logos}</span>` : ""}<span>${escapeHtml(technology)}</span></li>`;
      })
      .join("")}
  </ul>`;
}

interface ProjectImage {
  src: string;
  alt: string;
  caption: string;
}

interface ProjectVideo {
  src: string;
  poster: string | null;
  caption: string;
}

function safeLocalMediaUrl(value: string, extensions: RegExp): string | null {
  if (
    !value.startsWith("/public/") ||
    value.startsWith("//") ||
    value.includes("..") ||
    value.includes("?") ||
    value.includes("#") ||
    !extensions.test(value)
  ) {
    return null;
  }

  return value;
}

function safeProjectImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const local = safeLocalMediaUrl(value, /\.(?:avif|gif|jpe?g|png|webp)$/i);
  if (local) return local;

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === DELIVERY_HOST
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeProjectVideoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const local = safeLocalMediaUrl(value, /\.(?:mp4|webm)$/i);
  if (local) return local;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === DELIVERY_HOST &&
      url.pathname.includes("/video/upload/") &&
      /\.(?:mp4|webm)$/i.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function projectImages(metadata: Record<string, any>): ProjectImage[] {
  const title = typeof metadata.title === "string" ? metadata.title : "Project";
  const gallery = Array.isArray(metadata.gallery) ? metadata.gallery : [];
  const primary = safeProjectImageUrl(metadata.image);
  const images: ProjectImage[] = primary
    ? [{ src: primary, alt: title, caption: "" }]
    : [];

  for (const entry of gallery.slice(0, 8)) {
    const source =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? (entry.src ?? entry.url)
          : null;
    const src = safeProjectImageUrl(source);
    if (!src || images.some((image) => image.src === src)) continue;

    images.push({
      src,
      alt: typeof entry?.alt === "string" ? entry.alt : title,
      caption: typeof entry?.caption === "string" ? entry.caption : "",
    });
  }

  return images;
}

function projectVideo(metadata: Record<string, any>): ProjectVideo | null {
  const raw = metadata.video ?? metadata.videoUrl;
  const source =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? (raw.src ?? raw.url)
        : null;
  const src = safeProjectVideoUrl(source);
  if (!src) return null;

  const rawPoster = raw && typeof raw === "object" ? raw.poster : null;
  return {
    src,
    poster: safeProjectImageUrl(rawPoster),
    caption:
      raw && typeof raw === "object" && typeof raw.caption === "string"
        ? raw.caption
        : "",
  };
}

function renderProjectMedia(metadata: Record<string, any>): string {
  const images = projectImages(metadata);
  const video = projectVideo(metadata);
  const slides = [
    ...images.map(
      (image, index) => `
      <figure class="project-media__slide project-media__slide--image" data-project-media-slide${index === 0 ? ' data-active="true"' : ""}>
        <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="1440" height="900" loading="${index === 0 ? "eager" : "lazy"}" decoding="async">
        ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}
      </figure>`
    ),
    ...(video
      ? [
          `
      <figure class="project-media__slide project-media__slide--video" data-project-media-slide${images.length === 0 ? ' data-active="true"' : ""}>
        <video controls playsinline preload="metadata" width="1920" height="1080"${video.poster ? ` poster="${escapeHtml(video.poster)}"` : ""}>
          <source src="${escapeHtml(video.src)}">
          Your browser does not support embedded video.
        </video>
        ${video.caption ? `<figcaption>${escapeHtml(video.caption)}</figcaption>` : ""}
      </figure>`,
        ]
      : []),
  ];

  if (slides.length === 0) return "";

  const multiple = slides.length > 1;
  return `
    <section class="project-media${multiple ? " project-media--carousel" : ""}" aria-label="Project media" data-project-media${multiple && !video ? ' data-autoplay="true"' : ""}>
      <div class="project-media__viewport">
        ${slides.join("")}
      </div>
      ${
        multiple
          ? `
        <div class="project-media__controls">
          <button type="button" data-project-media-previous aria-label="Previous media">←</button>
          <div class="project-media__dots" role="group" aria-label="Choose media">
            ${slides.map((_, index) => `<button type="button" data-project-media-dot="${index}" aria-label="Show media ${index + 1}"${index === 0 ? ' aria-current="true"' : ""}></button>`).join("")}
          </div>
          <button type="button" data-project-media-next aria-label="Next media">→</button>
        </div>`
          : ""
      }
    </section>`;
}

export function renderProjectArticle(project: ProjectDetail): string {
  const { metadata } = project;
  const media = renderProjectMedia(metadata);
  const technologies = renderTechnologyBadges(projectTechnologies(metadata));
  const description =
    typeof metadata.description === "string" && metadata.description
      ? `<p class="project-dek">${escapeHtml(metadata.description)}</p>`
      : "";

  return `
    <article class="project-case-study">
      <header class="project-article-header">
        <h1>${escapeHtml(metadata.title)}</h1>
        ${description}
        ${technologies}
      </header>
      ${media}
      <div class="project-case-study__body markdown-content">
        ${project.html}
      </div>
    </article>
  `.trim();
}

/**
 * Get all projects with metadata
 */
export async function getAllProjects(): Promise<ProjectSummary[]> {
  try {
    const dirs = readdirSync(PROJECTS_CONTENT_DIR, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    const projects = await Promise.all(
      dirs.map(async (dir): Promise<ProjectSummary | null> => {
        try {
          const filePath = join(PROJECTS_CONTENT_DIR, dir, "content.md");
          const project = await readMarkdownFile(filePath);

          return {
            slug: dir,
            title: project.metadata.title,
            description: project.metadata.description,
            technologies: projectTechnologies(project.metadata),
            image: project.metadata.image,
            date: project.metadata.date,
            order:
              typeof project.metadata.order === "number"
                ? project.metadata.order
                : undefined,
          };
        } catch (error) {
          console.error(`Error reading project ${dir}:`, error);
          return null;
        }
      })
    );

    // Explicit portfolio order wins. Date remains the fallback for older content.
    const valid = projects.filter((p): p is ProjectSummary => p !== null);
    valid.sort((a, b) => {
      if (a.order !== undefined || b.order !== undefined) {
        return (
          (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER)
        );
      }
      if (a.date && b.date) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
      return 0;
    });
    return valid;
  } catch (error) {
    console.error("Error reading projects:", error);
    return [];
  }
}

/**
 * Get a single project by slug
 */
export async function getProjectBySlug(
  slug: string
): Promise<ProjectDetail | null> {
  try {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return null;
    }

    const filePath = join(PROJECTS_CONTENT_DIR, slug, "content.md");
    if (!(await fileExists(filePath))) {
      return null;
    }

    const project = await readMarkdownFile(filePath);

    return {
      slug,
      metadata: project.metadata,
      html: project.html,
    };
  } catch (error) {
    console.error("Error reading project:", error);
    return null;
  }
}

/**
 * Handler for /api/projects/list - returns list of all projects
 */
export async function projectsListHandler(): Promise<Response> {
  try {
    const projects = await getAllProjects();

    return new Response(JSON.stringify({ projects }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Error in projects list handler:", error);
    return new Response(JSON.stringify({ error: "Failed to load projects" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handler for /api/projects/:slug - returns single project
 */
export function createProjectHandler(
  url: URL,
  params?: Record<string, string>
) {
  return async (): Promise<Response> => {
    try {
      const slug = params?.slug;

      if (!slug) {
        return new Response(
          JSON.stringify({ error: "Slug parameter is required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const project = await getProjectBySlug(slug);

      if (!project) {
        return new Response(JSON.stringify({ error: "Project not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const renderedHtml = renderProjectArticle(project);
      const seo = createSeoMetadata(
        {
          kind: "project",
          slug: project.slug,
          title: project.metadata.title,
          description: project.metadata.description || "",
        },
        url
      );

      return new Response(
        JSON.stringify({ ...project, html: renderedHtml, seo }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        }
      );
    } catch (error) {
      console.error("Error in project handler:", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
