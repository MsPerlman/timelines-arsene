// Live preview: markdown marks are hidden except in the inline element under the
// cursor, or on the cursor's line for line formats (headings, quotes, bullets, rules)
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }
  eq(other) { return other.checked === this.checked; }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

const VIDEO_URL = /youtube\.com|youtu\.be|vimeo\.com|\.(mp4|webm|ogg|mov)(\?|$)/i;

class ImageWidget extends WidgetType {
  constructor(src, alt, resolveSrc) {
    super();
    this.src = src;
    this.alt = alt;
    this.resolveSrc = resolveSrc;
  }
  eq(other) { return other.src === this.src && other.alt === this.alt; }
  toDOM() {
    if (VIDEO_URL.test(this.src)) {
      const pill = document.createElement("span");
      pill.className = "cm-lp-embed";
      pill.textContent = `▶ ${this.alt || this.src}`;
      return pill;
    }
    const resolved = this.resolveSrc?.(this.src);
    if (!resolved) {
      const missing = document.createElement("span");
      missing.className = "cm-lp-embed";
      missing.textContent = this.alt || this.src;
      return missing;
    }
    const img = document.createElement("img");
    img.className = "cm-lp-image";
    img.src = resolved;
    img.alt = this.alt;
    return img;
  }
}

// End of a leading YAML frontmatter block (`---` … `---`), or 0. The markdown parser would read it
// as a horizontal rule and a setext heading, so it's styled separately and otherwise left alone.
function frontmatterEnd(doc) {
  if (doc.lines < 2 || doc.line(1).text !== "---") return 0;
  for (let n = 2; n <= doc.lines; n++) {
    if (doc.line(n).text === "---") return doc.line(n).to;
  }
  return 0;
}

