import axios from 'axios';
import { BaseKnowledgeBase, KnowledgeBaseConfig, KnowledgeBaseQuery, KnowledgeBaseResult } from './index';

interface ArXivEntry {
  id: string;
  updated: string;
  published: string;
  title: string;
  summary: string;
  author: Array<{ name: string }>;
  link: Array<{ '@_href': string; '@_type': string }>;
  'arxiv:primary_category': { '@_term': string };
  category?: Array<{ '@_term': string }>;
}

interface PubMedArticle {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  pubdate: string;
  doi?: string;
}

export class AcademicKnowledgeBase extends BaseKnowledgeBase {
  constructor() {
    super({
      name: 'academic',
      type: 'academic',
      endpoint: 'multiple',
      enabled: true,
      priority: 9,
      maxResults: 10,
      languages: ['*'],
    });
  }

  async search(query: KnowledgeBaseQuery): Promise<KnowledgeBaseResult[]> {
    const results: KnowledgeBaseResult[] = [];

    try {
      // Search multiple academic databases in parallel
      const [arxivResults, pubmedResults] = await Promise.allSettled([
        this.searchArXiv(query.query),
        this.searchPubMed(query.query),
      ]);

      if (arxivResults.status === 'fulfilled') {
        results.push(...arxivResults.value);
      }

      if (pubmedResults.status === 'fulfilled') {
        results.push(...pubmedResults.value);
      }

      // Sort by confidence and limit results
      return results
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.config.maxResults);
    } catch (error) {
      console.error('Academic search failed:', error);
      return [];
    }
  }

  private async searchArXiv(query: string): Promise<KnowledgeBaseResult[]> {
    try {
      const response = await axios.get(
        `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5&sortBy=relevance&sortOrder=descending`,
        {
          headers: {
            'User-Agent': 'Perplexica/1.0 (https://github.com/ItzCrazyKns/Perplexica)',
          },
          timeout: 15000,
        }
      );

      // Parse XML response (simplified - in production, use proper XML parser)
      const entries = this.parseArXivXML(response.data);
      
      return entries.map((entry, index) => ({
        title: entry.title.replace(/\n/g, ' ').trim(),
        content: entry.summary.replace(/\n/g, ' ').trim(),
        url: entry.link.find(l => l['@_type'] === 'text/html')?.[`@_href`] || `https://arxiv.org/abs/${entry.id.split('/').pop()}`,
        source: 'arxiv',
        confidence: Math.max(0.9 - index * 0.1, 0.1),
        language: 'en',
        domain: 'academic',
        metadata: {
          authors: entry.author.map(a => a.name).join(', '),
          published: entry.published,
          updated: entry.updated,
          category: entry['arxiv:primary_category']?.['@_term'],
          arxivId: entry.id.split('/').pop(),
        },
      }));
    } catch (error) {
      console.warn('ArXiv search failed:', error);
      return [];
    }
  }

  private async searchPubMed(query: string): Promise<KnowledgeBaseResult[]> {
    try {
      // First, search for article IDs
      const searchResponse = await axios.get(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`,
        {
          headers: {
            'User-Agent': 'Perplexica/1.0 (https://github.com/ItzCrazyKns/Perplexica)',
          },
          timeout: 15000,
        }
      );

      const pmids = searchResponse.data.esearchresult?.idlist || [];
      
      if (pmids.length === 0) {
        return [];
      }

      // Fetch detailed information for the articles
      const detailResponse = await axios.get(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`,
        {
          headers: {
            'User-Agent': 'Perplexica/1.0 (https://github.com/ItzCrazyKns/Perplexica)',
          },
          timeout: 15000,
        }
      );

      const articles = detailResponse.data.result;
      
      return pmids.map((pmid: string, index: number) => {
        const article = articles[pmid];
        if (!article) return null;

        return {
          title: article.title || '',
          content: article.abstract || article.title || '',
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          source: 'pubmed',
          confidence: Math.max(0.8 - index * 0.1, 0.1),
          language: 'en',
          domain: 'academic',
          metadata: {
            authors: article.authors?.map((a: any) => a.name).join(', ') || '',
            journal: article.source || '',
            pubdate: article.pubdate || '',
            pmid: pmid,
            doi: article.doi || '',
          },
        };
      }).filter((result): result is KnowledgeBaseResult => result !== null);
    } catch (error) {
      console.warn('PubMed search failed:', error);
      return [];
    }
  }

  private parseArXivXML(xmlData: string): ArXivEntry[] {
    // Simplified XML parsing - in production, use a proper XML parser like xml2js
    const entries: ArXivEntry[] = [];
    
    try {
      // Basic regex-based parsing for demonstration
      const entryMatches = xmlData.match(/<entry[^>]*>[\s\S]*?<\/entry>/g) || [];
      
      for (const entryXml of entryMatches.slice(0, 5)) {
        const entry: Partial<ArXivEntry> = {};
        
        // Extract basic fields
        const idMatch = entryXml.match(/<id>([^<]*)<\/id>/);
        const titleMatch = entryXml.match(/<title>([^<]*)<\/title>/);
        const summaryMatch = entryXml.match(/<summary>([^<]*)<\/summary>/);
        const publishedMatch = entryXml.match(/<published>([^<]*)<\/published>/);
        const updatedMatch = entryXml.match(/<updated>([^<]*)<\/updated>/);
        
        if (idMatch) entry.id = idMatch[1];
        if (titleMatch) entry.title = titleMatch[1];
        if (summaryMatch) entry.summary = summaryMatch[1];
        if (publishedMatch) entry.published = publishedMatch[1];
        if (updatedMatch) entry.updated = updatedMatch[1];
        
        // Extract authors
        const authorMatches = entryXml.match(/<author><name>([^<]*)<\/name><\/author>/g) || [];
        entry.author = authorMatches.map(match => {
          const nameMatch = match.match(/<name>([^<]*)<\/name>/);
          return { name: nameMatch ? nameMatch[1] : '' };
        });
        
        // Extract links
        const linkMatches = entryXml.match(/<link[^>]*>/g) || [];
        entry.link = linkMatches.map(match => {
          const hrefMatch = match.match(/href="([^"]*)"/);
          const typeMatch = match.match(/type="([^"]*)"/);
          return {
            '@_href': hrefMatch ? hrefMatch[1] : '',
            '@_type': typeMatch ? typeMatch[1] : ''
          };
        });
        
        // Extract category
        const categoryMatch = entryXml.match(/<arxiv:primary_category[^>]*term="([^"]*)"[^>]*>/);
        if (categoryMatch) {
          entry['arxiv:primary_category'] = { '@_term': categoryMatch[1] };
        }
        
        if (entry.id && entry.title && entry.summary) {
          entries.push(entry as ArXivEntry);
        }
      }
    } catch (error) {
      console.warn('ArXiv XML parsing failed:', error);
    }
    
    return entries;
  }
} 