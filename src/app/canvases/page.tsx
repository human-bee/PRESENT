import { LegacyArchiveNotice } from '@/components/ui/reset/legacy-archive-notice';

export default function CanvasesPage() {
  return (
    <LegacyArchiveNotice
      eyebrow="Legacy Canvas Index"
      title="Canvas index is archived."
      summary="The reset workspace now owns navigation, tasks, artifacts, and agent control. The old multi-canvas launcher is no longer a first-class entry point."
      detail="Open the reset workspace to launch code, canvas, widgets, and external agents from one shell."
      primaryHref="/"
      primaryLabel="Open Reset Workspace"
      secondaryHref="/canvas?legacy=1"
      secondaryLabel="Open Legacy Canvas"
    />
  );
}
