import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming, springTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { loadFont } from '@remotion/google-fonts/SpaceGrotesk';

const { fontFamily: spaceGrotesk } = loadFont('normal', {
  weights: ['400', '600', '700'],
  subsets: ['latin'],
});

export const PRESENT_SHOWCASE_FPS = 30;
export const PRESENT_SHOWCASE_WIDTH = 1920;
export const PRESENT_SHOWCASE_HEIGHT = 1080;

const TRANSITION_FRAMES = 15;

const SCENES: Array<{ key: string; duration: number }> = [
  { key: 'title', duration: 60 },
  { key: 'canvas', duration: 90 },
  { key: 'transcript', duration: 75 },
  { key: 'weather', duration: 75 },
  { key: 'youtube', duration: 75 },
  { key: 'scorecard', duration: 75 },
  { key: 'linear', duration: 75 },
  { key: 'infographic', duration: 75 },
  { key: 'pin', duration: 90 },
  { key: 'closing', duration: 60 },
];

const TOTAL_SCENE_FRAMES = SCENES.reduce((sum, scene) => sum + scene.duration, 0);
export const PRESENT_SHOWCASE_TOTAL_FRAMES = TOTAL_SCENE_FRAMES - TRANSITION_FRAMES * (SCENES.length - 1);

export type PresentShowcaseProps = {
  runId: string;
  domainLabel?: string;
};

function Background() {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#070A12',
        backgroundImage:
          'radial-gradient(1200px 700px at 18% 20%, rgba(56, 189, 248, 0.18) 0%, rgba(56, 189, 248, 0) 55%), radial-gradient(1000px 650px at 82% 78%, rgba(168, 85, 247, 0.14) 0%, rgba(168, 85, 247, 0) 58%), radial-gradient(900px 520px at 58% 40%, rgba(34, 197, 94, 0.08) 0%, rgba(34, 197, 94, 0) 60%)',
      }}
    />
  );
}

function FrameCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        borderRadius: 28,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 999,
        fontFamily: spaceGrotesk,
        fontSize: 14,
        letterSpacing: 0.3,
        color: 'rgba(255,255,255,0.86)',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: 999, background: '#22c55e' }} />
      {text}
    </div>
  );
}

function TitleCard({ domainLabel }: { domainLabel: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 20, mass: 0.9 } });
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(enter, [0, 1], [28, 0]);
  const scale = interpolate(enter, [0, 1], [0.98, 1]);

  return (
    <AbsoluteFill style={{ padding: 96, fontFamily: spaceGrotesk }}>
      <Background />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start' }}>
        <div style={{ opacity, transform: `translateY(${y}px) scale(${scale})` }}>
          <Pill text="Production Showcase" />
          <div style={{ marginTop: 26, maxWidth: 1200 }}>
            <div
              style={{
                fontSize: 84,
                fontWeight: 700,
                lineHeight: 0.98,
                letterSpacing: -1.2,
                color: 'rgba(255,255,255,0.94)',
              }}
            >
              Present is back online.
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 26,
                lineHeight: 1.35,
                color: 'rgba(255,255,255,0.70)',
                maxWidth: 980,
              }}
            >
              Multi-user canvas sync, speaker-attributed transcripts, Fairy-first canvas manipulation, and hardened widgets in production.
            </div>
          </div>
          <div
            style={{
              marginTop: 44,
              display: 'inline-flex',
              padding: '14px 18px',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(0,0,0,0.24)',
              color: 'rgba(255,255,255,0.82)',
              fontSize: 18,
            }}
          >
            {domainLabel}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function ScreenshotScene({
  label,
  headline,
  subhead,
  src,
  durationInFrames,
  domainLabel,
}: {
  label: string;
  headline: string;
  subhead: string;
  src: string;
  durationInFrames: number;
  domainLabel: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 22, mass: 0.9 } });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const baseScale = interpolate(enter, [0, 1], [0.985, 1]);
  const ken = interpolate(frame, [0, durationInFrames], [1.02, 1.08], { extrapolateRight: 'clamp' });
  const kenY = interpolate(frame, [0, durationInFrames], [10, -14], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ padding: 72, fontFamily: spaceGrotesk }}>
      <Background />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, height: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Pill text={label} />
            <div
              style={{
                fontSize: 56,
                fontWeight: 700,
                letterSpacing: -0.8,
                color: 'rgba(255,255,255,0.94)',
              }}
            >
              {headline}
            </div>
            <div style={{ fontSize: 22, lineHeight: 1.35, color: 'rgba(255,255,255,0.68)', maxWidth: 1200 }}>
              {subhead}
            </div>
          </div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>{domainLabel}</div>
        </div>

        <FrameCard style={{ flex: 1, opacity, transform: `scale(${baseScale})` }}>
          <AbsoluteFill style={{ transform: `scale(${ken}) translateY(${kenY}px)` }}>
            <Img
              src={staticFile(src)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </AbsoluteFill>
        </FrameCard>
      </div>
    </AbsoluteFill>
  );
}

