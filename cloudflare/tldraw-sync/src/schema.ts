import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas } from '@tldraw/tlschema';
import { T } from '@tldraw/validate';

const customShapeProps = {
  w: T.number,
  h: T.number,
  customComponent: T.any,
  name: T.string,
  pinned: T.optional(T.boolean),
  pinnedX: T.optional(T.number),
  pinnedY: T.optional(T.number),
  userResized: T.optional(T.boolean),
  state: T.optional(T.any),
};

const mermaidStreamShapeProps = {
  w: T.number,
  h: T.number,
  name: T.string,
  mermaidText: T.string,
  compileState: T.optional(T.string),
  renderState: T.optional(T.string),
  streamId: T.optional(T.string),
  keepLastGood: T.optional(T.boolean),
};

const toolboxShapeProps = {
  w: T.number,
  h: T.number,
  name: T.string,
};

const infographicShapeProps = {
  w: T.number,
  h: T.number,
};

export const appSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    custom: { props: customShapeProps },
    mermaid_stream: { props: mermaidStreamShapeProps },
    toolbox: { props: toolboxShapeProps },
    infographic: { props: infographicShapeProps },
  },
  bindings: defaultBindingSchemas,
});

