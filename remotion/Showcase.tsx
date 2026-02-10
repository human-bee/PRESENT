import * as React from 'react';
import { AbsoluteFill, Img, staticFile, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { loadFont } from '@remotion/google-fonts/Inter';

const { fontFamily } = loadFont('normal', { subsets: ['latin'], weights: ['400', '600', '700'] });

export type ShowcaseScene = {
  key: string;
  title: string;
  subtitle: string;
  src: string; // path under public/
};

export type ShowcaseProps = {
  scenes: readonly ShowcaseScene[];
  sceneFrames: number;
  transitionFrames: number;
};

function SceneCard({ scene }: { scene: ShowcaseScene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle "2026 UI" motion: no bouncy gimmicks, no CSS transitions.
  const t = interpolate(frame, [0, Math.floor(0.8 * fps)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const scale = interpolate(t, [0, 1], [0.985, 1]);
  const translateY = interpolate(t, [0, 1], [14, 0]);

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06))',
        fontFamily,
        padding: 72,
      }}
    >
      <div
        style={{
          display: 'flex',
          height: '100%',
          gap: 44,
          alignItems: 'center',
        }}
      >
        <div style={{ width: 520 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              opacity: 0.65,
              marginBottom: 12,
            }}
          >
            Present UI 2026
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.05 }}>{scene.title}</div>
          <div style={{ fontSize: 18, opacity: 0.72, marginTop: 14, lineHeight: 1.35 }}>{scene.subtitle}</div>
          <div style={{ height: 10 }} />
          <div
            style={{
              height: 2,
              width: 120,
              borderRadius: 999,
              background: 'rgba(183, 94, 63, 0.9)', // copper highlight
              marginTop: 20,
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              transform: `translateY(${translateY}px) scale(${scale})`,
              transformOrigin: '50% 50%',
              borderRadius: 28,
              overflow: 'hidden',
              border: '1px solid rgba(0,0,0,0.12)',
              boxShadow: '0 22px 70px rgba(0,0,0,0.22)',
              backgroundColor: 'white',
            }}
          >
            <Img
              src={staticFile(scene.src)}
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 0.75 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily,
        padding: 96,
        justifyContent: 'center',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.06))',
      }}
    >
      <div style={{ opacity, maxWidth: 980 }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            opacity: 0.65,
            marginBottom: 18,
          }}
        >
          Next
        </div>
        <div style={{ fontSize: 50, fontWeight: 700, lineHeight: 1.05 }}>
          Migrate remaining widget modals and controls
        </div>
        <div style={{ fontSize: 18, opacity: 0.74, marginTop: 16, lineHeight: 1.4 }}>
          The goal is total parity: every button, modal, card, and TLDraw menu uses one cohesive tokenized
          language, across light and dark.
        </div>
        <div
          style={{
            height: 2,
            width: 160,
            borderRadius: 999,
            background: 'rgba(183, 94, 63, 0.9)',
            marginTop: 26,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

export const Showcase: React.FC<ShowcaseProps> = ({ scenes, sceneFrames, transitionFrames }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#f6f6f4' }}>
      <TransitionSeries>
        {scenes.map((scene, idx) => (
          <React.Fragment key={scene.key}>
            <TransitionSeries.Sequence durationInFrames={sceneFrames}>
              <SceneCard scene={scene} />
            </TransitionSeries.Sequence>
            {idx < scenes.length - 1 ? (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: transitionFrames })}
              />
            ) : null}
          </React.Fragment>
        ))}

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: transitionFrames })}
        />
        <TransitionSeries.Sequence durationInFrames={60}>
          <EndCard />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