function PinCompareScene({
  leftSrc,
  rightSrc,
  durationInFrames,
  domainLabel,
}: {
  leftSrc: string;
  rightSrc: string;
  durationInFrames: number;
  domainLabel: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 24, mass: 0.9 } });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(enter, [0, 1], [18, 0]);

  const split = 26;
  const ken = interpolate(frame, [0, durationInFrames], [1.02, 1.06], { extrapolateRight: 'clamp' });

  const labelStyle: React.CSSProperties = {
    fontFamily: spaceGrotesk,
    fontSize: 16,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.86)',
    display: 'inline-flex',
    padding: '10px 14px',
    borderRadius: 999,
    background: 'rgba(0,0,0,0.28)',
    border: '1px solid rgba(255,255,255,0.12)',
  };

  return (
    <AbsoluteFill style={{ padding: 72, fontFamily: spaceGrotesk }}>
      <Background />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Pill text="Multi-user UX" />
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -0.8, color: 'rgba(255,255,255,0.94)' }}>
            Local-only pinning
          </div>
          <div style={{ fontSize: 22, lineHeight: 1.35, color: 'rgba(255,255,255,0.68)', maxWidth: 1200 }}>
            Pins are stored per user (localStorage), so your layout helpers do not fight across participants.
          </div>
        </div>
        <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)' }}>{domainLabel}</div>
      </div>

      <div style={{ display: 'flex', gap: split, height: 'calc(100% - 140px)', opacity, transform: `translateY(${y}px)` }}>
        <FrameCard style={{ flex: 1, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 18, left: 18, zIndex: 10 }}>
            <div style={labelStyle}>Alice: pinned overlay</div>
          </div>
          <AbsoluteFill style={{ transform: `scale(${ken})` }}>
            <Img src={staticFile(leftSrc)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
        </FrameCard>
        <FrameCard style={{ flex: 1, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 18, left: 18, zIndex: 10 }}>
            <div style={labelStyle}>Bob: unaffected</div>
          </div>
          <AbsoluteFill style={{ transform: `scale(${ken})` }}>
            <Img src={staticFile(rightSrc)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
        </FrameCard>
      </div>
    </AbsoluteFill>
  );
}

