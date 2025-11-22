import CanvasPageClient from './CanvasPageClient';

export const dynamic = 'force-dynamic';

export default function Canvas() {
  console.log('[Canvas Page] Rendering Canvas Page...');
  try {
    return <CanvasPageClient />;
  } catch (error) {
    console.error('[Canvas Page] Error rendering CanvasPageClient:', error);
    throw error;
  }
}

