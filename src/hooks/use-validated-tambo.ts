/**
 * Custom hook that wraps useTambo and validates tools
 * 
 * This hook ensures all tools in the registry have valid names
 * that comply with Tambo SDK requirements (^[a-zA-Z0-9_-]+$)
 */

import { useTambo } from "@tambo-ai/react";
import { sanitizeToolName, isValidToolName } from "@/lib/tambo-tool-validator";
import { useEffect, useRef, useMemo } from "react";

export function useValidatedTambo() {
  const tambo = useTambo() as any;
  const lastRegistryRef = useRef<any>(null);

  // Create a proxy that sanitizes tool names on access
  const proxiedRegistry = useMemo(() => {
    if (!tambo?.toolRegistry) return tambo?.toolRegistry;
    
    // If registry hasn't changed, return cached proxy
    if (tambo.toolRegistry === lastRegistryRef.current) {
      return tambo.toolRegistry;
    }
    
    lastRegistryRef.current = tambo.toolRegistry;

    // Handle Map-style registry
    if (tambo.toolRegistry instanceof Map) {
      const validatedMap = new Map();
      tambo.toolRegistry.forEach((tool: any, name: string) => {
        if (isValidToolName(name)) {
          validatedMap.set(name, tool);
        } else {
          const sanitized = sanitizeToolName(name);
          console.warn(`🔧 [ValidatedTambo] Sanitized tool name: "${name}" → "${sanitized}"`);
          // Update the tool with sanitized name
          const updatedTool = { ...tool, name: sanitized, originalName: name };
          validatedMap.set(sanitized, updatedTool);
        }
      });
      return validatedMap;
    }

    // Handle object-style registry
    if (typeof tambo.toolRegistry === 'object') {
      const validatedRegistry: Record<string, any> = {};
      Object.entries(tambo.toolRegistry).forEach(([name, tool]: [string, any]) => {
        if (isValidToolName(name)) {
          validatedRegistry[name] = tool;
        } else {
          const sanitized = sanitizeToolName(name);
          console.warn(`🔧 [ValidatedTambo] Sanitized tool name: "${name}" → "${sanitized}"`);
          // Update the tool with sanitized name
          const updatedTool = { ...tool, name: sanitized, originalName: name };
          validatedRegistry[sanitized] = updatedTool;
        }
      });
      return validatedRegistry;
    }

    return tambo.toolRegistry;
  }, [tambo?.toolRegistry]);

  // Return tambo context with validated tool registry
  return {
    ...tambo,
    toolRegistry: proxiedRegistry
  };
}