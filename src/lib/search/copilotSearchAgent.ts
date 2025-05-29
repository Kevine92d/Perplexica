import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  PromptTemplate,
} from '@langchain/core/prompts';
import {
  RunnableLambda,
  RunnableMap,
  RunnableSequence,
} from '@langchain/core/runnables';
import { BaseMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from 'langchain/document';
import { searchSearxng } from '../searxng';
import { getDocumentsFromLinks } from '../utils/documents';
import computeSimilarity from '../utils/computeSimilarity';
import formatChatHistoryAsString from '../utils/formatHistory';
import eventEmitter from 'events';
import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { MetaSearchAgentType } from './metaSearchAgent';

// Performance optimizations
import { searchResultCache, documentCache } from '@/lib/cache/searchCache';
import { globalProcessor } from '@/lib/performance/parallelProcessor';
import { globalDeduplicator } from '@/lib/performance/requestDeduplicator';
import { globalTimeoutManager } from '@/lib/performance/smartTimeout';

const copilotQueryGeneratorPrompt = `
You are Perplexica, an AI-powered search engine. You excel at breaking down complex queries into multiple focused search queries to gather comprehensive information.

Generate 2-4 specific, targeted search queries for the following user question. Each query should focus on a different aspect or perspective of the question to ensure comprehensive coverage.

Guidelines:
- Make queries specific and targeted
- Cover different angles of the main question
- Use search-friendly language
- Avoid overly broad or vague terms
- Each query should be on a separate line

User question: {query}
Chat history: {chat_history}

Generate specific search queries (one per line):
<queries>
`;

const copilotResponsePrompt = `
You are Perplexica, an AI-powered search engine. Based on the comprehensive research gathered from multiple sources, provide a detailed, accurate, and well-structured response.

Guidelines:
- Provide a comprehensive answer using the gathered information
- Include relevant details and context
- Cite sources when mentioning specific information
- Structure the response clearly with paragraphs
- Be factual and precise
- If information is conflicting, mention different perspectives

Context from research:
{context}

Current date and time: {date}

System instructions: {systemInstructions}

Provide a detailed response based on the research:
`;

interface CopilotConfig {
  maxQueries: number;
  maxSourcesPerQuery: number;
  rerankThreshold: number;
  enablePageExtraction: boolean;
}

export class CopilotSearchAgent implements MetaSearchAgentType {
  private config: CopilotConfig;
  private strParser = new StringOutputParser();

  constructor(config: CopilotConfig) {
    this.config = config;
  }

  async searchAndAnswer(
    message: string,
    history: BaseMessage[],
    llm: BaseChatModel,
    embeddings: Embeddings,
    optimizationMode: 'speed' | 'balanced' | 'quality',
    fileIds: string[],
    systemInstructions: string,
  ): Promise<eventEmitter> {
    const emitter = new eventEmitter();

    // Check cache first
    const cacheKey = `${message}-${optimizationMode}`;
    const cachedResult = searchResultCache.get(message, 'copilot', { optimizationMode });
    
    if (cachedResult) {
      setTimeout(() => {
        emitter.emit('data', JSON.stringify({ type: 'response', data: cachedResult }));
        emitter.emit('end');
      }, 0);
      return emitter;
    }

    try {
      const copilotChain = await this.createCopilotChain(
        llm,
        embeddings,
        systemInstructions,
        optimizationMode
      );

      const stream = copilotChain.streamEvents(
        {
          query: message,
          chat_history: history,
        },
        {
          version: 'v1',
        },
      );

      this.handleStream(stream, emitter, message, optimizationMode);
    } catch (error) {
      emitter.emit('error', error);
    }

    return emitter;
  }

  private async generateMultipleQueries(
    query: string,
    chatHistory: BaseMessage[],
    llm: BaseChatModel,
    maxQueries: number
  ): Promise<string[]> {
    const prompt = PromptTemplate.fromTemplate(copilotQueryGeneratorPrompt);
    const chain = RunnableSequence.from([prompt, llm, this.strParser]);

    const response = await globalTimeoutManager.executeWithTimeout(
      'query-generation',
      () => globalDeduplicator.deduplicate(
        `queries-${query}`,
        () => chain.invoke({
          query,
          chat_history: formatChatHistoryAsString(chatHistory),
        })
      )
    );

    // Parse queries from response
    const queriesMatch = response.match(/<queries>([\s\S]*?)<\/queries>/);
    if (queriesMatch) {
      return queriesMatch[1]
        .trim()
        .split('\n')
        .map((q: string) => q.trim())
        .filter((q: string) => q.length > 0)
        .slice(0, maxQueries);
    }

    return [query];
  }

  private async searchMultipleQueries(queries: string[]): Promise<Document[]> {
    const searchTasks = queries.map((query, index) => ({
      id: `search-${index}`,
      task: () => globalTimeoutManager.executeSearchWithTimeout(
        'web',
        () => globalDeduplicator.deduplicateSearch(
          query,
          'copilot',
          () => this.searchSingleQuery(query)
        )
      ),
      priority: index === 0 ? 2 : 1,
    }));

    const searchResults = await globalProcessor.executeWithResults(searchTasks);
    
    return searchResults
      .filter(result => result.result && !result.error)
      .flatMap(result => result.result || []);
  }

  private async searchSingleQuery(query: string): Promise<Document[]> {
    // Check document cache first
    const cachedDocs = documentCache.get(query, 'web-search');
    if (cachedDocs && Array.isArray(cachedDocs)) {
      return cachedDocs.slice(0, this.config.maxSourcesPerQuery);
    }

    try {
      const searchResults = await searchSearxng(query, {
        language: 'en',
        engines: [],
      });

      const docs = searchResults.results
        .slice(0, this.config.maxSourcesPerQuery)
        .map(result => new Document({
          pageContent: result.content || result.title || '',
          metadata: {
            title: result.title,
            url: result.url,
            query: query,
            ...(result.img_src && { img_src: result.img_src }),
          },
        }));

      // Cache the results
      documentCache.set(query, 'web-search', docs);
      
      return docs;
    } catch (error) {
      console.warn(`Search failed for query: ${query}`, error);
      return [];
    }
  }

  private async extractPageContent(docs: Document[], llm: BaseChatModel): Promise<Document[]> {
    if (!this.config.enablePageExtraction) {
      return docs;
    }

    const uniqueUrls = [...new Set(docs.map(doc => doc.metadata.url))];
    const urlGroups = uniqueUrls.slice(0, 10);
    
    try {
      const extractionTasks = urlGroups.map((url, index) => ({
        id: `extract-${index}`,
        task: () => globalTimeoutManager.executePageExtractionWithTimeout(
          () => globalDeduplicator.deduplicatePageExtraction(
            url,
            () => this.extractSinglePage(url, llm)
          )
        ),
      }));

      const extractionResults = await globalProcessor.executeWithResults(extractionTasks);
      
      return extractionResults
        .filter(result => result.result && !result.error)
        .map(result => result.result as Document);
    } catch (error) {
      console.warn('Page extraction failed, using search snippets', error);
      return docs;
    }
  }

  private async extractSinglePage(url: string, llm: BaseChatModel): Promise<Document> {
    try {
      const extractedDocs = await getDocumentsFromLinks({ links: [url] });
      const doc = extractedDocs[0];

      if (!doc) {
        throw new Error('No content extracted');
      }

      const summary = await llm.invoke(`
        You are a content extractor. Summarize the following web page content in 2-3 detailed paragraphs.
        Focus on the main points, key information, and factual details that would be useful for answering questions.
        
        Original Title: ${doc.metadata.title}
        Content: ${doc.pageContent.slice(0, 4000)}
        
        Provide a comprehensive summary:
      `);

      return new Document({
        pageContent: summary.content as string,
        metadata: {
          ...doc.metadata,
          extractedContent: true,
          originalLength: doc.pageContent.length,
        },
      });
    } catch (error) {
      throw new Error(`Failed to extract content from ${url}: ${error}`);
    }
  }

  private async rerankAndDeduplicate(
    docs: Document[],
    query: string,
    embeddings: Embeddings
  ): Promise<Document[]> {
    if (docs.length === 0) return [];

    const uniqueDocs = docs.filter((doc, index, self) => 
      index === self.findIndex(d => d.metadata.url === doc.metadata.url)
    );

    try {
      const [docEmbeddings, queryEmbedding] = await Promise.all([
        globalTimeoutManager.executeEmbeddingWithTimeout(
          () => embeddings.embedDocuments(uniqueDocs.map(doc => doc.pageContent))
        ),
        globalTimeoutManager.executeEmbeddingWithTimeout(
          () => embeddings.embedQuery(query)
        ),
      ]);

      const similarities = docEmbeddings.map((embedding, index) => ({
        index,
        similarity: computeSimilarity(queryEmbedding, embedding),
        doc: uniqueDocs[index],
      }));

      return similarities
        .filter(item => item.similarity > this.config.rerankThreshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 15)
        .map(item => item.doc);
    } catch (error) {
      console.warn('Reranking failed, using original order', error);
      return uniqueDocs.slice(0, 15);
    }
  }

  private async createCopilotChain(
    llm: BaseChatModel,
    embeddings: Embeddings,
    systemInstructions: string,
    optimizationMode: 'speed' | 'balanced' | 'quality'
  ) {
    const maxQueries = optimizationMode === 'speed' ? 2 : optimizationMode === 'balanced' ? 3 : 4;

    return RunnableSequence.from([
      RunnableMap.from({
        systemInstructions: () => systemInstructions,
        query: (input: { query: string; chat_history: BaseMessage[] }) => input.query,
        chat_history: (input: { query: string; chat_history: BaseMessage[] }) => input.chat_history,
        date: () => new Date().toISOString(),
        context: RunnableLambda.from(async (input: { query: string; chat_history: BaseMessage[] }) => {
          const queries = await this.generateMultipleQueries(
            input.query,
            input.chat_history,
            llm,
            maxQueries
          );

          const searchDocs = await this.searchMultipleQueries(queries);
          const extractedDocs = await this.extractPageContent(searchDocs, llm);
          const finalDocs = await this.rerankAndDeduplicate(
            extractedDocs,
            input.query,
            embeddings
          );

          return finalDocs
            .map((doc, index) => `[${index + 1}] ${doc.metadata.title}\nURL: ${doc.metadata.url}\nContent: ${doc.pageContent}`)
            .join('\n\n---\n\n');
        }).withConfig({
          runName: 'CopilotSourceRetriever',
        }),
      }),
      ChatPromptTemplate.fromMessages([
        ['system', copilotResponsePrompt],
        new MessagesPlaceholder('chat_history'),
        ['user', '{query}'],
      ]),
      llm,
      this.strParser,
    ]).withConfig({
      runName: 'CopilotResponseGenerator',
    });
  }

  private async handleStream(
    stream: AsyncGenerator<StreamEvent, any, any>,
    emitter: eventEmitter,
    query: string,
    optimizationMode: string
  ) {
    let fullResponse = '';

    try {
      for await (const event of stream) {
        if (event.event === 'on_llm_stream' && event.name === 'CopilotResponseGenerator') {
          const chunk = event.data.chunk;
          fullResponse += chunk;
          emitter.emit('data', JSON.stringify({ type: 'response', data: chunk }));
        } else if (event.event === 'on_llm_start' && event.name === 'CopilotSourceRetriever') {
          emitter.emit('data', JSON.stringify({ 
            type: 'thinking', 
            data: 'Generating multiple search queries for comprehensive research...' 
          }));
        } else if (event.event === 'on_chain_start' && event.name === 'CopilotSourceRetriever') {
          emitter.emit('data', JSON.stringify({ 
            type: 'status', 
            data: 'Searching multiple sources...' 
          }));
        }
      }

      // Cache the complete response
      if (fullResponse) {
        searchResultCache.set(query, 'copilot', fullResponse, { optimizationMode });
      }

      emitter.emit('end');
    } catch (error) {
      emitter.emit('error', error);
    }
  }
}

export default CopilotSearchAgent; 