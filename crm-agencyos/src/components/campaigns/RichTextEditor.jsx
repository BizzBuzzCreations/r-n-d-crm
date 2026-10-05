import { forwardRef, useImperativeHandle, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer } from '@tiptap/react';
import { Extension, InputRule } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Image as TiptapImage } from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Link as LinkIcon, Image as ImageIcon,
  Undo2, Redo2, Code2, Eye, Loader2, X, Braces,
} from 'lucide-react';
import { cn } from '../../utils/helpers';
import useAppStore from '../../store/useAppStore';

const COLORS = ['#0f172a', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0ea5e9', '#4f46e5', '#7c3aed', '#db2777'];

// ── Live snippet-picker popup (type ";" to browse) ────────────────────────
// Keyboard nav (Up/Down/Enter) + click-to-select, following TipTap's
// documented mention/suggestion-list pattern. `command` here is the
// Suggestion plugin's own dispatcher (threaded in as a prop by the render()
// lifecycle below) — calling it with a snippet re-enters our top-level
// `command` handler in SnippetExpander with that snippet as `props`.
const SnippetSuggestionList = forwardRef(function SnippetSuggestionList({ items, command }, ref) {
  const [selected, setSelected] = useState(0);

  useEffect(() => { setSelected(0); }, [items]);

  const select = (index) => {
    const item = items[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') { setSelected((s) => (s + items.length - 1) % items.length); return true; }
      if (event.key === 'ArrowDown') { setSelected((s) => (s + 1) % items.length); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { select(selected); return true; }
      return false;
    },
  }), [items, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return null;

  return (
    <div className="w-64 max-h-64 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal p-1">
      {items.map((item, i) => (
        <button
          key={item.trigger}
          type="button"
          onMouseDown={(e) => e.preventDefault()} // keep editor focus/selection intact
          onClick={() => select(i)}
          className={cn(
            'w-full text-left px-2.5 py-1.5 rounded-lg flex flex-col gap-0.5',
            i === selected ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
          )}
        >
          <span className="font-mono text-[11.5px] font-semibold text-primary-600 dark:text-primary-400">{item.trigger}</span>
          <span className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">{item.text}</span>
        </button>
      ))}
    </div>
  );
});

function positionFloatingEl(el, clientRectFn) {
  const rect = clientRectFn?.();
  if (!rect) return;
  el.style.left = `${rect.left + window.scrollX}px`;
  el.style.top = `${rect.bottom + window.scrollY + 4}px`;
}

// ── Shared Snippets Library (Settings -> Communication) ───────────────────
// Two ways to use it, both built on TipTap's own mechanisms rather than
// hand-rolled keystroke interception:
//  1. Type a configured trigger (e.g. ";greet") then a space — InputRule
//     expands it immediately, the same system TipTap uses internally for
//     markdown-style auto-formatting.
//  2. Type just the activation character (";") — the Suggestion plugin (the
//     same utility TipTap ships for @mention/slash-command pickers) opens a
//     browsable, filterable, keyboard-navigable list so you don't have to
//     already know a trigger exists to find it.
//
// `getSnippets` is a getter, not a captured array: useEditor() only builds
// the extension list once and the editor instance persists across
// re-renders, so a plain closed-over array would go stale the moment the
// snippet library changes. The getter always reads through to a ref that's
// kept fresh — see snippetsRef below.
const SnippetExpander = Extension.create({
  name: 'snippetExpander',
  addOptions() {
    return { getSnippets: () => [] };
  },
  addInputRules() {
    return [
      new InputRule({
        // Matches the run of non-space characters immediately before a
        // just-typed space — i.e. "the word that was just finished".
        find: /(\S+)\s$/,
        handler: ({ state, range, match }) => {
          const word = match[1];
          const snippets = this.options.getSnippets() || [];
          const found = snippets.find((s) => s.trigger?.trim() === word);
          if (!found) return null; // not a configured trigger — the space inserts normally, nothing else happens
          // Replace only the trigger word, leaving the trailing space the
          // user just typed untouched, so spacing after expansion stays natural.
          const wordEnd = range.to - (match[0].length - word.length);
          state.tr.insertText(found.text || '', range.from, wordEnd);
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: ';',
        allowSpaces: false,
        pluginKey: new PluginKey('snippetSuggestion'),
        // Triggers stored with their leading ";" (matching the Settings UI's
        // own placeholder convention) still need to match a query that
        // never includes the activation character itself.
        items: ({ query }) => {
          const snippets = this.options.getSnippets() || [];
          const q = query.toLowerCase();
          return snippets
            .filter((s) => (s.trigger || '').replace(/^;/, '').toLowerCase().includes(q))
            .slice(0, 8);
        },
        command: ({ editor, range, props: item }) => {
          editor.chain().focus().insertContentAt(range, item.text || '').run();
        },
        render: () => {
          let component = null;

          const mount = (props) => {
            component = new ReactRenderer(SnippetSuggestionList, { props, editor: props.editor });
            component.element.style.position = 'absolute';
            component.element.style.zIndex = '50';
            document.body.appendChild(component.element);
            positionFloatingEl(component.element, props.clientRect);
          };
          const unmount = () => {
            if (!component) return;
            component.destroy();
            component.element.remove();
            component = null;
          };

          return {
            onStart: (props) => { if (props.items.length) mount(props); },
            onUpdate: (props) => {
              if (!props.items.length) { unmount(); return; }
              if (!component) mount(props);
              else { component.updateProps(props); positionFloatingEl(component.element, props.clientRect); }
            },
            onKeyDown: (props) => {
              if (!component) return false;
              if (props.event.key === 'Escape') { unmount(); return true; }
              return component.ref?.onKeyDown(props) || false;
            },
            onExit: unmount,
          };
        },
      }),
    ];
  },
});

// ── Inline-style string helpers ──────────────────────────────────────────
// The image's `style` attribute is the single source of truth for both size
// and position, so what you see in HTML-source mode is exactly what's
// stored — no separate width/align schema fields to drift out of sync.
function parseStyleStr(str) {
  const out = {};
  (str || '').split(';').forEach((rule) => {
    const idx = rule.indexOf(':');
    if (idx === -1) return;
    const k = rule.slice(0, idx).trim();
    const v = rule.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  });
  return out;
}
function styleObjToStr(obj) {
  return Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(';') + ';';
}

// ── Resizable, positionable image node view ──────────────────────────────
function ResizableImageView({ node, updateAttributes, selected }) {
  const imgRef = useRef(null);
  const styleObj = parseStyleStr(node.attrs.style);

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth || 200;

    const onMove = (moveEvent) => {
      const newWidth = Math.max(40, Math.round(startWidth + (moveEvent.clientX - startX)));
      if (imgRef.current) imgRef.current.style.width = `${newWidth}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const finalWidth = imgRef.current?.offsetWidth;
      if (finalWidth) {
        updateAttributes({
          style: styleObjToStr({
            ...styleObj, width: `${finalWidth}px`, 'max-width': `${finalWidth}px`, height: 'auto',
            display: styleObj.display || 'block',
          }),
        });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const setAlign = (align) => {
    const margins = align === 'center' ? { 'margin-left': 'auto', 'margin-right': 'auto' }
      : align === 'right' ? { 'margin-left': 'auto', 'margin-right': '0' }
      : { 'margin-left': '0', 'margin-right': 'auto' };
    updateAttributes({ style: styleObjToStr({ ...styleObj, display: 'block', ...margins }) });
  };

  return (
    // `fit-content` only when the image has an explicit pixel width. With the
    // default `max-width:100%` style, a fit-content wrapper and a percentage
    // max-width depend on each other, so the wrapper collapses to 0px wide and
    // the image is invisible in the visual editor (while still in the HTML).
    <NodeViewWrapper
      as="div"
      style={{ position: 'relative', maxWidth: '100%', width: styleObj.width ? 'fit-content' : undefined }}
      data-drag-handle
    >
      {selected && (
        <div className="absolute -top-9 left-0 flex gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-modal p-0.5 z-10">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setAlign('left')} className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" title="Align left">
            <AlignLeft size={12} />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setAlign('center')} className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" title="Align center">
            <AlignCenter size={12} />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setAlign('right')} className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" title="Align right">
            <AlignRight size={12} />
          </button>
        </div>
      )}
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt || ''}
        style={{ ...styleObj, cursor: 'default' }}
        className={cn('block', selected && 'ring-2 ring-primary-400 ring-offset-1')}
        draggable={false}
      />
      {selected && (
        <span
          onMouseDown={startResize}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-primary-500 border-2 border-white dark:border-slate-800 rounded-full cursor-nwse-resize"
          style={{ transform: 'translate(50%, 50%)' }}
        />
      )}
    </NodeViewWrapper>
  );
}

// TipTap's stock Image extension doesn't parse/preserve a pasted <img>'s own
// `style` attribute — it gets dropped and replaced with the extension's
// configured default, which (being max-width:100%) blows images up to fill
// the editor. Extend it to actually keep whatever size the source HTML had,
// and give it a NodeView with a drag handle + alignment controls.
const ImageExt = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: 'max-width:100%;height:auto;',
        parseHTML: (element) => element.getAttribute('style') || 'max-width:100%;height:auto;',
        renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

// Same problem as ImageExt above, on <a> instead of <img>: TipTap's stock
// Link extension only recognizes href/target/rel/class in its schema, so an
// arbitrary `style` attribute (the ONLY thing making a "Request a Call"
// button look like a button — background color, padding, rounded corners —
// rather than a plain underlined link) gets silently dropped every time the
// content round-trips through the parser: typing near it, pasting, applying
// a saved template, or toggling in/out of HTML source mode all reparse the
// whole document through this same schema.
const LinkExt = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute('style'),
        renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
      },
    };
  },
});

function ToolbarButton({ active, onClick, disabled, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
        active ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 dark:text-slate-400'
      )}
    >
      {children}
    </button>
  );
}

function LinkPopover({ editor, onClose }) {
  const prevUrl = editor.getAttributes('link').href || '';
  const { from, to, empty } = editor.state.selection;
  const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
  const [url, setUrl] = useState(prevUrl);
  const [text, setText] = useState(selectedText);

  const apply = () => {
    if (!url.trim()) { onClose(); return; }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (empty || text !== selectedText) {
      // No selection (or the label was edited) — insert fresh text as the link
      editor.chain().focus().insertContent(`<a href="${href}">${text || href}</a>`).run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  };

  const remove = () => { editor.chain().focus().unsetLink().run(); onClose(); };

  return (
    <div className="absolute z-20 top-full mt-1 right-0 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal p-3 space-y-2">
      <div>
        <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Link text</label>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Click here" className="form-input text-[12.5px] py-1.5" />
      </div>
      <div>
        <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="form-input text-[12.5px] py-1.5" autoFocus />
      </div>
      <div className="flex justify-between items-center pt-1">
        {prevUrl ? <button type="button" onClick={remove} className="text-[11.5px] text-red-500 hover:underline">Remove link</button> : <span />}
        <div className="flex gap-1.5">
          <button type="button" onClick={onClose} className="text-[12px] px-2.5 py-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
          <button type="button" onClick={apply} className="text-[12px] px-2.5 py-1 rounded-md bg-primary-500 text-white hover:bg-primary-600">Apply</button>
        </div>
      </div>
    </div>
  );
}

function ImagePopover({ editor, onClose, onUploadImage }) {
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const insertUrl = () => {
    if (!url.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
    onClose();
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadImage) return;
    setUploading(true);
    try {
      const uploadedUrl = await onUploadImage(file);
      editor.chain().focus().setImage({ src: uploadedUrl }).run();
      onClose();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="absolute z-20 top-full mt-1 right-0 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal p-3 space-y-2">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-[12.5px] text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-colors disabled:opacity-60"
      >
        {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
        {uploading ? 'Uploading…' : 'Upload from device'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        <span className="text-[10.5px] text-slate-400">or</span>
        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>
      <div>
        <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Image URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/photo.jpg" className="form-input text-[12.5px] py-1.5" />
      </div>
      <div className="flex justify-end gap-1.5 pt-1">
        <button type="button" onClick={onClose} className="text-[12px] px-2.5 py-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Cancel</button>
        <button type="button" onClick={insertUrl} className="text-[12px] px-2.5 py-1 rounded-md bg-primary-500 text-white hover:bg-primary-600">Insert</button>
      </div>
    </div>
  );
}

// Browsable snippet list usable from EITHER editing surface — the visual
// editor already has the ";"-trigger Suggestion popup (SnippetSuggestionList
// above), but that's a TipTap plugin and doesn't exist inside HTML source
// mode's plain <textarea>. This is a separate, always-available toolbar
// button so snippets work the same way regardless of which mode you're in.
function SnippetPicker({ snippets, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();
  const filtered = snippets
    .filter((s) => (s.trigger || '').toLowerCase().includes(q) || (s.text || '').toLowerCase().includes(q))
    .slice(0, 20);

  return (
    <div className="absolute z-20 top-full mt-1 left-0 w-72 max-h-72 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-modal p-2 space-y-1">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search snippets…"
        className="form-input text-[12.5px] py-1.5 mb-1"
      />
      {snippets.length === 0 ? (
        <p className="text-[11.5px] text-slate-400 text-center py-3 px-2">No snippets saved yet — add some in Settings → Communication.</p>
      ) : filtered.length === 0 ? (
        <p className="text-[11.5px] text-slate-400 text-center py-3">No matches</p>
      ) : (
        filtered.map((s) => (
          <button
            key={s.trigger}
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep focus/selection (esp. textarea cursor) intact
            onClick={() => { onSelect(s); onClose(); }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 flex flex-col gap-0.5"
          >
            <span className="font-mono text-[11.5px] font-semibold text-primary-600 dark:text-primary-400">{s.trigger}</span>
            <span className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">{s.text}</span>
          </button>
        ))
      )}
    </div>
  );
}

const RichTextEditor = forwardRef(function RichTextEditor({ value, onChange, onUploadImage, placeholder }, ref) {
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const [showImagePopover, setShowImagePopover] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [showSnippetPicker, setShowSnippetPicker] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceHtml, setSourceHtml] = useState(value || '');
  const sourceTextareaRef = useRef(null);

  // Kept fresh via effect below so SnippetExpander's getter (captured once,
  // at editor-creation time) always sees the current library, not whatever
  // it was when this component first mounted.
  const snippetLibrary = useAppStore((s) => s.systemSettings?.snippetLibrary || []);
  const snippetsRef = useRef(snippetLibrary);
  useEffect(() => { snippetsRef.current = snippetLibrary; }, [snippetLibrary]);

  // Custom drag-to-resize for the whole editor box (width + height). Native
  // CSS `resize` on a contenteditable element turned out unreliable here —
  // this is the same manual mousemove/mouseup approach already used for
  // per-image resizing, so it doesn't depend on any browser-specific resize
  // behavior. null = natural size (100% wide, CSS-driven min-height).
  const shellRef = useRef(null);
  const [boxSize, setBoxSize] = useState(null); // { width, height } in px

  const startShellResize = (e) => {
    e.preventDefault();
    const rect = shellRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;

    // Cap width so it can never grow past whatever card/container it's
    // sitting in — resizing past that edge is what made it visually pop
    // out over the page background instead of staying contained.
    const container = shellRef.current.closest('.card') || shellRef.current.parentElement;
    const containerRect = container.getBoundingClientRect();
    const containerPaddingRight = parseFloat(getComputedStyle(container).paddingRight) || 0;
    const maxWidth = containerRect.right - containerPaddingRight - rect.left;

    const onMove = (moveEvent) => {
      const rawWidth = startWidth + (moveEvent.clientX - startX);
      const newWidth = Math.max(360, Math.min(Math.round(rawWidth), Math.round(maxWidth)));
      const newHeight = Math.max(220, Math.round(startHeight + (moveEvent.clientY - startY)));
      setBoxSize({ width: newWidth, height: newHeight });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      LinkExt.configure({ openOnClick: false, autolink: false }),
      ImageExt,
      Placeholder.configure({ placeholder: placeholder || 'Write your email…' }),
      SnippetExpander.configure({ getSnippets: () => snippetsRef.current }),
    ],
    content: value || '',
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    editorProps: {
      attributes: { class: 'rte-content' },
      // A real HTML clipboard payload (copying from a formatted email or
      // webpage) already has ProseMirror's default paste handling parse it
      // correctly — only intervene when the clipboard has ONLY plain text
      // that itself looks like raw markup (e.g. pasted from a chat message,
      // which never carries a text/html payload). Left to the default
      // behavior, that plain text gets inserted as literal, visible
      // characters — "<p>Hi {{first_name}}..." shown on screen instead of
      // an actual formatted paragraph — which is exactly what produces
      // stray "<" characters when someone then tries to backspace through it.
      handlePaste: (_view, event) => {
        if (event.clipboardData?.getData('text/html')) return false;
        const text = event.clipboardData?.getData('text/plain') || '';
        if (!/^\s*<[a-z!][\s\S]*>\s*$/i.test(text)) return false;
        editor.chain().focus().insertContent(text).run();
        return true;
      },
    },
  });

  // Keep editor content in sync if the parent swaps `value` out from under
  // us (e.g. loading a different campaign, or applying a saved template).
  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getHTML()) editor.commands.setContent(value || '', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => { setSourceHtml(value || ''); }, [value]);

  // Shared by the merge-tag/CTA-button chips (via the insertText imperative
  // handle below) AND the snippet picker — mode-aware so both actually work
  // in HTML source mode too, not just the visual editor. Routing chip clicks
  // through the (unmounted while in source mode) TipTap editor previously
  // meant they silently did nothing visible until switching back to visual.
  const insertAtCursor = (text) => {
    if (sourceMode) {
      const ta = sourceTextareaRef.current;
      const start = ta ? ta.selectionStart ?? sourceHtml.length : sourceHtml.length;
      const end = ta ? ta.selectionEnd ?? sourceHtml.length : sourceHtml.length;
      const next = sourceHtml.slice(0, start) + text + sourceHtml.slice(end);
      setSourceHtml(next);
      onChange(next);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        const pos = start + text.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      editor?.chain().focus().insertContent(text).run();
    }
  };

  useImperativeHandle(ref, () => ({
    insertText: insertAtCursor,
  }), [editor, sourceMode, sourceHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;

  const toggleSourceMode = () => {
    if (sourceMode) {
      // leaving source mode — push edited HTML back into the rich editor
      editor.commands.setContent(sourceHtml || '', false);
      onChange(sourceHtml || '');
    }
    setSourceMode((s) => !s);
  };

  return (
    <div
      ref={shellRef}
      className="relative border border-slate-300 dark:border-slate-600 rounded-xl overflow-hidden"
      style={boxSize ? { width: boxSize.width, maxWidth: 'none' } : { width: '100%' }}
    >
      <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 relative">
        <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></ToolbarButton>
        <ToolbarButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={14} /></ToolbarButton>
        <ToolbarButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></ToolbarButton>

        <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />

        <select
          value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'p'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(v) }).run();
          }}
          className="text-[12px] rounded-md border-0 bg-transparent text-slate-600 dark:text-slate-300 py-1 pr-6 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="p">Paragraph</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>

        <div className="relative">
          <ToolbarButton title="Text color" onClick={() => setShowColors((s) => !s)}>
            <span className="w-3.5 h-3.5 rounded-full border border-slate-300" style={{ background: editor.getAttributes('textStyle').color || '#0f172a' }} />
          </ToolbarButton>
          {showColors && (
            <div className="absolute z-20 top-full mt-1 left-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-modal p-2 grid grid-cols-5 gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => { editor.chain().focus().setColor(c).run(); setShowColors(false); }} className="w-5 h-5 rounded-full border border-slate-200" style={{ background: c }} />
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />

        <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={14} /></ToolbarButton>

        <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />

        <ToolbarButton title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={14} /></ToolbarButton>
        <ToolbarButton title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={14} /></ToolbarButton>
        <ToolbarButton title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={14} /></ToolbarButton>

        <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />

        <div className="relative">
          <ToolbarButton title="Insert link" active={editor.isActive('link')} onClick={() => { setShowImagePopover(false); setShowLinkPopover((s) => !s); }}><LinkIcon size={14} /></ToolbarButton>
          {showLinkPopover && <LinkPopover editor={editor} onClose={() => setShowLinkPopover(false)} />}
        </div>
        <div className="relative">
          <ToolbarButton title="Insert image" onClick={() => { setShowLinkPopover(false); setShowImagePopover((s) => !s); }}><ImageIcon size={14} /></ToolbarButton>
          {showImagePopover && <ImagePopover editor={editor} onClose={() => setShowImagePopover(false)} onUploadImage={onUploadImage} />}
        </div>
        <div className="relative">
          <ToolbarButton title="Insert saved snippet — works in both visual and HTML source mode" active={showSnippetPicker} onClick={() => setShowSnippetPicker((s) => !s)}><Braces size={14} /></ToolbarButton>
          {showSnippetPicker && (
            <SnippetPicker
              snippets={snippetLibrary}
              onSelect={(s) => insertAtCursor(s.text || '')}
              onClose={() => setShowSnippetPicker(false)}
            />
          )}
        </div>

        <div className="w-px h-5 bg-slate-300 dark:bg-slate-600 mx-1" />

        <ToolbarButton title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={14} /></ToolbarButton>
        <ToolbarButton title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={14} /></ToolbarButton>

        <div className="ml-auto">
          <ToolbarButton title={sourceMode ? 'Back to visual editor' : 'Edit HTML source'} active={sourceMode} onClick={toggleSourceMode}>
            {sourceMode ? <Eye size={14} /> : <Code2 size={14} />}
          </ToolbarButton>
        </div>
      </div>

      <div style={boxSize ? { height: boxSize.height - 45, overflow: 'auto' } : undefined}>
        {sourceMode ? (
          <textarea
            ref={sourceTextareaRef}
            value={sourceHtml}
            onChange={(e) => {
              // Push straight to the parent on every keystroke, not just when
              // leaving source mode — saving directly from source view (never
              // toggling back to visual) used to submit stale/empty content
              // because the parent never heard about the edit at all.
              setSourceHtml(e.target.value);
              onChange(e.target.value);
            }}
            rows={14}
            spellCheck={false}
            className={cn(
              'w-full h-full p-4 font-mono text-[12.5px] bg-slate-900 text-slate-200 outline-none resize-none',
              !boxSize && 'min-h-[280px] max-h-[80vh]'
            )}
          />
        ) : (
          <EditorContent editor={editor} className="h-full" />
        )}
      </div>

      <span
        onMouseDown={startShellResize}
        title="Drag to resize"
        className="absolute bottom-1 right-1 w-4 h-4 flex items-end justify-end cursor-nwse-resize text-slate-400 hover:text-primary-500 z-10"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
          <path d="M8 1L1 8M8 4.5L4.5 8M8 8L8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
});

export default RichTextEditor;
