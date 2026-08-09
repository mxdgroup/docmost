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
  draggable: true,
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
    return ReactNodeViewRenderer(this.options.view);
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
