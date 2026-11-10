import { useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { RichNode } from '../bridge/api';
import { isSafeUrl, normalize } from './richText';

interface Props {
  initial: RichNode;
  onCommit: (doc: RichNode, el: HTMLElement) => void;
  onCancel: () => void;
}

/**
 * Node text editor (open-source Tiptap). Enter commits (inside a list it adds an
 * item), Shift+Enter adds a line, Escape cancels, clicking elsewhere commits.
 * Ctrl+Z inside the editor undoes typing; the whole edit is one document undo step.
 */
export function RichTextEditor({ initial, onCommit, onCancel }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState(false);

  const finish = (commit: boolean) => {
    const editor = editorRef.current;
    if (done.current || !editor) return;
    done.current = true;
    if (commit) onCommit(normalize(editor.getJSON()), editor.view.dom as HTMLElement);
    else onCancel();
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          protocols: [],
          isAllowedUri: (url) => isSafeUrl(url),
        },
      }),
    ],
    content: initial,
    autofocus: 'all',
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        'aria-label': 'Node label',
        role: 'textbox',
        'aria-multiline': 'true',
        class: 'rich-editor',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          finish(false);
          return true;
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !editorRef.current?.isActive('listItem')) {
          finish(true);
          return true;
        }
        return false;
      },
    },
  });
  editorRef.current = editor;

  const applyLink = () => {
    if (!editor || link === null) return;
    const href = link.trim();
    if (href && !isSafeUrl(href)) return setLinkError(true);
    const chain = editor.chain().focus().extendMarkRange('link');
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    setLink(null);
    setLinkError(false);
  };

  const tool = (label: string, text: string, active: boolean, run: () => void) => (
    <button type="button" aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {text}
    </button>
  );

  return (
    <div
      ref={wrapper}
      className="rich-wrapper nodrag nopan nowheel"
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget as Node | null)) finish(true);
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {editor && (
        <div className="format-bar" role="toolbar" aria-label="Text formatting">
          {tool('Bold', 'B', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
          {tool('Italic', 'I', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
          {tool('Bulleted list', '•', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
          {tool('Numbered list', '1.', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
          {tool('Link', 'Link', editor.isActive('link'), () => setLink((editor.getAttributes('link').href as string | undefined) ?? 'https://'))}
          {link !== null && (
            <input
              aria-label="Link address"
              aria-invalid={linkError}
              title="http, https or mailto address; empty removes the link"
              value={link}
              autoFocus
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') applyLink();
                if (e.key === 'Escape') {
                  setLink(null);
                  editor.commands.focus();
                }
              }}
            />
          )}
        </div>
      )}
      <EditorContent editor={editor} className="rich-content" />
    </div>
  );
}
