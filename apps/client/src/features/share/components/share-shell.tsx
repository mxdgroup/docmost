import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Group,
  ScrollArea,
  Tooltip,
} from "@mantine/core";
import { useGetSharedPageTreeQuery } from "@/features/share/queries/share-query.ts";
import { useParams } from "react-router-dom";
import SharedTree from "@/features/share/components/shared-tree.tsx";
import { TableOfContents } from "@/features/editor/components/table-of-contents/table-of-contents.tsx";
import { readOnlyEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import { useAtomValue, useSetAtom } from "jotai";
import { useAtom } from "jotai";
import {
  sharedPageFullWidthAtom,
  sharedPageTreeAtom,
  sharedTreeDataAtom,
} from "@/features/share/atoms/shared-page-atom";
import { buildSharedPageTree } from "@/features/share/utils";
import {
  desktopSidebarAtom,
  mobileSidebarAtom,
  sidebarWidthAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import SidebarToggle from "@/components/ui/sidebar-toggle-button.tsx";
import { useTranslation } from "react-i18next";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import {
  mobileTableOfContentAsideAtom,
  tableOfContentAsideAtom,
} from "@/features/share/atoms/sidebar-atom.ts";
import {
  IconArrowsHorizontal,
  IconList,
  IconMessage,
} from "@tabler/icons-react";
import {
  guestNameAtom,
  shareAsideTabAtom,
  shareCommentsContextAtom,
} from "@/features/share/atoms/share-comments-atom";
import { getGuestName } from "@/features/share/guest-identity";
import SharedCommentsPanel from "@/features/share/components/shared-comments-panel";
import CommenterBanner from "@/features/share/components/commenter-banner";
import classes from "./share.module.css";
import {
  SearchControl,
  SearchMobileControl,
} from "@/features/search/components/search-control.tsx";
import { ShareSearchSpotlight } from "@/features/search/components/share-search-spotlight.tsx";
import { shareSearchSpotlight } from "@/features/search/constants";
import { MAIN_CONTENT_ID, SkipToMain } from "@/components/ui/skip-to-main.tsx";

const MemoizedSharedTree = React.memo(SharedTree);

export default function ShareShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);
  const toggleDesktop = useToggleSidebar(desktopSidebarAtom);

  const [tocOpened, setTocOpened] = useAtom(tableOfContentAsideAtom);
  const [mobileTocOpened, setMobileTocOpened] = useAtom(
    mobileTableOfContentAsideAtom,
  );
  // MXD: the aside hosts either the table of contents or, on commentable
  // links, the comments panel. A header button re-targets or closes it.
  const commentsContext = useAtomValue(shareCommentsContextAtom);
  const [asideTab, setAsideTab] = useAtom(shareAsideTabAtom);
  const setGuestNameAtom = useSetAtom(guestNameAtom);
  const activeAsideTab = commentsContext ? asideTab : "toc";

  useEffect(() => {
    setGuestNameAtom(getGuestName());
  }, [setGuestNameAtom]);

  const toggleAside = (tab: "toc" | "comments", mobile: boolean) => {
    const isOpen = mobile ? mobileTocOpened : tocOpened;
    const setOpen = mobile ? setMobileTocOpened : setTocOpened;
    if (isOpen && activeAsideTab === tab) {
      setOpen(false);
      return;
    }
    setAsideTab(tab);
    setOpen(true);
  };
  const toggleTocMobile = () => toggleAside("toc", true);
  const toggleToc = () => toggleAside("toc", false);
  const [fullWidth, setFullWidth] = useAtom(sharedPageFullWidthAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !sidebarRef.current) return;
      const newWidth =
        e.clientX - sidebarRef.current.getBoundingClientRect().left;
      if (newWidth < 220) {
        setSidebarWidth(220);
        return;
      }
      if (newWidth > 600) {
        setSidebarWidth(600);
        return;
      }
      setSidebarWidth(newWidth);
    },
    [isResizing, setSidebarWidth],
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  const { shareId } = useParams();
  const { data } = useGetSharedPageTreeQuery(shareId);
  const readOnlyEditor = useAtomValue(readOnlyEditorAtom);

  // @ts-ignore
  const setSharedPageTree = useSetAtom(sharedPageTreeAtom);
  // @ts-ignore
  const setSharedTreeData = useSetAtom(sharedTreeDataAtom);

  // Build and set the tree data when it changes
  const treeData = useMemo(() => {
    if (!data?.pageTree) return null;
    return buildSharedPageTree(data.pageTree);
  }, [data?.pageTree]);

  useEffect(() => {
    setSharedPageTree(data || null);
    setSharedTreeData(treeData);
  }, [data, treeData, setSharedPageTree, setSharedTreeData]);

  return (
    <>
      <SkipToMain />
      <AppShell
      header={{ height: 50 }}
      {...(data?.pageTree?.length > 1 && {
        navbar: {
          width: sidebarWidth,
          breakpoint: "sm",
          collapsed: {
            mobile: !mobileOpened,
            desktop: !desktopOpened,
          },
        },
      })}
      {...(commentsContext && { footer: { height: 48 } })}
      aside={{
        width: activeAsideTab === "comments" ? 360 : 300,
        breakpoint: "sm",
        collapsed: {
          mobile: !mobileTocOpened,
          desktop: !tocOpened,
        },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group wrap="nowrap" justify="space-between" py="sm" px="xl">
          <Group wrap="nowrap">
            {data?.pageTree?.length > 1 && (
              <>
                <Tooltip label={t("Sidebar toggle")}>
                  <SidebarToggle
                    aria-label={t("Sidebar toggle")}
                    opened={mobileOpened}
                    onClick={toggleMobile}
                    hiddenFrom="sm"
                    size="sm"
                  />
                </Tooltip>

                <Tooltip label={t("Sidebar toggle")}>
                  <SidebarToggle
                    aria-label={t("Sidebar toggle")}
                    opened={desktopOpened}
                    onClick={toggleDesktop}
                    visibleFrom="sm"
                    size="sm"
                  />
                </Tooltip>
              </>
            )}
          </Group>

          {shareId && (
            <Group visibleFrom="sm">
              <SearchControl onClick={shareSearchSpotlight.open} />
            </Group>
          )}

          <Group>
            <>
              {shareId && (
                <Group hiddenFrom="sm">
                  <SearchMobileControl onSearch={shareSearchSpotlight.open} />
                </Group>
              )}

              {commentsContext && (
                <>
                  <Tooltip label={t("Comments")} withArrow>
                    <ActionIcon
                      variant={
                        mobileTocOpened && activeAsideTab === "comments"
                          ? "light"
                          : "default"
                      }
                      style={{ border: "none" }}
                      onClick={() => toggleAside("comments", true)}
                      hiddenFrom="sm"
                      size="sm"
                      aria-label={t("Comments")}
                    >
                      <IconMessage size={20} stroke={2} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t("Comments")} withArrow>
                    <ActionIcon
                      variant={
                        tocOpened && activeAsideTab === "comments"
                          ? "light"
                          : "default"
                      }
                      style={{ border: "none" }}
                      onClick={() => toggleAside("comments", false)}
                      visibleFrom="sm"
                      size="sm"
                      aria-label={t("Comments")}
                    >
                      <IconMessage size={20} stroke={2} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}

              <Tooltip label={t("Table of contents")} withArrow>
                <ActionIcon
                  variant="default"
                  style={{ border: "none" }}
                  onClick={toggleTocMobile}
                  hiddenFrom="sm"
                  size="sm"
                  aria-label={t("Table of contents")}
                >
                  <IconList size={20} stroke={2} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label={t("Table of contents")} withArrow>
                <ActionIcon
                  variant="default"
                  style={{ border: "none" }}
                  aria-label={t("Table of contents")}
                  onClick={toggleToc}
                  visibleFrom="sm"
                  size="sm"
                >
                  <IconList size={20} stroke={2} />
                </ActionIcon>
              </Tooltip>

              <Tooltip label={t("Full width")} withArrow>
                <ActionIcon
                  variant={fullWidth ? "light" : "default"}
                  style={fullWidth ? undefined : { border: "none" }}
                  aria-label={t("Full width")}
                  aria-pressed={fullWidth}
                  onClick={() => setFullWidth((v) => !v)}
                  visibleFrom="sm"
                  size="sm"
                >
                  <IconArrowsHorizontal size={20} stroke={2} />
                </ActionIcon>
              </Tooltip>
            </>

            <ThemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      {data?.pageTree?.length > 1 && (
        <AppShell.Navbar p="md" className={classes.navbar} ref={sidebarRef}>
          <div
            className={classes.resizeHandle}
            onMouseDown={startResizing}
          />
          <MemoizedSharedTree sharedPageTree={data} />
        </AppShell.Navbar>
      )}

      <AppShell.Main id={MAIN_CONTENT_ID} tabIndex={-1}>
        {children}

      </AppShell.Main>

      <AppShell.Aside
        p="md"
        withBorder={mobileTocOpened}
        className={classes.aside}
      >
        {activeAsideTab === "comments" && commentsContext ? (
          <SharedCommentsPanel
            key={`${commentsContext.shareId}:${commentsContext.pageId}`}
            shareId={commentsContext.shareId}
            pageId={commentsContext.pageId}
          />
        ) : (
          <ScrollArea style={{ height: "80vh" }} scrollbarSize={5} type="scroll">
            <div style={{ paddingBottom: "50px" }}>
              {readOnlyEditor && (
                <TableOfContents isShare={true} editor={readOnlyEditor} />
              )}
            </div>
          </ScrollArea>
        )}
      </AppShell.Aside>

      {commentsContext && (
        <AppShell.Footer>
          <CommenterBanner
            shareId={commentsContext.shareId}
            pageId={commentsContext.pageId}
            sharePath={commentsContext.sharePath}
          />
        </AppShell.Footer>
      )}

      <ShareSearchSpotlight shareId={shareId} />
    </AppShell>
    </>
  );
}