function buildDecorations(view, resolveSrc) {
  const { state } = view;
  const { doc } = state;
  const decorations = [];

  const activeLines = new Set();
  if (view.hasFocus) {
    for (const range of state.selection.ranges) {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) activeLines.add(n);
    }
  }
  const isActive = (from, to = from) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n++) if (activeLines.has(n)) return true;
    return false;
  };
  const lineClass = (from, to, className) => {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      decorations.push(Decoration.line({ class: className }).range(line.from));
      pos = line.to + 1;
    }
  };
  const hideWithSpace = (from, to) => {
    const end = doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    if (end > from) decorations.push(hide.range(from, end));
  };
  const selectionTouches = (from, to) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const isEditing = (from, to) => view.hasFocus && selectionTouches(from, to);

  const fmEnd = frontmatterEnd(doc);
  if (fmEnd) lineClass(0, fmEnd, "cm-lp-frontmatter");

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.to <= fmEnd) return false;
        const { name } = node;
        const parent = node.node.parent?.name;
        const heading = /^ATXHeading(\d)$/.exec(name) || /^SetextHeading(\d)$/.exec(name);

        if (heading) {
          decorations.push(Decoration.line({ class: `cm-lp-h${heading[1]}` }).range(doc.lineAt(node.from).from));
          return;
        }
        switch (name) {
          case "HeaderMark":
            if (!isActive(node.from)) {
              if (parent?.startsWith("SetextHeading")) decorations.push(hide.range(node.from, node.to));
              else hideWithSpace(node.from, node.to);
            }
            return;
          case "Emphasis":
            decorations.push(Decoration.mark({ class: "cm-lp-em" }).range(node.from, node.to));
            return;
          case "StrongEmphasis":
            // The app renders __text__ as underline, not bold
            decorations.push(Decoration.mark({
              class: doc.sliceString(node.from, node.from + 2) === "__" ? "cm-lp-u" : "cm-lp-strong",
            }).range(node.from, node.to));
            return;
          case "Strikethrough":
            decorations.push(Decoration.mark({ class: "cm-lp-strike" }).range(node.from, node.to));
            return;
          case "Highlight":
            decorations.push(Decoration.mark({ class: "cm-lp-mark" }).range(node.from, node.to));
            return;
          case "InlineCode":
            decorations.push(Decoration.mark({ class: "cm-lp-code" }).range(node.from, node.to));
            return;
          case "EmphasisMark":
          case "StrikethroughMark":
          case "HighlightMark": {
            const element = node.node.parent;
            if (!isEditing(element.from, element.to)) decorations.push(hide.range(node.from, node.to));
            return;
          }
          case "CodeMark": {
            const element = node.node.parent;
            if (parent === "InlineCode" && !isEditing(element.from, element.to)) decorations.push(hide.range(node.from, node.to));
            return;
          }
          case "Link": {
            const marks = node.node.getChildren("LinkMark");
            const url = node.node.getChild("URL");
            if (marks.length < 2 || !url) return;
            const href = doc.sliceString(url.from, url.to);
            decorations.push(Decoration.mark({
              class: "cm-lp-link",
              attributes: { "data-href": href, title: href },
            }).range(marks[0].to, marks[1].from));
            if (!isEditing(node.from, node.to)) {
              decorations.push(hide.range(marks[0].from, marks[0].to));
              decorations.push(hide.range(marks[1].from, node.to));
            }
            return;
          }
          case "WikiLink": {
            const marks = node.node.getChildren("WikiLinkMark");
            if (marks.length < 2) return false;
            const inner = doc.sliceString(marks[0].to, marks[1].from);
            const pipe = inner.indexOf("|");
            const textFrom = pipe >= 0 ? marks[0].to + pipe + 1 : marks[0].to;
            if (marks[1].from > textFrom) {
              decorations.push(Decoration.mark({ class: "cm-lp-wikilink" }).range(textFrom, marks[1].from));
            }
            if (!isEditing(node.from, node.to)) {
              decorations.push(hide.range(node.from, textFrom));
              decorations.push(hide.range(marks[1].from, marks[1].to));
            }
            return false;
          }
          case "URL":
            if (parent === "Link" || parent === "Image") return;
            decorations.push(Decoration.mark({
              class: "cm-lp-link",
              attributes: { "data-href": doc.sliceString(node.from, node.to) },
            }).range(node.from, node.to));
            return;
          case "Image": {
            if (isEditing(node.from, node.to)) return false;
            const url = node.node.getChild("URL");
            if (!url) return false;
            const marks = node.node.getChildren("LinkMark");
            const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : "";
            decorations.push(Decoration.replace({
              widget: new ImageWidget(doc.sliceString(url.from, url.to), alt, resolveSrc),
            }).range(node.from, node.to));
            return false;
          }
          case "TaskMarker": {
            if (isEditing(node.from, node.to)) return;
            const checked = /x/i.test(doc.sliceString(node.from + 1, node.to - 1));
            decorations.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
            if (checked) decorations.push(Decoration.line({ class: "cm-lp-task-done" }).range(doc.lineAt(node.from).from));
            return;
          }
          case "ListMark": {
            if (isActive(node.from)) return;
            const isTask = Boolean(node.node.parent?.getChild("Task"));
            const mark = doc.sliceString(node.from, node.to);
            if (isTask) hideWithSpace(node.from, node.to);
            else if (/^[-*+]$/.test(mark)) decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            return;
          }
          case "Blockquote":
            lineClass(node.from, node.to, "cm-lp-quote");
            return;
          case "QuoteMark":
            if (!isActive(node.from)) hideWithSpace(node.from, node.to);
            return;
          case "HorizontalRule":
            if (!isActive(node.from)) {
              decorations.push(Decoration.line({ class: "cm-lp-hr" }).range(doc.lineAt(node.from).from));
              decorations.push(hide.range(node.from, node.to));
            }
            return;
          case "FencedCode":
          case "CodeBlock":
            lineClass(node.from, node.to, "cm-lp-codeblock");
            return false;
          case "Table":
            lineClass(node.from, node.to, "cm-lp-table");
            return false;
          default:
            return;
        }
      },
    });
  }

  return Decoration.set(decorations, true);
}

export function livePreview({ resolveSrc, openLink }) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildDecorations(view, resolveSrc);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
        || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = buildDecorations(update.view, resolveSrc);
      }
    }
  }, {
    decorations: (v) => v.decorations,
    eventHandlers: {
      // Links open with Cmd/Ctrl+click; a plain click places the cursor to edit them
      mousedown(event) {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const link = event.target.closest?.(".cm-lp-link");
        const href = link?.getAttribute("data-href");
        if (!href) return false;
        event.preventDefault();
        openLink?.(href);
        return true;
      },
    },
  });
  return [plugin, EditorView.editorAttributes.of({ class: "cm-live-preview" })];
}
