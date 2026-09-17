import { useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import { useSharePageQuery } from "@/features/share/queries/share-query.ts";
import { Container } from "@mantine/core";
import React, { useEffect } from "react";
import ReadonlyPageEditor from "@/features/editor/readonly-page-editor.tsx";
import SharedPageCollabEditor from "@/features/share/components/shared-page-collab-editor.tsx";
import {
  isShareEditEnabled,
  isShareGuestCommentsEnabled,
} from "@/lib/config.ts";
import { shareCommentsContextAtom } from "@/features/share/atoms/share-comments-atom";
import { useShareCommentHighlightClicks } from "@/features/share/hooks/use-share-comments-aside";
import { extractPageSlugId } from "@/lib";
import { Error404 } from "@/components/ui/error-404.tsx";
import { useAtomValue, useSetAtom } from "jotai";
import {
  sharedPageFullWidthAtom,
  sharedTreeDataAtom,
} from "@/features/share/atoms/shared-page-atom.ts";
import { isPageInTree } from "@/features/share/utils.ts";

export default function SharedPage() {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { shareId } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useSharePageQuery({
    pageId: extractPageSlugId(pageSlug),
    shareId,
  });

  const sharedTreeData = useAtomValue(sharedTreeDataAtom);
  const fullWidth = useAtomValue(sharedPageFullWidthAtom);
  const setCommentsContext = useSetAtom(shareCommentsContextAtom);

  // MXD: each elevated mode rides its own kill switch (mirrors the server).
  const mode = data?.share.mode;
  const liveMode =
    mode === "edit" && isShareEditEnabled()
      ? "edit"
      : mode === "comment" && isShareGuestCommentsEnabled()
        ? "comment"
        : null;
  const commentsEnabled = liveMode !== null;

  useEffect(() => {
    if (!data || !commentsEnabled) {
      setCommentsContext(null);
      return;
    }
    setCommentsContext({
      shareId: data.share.id,
      pageId: data.page.id,
      sharePath: `/share/${data.share.key}/p/${pageSlug}`,
    });
    return () => {
      setCommentsContext(null);
    };
  }, [
    data?.share.id,
    data?.page.id,
    data?.share.key,
    pageSlug,
    commentsEnabled,
    setCommentsContext,
  ]);

  useShareCommentHighlightClicks(commentsEnabled);

  useEffect(() => {
    if (shareId && data) {
      if (data.share.key !== shareId) {
        // Check if the current page is part of the active sharing tree (sidebar) - If we are part of it, we will not redirect, keeping the sidebar visible.
        const isPartOfTree =
          sharedTreeData && isPageInTree(sharedTreeData, data.page.slugId);

        if (!isPartOfTree) {
          navigate(`/share/${data.share.key}/p/${pageSlug}`, { replace: true });
        }
      }
    }
  }, [shareId, data, sharedTreeData]);

  if (isLoading) {
    return <></>;
  }

  if (isError || !data) {
    if ([401, 403, 404].includes(error?.["status"])) {
      return <Error404 />;
    }
    return <div>{t("Error fetching page data.")}</div>;
  }

  return (
    <div>
      <Helmet>
        <title>{`${data?.page?.title || t("untitled")}`}</title>
        {!data?.share.searchIndexing && (
          <meta name="robots" content="noindex" />
        )}
      </Helmet>

      <Container fluid={fullWidth} size={fullWidth ? undefined : 900} p={0}>
        {liveMode ? (
          // MXD: live session — writable for edit shares, read-only (to
          // anchor inline comments) for comment shares.
          <SharedPageCollabEditor
            key={data.page.id}
            pageId={data.page.id}
            shareId={data.share.id}
            title={data.page.title}
            content={data.page.content}
            mode={liveMode}
            commentsEnabled={commentsEnabled}
          />
        ) : (
          <ReadonlyPageEditor
            key={data.page.id}
            title={data.page.title}
            content={data.page.content}
            pageId={data.page.id}
            shareId={data.share.id}
          />
        )}
      </Container>
    </div>
  );
}
