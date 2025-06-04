import React, { useEffect, useState } from 'react';
import { z } from 'zod';

// Mock implementations for now if not available
// In a real Tambo setup, these would be imported from '@/hooks/tambo' or similar
const useTamboComponentState = <T,>(
  id: string, 
  initialState: T
): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [state, setState] = useState(initialState);
  console.log(`[TamboMock] useTamboComponentState for ${id}`, state);
  return [state, setState];
};

const useDataChannel = (channelName: string, callback: (message: any) => void) => {
  useEffect(() => {
    console.log(`[TamboMock] Subscribed to data channel: ${channelName}`);
    
    // Mock receiving a message - commented out for now
    const mockMessageInterval = setInterval(() => {
      // callback({ 
      //   type: 'transcription', 
      //   text: 'This is a test claim from a speaker.', 
      //   speakerId: 'Speaker 1',
      //   timestamp: Date.now()
      // });
    }, 15000);
    
    return () => {
      console.log(`[TamboMock] Unsubscribed from data channel: ${channelName}`);
      clearInterval(mockMessageInterval);
    };
  }, [channelName, callback]);
};


// Schema for individual claims
export const claimSchema = z.object({
  id: z.string().describe("Unique identifier for the claim"),
  text: z.string().describe("The text of the claim made by the speaker"),
  speaker: z.string().optional().describe("Identifier for the speaker making the claim"),
  status: z.enum(['pending', 'true', 'false', 'disputed', 'verifying']).default('pending').describe("Verification status of the claim"),
  source: z.string().optional().describe("Source or explanation for the verification status"),
  timestamp: z.date().describe("When the claim was made or logged"),
});

export type Claim = z.infer<typeof claimSchema>;

// Props schema for the FactChecker component
export const factCheckerSchema = z.object({
  componentId: z.string().default(() => `fact-checker-${Date.now()}`).describe("Unique ID for this component instance"),
  relevantSpeakers: z.array(z.string()).optional().describe("List of speaker IDs to focus on. If empty, checks all."),
  verificationServiceUrl: z.string().url().optional().describe("Optional URL for an automated fact-checking service."),
  autoVerify: z.boolean().default(true).describe("Attempt to automatically verify claims if a service URL is provided."),
  maxClaimsHistory: z.number().min(1).default(20).describe("Maximum number of claims to keep in history."),
});

export type FactCheckerProps = z.infer<typeof factCheckerSchema>;

interface FactCheckerComponentState {
  claims: Claim[];
  isListening: boolean;
}

