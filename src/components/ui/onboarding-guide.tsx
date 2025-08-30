'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, Mic, Palette, Users, HelpCircle } from 'lucide-react';
import { z } from 'zod';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  voiceExample?: string;
}

interface OnboardingGuideProps {
  context?: 'canvas' | 'voice' | 'general';
  autoStart?: boolean;
  onComplete?: () => void;
}

export const onboardingGuideSchema = z.object({
  context: z.enum(['canvas', 'voice', 'general']).optional().default('general'),
  autoStart: z.boolean().optional().default(false),
});

export function OnboardingGuide({
  context = 'general',
  autoStart = false,
  onComplete,
}: OnboardingGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(autoStart);

  // Context-aware steps based on actual system capabilities
  const getStepsForContext = (ctx: string): OnboardingStep[] => {
    const baseSteps = [
      {
        id: 'welcome',
        title: 'Welcome to PRESENT',
        description:
          'This is your AI-powered collaborative workspace. Everything here is controllable by voice, touch, or canvas interaction.',
        icon: <HelpCircle className="w-5 h-5 text-blue-600" />,
        voiceExample: 'Try saying "show me help" anytime',
      },
    ];

    const canvasSteps = [
      {
        id: 'voice-connection',
        title: 'Connect Your Voice',
        description:
          'Click the microphone button to join the voice room. The AI agent will listen for commands and respond in real-time.',
        icon: <Mic className="w-5 h-5 text-green-600" />,
        voiceExample: 'Say "connect to voice" or click the mic button',
      },
      {
        id: 'component-creation',
        title: 'Create Components',
        description:
          'Say things like "show timer", "create weather widget", or "add a document editor" to generate interactive components.',
        icon: <Palette className="w-5 h-5 text-purple-600" />,
        voiceExample: 'Try: "show me a timer" or "create a weather forecast"',
      },
      {
        id: 'canvas-interaction',
        title: 'Everything is Interactive',
        description:
          'Components appear on the canvas where you can move, resize, and interact with them. The AI can also update them via voice.',
        icon: <Users className="w-5 h-5 text-orange-600" />,
        voiceExample: 'Say "update the timer to 5 minutes" or drag components around',
      },
    ];

    const voiceSteps = [
      {
        id: 'chat-interaction',
        title: 'Voice Chat Mode',
        description:
          'This split-view lets you chat naturally with the AI. It understands context and can create visual components.',
        icon: <Mic className="w-5 h-5 text-blue-600" />,
        voiceExample: 'Just start talking naturally',
      },
      {
        id: 'canvas-integration',
        title: 'Show in Canvas',
        description:
          'Components created in chat can be transferred to the canvas using "Show in Canvas" buttons or voice commands.',
        icon: <Palette className="w-5 h-5 text-green-600" />,
        voiceExample: 'Say "put that on the canvas" or use the button',
      },
    ];

    switch (ctx) {
      case 'canvas':
        return [...baseSteps, ...canvasSteps];
      case 'voice':
        return [...baseSteps, ...voiceSteps];
      default:
        return baseSteps;
    }
  };

  const steps = getStepsForContext(context);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = () => {
    setIsVisible(false);
    onComplete?.();
  };

  const handleSkip = () => {
    setIsVisible(false);
    // Don't call onComplete for skip - user didn't finish the tour
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleShow = () => {
    setCurrentStep(0);
    setIsVisible(true);
  };

  if (!isVisible) {
    return (
      <div className="inline-flex items-center space-x-2 p-3 bg-white rounded-lg shadow-sm border border-gray-200">
        <HelpCircle className="w-4 h-4 text-gray-600" />
        <span className="text-sm text-gray-700">Need help getting started?</span>
        <button
          onClick={handleShow}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          Show Guide
        </button>
      </div>
    );
  }

  const step = steps[currentStep];

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg border p-6">
      {/* Header */}
      <div className="flex items-center space-x-3 mb-4">
        <div className="p-2 bg-blue-100 rounded-lg">{step.icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{step.title}</h3>
          <div className="text-xs text-gray-500">
            Step {currentStep + 1} of {steps.length}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mb-4">
        <p className="text-gray-700 leading-relaxed mb-3">{step.description}</p>
        {step.voiceExample && (
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-xs font-medium text-blue-800 mb-1">Try this:</div>
            <div className="text-sm text-blue-700 italic">&quot;{step.voiceExample}&quot;</div>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="flex space-x-1 mb-4">
        {steps.map((_, index) => (
          <div
            key={index}
            className={`flex-1 h-2 rounded-full transition-colors ${
              index === currentStep
                ? 'bg-blue-600'
                : index < currentStep
                  ? 'bg-blue-300'
                  : 'bg-gray-200'
            }`}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button
          onClick={handlePrevious}
          disabled={currentStep === 0}
          className="flex items-center space-x-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          onClick={handleSkip}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          Skip
        </button>

        <button
          onClick={handleNext}
          className="flex items-center space-x-1 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          <span>{currentStep === steps.length - 1 ? 'Get Started' : 'Next'}</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
