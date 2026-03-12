import { BenchmarkExplorer } from '@/components/admin/benchmark-explorer';
import { BenchmarkShell } from '@/components/admin/benchmark-shell';
import { BenchmarkSummary } from '@/components/admin/benchmark-summary';
import { requireAgentAdminCurrentUserId } from '@/lib/agents/admin/auth';
import { loadBenchmarkManifest } from './benchmark-data';

export const dynamic = 'force-dynamic';

export default async function AgentBenchmarksPage() {
  const admin = await requireAgentAdminCurrentUserId('/admin/agents/benchmarks');
  if (!admin.ok) {
    const title = admin.status === 401 ? 'Benchmark access requires sign-in.' : 'Benchmark access is restricted.';
    const subtitle =
      admin.status === 401
        ? 'Sign in with an allowed account to inspect benchmark screenshots, artifacts, and cost data.'
        : 'This benchmark surface follows the same allowlist/open-access policy as the rest of agent admin.';

    return (
      <BenchmarkShell eyebrow="Canvas Benchmarking" title={title} subtitle={subtitle}>
        <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-7 text-[#dccfbe]">
          Access check failed with <span className="font-mono text-[#fff7ed]">{admin.error}</span>.
        </section>
      </BenchmarkShell>
    );
  }

  const manifest = await loadBenchmarkManifest();

  if (!manifest) {
    return (
      <BenchmarkShell
        eyebrow="Canvas Benchmarking"
        title="No benchmark manifest found yet."
        subtitle="The admin comparison surface is wired, but `docs/benchmarks/canvas-agent/latest.json` has not been generated in this worktree."
      >
        <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-7 text-[#dccfbe]">
          Generate a suite run, then refresh this page. The reader expects a manifest at
          `docs/benchmarks/canvas-agent/latest.json` and screenshot artifacts somewhere under
          `docs/`.
        </section>
      </BenchmarkShell>
    );
  }

  return (
    <BenchmarkShell
      eyebrow="Canvas Benchmarking"
      title="PRESENT fairy and canvas benchmarks, rendered as an operator surface."
      subtitle="Scenario-by-scenario comparison of visual output, latency, followup churn, and failure texture across model variants."
    >
      <div className="space-y-8">
        <BenchmarkSummary manifest={manifest} />
        <BenchmarkExplorer manifest={manifest} />
        <section className="rounded-[1.8rem] border border-white/10 bg-[#0c1420] px-6 py-5 text-sm text-[#d6c9ba]">
          Manifest source: <span className="font-mono text-[#fff7ed]">{manifest.sourcePath}</span>
        </section>
      </div>
    </BenchmarkShell>
  );
}
