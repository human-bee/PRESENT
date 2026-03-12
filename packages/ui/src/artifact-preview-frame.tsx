'use client';

type ArtifactPreviewFrameProps = {
  title: string;
  html: string;
};

export function ArtifactPreviewFrame({ title, html }: ArtifactPreviewFrameProps) {
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
