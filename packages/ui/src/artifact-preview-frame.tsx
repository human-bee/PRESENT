'use client';

type ArtifactPreviewFrameProps = {
  title: string;
  html: string;
};

export function ArtifactPreviewFrame({ title, html }: ArtifactPreviewFrameProps) {
  if (!html.trim()) {
    return (
      <div className="reset-frame-shell">
        <div className="reset-frame-title">{title}</div>
        <div className="reset-empty">This widget bundle no longer carries inline HTML in the canvas session payload.</div>
      </div>
    );
  }

  return (
    <div className="reset-frame-shell">
      <div className="reset-frame-title">{title}</div>
      <iframe
        title={title}
        className="reset-frame"
        sandbox="allow-scripts"
        srcDoc={html}
      />
    </div>
  );
}
