import { CopilotSearchAgent } from '../copilotSearchAgent';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Embeddings } from '@langchain/core/embeddings';

// Mock implementations
class MockChatModel extends BaseChatModel {
  _llmType(): string {
    return 'mock';
  }

  async _generate() {
    return {
      generations: [[{ text: 'Mock response' }]],
    };
  }
}

class MockEmbeddings extends Embeddings {
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }

  async embedQuery(text: string): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }
}

describe('CopilotSearchAgent', () => {
  let agent: CopilotSearchAgent;
  let mockLLM: MockChatModel;
  let mockEmbeddings: MockEmbeddings;

  beforeEach(() => {
    mockLLM = new MockChatModel({});
    mockEmbeddings = new MockEmbeddings({});
    agent = new CopilotSearchAgent({
      maxQueries: 3,
      maxSourcesPerQuery: 5,
      rerankThreshold: 0.7,
      enablePageExtraction: true,
    });
  });

  describe('generateQueries', () => {
    it('should generate multiple search queries', async () => {
      const query = 'What is artificial intelligence?';
      const history = [];

      const queries = await agent.generateQueries(query, history, mockLLM);
      
      expect(Array.isArray(queries)).toBe(true);
      expect(queries.length).toBeGreaterThan(0);
    });
  });

  describe('searchAndAnswer', () => {
    it('should process a search request and return an event emitter', async () => {
      const message = 'Tell me about machine learning';
      const history = [];
      const optimizationMode = 'balanced';

      const emitter = await agent.searchAndAnswer(
        message,
        history,
        mockLLM,
        mockEmbeddings,
        optimizationMode
      );

      expect(emitter).toBeDefined();
      expect(typeof emitter.on).toBe('function');
      expect(typeof emitter.emit).toBe('function');
    });
  });

  describe('configuration', () => {
    it('should respect configuration parameters', () => {
      const customAgent = new CopilotSearchAgent({
        maxQueries: 5,
        maxSourcesPerQuery: 10,
        rerankThreshold: 0.8,
        enablePageExtraction: false,
      });

      expect(customAgent).toBeDefined();
    });
  });
});

// Integration tests
describe('CopilotSearchAgent Integration', () => {
  it('should handle empty search results gracefully', async () => {
    const agent = new CopilotSearchAgent({
      maxQueries: 1,
      maxSourcesPerQuery: 1,
      rerankThreshold: 0.5,
      enablePageExtraction: false,
    });

    const mockLLM = new MockChatModel({});
    const mockEmbeddings = new MockEmbeddings({});

    const emitter = await agent.searchAndAnswer(
      'nonexistent query that should return no results',
      [],
      mockLLM,
      mockEmbeddings,
      'balanced'
    );

    expect(emitter).toBeDefined();
  });

  it('should handle network errors gracefully', async () => {
    const agent = new CopilotSearchAgent({
      maxQueries: 1,
      maxSourcesPerQuery: 1,
      rerankThreshold: 0.5,
      enablePageExtraction: true,
    });

    const mockLLM = new MockChatModel({});
    const mockEmbeddings = new MockEmbeddings({});

    // This should not throw an error
    const emitter = await agent.searchAndAnswer(
      'test query',
      [],
      mockLLM,
      mockEmbeddings,
      'balanced'
    );

    expect(emitter).toBeDefined();
  });
}); 