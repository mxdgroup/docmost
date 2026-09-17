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
// (workspace search, private databases) — never schema. Attachments use the
// same upload controls with share-scoped server authorization.
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
import { useAtom, useAtomValue, useSetAtom, PrimitiveAtom } from "jotai";
import {
  collabExtensions,
  mainExtensions,
} from "@/features/editor/extensions/extensions";
import {
  handleFileDrop,
  handlePaste,
} from "@/features/editor/components/common/editor-paste-handler";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import { useDebouncedCallback } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  getShareCollabToken,
  updateSharedTitle,
} from "@/features/share/services/share-service";
import { Alert, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import ReadonlyPageEditor from "@/features/editor/readonly-page-editor.tsx";
import { ReadonlyBubbleMenu } from "@/features/editor/components/bubble-menu/readonly-bubble-menu";
import { showReadOnlyCommentPopupAtom } from "@/features/comment/atoms/comment-atom";
import { readOnlyEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";
import { TransclusionLookupProvider } from "@/features/editor/components/transclusion/transclusion-lookup-context";
import { EditorBubbleMenu } from "@/features/editor/components/bubble-menu/bubble-menu";
import { EditorLinkMenu } from "@/features/editor/components/link/link-menu";
import ImageMenu from "@/features/editor/components/image/image-menu";
import VideoMenu from "@/features/editor/components/video/video-menu";
import PdfMenu from "@/features/editor/components/pdf/pdf-menu";
import ExcalidrawMenu from "@/features/editor/components/excalidraw/excalidraw-menu-lazy";
import DrawioMenu from "@/features/editor/components/drawio/drawio-menu";
import TableMenu from "@/features/editor/components/table/table-menu";
import { TableHandlesLayer } from "@/features/editor/components/table/handle/table-handles-layer";
import CalloutMenu from "@/features/editor/components/callout/callout-menu";
import ColumnsMenu from "@/features/editor/components/columns/columns-menu";
import SearchAndReplaceDialog from "@/features/editor/components/search-and-replace/search-and-replace-dialog";
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
  const [readOnly, setReadOnly] = useState(true);
  const [guest, setGuest] = useState<{ id: string; name: string } | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let remote: HocuspocusProvider | null = null;

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let renew: ReturnType<typeof setTimeout> | undefined;
    setUnavailable(false);
    setSynced(false);
    setConnected(false);
    setReadOnly(true);

    const denyAccess = () => {
      if (cancelled) return;
      setReadOnly(true);
      setUnavailable(true);
      clearInterval(heartbeat);
      remote?.destroy();
      remote = null;
    };

    async function connect() {
      remote = new HocuspocusProvider({
        url: collaborationURL,
        name: `page.${pageId}`,
        document: new Y.Doc(),
        // Re-mint on every reconnect, and honor the current server capability.
        token: async () => {
          try {
            const result = await getShareCollabToken(shareId, pageId);
            if (cancelled) return "";
            setReadOnly(result.readOnly);
            setGuest(result.guest);
            return result.token;
          } catch {
            denyAccess();
            return "";
          }
        },
        onAuthenticationFailed: denyAccess,
        onStateless: ({ payload }) => {
          try {
            if (JSON.parse(payload).type === "share.access-denied")
              denyAccess();
          } catch {
            /* unrelated server message */
          }
        },
        onStatus: (event: onStatusParameters) => {
          if (cancelled) return;
          setConnected(event.status === WebSocketStatus.Connected);
          if (event.status !== WebSocketStatus.Connected) setSynced(false);
        },
        onSynced: ({ state }) => {
          if (!cancelled) setSynced(state);
        },
      });
      setProvider(remote);
      // Idle visitors also learn about revocation. Every actual write is
      // checked by the server immediately, independently of this heartbeat.
      heartbeat = setInterval(
        () => remote?.sendStateless("share.keepalive"),
        2000,
      );
      // Refresh before the signed session expires; never persist guest Yjs
      // state offline, where rejected edits could be replayed on another link.
      renew = setTimeout(
        () => {
          if (!cancelled) setSession((value) => value + 1);
        },
        9 * 60 * 1000,
      );
    }

    connect();
    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      clearTimeout(renew);
      remote?.destroy();
      remote = null;
      setProvider(null);
      setSynced(false);
    };
  }, [pageId, shareId, collaborationURL, session]);

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
      editable={mode === "edit" && !readOnly && connected}
      guest={guest}
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
  guest,
}: {
  provider: HocuspocusProvider;
  guest: { id: string; name: string } | null;
  title: string;
  connected: boolean;
  pageId: string;
  shareId: string;
  editable: boolean;
  commentsEnabled: boolean;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<Editor | null>(null);
  const setReadOnlyEditor = useSetAtom(
    readOnlyEditorAtom as PrimitiveAtom<Editor | null>,
  );
  const showCommentPopup = useAtomValue(showReadOnlyCommentPopupAtom);

  const editor = useEditor(
    {
      extensions: [
        ...mainExtensions,
        ...collabExtensions(provider, guest ?? { name: t("Guest") }),
      ],
      editable,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      // Existing upload controls use the share-scoped attachment authorisation.
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

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(
    () => () => {
      setReadOnlyEditor(null);
    },
    [setReadOnlyEditor],
  );

  const saveTitle = useDebouncedCallback(async (value: string) => {
    try {
      await updateSharedTitle(shareId, pageId, value);
    } catch {
      notifications.show({
        color: "red",
        message: t("Unable to save the title. Reload to check your access."),
      });
    }
  }, 500);

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
          editable={editable}
          onUpdate={({ editor }) => saveTitle(editor.getText())}
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
        {editor && editable && (
          <>
            <EditorLinkMenu editor={editor} />
            <EditorBubbleMenu editor={editor} publicShare />
            <ImageMenu editor={editor} />
            <VideoMenu editor={editor} />
            <PdfMenu editor={editor} />
            <ExcalidrawMenu editor={editor} />
            <DrawioMenu editor={editor} />
            <TableMenu editor={editor} />
            <TableHandlesLayer editor={editor} />
            <CalloutMenu editor={editor} />
            <ColumnsMenu editor={editor} />
            <SearchAndReplaceDialog editor={editor} editable />
          </>
        )}
        {editor && commentsEnabled && !editable && (
          <ReadonlyBubbleMenu editor={editor} />
        )}
      </div>
      {commentsEnabled && showCommentPopup && (
        <GuestCommentDialog shareId={shareId} pageId={pageId} />
      )}
      <div style={{ paddingBottom: "20vh" }}></div>
    </TransclusionLookupProvider>
  );
}
