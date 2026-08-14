import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

// MXD data platform — the `mxdTable` editor node (roadmap §16). It holds ONLY a
// reference: {tableId, viewId}. Row/field data NEVER enters the ProseMirror doc
// or the Y.doc — the relational source of truth stays in mxd_* and is fetched by
// the NodeView through the /mxd API. This keeps the collaborative document small
// and avoids CRDT conflicts over relational rows.
export interface MxdTableOptions {
  HTMLAttributes: Record<string, any>;
  view: any;
}

export interface MxdTableAttributes {
  tableId: string | null;
  viewId: string | null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mxdTable: {
      setMxdTable: (attributes?: MxdTableAttributes) => ReturnType;
    };
  }
}

export const MxdTable = Node.create<MxdTableOptions>({
  name: "mxdTable",
  group: "block",
  atom: true,
  isolating: true,
  defining: true,
  // Not draggable-as-a-whole: without a dedicated [data-drag-handle], a
  // draggable atom makes the ENTIRE NodeView draggable="true", which makes
  // Mantine's FocusTrap (used by every menu/tooltip/popover overlay) loop on
  // open and hang the page. A dedicated drag handle can be reintroduced later.
  draggable: false,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      view: null,
    };
  },

  addAttributes() {
    return {
      tableId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-table-id"),
        renderHTML: (attributes: MxdTableAttributes) =>
          attributes.tableId ? { "data-table-id": attributes.tableId } : {},
      },
      viewId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-view-id"),
        renderHTML: (attributes: MxdTableAttributes) =>
          attributes.viewId ? { "data-view-id": attributes.viewId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mxd-table"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mxd-table",
      }),
    ];
  },

  addNodeView() {
    // This is an ATOM node whose entire DOM is React-managed and never maps to
    // document content. Without these guards, a React re-render inside the
    // NodeView (opening a Mantine menu/overlay, a focus change) triggers
    // ProseMirror's mutation observer → PM rebuilds the NodeView → React
    // re-renders → the observer fires again → the page hangs in an infinite
    // loop. ignoreMutation tells PM none of the internal DOM changes affect the
    // document; stopEvent keeps PM from hijacking clicks/keys meant for the
    // interactive grid inside.
    return ReactNodeViewRenderer(this.options.view, {
      ignoreMutation: () => true,
      stopEvent: () => true,
    });
  },

  addCommands() {
    return {
      setMxdTable:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },
});

export default MxdTable;
