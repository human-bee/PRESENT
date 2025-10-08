export interface customShapeProps {
  w: number;
  h: number;
  customComponent: string;
  name: string;
  pinned?: boolean;
  pinnedX?: number;
  pinnedY?: number;
  userResized?: boolean;
  state?: Record<string, unknown>;
}

export interface MermaidStreamShapeProps {
  w: number;
  h: number;
  name: string;
  mermaidText: string;
  compileState: string;
  streamId?: string;
  keepLastGood?: boolean;
  renderState?: string;
}
