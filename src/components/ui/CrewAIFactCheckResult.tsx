"use client";
import * as React from "react";

export interface CrewAIFactCheckResultProps {
  results: any;
  status: string;
}

export const CrewAIFactCheckResult: React.FC<CrewAIFactCheckResultProps> = ({ results, status }) => {
  return (
    <div className="p-4 bg-gray-50 rounded-md border">
      <h2 className="text-xl font-semibold mb-2">Fact Check Result</h2>
      <p className="mb-2"><strong>Status:</strong> {status}</p>
      <pre className="bg-white p-2 rounded overflow-auto"><code>{JSON.stringify(results, null, 2)}</code></pre>
    </div>
  );
}; 