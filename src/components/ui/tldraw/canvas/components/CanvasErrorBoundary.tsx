"use client";

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface CanvasErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface CanvasErrorBoundaryProps {
  children: ReactNode;
}

export class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  constructor(props: CanvasErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Tldraw canvas error caught:', error.message);

    if (
      error.message.includes('ValidationError') ||
      error.message.includes('Expected a valid url') ||
      error.message.includes('shape(type = bookmark)')
    ) {
      console.warn('Validation error suppressed by CanvasErrorBoundary');
      return;
    }

    console.error('Tldraw error details:', info);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full w-full bg-gray-50">
          <div className="text-center p-8">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Canvas Error</h2>
            <p className="text-gray-500 mb-4">There was an issue with the canvas. Refreshing may help.</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

