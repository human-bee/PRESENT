'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CanvasSessionNode, CanvasSessionSnapshot } from '@present/contracts';

interface CanvasRuntimeShapeContextValue {
  session: CanvasSessionSnapshot;
  nodesById: Map<string, CanvasSessionNode>;
  canApplyLatestPatch: boolean;
  onApplyPatchArtifact?: (artifactId: string) => void;
  onResolveApproval?: (approvalRequestId: string, state: 'approved' | 'rejected') => void;
}

const CanvasRuntimeShapeContext = createContext<CanvasRuntimeShapeContextValue | null>(null);

interface CanvasRuntimeShapeProviderProps {
  session: CanvasSessionSnapshot;
  canApplyLatestPatch?: boolean;
  onApplyPatchArtifact?: (artifactId: string) => void;
  onResolveApproval?: (approvalRequestId: string, state: 'approved' | 'rejected') => void;
  children: ReactNode;
}

export function CanvasRuntimeShapeProvider({
  session,
  canApplyLatestPatch = false,
  onApplyPatchArtifact,
  onResolveApproval,
  children,
}: CanvasRuntimeShapeProviderProps) {
  const value = useMemo<CanvasRuntimeShapeContextValue>(
    () => ({
      session,
      nodesById: new Map(session.nodes.map((node) => [node.id, node])),
      canApplyLatestPatch,
      onApplyPatchArtifact,
      onResolveApproval,
    }),
    [canApplyLatestPatch, onApplyPatchArtifact, onResolveApproval, session],
  );

  return <CanvasRuntimeShapeContext.Provider value={value}>{children}</CanvasRuntimeShapeContext.Provider>;
}

export function useCanvasRuntimeShapeContext() {
  return useContext(CanvasRuntimeShapeContext);
}

export function useCanvasRuntimeNode(nodeId: string) {
  return useCanvasRuntimeShapeContext()?.nodesById.get(nodeId) ?? null;
}
