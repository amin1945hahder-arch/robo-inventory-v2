import { useMemo } from "react";
import { renderMarkdown } from "@/lib/markdown";

/**
 * Renders README markdown with GitHub-style typography. The descendant
 * selectors are literal class strings so Tailwind picks them up; the content
 * itself is sanitized HTML (see src/lib/markdown.ts).
 */
const MD_STYLE = [
  "text-[15px] leading-relaxed text-foreground/90",
  // headings
  "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:border-b [&_h1]:pb-2 [&_h1]:border-border/60 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:first:mt-0",
  "[&_h2]:mt-6 [&_h2]:mb-2.5 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight",
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold",
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold",
  // text
  "[&_p]:my-3 [&_p]:first:mt-0",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:opacity-80",
  // lists (incl. GFM task lists)
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
  "[&_li:has(>input)]:flex [&_li:has(>input)]:items-start [&_li:has(>input)]:gap-2",
  "[&_input]:mt-1 [&_input]:accent-primary",
  // quotes, code
  "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/50 [&_pre]:p-4",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13px]",
  // tables
  "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
  // media + embeds
  "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border/60",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_.md-embed]:my-4 [&_.md-embed]:overflow-hidden [&_.md-embed]:rounded-xl [&_.md-embed]:border [&_.md-embed]:border-border/60",
  "[&_.md-embed>iframe]:aspect-video [&_.md-embed>iframe]:w-full [&_.md-embed>iframe]:border-0",
  "[&_.md-embed>video]:aspect-video [&_.md-embed>video]:w-full [&_.md-embed>video]:bg-black",
  "[&_audio]:my-3 [&_audio]:w-full",
].join(" ");

export function MarkdownView({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const html = useMemo(() => renderMarkdown(markdown ?? ""), [markdown]);
  if (!html) return null;
  return (
    <div
      className={`${MD_STYLE} ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
