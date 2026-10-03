/**
 * GitHub-style Markdown rendering for the project README.
 *
 * - `marked` parses GFM (tables, strikethrough, task lists, fenced code).
 * - Video links on their own line become embeds (YouTube / Vimeo / Google
 *   Drive iframes, direct .mp4/.webm… <video> players) — the README editor
 *   only needs a pasted link, no HTML.
 * - `DOMPurify` sanitizes the final HTML: scripts/event handlers/javascript:
 *   URLs are stripped, iframes are restricted to a whitelist of embed
 *   hosts, and every link opens in a new tab with rel=noopener.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

const VIDEO_ID = "[A-Za-z0-9_-]{6,}";

/** Hosts an <iframe> may point at — anything else is dropped by the sanitizer. */
const IFRAME_SRC = [
  /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{6,}(?:\?.*)?$/,
  /^https:\/\/www\.youtube\.com\/embed\/[\w-]{6,}(?:\?.*)?$/,
  /^https:\/\/player\.vimeo\.com\/video\/\d+(?:\?.*)?$/,
  /^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/preview(?:\?.*)?$/,
];

/** Direct media files play inline with the native <video>/<audio> controls. */
const MEDIA_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v|mp3|wav|ogg)(\?.*)?$/i;

function escapeAttr(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Turn a link into embed HTML, or `null` when it is an ordinary link.
 * Exported for tests.
 */
export function embedFor(rawUrl: string): string | null {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const yt = url.match(
    new RegExp(`(?:https?:\\/\\/(?:www\\.)?youtube\\.com\\/(?:watch\\?v=|shorts\\/|embed\\/)|https?:\\/\\/youtu\\.be/)(${VIDEO_ID})`),
  );
  if (yt) {
    return `<div class="md-embed"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  const vimeo = url.match(new RegExp(`https?:\\/\\/(?:www\\.)?vimeo\\.com\\/(\\d+)`));
  if (vimeo) {
    return `<div class="md-embed"><iframe src="https://player.vimeo.com/video/${vimeo[1]}" title="Vimeo video" loading="lazy" allowfullscreen></iframe></div>`;
  }

  const drive = url.match(new RegExp(`https?:\\/\\/drive\\.google\\.com\\/file\\/d\\/([A-Za-z0-9_-]+)`));
  if (drive) {
    return `<div class="md-embed"><iframe src="https://drive.google.com/file/d/${drive[1]}/preview" title="Google Drive video" loading="lazy" allowfullscreen></iframe></div>`;
  }

  if (MEDIA_EXT.test(url)) {
    const src = escapeAttr(url);
    if (/\.mp3|\.wav$/i.test(url)) return `<audio controls src="${src}"></audio>`;
    return `<div class="md-embed"><video controls playsinline src="${src}"></video></div>`;
  }
  return null;
}

/** A line that is nothing but a link: `[label](url)` or a bare URL (optionally wrapped in <>). */
function lineLink(trimmed: string): string | null {
  const angled = /^<(.+)>$/.exec(trimmed);
  const bare = (angled ? angled[1] : trimmed).trim();
  const md = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/.exec(bare);
  if (md) return md[2];
  if (/^https?:\/\/\S+$/.test(bare)) return bare;
  return null;
}

/**
 * Replace standalone video-link lines with embed HTML, skipping fenced code
 * blocks. Exported for tests.
 */
export function preprocessVideos(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      const t = line.trim();
      if (/^(```|~~~)/.test(t)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !t) return line;
      const url = lineLink(t);
      if (!url) return line;
      const embed = embedFor(url);
      return embed ?? line;
    })
    .join("\n");
}

let hooksInstalled = false;
function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (el.tagName === "IFRAME") {
      const src = el.getAttribute("src") ?? "";
      if (!IFRAME_SRC.some((re) => re.test(src))) el.remove();
    }
    if (el.tagName === "VIDEO" || el.tagName === "AUDIO" || el.tagName === "SOURCE") {
      const src = el.getAttribute("src") ?? "";
      if (!/^https?:\/\//i.test(src)) el.remove();
    }
  });
}

/** Render markdown → sanitized HTML ready for dangerouslySetInnerHTML. */
export function renderMarkdown(markdown: string): string {
  if (!markdown?.trim()) return "";
  installHooks();
  const withEmbeds = preprocessVideos(markdown);
  let html: string;
  try {
    html = marked.parse(withEmbeds, { gfm: true, breaks: false, async: false }) as string;
  } catch {
    return "";
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["iframe", "video", "audio", "source"],
    ADD_ATTR: [
      "allow",
      "allowfullscreen",
      "allowTransparency",
      "controls",
      "frameborder",
      "loading",
      "playsinline",
      "target",
      "rel",
    ],
  });
}
