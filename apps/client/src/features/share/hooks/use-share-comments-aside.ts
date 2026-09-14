// MXD: open the share page's aside on the comments panel (desktop or mobile),
// and route clicks on inline comment highlights to their thread.
import { useCallback, useEffect } from "react";
import { useSetAtom } from "jotai";
import {
  mobileTableOfContentAsideAtom,
  tableOfContentAsideAtom,
} from "@/features/share/atoms/sidebar-atom.ts";
import {
  activeShareCommentIdAtom,
  shareAsideTabAtom,
} from "@/features/share/atoms/share-comments-atom";

const MOBILE_QUERY = "(max-width: 48em)"; // Mantine `sm`, the AppShell breakpoint

export function scrollToThread(commentId: string) {
  // wait for the aside to open / the thread to render
  setTimeout(() => {
    document
      .querySelector(`div[data-comment-id="${commentId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 400);
}

export function useOpenShareComments() {
  const setTab = useSetAtom(shareAsideTabAtom);
  const setDesktopOpen = useSetAtom(tableOfContentAsideAtom);
  const setMobileOpen = useSetAtom(mobileTableOfContentAsideAtom);
  const setActive = useSetAtom(activeShareCommentIdAtom);

  return useCallback(
    (commentId?: string) => {
      setTab("comments");
      if (window.matchMedia(MOBILE_QUERY).matches) {
        setMobileOpen(true);
      } else {
        setDesktopOpen(true);
      }
      if (commentId) {
        setActive(commentId);
        scrollToThread(commentId);
      }
    },
    [setTab, setDesktopOpen, setMobileOpen, setActive],
  );
}

export function useShareCommentHighlightClicks(enabled: boolean) {
  const openComments = useOpenShareComments();

  useEffect(() => {
    if (!enabled) return;
    const onActiveComment = (event: Event) => {
      const { commentId, resolved } = (event as CustomEvent).detail ?? {};
      if (!commentId || resolved) return;
      openComments(commentId);
    };
    document.addEventListener("ACTIVE_COMMENT_EVENT", onActiveComment);
    return () =>
      document.removeEventListener("ACTIVE_COMMENT_EVENT", onActiveComment);
  }, [enabled, openComments]);
}
