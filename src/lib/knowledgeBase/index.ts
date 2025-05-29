export interface KnowledgeBaseConfig {
  name: string;
  type: 'wikipedia' | 'academic' | 'specialist' | 'custom';
  endpoint: string;
  apiKey?: string;
  enabled: boolean;
  priority: number;
  maxResults: number;
  languages: string[];
}

export interface KnowledgeBaseQuery {
  query: string;
  language?: string;
  domain?: string;
  resultType?: 'summary' | 'detailed' | 'raw';
}

export interface KnowledgeBaseResult {
  title: string;
  content: string;
  url: string;
  source: string;
  confidence: number;
  language: string;
  domain?: string;
  metadata?: Record<string, any>;
}

export abstract class BaseKnowledgeBase {
  protected config: KnowledgeBaseConfig;

  constructor(config: KnowledgeBaseConfig) {
    this.config = config;
  }

  abstract search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]>;
  
  getName(): string {
    return this.config.name;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getPriority(): number {
    return this.config.priority;
  }

  supportsLanguage(language: string): boolean {
    return this.config.languages.includes(language) || this.config.languages.includes('*');
  }
}

export class KnowledgeBaseManager {
  private knowledgeBases: Map<string, BaseKnowledgeBase> = new Map();

  registerKnowledgeBase(kb: BaseKnowledgeBase): void {
    this.knowledgeBases.set(kb.getName(), kb);
  }

  async searchMultiple(
    query: KnowledgeBaseQuery,
    sources?: string[]
  ): Promise<KnowledgeBaseResult[]> {
    const enabledBases = Array.from(this.knowledgeBases.values())
      .filter(kb => kb.isEnabled())
      .filter(kb => !sources || sources.includes(kb.getName()))
      .filter(kb => !query.language || kb.supportsLanguage(query.language))
      .sort((a, b) => b.getPriority() - a.getPriority());

    const searchPromises = enabledBases.map(async (kb) => {
      try {
        const results = await kb.search(query);
        return results.map(result => ({
          ...result,
          source: kb.getName(),
        }));
      } catch (error) {
        console.warn(`Knowledge base ${kb.getName()} search failed:`, error);
        return [];
      }
    });

    const allResults = (await Promise.all(searchPromises)).flat();
    
    // Sort by confidence and priority
    return allResults
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20); // Limit total results
  }

  getAvailableKnowledgeBases(): string[] {
    return Array.from(this.knowledgeBases.keys());
  }

  getKnowledgeBase(name: string): BaseKnowledgeBase | undefined {
    return this.knowledgeBases.get(name);
  }
}

export const globalKnowledgeBaseManager = new KnowledgeBaseManager(); 