// MXD: state for guest commenting on a public share page.
// (Explicit PrimitiveAtom types: without strictNullChecks, jotai's overloads
// otherwise infer these as read-only atoms.)
import { atom, PrimitiveAtom } from "jotai";

// Set by the shared page when its link allows comments; null otherwise.
export const shareCommentsContextAtom = atom(null) as PrimitiveAtom<{
  shareId: string;
  pageId: string;
} | null>;

// Which panel the share page's right-hand aside shows.
export const shareAsideTabAtom = atom("comments") as PrimitiveAtom<
  "toc" | "comments"
>;

export const activeShareCommentIdAtom = atom(null) as PrimitiveAtom<
  string | null
>;

// The guest's display name, shared by every composer on the page.
export const guestNameAtom = atom("") as PrimitiveAtom<string>;
