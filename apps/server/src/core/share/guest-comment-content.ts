// MXD: content policy for guest-authored comment bodies.
//
// Unauthenticated posters get a restricted ProseMirror vocabulary: basic
// prose only. Everything else — embeds, iframes-as-nodes, mentions (a spam
// vector: a guest mention would trigger a notification to any user id they
// can guess), attachments, media — is stripped structurally, node-by-node.
// Marks are allowlisted too; link hrefs must be http(s). Sanitization is
// enforced server-side at the trust boundary, never delegated to the client.
const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'text',
  'hardBreak',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
]);

const ALLOWED_MARKS = new Set(['bold', 'italic', 'strike', 'code', 'link']);

function sanitizeMarks(marks: any[]): any[] {
  if (!Array.isArray(marks)) return [];
  return marks.filter((mark) => {
    if (!mark || typeof mark.type !== 'string') return false;
    if (!ALLOWED_MARKS.has(mark.type)) return false;
    if (mark.type === 'link') {
      const href = String(mark.attrs?.href ?? '');
      if (!/^https?:\/\//i.test(href)) return false;
      // keep only the href attribute; drop targets/classes/rel injections
      mark.attrs = { href };
    }
    return true;
  });
}

function sanitizeNode(node: any): any | null {
  if (!node || typeof node.type !== 'string') return null;
  if (!ALLOWED_NODES.has(node.type)) return null;

  const clean: any = { type: node.type };
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || node.text.length === 0) return null;
    clean.text = node.text;
    const marks = sanitizeMarks(node.marks);
    if (marks.length) clean.marks = marks;
    return clean;
  }

  if (Array.isArray(node.content)) {
    const children = node.content
      .map((child: any) => sanitizeNode(child))
      .filter((child: any) => child !== null);
    if (children.length) clean.content = children;
  }
  return clean;
}

// Returns a sanitized copy, or null when nothing survivable remains.
export function sanitizeGuestCommentContent(content: any): any | null {
  const doc = sanitizeNode(content);
  if (!doc || doc.type !== 'doc' || !doc.content?.length) return null;
  return doc;
}
