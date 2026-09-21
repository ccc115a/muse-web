import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

export function createEditor(mount, { initial = '', onChange, onDropFiles } = {}) {
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged && onChange) onChange(u.state.doc.toString());
  });
  const state = EditorState.create({
    doc: initial,
    extensions: [history(), keymap.of([...defaultKeymap, ...historyKeymap]), markdown(), updateListener, EditorView.lineWrapping],
  });
  const view = new EditorView({ state, parent: mount });
  if (onDropFiles) {
    mount.addEventListener('dragover', (e) => e.preventDefault());
    mount.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) onDropFiles(files);
    });
  }
  return {
    get value() {
      return view.state.doc.toString();
    },
    set value(s) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s ?? '' } });
    },
    insert(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text } });
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
