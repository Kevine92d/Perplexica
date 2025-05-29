import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import type { Document } from '@langchain/core/documents';
import { getSearchResults } from '../searxng';
import { globalProcessorManager } from '../performance/parallelProcessing';
import { globalTimeoutManager } from '../performance/timeoutManager';
import { globalDeduplicator } from '../performance/deduplication';
import { searchResultCache } from '../performance/cache';
import { globalKnowledgeBaseManager } from '../knowledgeBases';
import type { KnowledgeBaseResult } from '../knowledgeBases';
import { defaultUserProfile } from '../personalization/userProfile';
import { globalReasoningManager } from '../reasoning';
import { globalTranslationManager } from '../multiLanguage';

interface EnhancedSearchResult {
  title: string;
  link: string;
  snippet: string;
  engine: string[];
  score?: number;
  type?: 'web' | 'knowledge' | 'reasoning';
  confidence?: number;
  reasoning?: any;
  translation?: {
    original: string;
    translated: string;
    language: string;
  };
}

interface EnhancedCopilotOptions {
  maxResults?: number;
  includeKnowledgeBases?: boolean;
  enableReasoning?: boolean;
  enableTranslation?: boolean;
  enablePersonalization?: boolean;
  timeout?: number;
}

const enhancedCopilotSearchPrompt = PromptTemplate.fromTemplate(`
You are Perplexica's Enhanced Copilot, an AI assistant with advanced reasoning and multilingual capabilities.

Query: {query}
Context: {context}
User Profile: {userProfile}
Knowledge Sources: {knowledgeSources}
Reasoning Chain: {reasoningChain}

Guidelines:
1. Provide comprehensive, accurate, and well-structured responses
2. Integrate information from multiple sources (web, knowledge bases, reasoning)
3. Consider user preferences and search history for personalized responses
4. Use advanced reasoning techniques when appropriate
5. Support multilingual queries and responses
6. Cite sources clearly and provide confidence levels
7. Adapt response style based on user's detail preference

Response format:
- Start with a direct answer to the query
- Provide detailed explanation with supporting evidence
- Include reasoning steps for complex queries
- List key sources with confidence indicators
- Suggest related queries based on user profile

Your response:
`);

export class EnhancedCopilotSearchAgent {
  private llm: BaseChatModel;
  private embeddings: Embeddings;
  private processingChain: RunnableSequence;

  constructor(llm: BaseChatModel, embeddings: Embeddings) {
    this.llm = llm;
    this.embeddings = embeddings;

    this.processingChain = RunnableSequence.from([
      enhancedCopilotSearchPrompt,
      this.llm,
      new StringOutputParser(),
    ]);
  }

  async searchSingleQuery(
    query: string,
    history: any[] = [],
    options: EnhancedCopilotOptions = {}
  ): Promise<any> {
    const {
      maxResults = 10,
      includeKnowledgeBases = true,
      enableReasoning = true,
      enableTranslation = true,
      enablePersonalization = true,
      timeout = 30000,
    } = options;

    try {
      // Start timeout management
      const timeoutPromise = globalTimeoutManager.withTimeout(
        this.performEnhancedSearch(query, history, {
          maxResults,
          includeKnowledgeBases,
          enableReasoning,
          enableTranslation,
          enablePersonalization,
        }),
        timeout
      );

      return await timeoutPromise;
    } catch (error) {
      console.error('Enhanced copilot search failed:', error);
      throw error;
    }
  }

