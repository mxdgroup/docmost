// MXD: anonymous collaborative editor for edit-mode public shares.
//
// Schema parity is a correctness constraint: this editor loads the SAME
// mainExtensions set as the authenticated editor, so a guest edit can never
// mangle nodes it doesn't know (mentions, attachments, transclusions,
// comment marks). What guests lose is *affordances* that need authenticated
// APIs (uploads, mention search) — those degrade gracefully — never schema.
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  WebSocketStatus,
  onStatusParameters,
} from "@hocuspocus/provider";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  collabExtensions,
  mainExtensions,
} from "@/features/editor/extensions/extensions";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import { getShareCollabToken } from "@/features/share/services/share-service";
import { Alert, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import classes from "@/features/editor/styles/editor.module.css";

interface SharedPageCollabEditorProps {
  pageId: string;
  shareId: string;
  title: string;
}

export default function SharedPageCollabEditor({
  pageId,
  shareId,
  title,
}: SharedPageCollabEditorProps) {
  const { t } = useTranslation();
  const collaborationURL = useCollaborationUrl();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [connected, setConnected] = useState(false);
  const providersRef = useRef<{
    remote: HocuspocusProvider;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      let token: string;
      try {
        const res = await getShareCollabToken(shareId, pageId);
        token = res.token;
      } catch {
        if (!cancelled) setAuthFailed(true);
        return;
      }
      if (cancelled) return;

      const documentName = `page.${pageId}`;
      const ydoc = new Y.Doc();
      const remote = new HocuspocusProvider({
        url: collaborationURL,
        name: documentName,
        document: ydoc,
        token,
        // Short-TTL tokens: re-mint on every auth failure. A revoked or
        // downgraded share makes the re-mint 403 -> read-only banner.
        onAuthenticationFailed: () => {
          getShareCollabToken(shareId, pageId)
            .then((res) => {
              remote.disconnect();
              setTimeout(() => {
                remote.configuration.token = res.token;
                remote.connect();
              }, 100);
            })
            .catch(() => setAuthFailed(true));
        },
        onStatus: (event: onStatusParameters) => {
          console.debug("[share-collab] status:", event.status);
          setConnected(event.status === WebSocketStatus.Connected);
        },
        onAuthenticated: () => console.debug("[share-collab] authenticated"),
        onClose: (e: any) =>
          console.debug("[share-collab] close", e?.event?.code),
      });
      providersRef.current = { remote };
      setProvider(remote);
    }

    connect();
    return () => {
      cancelled = true;
      providersRef.current?.remote.destroy();
      providersRef.current = null;
      setProvider(null);
    };
  }, [pageId, shareId, collaborationURL]);

  if (authFailed) {
    return (
      <Alert color="yellow" my="md">
        <Text size="sm">
          {t(
            "This link is no longer editable. Reload the page to view the latest content.",
          )}
        </Text>
      </Alert>
    );
  }

  if (!provider) {
    return <></>;
  }

  return (
    <GuestEditor provider={provider} title={title} connected={connected} />
  );
}

function GuestEditor({
  provider,
  title,
  connected,
}: {
  provider: HocuspocusProvider;
  title: string;
  connected: boolean;
}) {
  const { t } = useTranslation();
  const editor = useEditor(
    {
      extensions: [
        ...mainExtensions,
        ...collabExtensions(provider, { name: t("Guest") } as any),
      ],
      editable: true,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
    },
    [provider],
  );

  return (
    <div>
      <h1 style={{ paddingLeft: "var(--mantine-spacing-md)" }}>{title}</h1>
      {!connected && (
        <Text size="xs" c="dimmed" pl="md">
          {t("Connecting…")}
        </Text>
      )}
      <EditorContent editor={editor} className={classes.editor} />
    </div>
  );
}
