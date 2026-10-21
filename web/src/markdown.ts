/**
 * A small markdown renderer for the notes.
 *
 * The text of a note is never trusted, so everything is escaped before the
 * html is built. Only the marks of the notes are understood: the headings,
 * the lists, the quotes, the code, the links, the wiki links and the embeds
 * of the files.
 */

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The inline marks of a line of text. */
function renderInline(text: string, fileToken: string): string {
  const placeholders: string[] = [];
  const masked = text.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the placeholder is exactly what has to be found
    /!\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|`([^`]+)`/g,
    (_match, embed: string | undefined, wiki: string | undefined, code: string | undefined) => {
      if (embed !== undefined) {
        const name = embed.trim();
        const isImage = IMAGE_EXTENSIONS.some((extension) =>
          name.toLowerCase().endsWith(extension),
        );
        if (isImage) {
          const url = `/api/file?path=${encodeURIComponent(`attachments/${name}`)}`;
          const token = fileToken ? `&token=${encodeURIComponent(fileToken)}` : "";
          return `<img src="${url}${token}" alt="${escapeHtml(name)}" loading="lazy" />`;
        }
        const link = `<a href="#" class="embed">${escapeHtml(name)}</a>`;
        placeholders.push(link);
        return `\u0000${placeholders.length - 1}\u0000`;
      }
      if (wiki !== undefined) {
        const link = `<a href="#" class="wiki">${escapeHtml(wiki.trim())}</a>`;
        placeholders.push(link);
        return `\u0000${placeholders.length - 1}\u0000`;
      }
      const html = `<code>${escapeHtml(code ?? "")}</code>`;
      placeholders.push(html);
      return `\u0000${placeholders.length - 1}\u0000`;
    },
  );

  let html = escapeHtml(masked);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // biome-ignore lint/suspicious/noControlCharactersInRegex: the placeholder is exactly what has to be found
  return html.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
    return placeholders[Number(index)] ?? "";
  });
}

/** Turns the text of a note into html. */
export function renderMarkdown(source: string, fileToken = ""): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let quote: string[] = [];
  let code: string[] = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map((line) => renderInline(line, fileToken)).join("<br />")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const tag = ordered ? "ol" : "ul";
    const items = list.map((item) => `<li>${renderInline(item, fileToken)}</li>`).join("");
    blocks.push(`<${tag}>${items}</${tag}>`);
    list = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      `<blockquote>${quote.map((line) => renderInline(line, fileToken)).join("<br />")}</blockquote>`,
    );
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
      } else {
        flushAll();
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(3, (heading[1] ?? "#").length);
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "", fileToken)}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushAll();
      blocks.push("<hr />");
      continue;
    }

    const quoteLine = /^>\s?(.*)$/.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1] ?? "");
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const nextOrdered = Boolean(numbered);
      if (list.length > 0 && ordered !== nextOrdered) flushList();
      ordered = nextOrdered;
      list.push(bullet?.[1] ?? numbered?.[1] ?? "");
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }

  if (inCode && code.length > 0) {
    blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  }
  flushAll();

  return blocks.join("\n");
}
