import { useEffect, useState } from 'react';
import { useEditor, Editor } from '@tldraw/tldraw';

interface EditorReadyResult {
  editor: Editor | null;
  ready: boolean;
}

export function useEditorReady(): EditorReadyResult {
  const editor = useEditor();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (editor) {
      setReady(true);
    } else {
      setReady(false);
    }
  }, [editor]);

  return { editor: editor ?? null, ready };
}
