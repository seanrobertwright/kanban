import type { ReactNode } from "react";

/**
 * A small, safe Markdown subset — rendered to React elements, never to HTML.
 *
 * This is the whole security argument, and it is structural rather than a filter
 * we hope is complete: every literal run of the input becomes a React text child,
 * which React escapes, so `<script>` or `<img onerror=…>` in a comment renders as
 * the characters a person typed and can never become a node. There is no
 * dangerouslySetInnerHTML here and no sanitiser to keep ahead of an attacker —
 * the only nodes that exist are the ones this file constructs from a fixed
 * grammar. That is the promise comment-thread.tsx names: "an agent writes here
 * from M2, and its output is not to be trusted with HTML" (033). An agent report,
 * a pasted stack trace, a user's angle brackets — all safe by construction.
 *
 * The grammar is deliberately small — what a task comment actually uses:
 *   inline: `code`, **bold**, *italic* / _italic_, [text](url)
 *   block:  paragraphs, ``` fenced code, - bullet lists, > blockquotes
 * Anything outside it is left as literal text, which is the safe default.
 */

/** Allow only hrefs that cannot execute script: http(s), mailto, or same-site
 *  relative. A `javascript:` or `data:` URL falls through to null and the link
 *  renders as its literal Markdown text instead. */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u) || u.startsWith("/")) {
    return u;
  }
  return null;
}

// One pattern, several alternations; compiled fresh per call so the recursion
// below (bold/italic parse their own contents) never shares lastIndex.
//   1 code · 2 bold · 3 link-text 4 link-url · 5 italic* · 6 italic_
const INLINE_SOURCE =
  "`([^`]+)`|\\*\\*([\\s\\S]+?)\\*\\*|\\[([^\\]]+?)\\]\\(([^)\\s]+)\\)|\\*([^*\\n]+?)\\*|_([^_\\n]+?)_";

/** Parse one run of text into inline nodes. Recurses for bold/italic contents;
 *  code contents are literal (Markdown does not format inside code). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const re = new RegExp(INLINE_SOURCE, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {m[1]}
        </code>
      );
    } else if (m[2] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[2], key)}</strong>);
    } else if (m[3] !== undefined) {
      const href = safeHref(m[4]);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener nofollow"
            className="text-primary underline underline-offset-2"
          >
            {m[3]}
          </a>
        ) : (
          // Unsafe URL: render the raw Markdown as text rather than a live link.
          m[0]
        )
      );
    } else if (m[5] !== undefined) {
      out.push(<em key={key}>{renderInline(m[5], key)}</em>);
    } else if (m[6] !== undefined) {
      out.push(<em key={key}>{renderInline(m[6], key)}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A paragraph's own newlines become <br> — the newlines someone typed are the
 *  newlines they get, comment-thread.tsx's old whitespace-pre-wrap promise. */
function renderParagraph(lines: string[], key: string): ReactNode {
  const parts: ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) parts.push(<br key={`${key}-br-${idx}`} />);
    parts.push(...renderInline(line, `${key}-l${idx}`));
  });
  return (
    <p key={key} className="leading-6">
      {parts}
    </p>
  );
}

/**
 * Render Markdown-subset `text` as safe React nodes. Blocks are separated by
 * blank lines; a run of "- "/"* " lines is a list, "> " lines a quote, a ```
 * fence a code block, everything else a paragraph.
 */
export function RichText({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line: block separator, skip it.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block: ``` … ``` — contents verbatim, never parsed or executed.
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or run off the end)
      blocks.push(
        <pre
          key={`b${b++}`}
          className="overflow-x-auto rounded bg-muted p-2 text-[0.85em]"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Bullet list: consecutive "- " / "* " lines.
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      const key = `b${b++}`;
      blocks.push(
        <ul key={key} className="list-disc pl-5 leading-6">
          {items.map((it, idx) => (
            <li key={`${key}-${idx}`}>{renderInline(it, `${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Blockquote: consecutive "> " lines.
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const key = `b${b++}`;
      blocks.push(
        <blockquote
          key={key}
          className="border-l-2 border-border pl-3 text-muted-foreground"
        >
          {renderParagraph(quote, key)}
        </blockquote>
      );
      continue;
    }

    // Paragraph: consecutive plain lines until a blank or a special line.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(renderParagraph(para, `b${b++}`));
  }

  return <div className={className ? `grid gap-2 ${className}` : "grid gap-2"}>{blocks}</div>;
}
