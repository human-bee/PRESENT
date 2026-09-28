import { useEffect } from 'react';
/** Disable embedded widget form controls too; native tldraw readonly is enforced separately. */
export function useViewerControls(viewer: boolean) {
  useEffect(() => {
    if (!viewer) return;
    document.body.classList.add('invite-viewer');
    const disabled = new Set<HTMLFieldSetElement>();
    const update = () => { for (const field of document.querySelectorAll<HTMLFieldSetElement>('.native-canvas fieldset')) if (!field.disabled) { field.disabled = true; disabled.add(field); } };
    const observer = new MutationObserver(update); observer.observe(document.body, { subtree: true, childList: true }); update();
    return () => { observer.disconnect(); document.body.classList.remove('invite-viewer'); for (const field of disabled) field.disabled = false; };
  }, [viewer]);
}
