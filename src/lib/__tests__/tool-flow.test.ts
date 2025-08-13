import { systemRegistry } from '../system-registry';

describe('Unified Tool Execution Flow (Phase 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Tool Execution', () => {
    it('should execute tool through registry and emit result state', async () => {
      // Mock Tambo tool
      const mockTool = {
        execute: jest.fn().mockResolvedValue({ status: 'SUCCESS', data: 'test result' })
      };
      
      const mockRegistry = {
        youtube_search: mockTool
      };

      const call = {
        id: 'call-123',
        name: 'youtube_search',
        args: { query: 'test search' },
        origin: 'browser'
      };

      await systemRegistry.executeTool(call, { tamboRegistry: mockRegistry });

      // Check tool was called
      expect(mockTool.execute).toHaveBeenCalledWith({ query: 'test search' });
      
      // Check result state was emitted
      const resultState = systemRegistry.getState('call-123');
      expect(resultState).toBeDefined();
      expect(resultState?.kind).toBe('tool_result');
      expect(resultState?.payload).toEqual({
        ok: true,
        result: { status: 'SUCCESS', data: 'test result' }
      });
    });

    it('should handle tool execution errors and emit error state', async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error('Tool failed'))
      };
      
      const mockRegistry = {
        failing_tool: mockTool
      };

      const call = {
        id: 'call-456',
        name: 'failing_tool',
        args: {},
        origin: 'agent'
      };

      await expect(
        systemRegistry.executeTool(call, { tamboRegistry: mockRegistry })
      ).rejects.toThrow('Tool failed');

      // Check error state was emitted
      const errorState = systemRegistry.getState('call-456');
      expect(errorState).toBeDefined();
      expect(errorState?.kind).toBe('tool_error');
      expect(errorState?.payload).toEqual({
        ok: false,
        error: 'Tool failed'
      });
    });

    it('should use capability routing for tool name mapping', async () => {
      // Add YouTube search capability with mapping
      systemRegistry.addCapability({
        id: 'youtube_search',
        type: 'tool',
        name: 'YouTube Search',
        description: 'Search YouTube videos',
        agentToolName: 'youtube_search',
        mcpToolName: 'searchVideos', // Different MCP name
        available: true,
        source: 'static'
      });

      const mockTool = {
        execute: jest.fn().mockResolvedValue({ videos: [] })
      };
      
      const mockRegistry = {
        searchVideos: mockTool // MCP name
      };

      const call = {
        id: 'call-789',
        name: 'youtube_search', // Agent name
        args: { query: 'test' }
      };

      await systemRegistry.executeTool(call, { tamboRegistry: mockRegistry });

      // Should have called the MCP tool with mapped name
      expect(mockTool.execute).toHaveBeenCalledWith({ query: 'test' });
    });
  });

  describe('Tool Registry Types', () => {
    it('should handle Map-style tool registry', async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue('map result')
      };
      
      const mockRegistry = new Map([
        ['test_tool', mockTool]
      ]);

      const call = {
        id: 'map-test',
        name: 'test_tool',
        args: { param: 'value' }
      };

      await systemRegistry.executeTool(call, { tamboRegistry: mockRegistry });
      
      expect(mockTool.execute).toHaveBeenCalledWith({ param: 'value' });
    });

    it('should handle object-style tool registry', async () => {
      const mockTool = jest.fn().mockResolvedValue('object result');
      
      const mockRegistry = {
        test_tool: mockTool
      };

      const call = {
        id: 'obj-test',
        name: 'test_tool',
        args: { param: 'value' }
      };

      await systemRegistry.executeTool(call, { tamboRegistry: mockRegistry });
      
      expect(mockTool).toHaveBeenCalledWith({ param: 'value' });
    });
  });

  describe('State Integration', () => {
    it('should allow listening to tool results via state subscription', (done) => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({ result: 'success' })
      };
      
      const mockRegistry = { my_tool: mockTool };

      const unsubscribe = systemRegistry.onState((envelope) => {
        if (envelope.kind === 'tool_result' && envelope.id === 'state-test') {
          expect(envelope.payload).toEqual({
            ok: true,
            result: { result: 'success' }
          });
          unsubscribe();
          done();
        }
      });

      systemRegistry.executeTool(
        { id: 'state-test', name: 'my_tool', args: {} },
        { tamboRegistry: mockRegistry }
      );
    });
  });

  describe('Hot Reloading', () => {
    it('should execute newly added tools without code changes', async () => {
      // Simulate MCP tool discovery
      systemRegistry.addCapability({
        id: 'new_mcp_tool',
        type: 'mcp_tool',
        name: 'New MCP Tool',
        description: 'Dynamically discovered tool',
        mcpToolName: 'newTool',
        agentToolName: 'new_mcp_tool',
        available: true,
        source: 'mcp'
      });

      const mockTool = {
        execute: jest.fn().mockResolvedValue({ dynamicResult: true })
      };
      
      const mockRegistry = {
        newTool: mockTool
      };

      const call = {
        id: 'dynamic-test',
        name: 'new_mcp_tool',
        args: { test: true }
      };

      await systemRegistry.executeTool(call, { tamboRegistry: mockRegistry });
      
      expect(mockTool.execute).toHaveBeenCalledWith({ test: true });
    });
  });

  // New tests for weather mapping
  describe('MCP Weather Mapping', () => {
    it('should map agent weather tools to MCP names when present in registry', async () => {
      // Simulate capabilities synced from MCP
      systemRegistry.addCapability({
        id: 'mcp_weather',
        type: 'tool',
        name: 'Weather',
        description: 'Weather current conditions',
        agentToolName: 'mcp_weather',
        mcpToolName: 'weather',
        available: true,
        source: 'mcp'
      });
      systemRegistry.addCapability({
        id: 'mcp_forecast',
        type: 'tool',
        name: 'Forecast',
        description: 'Weather forecast',
        agentToolName: 'mcp_forecast',
        mcpToolName: 'forecast',
        available: true,
        source: 'mcp'
      });

      const weatherTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };
      const forecastTool = { execute: jest.fn().mockResolvedValue({ ok: true }) };

      const registry: any = { weather: weatherTool, forecast: forecastTool };

      await systemRegistry.executeTool({ id: 'w1', name: 'mcp_weather', args: { location: 'SF' } }, { tamboRegistry: registry });
      await systemRegistry.executeTool({ id: 'w2', name: 'mcp_forecast', args: { location: 'SF', days: 7 } }, { tamboRegistry: registry });

      expect(weatherTool.execute).toHaveBeenCalledWith({ location: 'SF' });
      expect(forecastTool.execute).toHaveBeenCalledWith({ location: 'SF', days: 7 });
    });
  });
}); 