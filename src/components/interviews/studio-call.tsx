'use client';

import dynamic from 'next/dynamic';
import { ArrowRight, Link, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from 'lucide-react';
import type { BriefSnapshot, InterviewEnvelope } from '@present/contracts/interviews';
import type { useInterviewCall } from './use-interview-call';
import { LiveNotesControl } from './live-notes-control';

const CallMedia = dynamic(() => import('./call-media').then((module) => module.CallMedia), { ssr: false });
export type StudioCall = ReturnType<typeof useInterviewCall>;
export function StudioParticipants({ snapshot, interview, call }: { snapshot: BriefSnapshot; interview: InterviewEnvelope; call: StudioCall }) {
  const candidate = snapshot.fields.name || 'Candidate';
  return call.room ? <CallMedia room={call.room} /> : <div className="ob-participants">
    <div className="ob-participant"><span className="ob-initials">{candidate.split(/\s+/).map((part) => part[0]).slice(0,2).join('')}</span><div className="ob-participant-label"><span>{candidate} · Candidate</span><MicOff /></div></div>
    <div className="ob-participant"><span className="ob-initials">{interview.role === 'recruiter' ? 'YO' : 'RC'}</span><div className="ob-participant-label"><span>{interview.role === 'recruiter' ? 'You' : 'Recruiter'} · Recruiter</span><MicOff /></div></div>
  </div>;
}
export function StudioCallControls({ call, onScreen }: { call: StudioCall; onScreen?: () => void }) {
  return <div className="ob-call-controls st-call-controls"><button className={`ob-icon-button ${call.mic ? 'is-on' : ''}`} disabled={!call.connected} aria-label={call.mic ? 'Mute microphone' : 'Unmute microphone'} onClick={() => void call.toggle('mic')}>{call.mic ? <Mic /> : <MicOff />}</button><button className={`ob-icon-button ${call.camera ? 'is-on' : ''}`} disabled={!call.connected} aria-label={call.camera ? 'Turn camera off' : 'Turn camera on'} onClick={() => void call.toggle('camera')}>{call.camera ? <Video /> : <VideoOff />}</button><button className="ob-connect-button" disabled={call.connecting} onClick={() => void call.connect()}>{call.connected ? <PhoneOff /> : <Link />}{call.connecting ? 'Connecting…' : call.connected ? 'Leave call' : 'Connect call'}</button>{call.audioBlocked && <button className="ob-button st-enable-sound" onClick={() => void call.enableAudio()}>Enable sound</button>}{onScreen && <button className="ob-icon-button" aria-label="Show screen" onClick={onScreen}><MonitorUp /></button>}</div>;
}
export function MeetScene({ snapshot, interview, call, onBrief, onScreen, busy, onConsent }: { snapshot: BriefSnapshot; interview: InterviewEnvelope; call: StudioCall; onBrief: () => void; onScreen: () => void; busy: boolean; onConsent: (enabled: boolean) => void }) {
  return <section className="st-meet"><div className="st-meet-intro"><h1>Let’s meet.</h1><p>Start with a conversation. Bring the brief in when you’re ready.</p></div><LiveNotesControl interview={interview} busy={busy} onConsent={onConsent} /><StudioParticipants snapshot={snapshot} interview={interview} call={call} /><StudioCallControls call={call} onScreen={onScreen} /><button className="ob-button ob-button-primary st-open-brief" onClick={onBrief}>Open the brief <ArrowRight /></button><p className="st-meet-state">{call.connected ? call.listening ? 'Live notes are on.' : 'Connected. Turn on your microphone and camera, then enable shared notes together.' : 'Connect the call, then turn on your microphone and camera.'}</p></section>;
}
