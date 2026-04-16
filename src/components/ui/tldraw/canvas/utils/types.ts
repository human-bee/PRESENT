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

export interface RuntimeCardShapeProps {
  w: number;
  h: number;
  nodeId: string;
  nodeKind: string;
  syncVersion: string;
  retention: 'mirror' | 'persistent';
  title: string;
  subtitle?: string;
  detail?: string;
}

export interface RuntimeWidgetShapeProps {
  w: number;
  h: number;
  nodeId: string;
  syncVersion: string;
  retention: 'mirror' | 'persistent';
  title: string;
  artifactId?: string;
  artifactUri?: string;
  resourceUri?: string;
}
