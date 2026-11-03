import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

export default function MarkdownPreview({ text, path, onOpen }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { async: false }), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["form", "input", "button", "style", "iframe"],
        FORBID_ATTR: ["style"],
      }),
    [text],
  );
  return (
    <div
      className="markdown-preview"
      onClick={(event) => {
        const anchor = event.target.closest("a");
        if (!anchor || !event.currentTarget.contains(anchor)) return;
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        event.preventDefault();
        let base, url;
        try {
          base = new URL(
            path || "README.md",
            "https://studio-project.invalid/",
          );
          url = new URL(href, base);
        } catch {
          return;
        }
        if (url.origin === base.origin) {
          try {
            onOpen?.(decodeURIComponent(url.pathname.slice(1)));
          } catch {
            // Ignore malformed local references rather than losing the preview.
          }
        } else if (["https:", "http:", "mailto:"].includes(url.protocol))
          window.open(url.href, "_blank", "noopener,noreferrer");
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
