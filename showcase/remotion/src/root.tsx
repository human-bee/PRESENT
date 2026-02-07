import { Composition, Folder } from 'remotion';
import {
  PresentShowcase,
  type PresentShowcaseProps,
  PRESENT_SHOWCASE_FPS,
  PRESENT_SHOWCASE_HEIGHT,
  PRESENT_SHOWCASE_TOTAL_FRAMES,
  PRESENT_SHOWCASE_WIDTH,
} from './showcase';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Present">
        <Composition
          id="PresentShowcase"
          component={PresentShowcase}
          durationInFrames={PRESENT_SHOWCASE_TOTAL_FRAMES}
          fps={PRESENT_SHOWCASE_FPS}
          width={PRESENT_SHOWCASE_WIDTH}
          height={PRESENT_SHOWCASE_HEIGHT}
          defaultProps={
            {
              runId: '__RUN_ID__',
              domainLabel: 'present.best/canvas',
            } satisfies PresentShowcaseProps
          }
        />
      </Folder>
    </>
  );
};

