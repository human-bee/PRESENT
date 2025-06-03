/**
 * MCP Debug Utilities
 * Helper functions for debugging MCP and component state issues
 */

interface MCPDebugInfo {
  componentId: string;
  state: any;
  error?: Error;
  timestamp: string;
}

// Store debug information in session storage for debugging
const MCP_DEBUG_KEY = 'mcp-debug-info';

/**
 * Log MCP component state changes for debugging
 */
export function debugMCPState(componentId: string, state: any, error?: Error) {
  if (process.env.NODE_ENV !== 'development') return;
  
  const debugInfo: MCPDebugInfo = {
    componentId,
    state,
    error,
    timestamp: new Date().toISOString()
  };
  
  // Log to console with structured format
  console.group(`🔍 [MCP Debug] ${componentId}`);
  console.log('State:', state);
  if (error) {
    console.error('Error:', error);
  }
  console.log('Timestamp:', debugInfo.timestamp);
  console.groupEnd();
  
  // Store in session storage for debugging
  try {
    const existing = JSON.parse(sessionStorage.getItem(MCP_DEBUG_KEY) || '[]');
    existing.push(debugInfo);
    
    // Keep only last 50 entries
    if (existing.length > 50) {
      existing.splice(0, existing.length - 50);
    }
    
    sessionStorage.setItem(MCP_DEBUG_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn('Failed to store MCP debug info:', e);
  }
}

/**
 * Get debug information for a specific component
 */
export function getMCPDebugInfo(componentId?: string): MCPDebugInfo[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const debugInfo = JSON.parse(sessionStorage.getItem(MCP_DEBUG_KEY) || '[]');
    
    if (componentId) {
      return debugInfo.filter((info: MCPDebugInfo) => info.componentId === componentId);
    }
    
    return debugInfo;
  } catch (e) {
    console.warn('Failed to retrieve MCP debug info:', e);
    return [];
  }
}

/**
 * Clear debug information
 */
export function clearMCPDebugInfo() {
  if (typeof window === 'undefined') return;
  
  try {
    sessionStorage.removeItem(MCP_DEBUG_KEY);
    console.log('🔍 [MCP Debug] Debug info cleared');
  } catch (e) {
    console.warn('Failed to clear MCP debug info:', e);
  }
}

/**
 * Validate component state before updates
 */
export function validateMCPState(componentId: string, state: any): boolean {
  if (!state) {
    console.warn(`🔍 [MCP Debug] ${componentId}: State is null/undefined`);
    debugMCPState(componentId, state, new Error('State is null/undefined'));
    return false;
  }
  
  if (typeof state !== 'object') {
    console.warn(`🔍 [MCP Debug] ${componentId}: State is not an object:`, typeof state);
    debugMCPState(componentId, state, new Error('State is not an object'));
    return false;
  }
  
  return true;
}

/**
 * Safe state updater that validates and logs state changes
 */
export function safeMCPStateUpdate<T>(
  componentId: string, 
  setState: (updater: (prev: T | null) => T) => void,
  updater: (prev: T | null) => T
) {
  setState((prev) => {
    try {
      const newState = updater(prev);
      
      if (!validateMCPState(componentId, newState)) {
        console.warn(`🔍 [MCP Debug] ${componentId}: Invalid state update, using previous state`);
        return prev || {} as T;
      }
      
      debugMCPState(componentId, newState);
      return newState;
    } catch (error) {
      console.error(`🔍 [MCP Debug] ${componentId}: Error in state updater:`, error);
      debugMCPState(componentId, prev, error as Error);
      return prev || {} as T;
    }
  });
}

/**
 * Development-only MCP state inspector
 */
export function inspectMCPState() {
  if (process.env.NODE_ENV !== 'development') return;
  
  const debugInfo = getMCPDebugInfo();
  console.group('🔍 [MCP Debug] State Inspector');
  console.log('Total entries:', debugInfo.length);
  
  const byComponent = debugInfo.reduce((acc, info) => {
    if (!acc[info.componentId]) acc[info.componentId] = [];
    acc[info.componentId].push(info);
    return acc;
  }, {} as Record<string, MCPDebugInfo[]>);
  
  Object.entries(byComponent).forEach(([componentId, entries]) => {
    console.group(`Component: ${componentId} (${entries.length} entries)`);
    entries.forEach((entry, index) => {
      console.log(`${index + 1}.`, entry.timestamp, entry.state);
      if (entry.error) {
        console.error('Error:', entry.error);
      }
    });
    console.groupEnd();
  });
  
  console.groupEnd();
}

// Expose debug utilities to window for easy access in development
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as any).MCPDebug = {
    inspect: inspectMCPState,
    clear: clearMCPDebugInfo,
    get: getMCPDebugInfo,
  };
} 