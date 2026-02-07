import { notFound } from 'next/navigation';
import { UiShowcaseClient } from './UiShowcaseClient';

export default function UiShowcasePage() {
  // Keep this route dev-only. It renders fixture data for screenshots/videos.
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  return <UiShowcaseClient />;
}