  private async performEnhancedSearch(
    query: string,
    history: any[],
    options: EnhancedCopilotOptions
  ): Promise<any> {
    const searchStartTime = Date.now();
    
    // 1. Language detection and translation if needed
    let processedQuery = query;
    let queryLanguage = 'en';
    let translationInfo = null;

    if (options.enableTranslation) {
      try {
        const detectionResult = await globalTranslationManager.detectLanguage(query);
        queryLanguage = detectionResult.language;
        
        if (queryLanguage !== 'en') {
          const translationResult = await globalTranslationManager.translate(query, queryLanguage, 'en');
          processedQuery = translationResult.translatedText;
          translationInfo = {
            original: query,
            translated: processedQuery,
            language: queryLanguage,
          };
        }
      } catch (error) {
        console.warn('Translation failed, using original query:', error);
      }
    }

    // 2. User profile and personalization
    let userProfile = {};
    let personalizedSuggestions: string[] = [];
    let recommendedMode = 'webSearch';

    if (options.enablePersonalization) {
      try {
        userProfile = defaultUserProfile.getPreferences();
        personalizedSuggestions = defaultUserProfile.getPersonalizedSuggestions(processedQuery);
        recommendedMode = defaultUserProfile.getRecommendedSearchMode(processedQuery);
      } catch (error) {
        console.warn('Personalization failed:', error);
      }
    }

    // 3. Parallel search execution
    const searchPromises: Promise<any>[] = [];

    // Web search
    searchPromises.push(
      globalProcessorManager.processTask(
        `web-search-${Date.now()}`,
        () => this.performWebSearch(processedQuery, options.maxResults || 10)
      )
    );

    // Knowledge base search
    if (options.includeKnowledgeBases) {
      searchPromises.push(
        globalProcessorManager.processTask(
          `knowledge-search-${Date.now()}`,
          () => this.performKnowledgeBaseSearch(processedQuery, queryLanguage)
        )
      );
    }

    // Execute searches in parallel
    const searchResults = await Promise.allSettled(searchPromises);
    
    // Combine and process results
    let allResults: EnhancedSearchResult[] = [];
    
    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        allResults = allResults.concat(result.value);
      } else {
        console.warn(`Search ${index} failed:`, result.status === 'rejected' ? result.reason : 'Unknown error');
      }
    });

    // 4. Deduplication
    const deduplicatedResults = await globalDeduplicator.deduplicateResults(allResults);

    // 5. Advanced reasoning if enabled
    let reasoningChain = null;
    if (options.enableReasoning && deduplicatedResults.length > 0) {
      try {
        const reasoningContext = {
          query: processedQuery,
          domain: this.extractDomain(processedQuery),
          priorKnowledge: deduplicatedResults.slice(0, 5).map(r => r.snippet),
          goal: 'comprehensive_analysis',
        };

        reasoningChain = await globalReasoningManager.reason(reasoningContext);
      } catch (error) {
        console.warn('Reasoning failed:', error);
      }
    }

    // 6. Generate enhanced response
    const context = this.buildContextString(deduplicatedResults.slice(0, 8));
    const knowledgeSources = this.buildKnowledgeSourcesString(deduplicatedResults);
    const reasoningChainStr = reasoningChain ? this.buildReasoningChainString(reasoningChain) : 'No reasoning chain generated';

    const response = await this.processingChain.invoke({
      query: processedQuery,
      context,
      userProfile: JSON.stringify(userProfile, null, 2),
      knowledgeSources,
      reasoningChain: reasoningChainStr,
    });

    // 7. Record search history for personalization
    if (options.enablePersonalization) {
      try {
        defaultUserProfile.addSearchHistory({
          query: query,
          mode: 'enhanced-copilot',
          results: deduplicatedResults,
          clickedResults: [],
        });
      } catch (error) {
        console.warn('Failed to record search history:', error);
      }
    }

    // 8. Translate response back if needed
    let finalResponse = response;
    if (translationInfo && queryLanguage !== 'en') {
      try {
        const translatedResponse = await globalTranslationManager.translate(response, 'en', queryLanguage);
        finalResponse = translatedResponse.translatedText;
      } catch (error) {
        console.warn('Response translation failed:', error);
      }
    }

    const searchEndTime = Date.now();

    return {
      type: 'response',
      data: finalResponse,
      sources: deduplicatedResults.slice(0, 8),
      suggestions: personalizedSuggestions,
      metadata: {
        searchMode: 'enhanced-copilot',
        recommendedMode,
        queryLanguage,
        translationInfo,
        reasoningChain: reasoningChain ? {
          strategy: reasoningChain.metadata.strategy,
          steps: reasoningChain.steps.length,
          confidence: reasoningChain.confidence,
        } : null,
        performance: {
          totalTime: searchEndTime - searchStartTime,
          resultsCount: deduplicatedResults.length,
          knowledgeBasesUsed: globalKnowledgeBaseManager.getEnabledKnowledgeBases(),
        },
        personalization: {
          profileApplied: options.enablePersonalization,
          suggestionsCount: personalizedSuggestions.length,
        },
      },
    };
  }

  private async performWebSearch(query: string, maxResults: number): Promise<EnhancedSearchResult[]> {
    try {
      // Check cache first
      const cacheKey = `web-${query}-${maxResults}`;
      const cachedResults = await searchResultCache.get(cacheKey);
      if (cachedResults) {
        return cachedResults.map((r: any) => ({ ...r, type: 'web' as const }));
      }

      const results = await getSearchResults(query, {
        engines: ['duckduckgo', 'searx'],
        limit: maxResults,
      });

      const enhancedResults: EnhancedSearchResult[] = results.map((result: any) => ({
        title: result.title,
        link: result.link,
        snippet: result.snippet,
        engine: result.engine || ['unknown'],
        type: 'web' as const,
        confidence: 0.7,
      }));

      // Cache results
      await searchResultCache.set(cacheKey, enhancedResults, 300); // 5 minutes

      return enhancedResults;
    } catch (error) {
      console.error('Web search failed:', error);
      return [];
    }
  }

  private async performKnowledgeBaseSearch(query: string, language: string): Promise<EnhancedSearchResult[]> {
    try {
      const kbResults = await globalKnowledgeBaseManager.search({
        query,
        language,
        resultLimit: 5,
        includeMetadata: true,
      });

      return kbResults.map((result: KnowledgeBaseResult) => ({
        title: result.title,
        link: result.url || '#',
        snippet: result.content.substring(0, 200) + '...',
        engine: [result.source],
        type: 'knowledge' as const,
        confidence: result.confidence,
      }));
    } catch (error) {
      console.error('Knowledge base search failed:', error);
      return [];
    }
  }

  private extractDomain(query: string): string {
    // Simple domain extraction based on keywords
    const domains = {
      'programming': ['code', 'programming', 'javascript', 'python', 'react', 'node'],
      'science': ['science', 'research', 'study', 'theory', 'experiment'],
      'technology': ['technology', 'tech', 'computer', 'software', 'hardware'],
      'health': ['health', 'medical', 'medicine', 'disease', 'treatment'],
      'business': ['business', 'finance', 'market', 'economy', 'company'],
    };

    const queryLower = query.toLowerCase();
    for (const [domain, keywords] of Object.entries(domains)) {
      if (keywords.some(keyword => queryLower.includes(keyword))) {
        return domain;
      }
    }

    return 'general';
  }

  private buildContextString(results: EnhancedSearchResult[]): string {
    return results
      .map((result, index) => `${index + 1}. ${result.title}\n${result.snippet}`)
      .join('\n\n');
  }

  private buildKnowledgeSourcesString(results: EnhancedSearchResult[]): string {
    const sourceGroups = results.reduce((groups, result) => {
      const source = result.engine[0] || 'unknown';
      if (!groups[source]) groups[source] = [];
      groups[source].push(result);
      return groups;
    }, {} as Record<string, EnhancedSearchResult[]>);

    return Object.entries(sourceGroups)
      .map(([source, sourceResults]) => 
        `${source.toUpperCase()}: ${sourceResults.length} results`
      )
      .join(', ');
  }

  private buildReasoningChainString(reasoningChain: any): string {
    if (!reasoningChain || !reasoningChain.steps) {
      return 'No reasoning steps available';
    }

    return reasoningChain.steps
      .map((step: any, index: number) => 
        `Step ${index + 1} (${step.type}): ${step.content.substring(0, 100)}...`
      )
      .join('\n');
  }
}

export const createEnhancedCopilotSearchAgent = (
  llm: BaseChatModel,
  embeddings: Embeddings
) => {
  return new EnhancedCopilotSearchAgent(llm, embeddings);
}; 