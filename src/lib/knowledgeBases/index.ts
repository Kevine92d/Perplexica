// External knowledge base integration system

export interface KnowledgeBaseResult {
  id: string;
  title: string;
  content: string;
  url?: string;
  source: string;
  confidence: number;
  metadata: {
    type: 'article' | 'paper' | 'documentation' | 'forum' | 'wiki' | 'reference';
    language: string;
    lastUpdated?: string;
    authors?: string[];
    tags?: string[];
    domain?: string;
  };
}

export interface KnowledgeBaseQuery {
  query: string;
  language?: string;
  domain?: string;
  resultLimit?: number;
  includeMetadata?: boolean;
  filters?: {
    type?: string[];
    dateRange?: {
      from?: string;
      to?: string;
    };
    sources?: string[];
  };
}

export abstract class BaseKnowledgeBase {
  protected name: string;
  protected apiKey?: string;
  protected baseUrl?: string;
  protected rateLimit: {
    requestsPerMinute: number;
    requestsThisMinute: number;
    lastResetTime: number;
  };

  constructor(name: string, options: { apiKey?: string; baseUrl?: string; rateLimit?: number }) {
    this.name = name;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.rateLimit = {
      requestsPerMinute: options.rateLimit || 60,
      requestsThisMinute: 0,
      lastResetTime: Date.now(),
    };
  }

  abstract search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]>;
  
  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinute = 60 * 1000;
    
    if (now - this.rateLimit.lastResetTime > oneMinute) {
      this.rateLimit.requestsThisMinute = 0;
      this.rateLimit.lastResetTime = now;
    }
    
    if (this.rateLimit.requestsThisMinute >= this.rateLimit.requestsPerMinute) {
      const waitTime = oneMinute - (now - this.rateLimit.lastResetTime);
      throw new Error(`Rate limit exceeded for ${this.name}. Wait ${waitTime}ms`);
    }
    
    this.rateLimit.requestsThisMinute++;
  }

  getName(): string {
    return this.name;
  }

  abstract isConfigured(): boolean;
}

// Wikipedia Knowledge Base
export class WikipediaKnowledgeBase extends BaseKnowledgeBase {
  constructor() {
    super('Wikipedia', { baseUrl: 'https://en.wikipedia.org/api/rest_v1' });
  }

  isConfigured(): boolean {
    return true; // Wikipedia doesn't require API key
  }

  async search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]> {
    await this.checkRateLimit();
    
    const language = query.language || 'en';
    const baseUrl = `https://${language}.wikipedia.org/api/rest_v1`;
    const limit = Math.min(query.resultLimit || 5, 10);
    
    try {
      // First, search for articles
      const searchResponse = await fetch(
        `${baseUrl}/page/search/${encodeURIComponent(query.query)}?limit=${limit}`
      );
      
      if (!searchResponse.ok) {
        throw new Error(`Wikipedia search failed: ${searchResponse.statusText}`);
      }
      
      const searchData = await searchResponse.json();
      const results: KnowledgeBaseResult[] = [];
      
      // Get content for each result
      for (const page of searchData.pages || []) {
        try {
          const summaryResponse = await fetch(
            `${baseUrl}/page/summary/${encodeURIComponent(page.title)}`
          );
          
          if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            
            results.push({
              id: `wikipedia-${page.pageid}`,
              title: summaryData.title,
              content: summaryData.extract || '',
              url: summaryData.content_urls?.desktop?.page,
              source: 'Wikipedia',
              confidence: 0.8,
              metadata: {
                type: 'wiki',
                language: language,
                lastUpdated: summaryData.timestamp,
                tags: summaryData.categories || [],
                domain: query.domain,
              },
            });
          }
        } catch (error) {
          console.warn(`Failed to get Wikipedia summary for ${page.title}:`, error);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Wikipedia search error:', error);
      return [];
    }
  }
}

// arXiv Knowledge Base for academic papers
export class ArxivKnowledgeBase extends BaseKnowledgeBase {
  constructor() {
    super('arXiv', { baseUrl: 'http://export.arxiv.org/api/query' });
  }

