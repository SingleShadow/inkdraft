import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { AiSpan } from '../extensions/aiSpan.js';

/**
 * 编辑器。通过 ref 暴露 insertAiText，供续写面板把 AI 草稿（带 aiSpan 标记）插入正文。
 * AiSpan 设为 inclusive:false —— 用户继续手打的字不会被自动带成 AI 标记。
 */
const Editor = React.forwardRef(function Editor({ value, onChange, onSave, placeholder }, ref) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: placeholder || '从这里开始写第一章…' }),
      AiSpan,
    ],
    content: value || { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'ink-prose', spellcheck: 'false' },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getJSON(), ed.getText());
    },
    onBlur: () => onSave?.(),
  });

  React.useImperativeHandle(
    ref,
    () => ({
      insertAiText(text, ratio = 0, rewritten = false) {
        if (!editor || !text) return;
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text,
            marks: [{ type: 'aiSpan', attrs: { raw: text, ratio, rewritten } }],
          })
          .run();
      },
    }),
    [editor]
  );

  // 切换章节时同步内容
  React.useEffect(() => {
    if (!editor) return;
    if (!value) return;
    const same = JSON.stringify(editor.getJSON()) === JSON.stringify(value);
    if (!same) editor.commands.setContent(value, false);
  }, [value, editor]);

  if (!editor) return <div className="ink-prose-loading">载入编辑器…</div>;

  return <EditorContent editor={editor} className="ink-editor" />;
});

export default Editor;
