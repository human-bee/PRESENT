import type { ReactNode } from 'react';

export function BenchmarkShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#070b11] text-[#f7f1e8]">
      <div className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.22),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(45,212,191,0.2),_transparent_24%),linear-gradient(180deg,_rgba(12,18,27,0.96),_rgba(7,11,17,1))]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(247,241,232,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(247,241,232,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />
        <section className="relative mx-auto max-w-7xl px-6 py-16 sm:px-8">
          <p className="mb-4 text-xs uppercase tracking-[0.45em] text-[#f59e0b]">{eyebrow}</p>
          <div className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr]">
            <div>
              <h1
                className="max-w-4xl text-4xl leading-[0.95] sm:text-6xl"
                style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
              >
                {title}
              </h1>
              <p
                className="mt-5 max-w-2xl text-sm leading-7 text-[#dccfbe] sm:text-base"
                style={{ fontFamily: '"Avenir Next", "Segoe UI", sans-serif' }}
              >
                {subtitle}
              </p>
            </div>
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
              <div className="mb-3 flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-[#f97316]" />
                <span className="h-3 w-3 rounded-full bg-[#14b8a6]" />
                <span className="h-3 w-3 rounded-full bg-[#facc15]" />
              </div>
              <p className="text-xs uppercase tracking-[0.35em] text-[#cbbda9]">Operator Lens</p>
              <p className="mt-4 text-sm leading-7 text-[#f7f1e8]">
                Side-by-side canvas outcomes, speed, and failure texture for each scenario. Built
                for tuning, not vanity screenshots.
              </p>
            </div>
          </div>
        </section>
      </div>
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-8">{children}</div>
    </main>
  );
}
