// MXD: live (collaborative) editor for elevated public shares.
//
//  - edit shares:    writable session — anonymous real-time editing.
//  - comment shares: READ-ONLY session (enforced server-side at websocket
//    auth). Guests need the live Yjs doc only so a text selection can be
//    turned into Yjs relative positions that anchor an inline comment, and so
//    highlights (theirs and the team's) appear without a reload.
//
// The static render of the page's saved content is shown until the live doc
// has synced, so the page never flashes empty; if a live session can't be had
// at all, comment shares simply stay static (general comments still work).
//
// Schema parity is a correctness constraint: this editor loads the SAME
// mainExtensions set as the authenticated editor, so a guest session can never
// mangle nodes it doesn't know (mentions, attachments, transclusions, comment
// marks). What guests lose is *affordances* that need authenticated APIs
// (uploads, mention search) — those degrade gracefully — never schema.
import "@/features/editor/styles/index.css";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  onStatusParameters,
  WebSocketStatus,
} from "@hocuspocus/provider";
import {
  EditorContent,
  EditorProvider,
  useEditor,
  Editor,
} from "@tiptap/react";
import { Document } from "@tiptap/extension-document";
import { Text as TextExtension } from "@tiptap/extension-text";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Heading } from "@docmost/editor-ext";
import { useAtom, useAtomValue } from "jotai";
import {
  collabExtensions,
  mainExtensions,
} from "@/features/editor/extensions/extensions";
import {
  handleFileDrop,
  handlePaste,
} from "@/features/editor/components/common/editor-paste-handler";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import { getShareCollabToken } from "@/features/share/services/share-service";
import { Alert, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import ReadonlyPageEditor from "@/features/editor/readonly-page-editor.tsx";
import { ReadonlyBubbleMenu } from "@/features/editor/components/bubble-menu/readonly-bubble-menu";
import { showReadOnlyCommentPopupAtom } from "@/features/comment/atoms/comment-atom";
import { readOnlyEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { TransclusionLookupProvider } from "@/features/editor/components/transclusion/transclusion-lookup-context";
import GuestCommentDialog from "@/features/share/components/guest-comment-dialog";

export type SharedLiveMode = "edit" | "comment";

interface SharedPageCollabEditorProps {
  pageId: string;
  shareId: string;
  title: string;
  content: any;
  mode: SharedLiveMode;
  // Inline commenting (selection bubble + dialog) on this page.
  commentsEnabled: boolean;
}

export default function SharedPageCollabEditor({
  pageId,
  shareId,
  title,
  content,
  mode,
  commentsEnabled,
}: SharedPageCollabEditorProps) {
  const { t } = useTranslation();
  const collaborationURL = useCollaborationUrl();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [synced, setSynced] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let remote: HocuspocusProvider | null = null;

    async function connect() {
      let token: string;
      try {
        token = (await getShareCollabToken(shareId, pageId)).token;
      } catch {
        if (!cancelled) setUnavailable(true);
        return;
      }
      if (cancelled) return;

      remote = new HocuspocusProvider({
        url: collaborationURL,
        name: `page.${pageId}`,
        document: new Y.Doc(),
        token,
        // Short-TTL tokens: re-mint on every auth failure. A revoked or
        // downgraded share makes the re-mint 403 -> unavailable.
        onAuthenticationFailed: () => {
          getShareCollabToken(shareId, pageId)
            .then((res) => {
              remote?.disconnect();
              setTimeout(() => {
                if (!remote) return;
                remote.configuration.token = res.token;
                remote.connect();
              }, 100);
            })
            .catch(() => setUnavailable(true));
        },
        onStatus: (event: onStatusParameters) => {
          setConnected(event.status === WebSocketStatus.Connected);
        },
        onSynced: ({ state }) => {
          if (state) setSynced(true);
        },
      });
      setProvider(remote);
    }

    connect();
    return () => {
      cancelled = true;
      remote?.destroy();
      remote = null;
      setProvider(null);
      setSynced(false);
    };
  }, [pageId, shareId, collaborationURL]);

  const staticView = (
    <ReadonlyPageEditor
      key={pageId}
      title={title}
      content={content}
      pageId={pageId}
      shareId={shareId}
    />
  );

  if (unavailable) {
    return mode === "edit" ? (
      <>
        <Alert color="yellow" my="md">
          <Text size="sm">
            {t(
              "This link is no longer editable. Reload the page to view the latest content.",
            )}
          </Text>
        </Alert>
        {staticView}
      </>
    ) : (
      staticView
    );
  }

  if (!provider || !synced) {
    return staticView;
  }

  return (
    <LiveEditor
      provider={provider}
      title={title}
      connected={connected}
      pageId={pageId}
      shareId={shareId}
      editable={mode === "edit"}
      commentsEnabled={commentsEnabled}
    />
  );
}

function LiveEditor({
  provider,
  title,
  connected,
  pageId,
  shareId,
  editable,
  commentsEnabled,
}: {
  provider: HocuspocusProvider;
  title: string;
  connected: boolean;
  pageId: string;
  shareId: string;
  editable: boolean;
  commentsEnabled: boolean;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<Editor | null>(null);
  const [, setReadOnlyEditor] = useAtom(readOnlyEditorAtom);
  const showCommentPopup = useAtomValue(showReadOnlyCommentPopupAtom);

  const editor = useEditor(
    {
      extensions: [
        ...mainExtensions,
        ...collabExtensions(provider, { name: t("Guest") } as any),
      ],
      editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      // Image upload via paste/drop uses the SAME authenticated attachment
      // endpoint as the normal editor. It succeeds for a logged-in editor with
      // page access (owner / space member) and fails gracefully (401/403 -> a
      // notification) for an anonymous share visitor — no anonymous upload path.
      editorProps: editable
        ? {
            handlePaste: (_view, event) => {
              if (!editorRef.current) return false;
              return handlePaste(editorRef.current, event, pageId);
            },
            handleDrop: (_view, event, _slice, moved) => {
              if (!editorRef.current) return false;
              return handleFileDrop(editorRef.current, event, moved, pageId);
            },
          }
        : {}, // never undefined: tiptap reads editorProps.dispatchTransaction
      onCreate({ editor }) {
        editorRef.current = editor as Editor;
        // @ts-ignore
        editor.storage.pageId = pageId;
        // the share shell's table of contents reads this atom
        // @ts-ignore
        setReadOnlyEditor(editor);
      },
    },
    [provider],
  );

  const titleExtensions = [
    Document.extend({ content: "heading" }),
    Heading,
    TextExtension,
    Placeholder.configure({
      placeholder: "Untitled",
      showOnlyWhenEditable: false,
    }),
  ];

  return (
    <TransclusionLookupProvider shareId={shareId}>
      <div className="page-title">
        <EditorProvider
          editable={false}
          immediatelyRender={true}
          extensions={titleExtensions}
          content={title}
        ></EditorProvider>
      </div>
      {editable && !connected && (
        <Text size="xs" c="dimmed" pl="md">
          {t("Connecting…")}
        </Text>
      )}
      <div className="editor-container" style={{ position: "relative" }}>
        <EditorContent editor={editor} />
        {editor && commentsEnabled && <ReadonlyBubbleMenu editor={editor} />}
      </div>
      {commentsEnabled && showCommentPopup && (
        <GuestCommentDialog shareId={shareId} pageId={pageId} />
      )}
      <div style={{ paddingBottom: "20vh" }}></div>
    </TransclusionLookupProvider>
  );
}
