import * as React from 'react';
import { Composition, Folder } from 'remotion';
import { Showcase, type ShowcaseProps } from './Showcase';

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

const SCENE_FRAMES = 75;
const TRANSITION_FRAMES = 15;

const scenes = [
  {
    key: 'canvas-light-closed',
    title: 'Canvas shell (Light)',
    subtitle: 'TLDraw chrome + transcript share tokens',
    src: 'showcase/2026-ui/canvas-light-desktop-closed.png',
  },
  {
    key: 'canvas-light-chat',
    title: 'Transcript panel',
    subtitle: 'Consistent borders, radii, typography',
    src: 'showcase/2026-ui/canvas-light-desktop-chat.png',
  },
  {
    key: 'ui-light',
    title: 'Widget chrome sweep',
    subtitle: 'Productivity widgets snapped to WidgetFrame',
    src: 'showcase/2026-ui/ui-light-desktop.png',
  },
  {
    key: 'mcp-light',
    title: 'Configuration surfaces',
    subtitle: 'Forms use tokenized inputs + focus rings',
    src: 'showcase/2026-ui/mcp-config-light-desktop.png',
  },
  {
    key: 'signin-light',
    title: 'Auth',
    subtitle: 'Neutral primaries + copper focus accents',
    src: 'showcase/2026-ui/signin-light-desktop.png',
  },
  {
    key: 'canvas-dark-closed',
    title: 'Canvas shell (Dark)',
    subtitle: 'Same tokens, real dark mode',
    src: 'showcase/2026-ui/canvas-dark-desktop-closed.png',
  },
  {
    key: 'canvas-dark-chat',
    title: 'Transcript panel',
    subtitle: 'Copper highlight reserved for focus/selection',
    src: 'showcase/2026-ui/canvas-dark-desktop-chat.png',
  },
  {
    key: 'ui-dark',
    title: 'Widgets',
    subtitle: 'Cohesive chrome across cards/modals/controls',
    src: 'showcase/2026-ui/ui-dark-desktop.png',
  },
  {
    key: 'mcp-dark',
    title: 'MCP Config',
    subtitle: 'Token surfaces + accessible focus rings',
    src: 'showcase/2026-ui/mcp-config-dark-desktop.png',
  },
  {
    key: 'signin-dark',
    title: 'Sign In',
    subtitle: 'No blue gradients, no random grays',
    src: 'showcase/2026-ui/signin-dark-desktop.png',
  },
] as const satisfies ShowcaseProps['scenes'];

const durationInFrames =
  scenes.length * SCENE_FRAMES - (scenes.length - 1) * TRANSITION_FRAMES + FPS * 2; // end card

export const RemotionRoot: React.FC = () => {
  return (
    <Folder name="Showcase-2026">
      <Composition
        id="Showcase"
        component={Showcase}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={durationInFrames}
        defaultProps={
          {
            scenes: scenes as unknown as ShowcaseProps['scenes'],
            sceneFrames: SCENE_FRAMES,
            transitionFrames: TRANSITION_FRAMES,
          } satisfies ShowcaseProps
        }
      />
    </Folder>
  );
};

