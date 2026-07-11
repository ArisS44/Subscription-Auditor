import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

// The assistant reply is untrusted (LLM-authored, DB-round-tripped), so these
// tests assert the marked → DOMPurify pipeline strips anything executable before
// it can reach the DOM. This is the security guarantee, not a formatting nicety.
describe('Markdown sanitization', () => {
  function html(content: string): string {
    const { container } = render(<Markdown content={content} />);
    return container.querySelector('.chat-markdown')?.innerHTML ?? '';
  }

  it('strips <script> tags entirely', () => {
    const out = html('Hello <script>window.__pwned = true</script> world');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('__pwned');
  });

  it('strips inline event handlers and img onerror payloads', () => {
    const out = html('<img src=x onerror="alert(1)" />');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out.toLowerCase()).not.toContain('<img');
  });

  it('neutralizes javascript: URLs in links', () => {
    const out = html('[click me](javascript:alert(1))');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('drops iframes and style/script vectors', () => {
    const out = html('<iframe src="https://evil.example"></iframe>');
    expect(out.toLowerCase()).not.toContain('<iframe');
  });

  it('keeps safe formatting (bold, lists, code)', () => {
    const out = html('**bold** and `code`\n\n- one\n- two');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<li>one</li>');
  });

  it('forces external links to open safely', () => {
    const out = html('[example](https://example.com)');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });
});
