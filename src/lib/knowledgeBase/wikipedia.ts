import axios from 'axios';
import { BaseKnowledgeBase, KnowledgeBaseConfig, KnowledgeBaseQuery, KnowledgeBaseResult } from './index';

interface WikipediaSearchResult {
  title: string;
  excerpt: string;
  score: number;
  thumbnail?: {
    url: string;
  };
}

interface ArticleContent {
  summary: string;
  url: string;
  lastModified: string;
  views: number;
}

export class WikipediaKnowledgeBase extends BaseKnowledgeBase {
  constructor(languages: string[] = ['en']) {
    super({
      name: 'wikipedia',
      type: 'wikipedia',
      endpoint: 'https://api.wikimedia.org/core/v1/wikipedia',
      enabled: true,
      priority: 8,
      maxResults: 5,
      languages,
    });
  }

  async search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]> {
    const language = query.language || 'en';
    
    if (!this.supportsLanguage(language)) {
      return [];
    }

    try {
      // Search for articles
      const searchResults = await this.searchArticles(query.query, language);
      
      // Get detailed content for top results
      const detailedResults = await Promise.all(
        searchResults.slice(0, this.config.maxResults).map(async (result: WikipediaSearchResult): Promise<KnowledgeBaseResult | null> => {
          try {
            const content = await this.getArticleContent(result.title, language);
            return {
              title: result.title,
              content: content.summary,
              url: content.url,
              source: this.config.name,
              confidence: result.score,
              language,
              metadata: {
                excerpt: result.excerpt,
                thumbnailUrl: result.thumbnail?.url,
                lastModified: content.lastModified,
                views: content.views,
              },
            };
          } catch (error) {
            console.warn(`Failed to get content for ${result.title}:`, error);
            return null;
          }
        })
      );

      return detailedResults.filter((result): result is KnowledgeBaseResult => result !== null);
    } catch (error) {
      console.error('Wikipedia search failed:', error);
      return [];
    }
  }

  private async searchArticles(query: string, language: string): Promise<WikipediaSearchResult[]> {
    const searchUrl = `https://${language}.wikipedia.org/api/rest_v1/page/search/${encodeURIComponent(query)}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Perplexica/1.0 (https://github.com/ItzCrazyKns/Perplexica)',
      },
      timeout: 10000,
    });

    return response.data.pages || [];
  }

  private async getArticleContent(title: string, language: string): Promise<ArticleContent> {
    const [summaryResponse, viewsResponse] = await Promise.all([
      // Get article summary
      axios.get(
        `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        {
          headers: {
            'User-Agent': 'Perplexica/1.0 (https://github.com/ItzCrazyKns/Perplexica)',
          },
          timeout: 10000,
        }
      ),
      // Get page views (optional)
      this.getPageViews(title, language).catch(() => ({ views: 0 })),
    ]);

    const summary = summaryResponse.data;
    
    return {
      summary: summary.extract || summary.description || '',
      url: summary.content_urls?.desktop?.page || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      lastModified: summary.timestamp || new Date().toISOString(),
      views: viewsResponse.views,
    };
  }

  private async getPageViews(title: string, language: string): Promise<{ views: number }> {
    try {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
      
      const response = await axios.get(
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${language}.wikipedia.org/all-access/user/${encodeURIComponent(title)}/daily/${dateStr}/${dateStr}`,
        {
          headers: {
            'User-Agent': 'Perplexica/1.0 (https://github.com/ItzCrazyKns/Perplexica)',
          },
          timeout: 5000,
        }
      );

      return {
        views: response.data.items?.[0]?.views || 0,
      };
    } catch (error) {
      return { views: 0 };
    }
  }
} 