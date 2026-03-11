import { LegacyArchiveNotice } from '@/components/ui/reset/legacy-archive-notice';

export default function McpConfigPage() {
  return (
    <LegacyArchiveNotice
      eyebrow="Legacy MCP Config"
      title="Browser MCP config is archived."
      summary="PRESENT now exposes a server-owned MCP surface through the reset runtime instead of a browser-local MCP server list."
      detail="Use the reset workspace, `npm run present:mcp`, or the reset runtime manifest to connect external agents."
      primaryHref="/"
      primaryLabel="Open Reset Workspace"
      secondaryHref="/api/reset/runtime-manifest"
      secondaryLabel="Open Runtime Manifest"
    />
  );
}
