import { describe, expect, it } from "vitest";
import { embedFor, preprocessVideos, renderMarkdown } from "./markdown";

describe("renderMarkdown — GFM", () => {
  it("renders headings, emphasis and paragraphs", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and *italic* text.");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders tables (GFM)", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("const a = 1;");
  });

  it("renders lists", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders images from links", () => {
    const html = renderMarkdown("![diagram](https://example.com/d.png)");
    expect(html).toContain('<img src="https://example.com/d.png"');
    expect(html).toContain('alt="diagram"');
  });

  it("keeps Arabic text intact", () => {
    const html = renderMarkdown("# عنوان المشروع\n\nهذه فقرة باللغة العربية.");
    expect(html).toContain("عنوان المشروع");
    expect(html).toContain("هذه فقرة باللغة العربية.");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n  ")).toBe("");
  });
});

describe("renderMarkdown — sanitization", () => {
  it("strips script tags", () => {
    const html = renderMarkdown('hello <script>alert("x")</script> world');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: URLs", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("forces links to open in a new tab safely", () => {
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("removes iframes that are not on the embed whitelist", () => {
    const html = renderMarkdown('<iframe src="https://evil.example.com/x"></iframe>');
    expect(html).not.toContain("evil.example.com");
  });
});

describe("embedFor", () => {
  it("embeds a YouTube watch URL", () => {
    const html = embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(html).toContain('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
  });

  it("embeds a youtu.be short URL", () => {
    const html = embedFor("https://youtu.be/dQw4w9WgXcQ");
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("embeds a YouTube Shorts URL", () => {
    const html = embedFor("https://www.youtube.com/shorts/abcDEF12345");
    expect(html).toContain("youtube-nocookie.com/embed/abcDEF12345");
  });

  it("embeds a Vimeo URL", () => {
    const html = embedFor("https://vimeo.com/123456789");
    expect(html).toContain('<iframe src="https://player.vimeo.com/video/123456789"');
  });

  it("embeds a Google Drive file URL", () => {
    const html = embedFor("https://drive.google.com/file/d/abc-XYZ_123/view?usp=sharing");
    expect(html).toContain("https://drive.google.com/file/d/abc-XYZ_123/preview");
  });

  it("plays direct video files inline", () => {
    const html = embedFor("https://cdn.example.com/demo.mp4");
    expect(html).toContain("<video");
    expect(html).toContain('src="https://cdn.example.com/demo.mp4"');
  });

  it("plays direct audio files inline", () => {
    const html = embedFor("https://cdn.example.com/demo.mp3");
    expect(html).toContain("<audio");
  });

  it("returns null for ordinary links", () => {
    expect(embedFor("https://example.com/page")).toBeNull();
    expect(embedFor("not a url")).toBeNull();
  });
});

describe("preprocessVideos", () => {
  it("replaces a standalone link line with an embed", () => {
    const out = preprocessVideos("Intro\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nOutro");
    expect(out).toContain("<iframe");
    expect(out).toContain("Intro");
    expect(out).toContain("Outro");
  });

  it("replaces a markdown video link line", () => {
    const out = preprocessVideos("[Demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)");
    expect(out).toContain("<iframe");
    expect(out).not.toContain("[Demo]");
  });

  it("leaves links inside fenced code blocks alone", () => {
    const out = preprocessVideos("```\nhttps://youtu.be/dQw4w9WgXcQ\n```");
    expect(out).not.toContain("<iframe");
    expect(out).toContain("https://youtu.be/dQw4w9WgXcQ");
  });

  it("leaves non-video links as-is", () => {
    const out = preprocessVideos("https://example.com/docs");
    expect(out).toBe("https://example.com/docs");
    expect(out).not.toContain("<iframe");
  });
});

describe("renderMarkdown — end-to-end embeds", () => {
  it("renders a YouTube link line as a sanitized iframe", () => {
    const html = renderMarkdown("Watch the match:\n\nhttps://youtu.be/dQw4w9WgXcQ");
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("drops a non-whitelisted iframe that came through markdown", () => {
    const html = renderMarkdown('<div class="md-embed"><iframe src="https://evil.example.com/x"></iframe></div>');
    expect(html).not.toContain("evil.example.com");
  });
});
