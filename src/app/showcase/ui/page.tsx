import { notFound } from 'next/navigation';
import { UiShowcaseShellClient } from './UiShowcaseShellClient';

export default function UiShowcasePage() {
  // Keep this route dev-only. It renders fixture data for screenshots/videos.
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  return <UiShowcaseShellClient />;
}