function ClosingCard({ domainLabel }: { domainLabel: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, mass: 0.9 } });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(enter, [0, 1], [18, 0]);

  return (
    <AbsoluteFill style={{ padding: 96, fontFamily: spaceGrotesk }}>
      <Background />
      <AbsoluteFill style={{ justifyContent: 'center' }}>
        <div style={{ opacity, transform: `translateY(${y}px)` }}>
          <Pill text="Verified in Production" />
          <div style={{ marginTop: 26, fontSize: 68, fontWeight: 700, letterSpacing: -1.1, color: 'rgba(255,255,255,0.94)' }}>
            Ready for real rooms.
          </div>
          <div style={{ marginTop: 18, fontSize: 24, lineHeight: 1.4, color: 'rgba(255,255,255,0.70)', maxWidth: 1100 }}>
            Multi-user sync, speaker-attributed transcript UI, Fairy-first canvas control, and widget reliability hardening all verified via Playwright screenshots.
          </div>
          <div style={{ marginTop: 44, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {['Fairy-first', 'Multi-user sync', 'Transcripts', 'YouTube + Weather', 'Scorecard edits', 'Infographic provider'].map((t) => (
              <div
                key={t}
                style={{
                  padding: '12px 14px',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(0,0,0,0.22)',
                  color: 'rgba(255,255,255,0.78)',
                  fontSize: 16,
                }}
              >
                {t}
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 52,
              display: 'inline-flex',
              padding: '14px 18px',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.84)',
              fontSize: 18,
            }}
          >
            {domainLabel}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export const PresentShowcase: React.FC<PresentShowcaseProps> = ({
  runId,
  domainLabel = 'present.best/canvas',
}) => {
  const base = `showcase/${runId}`;
  const a = `${base}/01-canvas-a.png`;
  const transcript = `${base}/02-transcript.png`;
  const weather = `${base}/03-weather.png`;
  const youtube = `${base}/04-youtube.png`;
  const scorecard = `${base}/05-scorecard.png`;
  const linear = `${base}/06-linear.png`;
  const infographic = `${base}/07-infographic.png`;
  const pinA = `${base}/08-local-pin-a.png`;
  const pinB = `${base}/08-local-pin-b.png`;

  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES[0].duration}>
          <TitleCard domainLabel={domainLabel} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[1].duration}>
          <ScreenshotScene
            label="Multi-user canvas"
            headline="One document, two browsers"
            subhead="Shared TLDraw doc + LiveKit connectivity. This is a real production room on present.best."
            src={a}
            durationInFrames={SCENES[1].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={springTiming({ durationInFrames: TRANSITION_FRAMES, config: { damping: 200 } })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[2].duration}>
          <ScreenshotScene
            label="Transcripts"
            headline="Speaker-attributed transcript UI"
            subhead="Transcripts flow over LiveKit data channels and render in the collapsible thread."
            src={transcript}
            durationInFrames={SCENES[2].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[3].duration}>
          <ScreenshotScene
            label="Weather widget"
            headline="Weather works in production"
            subhead="Fallback path uses /api/weather (Open-Meteo) when MCP isn’t available."
            src={weather}
            durationInFrames={SCENES[3].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: 'from-bottom' })} timing={springTiming({ durationInFrames: TRANSITION_FRAMES, config: { damping: 220 } })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[4].duration}>
          <ScreenshotScene
            label="YouTube widget"
            headline="YouTube search + transcripts"
            subhead="Backed by the YouTube Data API routes in production (no MCP stub)."
            src={youtube}
            durationInFrames={SCENES[4].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[5].duration}>
          <ScreenshotScene
            label="Debate scorecard"
            headline="Edits + state promotion"
            subhead="The scorecard promotes higher version/lastUpdated and supports a two-way workflow."
            src={scorecard}
            durationInFrames={SCENES[5].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: 'from-left' })} timing={springTiming({ durationInFrames: TRANSITION_FRAMES, config: { damping: 210 } })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[6].duration}>
          <ScreenshotScene
            label="Linear"
            headline="Kanban layout fixed"
            subhead="Sizing/cropping hardened so the board renders cleanly in the default canvas shape."
            src={linear}
            durationInFrames={SCENES[6].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[7].duration}>
          <ScreenshotScene
            label="Infographics"
            headline="Provider visibility"
            subhead="The widget reports which provider ran (and why it fell back, if needed)."
            src={infographic}
            durationInFrames={SCENES[7].duration}
            domainLabel={domainLabel}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={springTiming({ durationInFrames: TRANSITION_FRAMES, config: { damping: 220 } })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[8].duration}>
          <PinCompareScene leftSrc={pinA} rightSrc={pinB} durationInFrames={SCENES[8].duration} domainLabel={domainLabel} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />

        <TransitionSeries.Sequence durationInFrames={SCENES[9].duration}>
          <ClosingCard domainLabel={domainLabel} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

