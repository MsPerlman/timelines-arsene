import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import { livePreview } from "./livePreview";

// ==highlight== isn't standard markdown; the app's renderer supports it, so the editor parses it too
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };
const HighlightSyntax = {
  defineNodes: [{ name: "Highlight", style: tags.special(tags.content) }, { name: "HighlightMark", style: tags.processingInstruction }],
  parseInline: [{
    name: "Highlight",
    parse(cx, next, pos) {
      if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
      const before = cx.slice(pos - 1, pos);
      const after = cx.slice(pos + 2, pos + 3);
      const spaceBefore = /\s|^$/.test(before);
      const spaceAfter = /\s|^$/.test(after);
      return cx.addDelimiter(HighlightDelim, pos, pos + 2, !spaceAfter, !spaceBefore);
    },
    after: "Emphasis",
  }],
};

// [[wikilinks]] / ![[embeds]]; has to run before the regular link parser claims the "["
const wikiLinkTag = tags.special(tags.link);
const WikiLinkSyntax = {
  defineNodes: [{ name: "WikiLink", style: wikiLinkTag }, { name: "WikiLinkMark", style: tags.processingInstruction }],
  parseInline: [{
    name: "WikiLink",
    parse(cx, next, pos) {
      const start = next === 33 /* ! */ && cx.char(pos + 1) === 91 ? pos + 1 : pos;
      if (cx.char(start) !== 91 /* [ */ || cx.char(start + 1) !== 91) return -1;
      const close = cx.slice(start, cx.end).indexOf("]]");
      if (close < 3) return -1;
      const inner = cx.slice(start + 2, start + close);
      if (/[[\]\n]/.test(inner)) return -1;
      const end = start + close + 2;
      return cx.addElement(cx.elt("WikiLink", pos, end, [
        cx.elt("WikiLinkMark", pos, start + 2),
        cx.elt("WikiLinkMark", end - 2, end),
      ]));
    },
    before: "Link",
  }],
};

const sourceHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--link-color)" },
  { tag: wikiLinkTag, color: "color-mix(in srgb, var(--link-color), var(--ui-muted) 50%)" },
  { tag: tags.monospace, fontFamily: "var(--mono-font, ui-monospace, SFMono-Regular, Menlo, monospace)" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: "var(--ui-muted)" },
  { tag: tags.quote, color: "var(--text-subtle)" },
]);

// Live Preview styles formatting with its own classes; the highlighter only colours what's left
const liveHighlight = HighlightStyle.define([
  { tag: [tags.link, tags.url], color: "var(--link-color)" },
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.meta], color: "var(--ui-muted)" },
]);

export function createNoteEditor({ parent, doc, mode, placeholder, onChange, onBlur, resolveImageSrc, openLink }) {
  const modeCompartment = new Compartment();
  const placeholderCompartment = new Compartment();

  const modeExtensions = (m) => (m === "source"
    ? [syntaxHighlighting(sourceHighlight)]
    : [syntaxHighlighting(liveHighlight), livePreview({ resolveSrc: resolveImageSrc, openLink })]);

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, extensions: [HighlightSyntax, WikiLinkSyntax] }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
        placeholderCompartment.of(placeholderExt(placeholder || "")),
        modeCompartment.of(modeExtensions(mode)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: () => { onBlur?.(); },
        }),
      ],
    }),
  });

  const focusSoon = () => requestAnimationFrame(() => view.focus());

  return {
    view,
    destroy: () => view.destroy(),
    setMode: (m) => view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(m)) }),
    setPlaceholder: (text) => view.dispatch({ effects: placeholderCompartment.reconfigure(placeholderExt(text || "")) }),
    // For changes made outside the editor; not an undo step
    setDoc: (text) => {
      if (text === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: Transaction.addToHistory.of(false),
      });
    },

    // Counting runs of the marker character keeps * (italic) and ** (bold) apart: "***x***" has both,
    // but the "**" around bold text isn't an italic marker
    toggleWrap: (marker) => {
      const size = marker.length;
      const char = marker[0];
      const isWrapped = (before, after) => (size === 1
        ? (before === 1 || before === 3) && (after === 1 || after === 3)
        : before >= 2 && after >= 2);
      const { state } = view;
      const countBack = (pos) => {
        let n = 0;
        while (pos - n > 0 && state.sliceDoc(pos - n - 1, pos - n) === char) n++;
        return n;
      };
      const countForward = (pos, limit = state.doc.length) => {
        let n = 0;
        while (pos + n < limit && state.sliceDoc(pos + n, pos + n + 1) === char) n++;
        return n;
      };
      view.dispatch(state.changeByRange((range) => {
        if (isWrapped(countBack(range.from), countForward(range.to))) {
          return {
            changes: [{ from: range.from - size, to: range.from }, { from: range.to, to: range.to + size }],
            range: EditorSelection.range(range.from - size, range.to - size),
          };
        }
        const inner = range.to - range.from;
        if (inner > size * 2) {
          const lead = countForward(range.from, range.to);
          let trail = 0;
          while (trail < inner && state.sliceDoc(range.to - trail - 1, range.to - trail) === char) trail++;
          if (lead < inner && isWrapped(lead, trail)) {
            return {
              changes: [{ from: range.from, to: range.from + size }, { from: range.to - size, to: range.to }],
              range: EditorSelection.range(range.from, range.to - size * 2),
            };
          }
        }
        return {
          changes: [{ from: range.from, insert: marker }, { from: range.to, insert: marker }],
          range: EditorSelection.range(range.from + size, range.to + size),
        };
      }));
      focusSoon();
    },
    heading: (level) => {
      const { state } = view;
      const line = state.doc.lineAt(state.selection.main.head);
      const existing = /^#{1,6}\s+/.exec(line.text);
      const prefix = `${"#".repeat(level)} `;
      view.dispatch({
        changes: { from: line.from, to: line.from + (existing ? existing[0].length : 0), insert: prefix },
        selection: { anchor: line.to - (existing ? existing[0].length : 0) + prefix.length },
      });
      focusSoon();
    },
    // Inserts text at the selection; selectFrom/selectTo (offsets into the text) pick what to select after
    insert: (text, selectFrom = text.length, selectTo = selectFrom) => {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + selectFrom, head: from + selectTo },
      });
      focusSoon();
    },
    selectedText: () => {
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    },
  };
}
