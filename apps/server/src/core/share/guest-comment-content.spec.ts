import { sanitizeGuestCommentContent } from './guest-comment-content';

const doc = (...content: any[]) => ({ type: 'doc', content });
const p = (...content: any[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: any[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});

describe('sanitizeGuestCommentContent', () => {
  it('keeps plain prose, lists, blockquotes, and allowed marks', () => {
    const input = doc(
      p(text('hello '), text('bold', [{ type: 'bold' }])),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(text('item'))] }],
      },
      { type: 'blockquote', content: [p(text('quoted'))] },
    );
    const out = sanitizeGuestCommentContent(input);
    expect(out).toEqual(input);
  });

  it('strips iframe/embed/video/mention/attachment nodes entirely', () => {
    for (const type of [
      'iframe',
      'embed',
      'video',
      'mention',
      'attachment',
      'image',
      'codeBlock',
      'transclusion',
    ]) {
      const out = sanitizeGuestCommentContent(
        doc(p(text('ok')), { type, attrs: { src: 'http://x' } }),
      );
      expect(JSON.stringify(out)).not.toContain(`"${type}"`);
      expect(JSON.stringify(out)).toContain('ok');
    }
  });

  it('rejects javascript: and data: link hrefs but keeps https links', () => {
    const out = sanitizeGuestCommentContent(
      doc(
        p(
          text('evil', [
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
          ]),
          text('data', [{ type: 'link', attrs: { href: 'data:text/html,x' } }]),
          text('good', [
            {
              type: 'link',
              attrs: { href: 'https://example.com', target: '_parent' },
            },
          ]),
        ),
      ),
    );
    const s = JSON.stringify(out);
    expect(s).not.toContain('javascript:');
    expect(s).not.toContain('data:text');
    expect(s).toContain('https://example.com');
    expect(s).not.toContain('_parent'); // extra attrs dropped
  });

  it('strips disallowed marks (e.g. textStyle/comment) but keeps the text', () => {
    const out = sanitizeGuestCommentContent(
      doc(
        p(
          text('styled', [
            { type: 'textStyle', attrs: { color: 'red' } },
            { type: 'comment', attrs: { id: 'c1' } },
            { type: 'italic' },
          ]),
        ),
      ),
    );
    const marks = out.content[0].content[0].marks;
    expect(marks).toEqual([{ type: 'italic' }]);
  });

  it('returns null for empty, non-doc, or fully-stripped input', () => {
    expect(sanitizeGuestCommentContent(null)).toBeNull();
    expect(sanitizeGuestCommentContent({ type: 'paragraph' })).toBeNull();
    expect(
      sanitizeGuestCommentContent(doc({ type: 'iframe', attrs: {} })),
    ).toBeNull();
    expect(sanitizeGuestCommentContent(doc())).toBeNull();
  });

  it('survives malformed nodes without throwing', () => {
    expect(
      sanitizeGuestCommentContent(
        doc(p(text('x'), { type: 42 } as any, null as any, {
          notype: true,
        } as any)),
      ),
    ).toEqual(doc(p(text('x'))));
  });

  it('caps recursion depth — a pathologically deep doc does not overflow the stack', () => {
    // build a 5000-deep nesting of allowed containers
    let node: any = { type: 'paragraph', content: [{ type: 'text', text: 'x' }] };
    for (let i = 0; i < 5000; i++) {
      node = { type: 'blockquote', content: [node] };
    }
    const doc = { type: 'doc', content: [node] };
    // must return (null or a truncated doc) without throwing
    let out: any;
    expect(() => {
      out = sanitizeGuestCommentContent(doc);
    }).not.toThrow();
  });

  it('caps total node count — a very wide doc is bounded', () => {
    const wide = {
      type: 'doc',
      content: Array.from({ length: 10000 }, () => ({
        type: 'paragraph',
        content: [{ type: 'text', text: 'x' }],
      })),
    };
    const out = sanitizeGuestCommentContent(wide);
    // survives without throwing; node budget truncates the tail
    expect(out === null || out.content.length < 10000).toBe(true);
  });
});