const FactChecker: React.FC<FactCheckerProps> = (props) => {
  const { componentId, relevantSpeakers, verificationServiceUrl, autoVerify, maxClaimsHistory } = props;

  const [state, setState] = useTamboComponentState<FactCheckerComponentState>(
    componentId,
    { claims: [], isListening: true }
  );

  // Listen to transcriptions from LiveKit data channel
  useDataChannel("transcription", (message) => {
    if (!state.isListening) return;

    // Assuming message format: { text: string, speakerId?: string, timestamp?: number }
    const { text, speakerId, timestamp } = message;
    
    if (relevantSpeakers && relevantSpeakers.length > 0 && speakerId && !relevantSpeakers.includes(speakerId)) {
      return; // Ignore claims from speakers not in the relevant list
    }

    const newClaim: Claim = {
      id: `claim-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      text: text,
      speaker: speakerId || 'Unknown Speaker',
      status: 'pending',
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    setState(prevState => ({
      ...prevState,
      claims: [newClaim, ...prevState.claims].slice(0, maxClaimsHistory),
    }));

    if (autoVerify && verificationServiceUrl) {
      // Placeholder for calling the verification service
      verifyClaimWithService(newClaim, verificationServiceUrl);
    }
  });
  
  const verifyClaimWithService = async (claim: Claim, serviceUrl: string) => {
    setState(prevState => ({
      ...prevState,
      claims: prevState.claims.map(c => c.id === claim.id ? { ...c, status: 'verifying' } : c),
    }));
    try {
      // This is a placeholder. Replace with actual API call.
      console.log(`Verifying claim "${claim.text}" with ${serviceUrl}`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      const randomStatus = Math.random() > 0.5 ? 'true' : 'false';
      const mockSource = randomStatus === 'true' ? 'Verified by MockAPI' : 'Contradicted by MockAPI';
      
      updateClaimStatus(claim.id, randomStatus as 'true' | 'false', mockSource);
    } catch (error) {
      console.error("Error verifying claim:", error);
      updateClaimStatus(claim.id, 'pending', 'Verification service error');
    }
  };

  // Canvas awareness: Dispatch event to show component on canvas
  useEffect(() => {
    const eventDetail = { messageId: componentId, component: <FactChecker {...props} /> };
    window.dispatchEvent(new CustomEvent("tambo:showComponent", { detail: eventDetail }));
    console.log('[Tambo] FactChecker component shown on canvas', eventDetail);
  }, [componentId, props]);


  const updateClaimStatus = (claimId: string, status: Claim['status'], source?: string) => {
    setState(prevState => ({
      ...prevState,
      claims: prevState.claims.map(c => 
        c.id === claimId ? { ...c, status, source: source || c.source } : c
      ),
    }));
  };
  
  const getStatusColor = (status: Claim['status']) => {
    switch (status) {
      case 'true': return 'bg-green-600 hover:bg-green-700';
      case 'false': return 'bg-red-600 hover:bg-red-700';
      case 'disputed': return 'bg-yellow-500 hover:bg-yellow-600';
      case 'verifying': return 'bg-blue-500 animate-pulse';
      default: return 'bg-gray-600 hover:bg-gray-700';
    }
  };

  return (
    <div className="p-4 bg-gray-800 text-white rounded-lg shadow-xl max-w-md mx-auto w-full" style={{fontFamily: "'Inter', sans-serif"}}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Real-Time Fact Checker</h2>
        <button 
          onClick={() => setState(prev => ({...prev, isListening: !prev.isListening}))}
          className={`px-3 py-1 rounded-md text-sm font-medium ${state.isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
        >
          {state.isListening ? 'Pause' : 'Resume'}
        </button>
      </div>
      
      <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
        {state.claims.length === 0 && (
          <p className="text-center text-gray-400 py-4">
            {state.isListening ? 'Listening for claims...' : 'Paused. Press Resume to start listening.'}
          </p>
        )}
        {state.claims.map((claim) => (
          <div key={claim.id} className="bg-gray-700 p-3 rounded-md shadow hover:shadow-lg transition-shadow duration-200">
            <p className="text-sm text-gray-300 mb-1">
              <span className="font-semibold">{claim.speaker || 'Unknown'}</span>
              <span className="text-xs text-gray-400 ml-2">{new Date(claim.timestamp).toLocaleTimeString()}</span>
            </p>
            <p className="text-base mb-2 leading-tight">{claim.text}</p>
            <div className="flex justify-between items-center">
              <div className="flex space-x-1">
                {['true', 'false', 'disputed', 'pending'].map(s => (
                  <button
                    key={s}
                    onClick={() => updateClaimStatus(claim.id, s as Claim['status'], 'Manually updated')}
                    className={`px-2 py-1 text-xs rounded ${getStatusColor(s as Claim['status'])} ${claim.status === s ? 'ring-2 ring-white ring-opacity-50' : ''}`}
                    title={`Mark as ${s}`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {claim.status === 'verifying' && <div className="text-xs text-blue-300">Verifying...</div>}
            </div>
            {claim.source && claim.status !== 'pending' && claim.status !== 'verifying' && (
              <p className="text-xs text-gray-400 mt-1.5 pt-1.5 border-t border-gray-600">
                <span className="font-semibold">Source:</span> {claim.source}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default FactChecker; 