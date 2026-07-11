import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Renders assistant/DB-sourced markdown as sanitized HTML. This content is
// untrusted — it originated from the LLM or round-tripped through the DB — so it
// is NEVER rendered raw. The pipeline is: marked → HTML string → DOMPurify with
// a tag/attribute allowlist → dangerouslySetInnerHTML on the purified result.
// DOMPurify is the trust boundary here; `dangerouslySetInnerHTML` only ever sees
// its output, never the raw model text.

// Restrained allowlist: the formatting an assistant realistically emits, nothing
// that can script or embed. No <img>, <iframe>, <style>, <form>, event handlers.
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];
const ALLOWED_ATTR = ['href', 'title'];

// Force any surviving <a> to open safely and drop referrer/opener. Registered
// once at module load. DOMPurify runs this on every anchor node it keeps.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

// marked in synchronous mode (no async extensions), GitHub-flavored line breaks
// so a single newline becomes <br> as users expect in chat.
marked.setOptions({ async: false, gfm: true, breaks: true });

function renderSafeHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Belt-and-braces: forbid these even if they somehow reach the allowlist.
    FORBID_TAGS: ['style', 'script', 'iframe', 'img', 'form'],
    FORBID_ATTR: ['style', 'srcset', 'src'],
  });
}

export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => renderSafeHtml(content), [content]);
  return (
    <div
      className="chat-markdown text-sm leading-relaxed"
      // Safe: `html` is DOMPurify output, not raw model text (see file header).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
