import type { Metadata } from 'next';
import { InterviewEntry } from '@/components/interviews/interview-entry';
import './interviews.css';
import './evidence.css';
import './studio.css';

export const metadata: Metadata = {
  title: 'Open brief · PRESENT',
  description: 'One conversation. One shared story. Write the candidate brief together.',
  referrer: 'no-referrer',
};
export default function InterviewsPage() { return <InterviewEntry />; }
