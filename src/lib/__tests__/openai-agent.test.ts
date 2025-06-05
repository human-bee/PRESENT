import { tamboVoiceAgent, createTamboVoiceAgent, createAgentSession, TamboVoiceAgentManager, defaultAgentConfig } from '../openai-agent';

// Mock the OpenAI agents SDK for testing
jest.mock('@openai/agents/realtime', () => ({
  RealtimeAgent: jest.fn().mockImplementation((config) => ({
    name: config.name,
    instructions: config.instructions,
    tools: config.tools || [],
  })),
  RealtimeSession: jest.fn().mockImplementation((agent, config) => ({
    agent,
    model: config.model,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('OpenAI Agent-JS Setup', () => {
  beforeEach(() => {
    // Reset environment variables
    delete process.env.OPENAI_API_KEY;
    jest.clearAllMocks();
  });

  describe('Agent Creation', () => {
    it('should create a TamboVoiceAgent with default configuration', () => {
      // Set API key for the test
      process.env.OPENAI_API_KEY = 'test-api-key';
      
      const agent = createTamboVoiceAgent();
      
      expect(agent).toBeDefined();
      expect(agent.name).toBe('Tambo Voice Assistant');
      expect(agent.instructions).toContain('voice assistant');
      expect(agent.instructions).toContain('show timer');
    });

    it('should create a TamboVoiceAgent with custom configuration', () => {
      const customConfig = {
        name: 'Custom Assistant',
        instructions: 'Custom instructions',
        openaiApiKey: 'custom-api-key',
      };
      
      const agent = createTamboVoiceAgent(customConfig);
      
      expect(agent).toBeDefined();
      expect(agent.name).toBe('Custom Assistant');
      expect(agent.instructions).toBe('Custom instructions');
    });

    it('should throw error when OpenAI API key is missing', () => {
      // Ensure no API key is available in environment or config
      delete process.env.OPENAI_API_KEY;
      
      expect(() => {
        createTamboVoiceAgent({ openaiApiKey: '' });
      }).toThrow('OpenAI API key is required');
    });
  });

  describe('Session Creation', () => {
    it('should create a RealtimeSession with agent', () => {
      process.env.OPENAI_API_KEY = 'test-api-key';
      
      const agent = createTamboVoiceAgent();
      const session = createAgentSession(agent);
      
      expect(session).toBeDefined();
      expect(session.agent).toBe(agent);
      expect(session.model).toBe('gpt-4o-realtime-preview-2025-06-03');
    });

    it('should create a RealtimeSession with custom model', () => {
      process.env.OPENAI_API_KEY = 'test-api-key';
      
      const agent = createTamboVoiceAgent();
      const session = createAgentSession(agent, { model: 'custom-model' });
      
      expect(session).toBeDefined();
      expect(session.model).toBe('custom-model');
    });
  });

  describe('TamboVoiceAgentManager', () => {
    let manager: TamboVoiceAgentManager;

    beforeEach(() => {
      manager = new TamboVoiceAgentManager({ openaiApiKey: 'test-api-key' });
    });

    it('should initialize successfully', async () => {
      await manager.initialize();
      
      const status = manager.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.agentName).toBe('Tambo Voice Assistant');
    });

    it('should connect successfully after initialization', async () => {
      await manager.initialize();
      await manager.connect();
      
      const status = manager.getStatus();
      expect(status.connected).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await manager.initialize();
      await manager.connect();
      await manager.disconnect();
      
      const status = manager.getStatus();
      expect(status.connected).toBe(false);
    });

    it('should throw error when connecting without initialization', async () => {
      await expect(manager.connect()).rejects.toThrow('Agent not initialized');
    });

    it('should provide access to session and agent', async () => {
      await manager.initialize();
      
      expect(manager.getAgent()).toBeDefined();
      expect(manager.getSession()).toBeDefined();
    });
  });

  describe('Default Configuration', () => {
    it('should have appropriate default trigger phrases', () => {
      expect(defaultAgentConfig.triggerPhrases).toContain('show timer');
      expect(defaultAgentConfig.triggerPhrases).toContain('create button');
      expect(defaultAgentConfig.triggerPhrases).toContain('show component');
    });

    it('should have appropriate default model', () => {
      expect(defaultAgentConfig.model).toBe('gpt-4o-realtime-preview-2025-06-03');
    });

    it('should have appropriate instructions for Tambo UI integration', () => {
      expect(defaultAgentConfig.instructions).toContain('Tambo UI component');
      expect(defaultAgentConfig.instructions).toContain('trigger phrases');
      expect(defaultAgentConfig.instructions).toContain('RetroTimer');
    });
  });

  describe('Global Agent Instance', () => {
    it('should provide global tamboVoiceAgent instance', () => {
      expect(tamboVoiceAgent).toBeInstanceOf(TamboVoiceAgentManager);
    });

    it('should have default configuration', () => {
      const status = tamboVoiceAgent.getStatus();
      expect(status.initialized).toBe(false);
      expect(status.connected).toBe(false);
    });
  });
}); 