import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Interview studio · PRESENT',referrer: 'no-referrer',description: 'Meet and write the same shared brief together.' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /><link rel="icon" href="/icon.svg" /><style>{'html,body{margin:0;padding:0}button,input,textarea,select{font:inherit}'}</style></head><body>{children}</body></html>;
}
