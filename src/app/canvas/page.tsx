import CanvasPageClient from './CanvasPageClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LegacyArchiveNotice } from '@/components/ui/reset/legacy-archive-notice';

export const dynamic = 'force-dynamic';

export default async function Canvas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const embedded = params.embed === '1';
  const legacyEnabled = params.legacy === '1' || embedded;

  if (!legacyEnabled) {
    return (
      <LegacyArchiveNotice
        eyebrow="Legacy Canvas"
        title="The standalone canvas is archived."
        summary="PRESENT now opens in the reset workspace shell. The old TLDraw and LiveKit runtime is still reachable, but it is no longer the main product entry."
        detail="Use the reset shell for the primary mission-control flow, or launch the legacy canvas explicitly when you need the old room surface."
        primaryHref="/"
        primaryLabel="Open Reset Workspace"
        secondaryHref="/canvas?legacy=1"
        secondaryLabel="Launch Legacy Canvas"
      />
    );
  }

  try {
    return (
      <ErrorBoundary>
        {!embedded ? (
          <div className="legacy-canvas-shell">
            <div className="legacy-canvas-shell__banner">
              <span>Legacy Runtime</span>
              <strong>This canvas is archived. The reset workspace at `/` is now the primary surface.</strong>
            </div>
            <CanvasPageClient />
          </div>
        ) : (
          <CanvasPageClient />
        )}
      </ErrorBoundary>
    );
  } catch (error) {
    console.error('[Canvas Page] Error rendering CanvasPageClient:', error);
    throw error;
  }
}
