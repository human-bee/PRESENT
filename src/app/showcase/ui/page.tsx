import { LegacyArchiveNotice } from '@/components/ui/reset/legacy-archive-notice';

export default function UiShowcasePage() {
  return (
    <LegacyArchiveNotice
      eyebrow="Archived Showcase"
      title="The UI showcase moved out of the product surface."
      summary="The reset workspace is now the active shell. The old showcase route is preserved only as proof and is no longer part of the shipping runtime."
      detail="Use the reset workspace for current product verification and artifact review."
      primaryHref="/"
      primaryLabel="Open Reset Workspace"
    />
  );
}