  isConfigured(): boolean {
    return true; // arXiv doesn't require API key
  }

  async search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]> {
    await this.checkRateLimit();
    
    const limit = Math.min(query.resultLimit || 5, 20);
    
    try {
      const searchQuery = `search_query=all:${encodeURIComponent(query.query)}&start=0&max_results=${limit}`;
      const response = await fetch(`${this.baseUrl}?${searchQuery}`);
      
      if (!response.ok) {
        throw new Error(`arXiv search failed: ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      const results = this.parseArxivXML(xmlText, query.domain);
      
      return results;
    } catch (error) {
      console.error('arXiv search error:', error);
      return [];
    }
  }

  private parseArxivXML(xmlText: string, domain?: string): KnowledgeBaseResult[] {
    const results: KnowledgeBaseResult[] = [];
    
    // Simple XML parsing for arXiv response
    const entryMatches = xmlText.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
    
    entryMatches.forEach((entry, index) => {
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      const linkMatch = entry.match(/<link.*?href="([^"]*)".*?title="pdf"/);
      const authorMatches = entry.match(/<name>([\s\S]*?)<\/name>/g) || [];
      const updatedMatch = entry.match(/<updated>([\s\S]*?)<\/updated>/);
      const categoryMatches = entry.match(/<category.*?term="([^"]*)".*?>/g) || [];
      
      if (titleMatch && summaryMatch) {
        const authors = authorMatches.map(author => 
          author.replace(/<\/?name>/g, '').trim()
        );
        
        const categories = categoryMatches.map(cat => {
          const match = cat.match(/term="([^"]*)"/);
          return match ? match[1] : '';
        }).filter(Boolean);
        
        results.push({
          id: `arxiv-${Date.now()}-${index}`,
          title: titleMatch[1].trim(),
          content: summaryMatch[1].trim(),
          url: linkMatch ? linkMatch[1] : undefined,
          source: 'arXiv',
          confidence: 0.9,
          metadata: {
            type: 'paper',
            language: 'en',
            lastUpdated: updatedMatch ? updatedMatch[1].trim() : undefined,
            authors: authors,
            tags: categories,
            domain: domain,
          },
        });
      }
    });
    
    return results;
  }
}

// GitHub Knowledge Base for code and documentation
export class GitHubKnowledgeBase extends BaseKnowledgeBase {
  constructor(apiKey?: string) {
    super('GitHub', { 
      apiKey, 
      baseUrl: 'https://api.github.com',
      rateLimit: apiKey ? 5000 : 60 // Higher rate limit with API key
    });
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]> {
    if (!this.isConfigured()) {
      console.warn('GitHub API key not configured, skipping GitHub search');
      return [];
    }
    
    await this.checkRateLimit();
    
    const limit = Math.min(query.resultLimit || 5, 30);
    
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Perplexica-Search',
      };
      
      if (this.apiKey) {
        headers['Authorization'] = `token ${this.apiKey}`;
      }
      
      // Search repositories
      const repoResponse = await fetch(
        `${this.baseUrl}/search/repositories?q=${encodeURIComponent(query.query)}&per_page=${Math.ceil(limit/2)}`,
        { headers }
      );
      
      // Search code
      const codeResponse = await fetch(
        `${this.baseUrl}/search/code?q=${encodeURIComponent(query.query)}&per_page=${Math.ceil(limit/2)}`,
        { headers }
      );
      
      const results: KnowledgeBaseResult[] = [];
      
      if (repoResponse.ok) {
        const repoData = await repoResponse.json();
        
        for (const repo of repoData.items || []) {
          results.push({
            id: `github-repo-${repo.id}`,
            title: repo.full_name,
            content: repo.description || 'No description available',
            url: repo.html_url,
            source: 'GitHub',
            confidence: 0.7,
            metadata: {
              type: 'documentation',
              language: repo.language || 'unknown',
              lastUpdated: repo.updated_at,
              tags: repo.topics || [],
              domain: query.domain,
            },
          });
        }
      }
      
      if (codeResponse.ok) {
        const codeData = await codeResponse.json();
        
        for (const file of codeData.items || []) {
          results.push({
            id: `github-code-${file.sha}`,
            title: `${file.repository.full_name}/${file.name}`,
            content: `Code file: ${file.name}\nRepository: ${file.repository.full_name}`,
            url: file.html_url,
            source: 'GitHub',
            confidence: 0.6,
            metadata: {
              type: 'documentation',
              language: this.getLanguageFromExtension(file.name),
              tags: ['code'],
              domain: query.domain,
            },
          });
        }
      }
      
      return results.slice(0, limit);
    } catch (error) {
      console.error('GitHub search error:', error);
      return [];
    }
  }

  private getLanguageFromExtension(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
    };
    
    return languageMap[extension || ''] || 'unknown';
  }
}

// Knowledge Base Manager
export class KnowledgeBaseManager {
  private knowledgeBases: Map<string, BaseKnowledgeBase>;
  private enabledBases: Set<string>;

  constructor() {
    this.knowledgeBases = new Map();
    this.enabledBases = new Set();
    
    // Initialize default knowledge bases
    this.registerKnowledgeBase(new WikipediaKnowledgeBase());
    this.registerKnowledgeBase(new ArxivKnowledgeBase());
    
    // Enable all configured knowledge bases by default
    this.enabledBases.add('Wikipedia');
    this.enabledBases.add('arXiv');
  }

  registerKnowledgeBase(kb: BaseKnowledgeBase): void {
    this.knowledgeBases.set(kb.getName(), kb);
    
    if (kb.isConfigured()) {
      this.enabledBases.add(kb.getName());
    }
  }

  enableKnowledgeBase(name: string): void {
    if (this.knowledgeBases.has(name)) {
      this.enabledBases.add(name);
    }
  }

  disableKnowledgeBase(name: string): void {
    this.enabledBases.delete(name);
  }

  async search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]> {
    const promises: Promise<KnowledgeBaseResult[]>[] = [];
    
    for (const name of this.enabledBases) {
      const kb = this.knowledgeBases.get(name);
      if (kb && kb.isConfigured()) {
        promises.push(
          kb.search(query).catch(error => {
            console.warn(`Knowledge base ${name} search failed:`, error);
            return [];
          })
        );
      }
    }
    
    if (promises.length === 0) {
      return [];
    }
    
    const results = await Promise.all(promises);
    const allResults = results.flat();
    
    // Sort by confidence and relevance
    allResults.sort((a, b) => {
      // First by confidence
      if (a.confidence !== b.confidence) {
        return b.confidence - a.confidence;
      }
      
      // Then by query relevance (simple keyword matching)
      const aRelevance = this.calculateRelevance(query.query, a.title + ' ' + a.content);
      const bRelevance = this.calculateRelevance(query.query, b.title + ' ' + b.content);
      
      return bRelevance - aRelevance;
    });
    
    return allResults.slice(0, query.resultLimit || 10);
  }

  private calculateRelevance(query: string, content: string): number {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let relevance = 0;
    for (const word of queryWords) {
      if (word.length > 2) { // Ignore very short words
        const wordCount = (contentLower.match(new RegExp(word, 'g')) || []).length;
        relevance += wordCount;
      }
    }
    
    return relevance;
  }

  getAvailableKnowledgeBases(): string[] {
    return Array.from(this.knowledgeBases.keys());
  }

  getEnabledKnowledgeBases(): string[] {
    return Array.from(this.enabledBases);
  }

  async getKnowledgeBaseStatus(): Promise<Record<string, { name: string; configured: boolean; enabled: boolean }>> {
    const status: Record<string, { name: string; configured: boolean; enabled: boolean }> = {};
    
    for (const [name, kb] of this.knowledgeBases) {
      status[name] = {
        name: name,
        configured: kb.isConfigured(),
        enabled: this.enabledBases.has(name),
      };
    }
    
    return status;
  }
}

// Global knowledge base manager instance
export const globalKnowledgeBaseManager = new KnowledgeBaseManager(); 