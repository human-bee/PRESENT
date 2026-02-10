import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-surface p-6">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <h2 className="heading-lg mb-2">Page not found</h2>
        <p className="text-secondary mb-8 text-sm">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link
          href="/"
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
