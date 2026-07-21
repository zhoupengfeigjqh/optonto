'use client';

import { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function PythonEditor({ value, onChange, className = '' }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  onChangeRef.current = onChange;
  valueRef.current = value;

  const handleChange = useCallback(() => {
    const doc = viewRef.current?.state.doc.toString() ?? '';
    if (doc !== valueRef.current) {
      valueRef.current = doc;
      onChangeRef.current(doc);
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    if (!viewRef.current) {
      const updateListener = EditorView.updateListener.of(update => {
        if (update.docChanged) handleChange();
      });

      const state = EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          keymap.of(defaultKeymap),
          python(),
          oneDark,
          EditorView.editable.of(true),
          EditorView.theme({
            '&': { backgroundColor: 'transparent', height: '100%' },
            '.cm-scroller': { fontFamily: "'Fira Code', 'Consolas', monospace", fontSize: '13px' },
            '.cm-content': { caretColor: '#e2e8f0', padding: '16px' },
            '&.cm-focused': { outline: 'none' },
            '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid rgba(255,255,255,0.05)' },
          }),
          updateListener,
        ],
      });

      const view = new EditorView({
        state,
        parent: editorRef.current,
      });
      viewRef.current = view;
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external value changes without re-creating editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={editorRef} className={`${className}`} />;
}
