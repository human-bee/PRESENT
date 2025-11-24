import CanvasPageClient from './CanvasPageClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const dynamic = 'force-dynamic';

export default function Canvas() {
  console.log('[Canvas Page] Rendering Canvas Page...');
  try {
    return (
      <ErrorBoundary>
        <CanvasPageClient />
      </ErrorBoundary>
    );
  } catch (error) {
    console.error('[Canvas Page] Error rendering CanvasPageClient:', error);
    throw error;
  }
}

