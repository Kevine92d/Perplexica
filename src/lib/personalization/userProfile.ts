// User preference and profile management for personalized search experience

export interface UserPreferences {
  // Search behavior preferences
  preferredSearchModes: string[];
  preferredLanguages: string[];
  domainExpertise: string[];
  
  // Content preferences
  contentTypes: ('text' | 'image' | 'video' | 'audio' | 'code')[];
  sourcePriority: ('academic' | 'news' | 'blog' | 'official' | 'forum')[];
  recencyPreference: 'latest' | 'balanced' | 'classic';
  
  // Interface preferences
  resultsPerPage: number;
  detailLevel: 'brief' | 'standard' | 'detailed';
  showSources: boolean;
  showConfidence: boolean;
  
  // Learning preferences
  adaptToHistory: boolean;
  personalizedRecommendations: boolean;
  trackingEnabled: boolean;
}

export interface SearchHistory {
  id: string;
  query: string;
  mode: string;
  timestamp: number;
  results: any[];
  clickedResults: string[];
  rating?: number;
  feedback?: string;
  context?: {
    domain?: string;
    followUp?: boolean;
    session?: string;
  };
}

export interface UserInteraction {
  type: 'click' | 'dwell' | 'share' | 'bookmark' | 'rating' | 'feedback';
  resultId: string;
  query: string;
  timestamp: number;
  value?: number | string;
  context?: Record<string, any>;
}

export interface LearningPattern {
  pattern: string;
  confidence: number;
  frequency: number;
  lastSeen: number;
  examples: string[];
}

export class UserProfileManager {
  private userId: string;
  private preferences: UserPreferences;
  private searchHistory: SearchHistory[];
  private interactions: UserInteraction[];
  private learningPatterns: Map<string, LearningPattern>;
  private storagePrefix: string;

  constructor(userId: string = 'default') {
    this.userId = userId;
    this.storagePrefix = `perplexica_user_${userId}`;
    this.preferences = this.getDefaultPreferences();
    this.searchHistory = [];
    this.interactions = [];
    this.learningPatterns = new Map();
    
    this.loadFromStorage();
  }

  private getDefaultPreferences(): UserPreferences {
    return {
      preferredSearchModes: ['webSearch'],
      preferredLanguages: ['en'],
      domainExpertise: [],
      contentTypes: ['text'],
      sourcePriority: ['official', 'academic', 'news'],
      recencyPreference: 'balanced',
      resultsPerPage: 10,
      detailLevel: 'standard',
      showSources: true,
      showConfidence: true,
      adaptToHistory: true,
      personalizedRecommendations: true,
      trackingEnabled: true,
    };
  }

  // Preference management
  getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  updatePreferences(updates: Partial<UserPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
    this.saveToStorage();
  }

  // Search history management
  addSearchHistory(history: Omit<SearchHistory, 'id' | 'timestamp'>): void {
    if (!this.preferences.trackingEnabled) return;

    const searchRecord: SearchHistory = {
      ...history,
      id: `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.searchHistory.unshift(searchRecord);
    
    // Keep only last 1000 searches
    if (this.searchHistory.length > 1000) {
      this.searchHistory = this.searchHistory.slice(0, 1000);
    }

    this.updateLearningPatterns(searchRecord);
    this.saveToStorage();
  }

  getSearchHistory(limit: number = 50): SearchHistory[] {
    return this.searchHistory.slice(0, limit);
  }

  // User interaction tracking
  recordInteraction(interaction: Omit<UserInteraction, 'timestamp'>): void {
    if (!this.preferences.trackingEnabled) return;

    const record: UserInteraction = {
      ...interaction,
      timestamp: Date.now(),
    };

    this.interactions.unshift(record);
    
    // Keep only last 5000 interactions
    if (this.interactions.length > 5000) {
      this.interactions = this.interactions.slice(0, 5000);
    }

    this.saveToStorage();
  }

  // Learning pattern analysis
  private updateLearningPatterns(searchRecord: SearchHistory): void {
    // Extract patterns from query
    const queryPatterns = this.extractQueryPatterns(searchRecord.query);
    
    queryPatterns.forEach(pattern => {
      const existing = this.learningPatterns.get(pattern);
      if (existing) {
        existing.frequency += 1;
        existing.lastSeen = Date.now();
        existing.confidence = Math.min(1.0, existing.confidence + 0.1);
        if (existing.examples.length < 5) {
          existing.examples.push(searchRecord.query);
        }
      } else {
        this.learningPatterns.set(pattern, {
          pattern,
          confidence: 0.3,
          frequency: 1,
          lastSeen: Date.now(),
          examples: [searchRecord.query],
        });
      }
    });
  }

  private extractQueryPatterns(query: string): string[] {
    const patterns: string[] = [];
    
    // Extract keywords (simple word extraction)
    const words = query.toLowerCase().match(/\b\w+\b/g) || [];
    patterns.push(...words);
    
    // Extract bigrams
    for (let i = 0; i < words.length - 1; i++) {
      patterns.push(`${words[i]} ${words[i + 1]}`);
    }
    
    // Extract question patterns
    if (query.match(/^(what|how|why|when|where|who)/i)) {
      const questionType = query.match(/^(\w+)/i)?.[1].toLowerCase();
      if (questionType) {
        patterns.push(`question:${questionType}`);
      }
    }
    
    // Extract domain patterns (simple heuristics)
    if (query.match(/code|programming|javascript|python|react/i)) {
      patterns.push('domain:programming');
    }
    if (query.match(/science|research|study|theory/i)) {
      patterns.push('domain:science');
    }
    if (query.match(/news|current|latest|today/i)) {
      patterns.push('domain:news');
    }
    
    return patterns;
  }

  // Personalized recommendations
  getPersonalizedSuggestions(currentQuery: string): string[] {
    if (!this.preferences.personalizedRecommendations) return [];

    const suggestions: string[] = [];
    const queryWords = currentQuery.toLowerCase().split(' ');
    
    // Find related patterns from history
    const relatedPatterns = Array.from(this.learningPatterns.values())
      .filter(pattern => {
        return queryWords.some(word => pattern.pattern.includes(word)) ||
               pattern.examples.some(example => 
                 queryWords.some(word => example.toLowerCase().includes(word))
               );
      })
      .sort((a, b) => b.confidence * b.frequency - a.confidence * a.frequency)
      .slice(0, 5);

    // Generate suggestions based on patterns
    relatedPatterns.forEach(pattern => {
      pattern.examples.forEach(example => {
        if (!suggestions.includes(example) && example !== currentQuery) {
          suggestions.push(example);
        }
      });
    });

    return suggestions.slice(0, 5);
  }

  // Search mode recommendation
  getRecommendedSearchMode(query: string): string {
    const queryLower = query.toLowerCase();
    
    // Check user's preferred modes first
    if (this.preferences.preferredSearchModes.length > 0) {
      // Use pattern matching to suggest mode
      if (queryLower.match(/code|programming|github|stackoverflow/)) {
        return this.preferences.preferredSearchModes.includes('codeSearch') ? 'codeSearch' : 'webSearch';
      }
      
      if (queryLower.match(/academic|research|paper|study/)) {
        return this.preferences.preferredSearchModes.includes('academicSearch') ? 'academicSearch' : 'webSearch';
      }
      
      if (queryLower.match(/news|current|latest|breaking/)) {
        return 'webSearch'; // Usually best for news
      }
      
      if (queryLower.match(/video|tutorial|how to/)) {
        return this.preferences.preferredSearchModes.includes('videoSearch') ? 'videoSearch' : 'webSearch';
      }
      
      return this.preferences.preferredSearchModes[0];
    }
    
    return 'webSearch'; // Default fallback
  }

  // Analytics and insights
  getUsageAnalytics(): {
    totalSearches: number;
    averageSearchesPerDay: number;
    topSearchModes: string[];
    topDomains: string[];
    searchTrends: { date: string; count: number }[];
  } {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - (30 * oneDay);
    
    const recentSearches = this.searchHistory.filter(h => h.timestamp > thirtyDaysAgo);
    
    // Calculate search modes frequency
    const modeCount = new Map<string, number>();
    recentSearches.forEach(search => {
      modeCount.set(search.mode, (modeCount.get(search.mode) || 0) + 1);
    });
    
    const topSearchModes = Array.from(modeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([mode]) => mode);

    // Extract domains from patterns
    const domainPatterns = Array.from(this.learningPatterns.values())
      .filter(p => p.pattern.startsWith('domain:'))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5)
      .map(p => p.pattern.replace('domain:', ''));

    // Calculate daily trends
    const dailyCounts = new Map<string, number>();
    recentSearches.forEach(search => {
      const date = new Date(search.timestamp).toISOString().split('T')[0];
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
    });
    
    const searchTrends = Array.from(dailyCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalSearches: this.searchHistory.length,
      averageSearchesPerDay: recentSearches.length / 30,
      topSearchModes,
      topDomains: domainPatterns,
      searchTrends,
    };
  }

  // Storage management
  private saveToStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`${this.storagePrefix}_preferences`, JSON.stringify(this.preferences));
        localStorage.setItem(`${this.storagePrefix}_history`, JSON.stringify(this.searchHistory));
        localStorage.setItem(`${this.storagePrefix}_interactions`, JSON.stringify(this.interactions));
        localStorage.setItem(`${this.storagePrefix}_patterns`, JSON.stringify(Array.from(this.learningPatterns.entries())));
      }
    } catch (error) {
      console.warn('Failed to save user profile to storage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const preferencesData = localStorage.getItem(`${this.storagePrefix}_preferences`);
        if (preferencesData) {
          this.preferences = { ...this.preferences, ...JSON.parse(preferencesData) };
        }
        
        const historyData = localStorage.getItem(`${this.storagePrefix}_history`);
        if (historyData) {
          this.searchHistory = JSON.parse(historyData);
        }
        
        const interactionsData = localStorage.getItem(`${this.storagePrefix}_interactions`);
        if (interactionsData) {
          this.interactions = JSON.parse(interactionsData);
        }
        
        const patternsData = localStorage.getItem(`${this.storagePrefix}_patterns`);
        if (patternsData) {
          const patternsArray = JSON.parse(patternsData);
          this.learningPatterns = new Map(patternsArray);
        }
      }
    } catch (error) {
      console.warn('Failed to load user profile from storage:', error);
    }
  }

  // Clean up old data
  cleanup(): void {
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    // Clean old search history
    this.searchHistory = this.searchHistory.filter(h => h.timestamp > oneMonthAgo);
    
    // Clean old interactions
    this.interactions = this.interactions.filter(i => i.timestamp > oneMonthAgo);
    
    // Clean old patterns
    for (const [key, pattern] of this.learningPatterns.entries()) {
      if (pattern.lastSeen < oneMonthAgo && pattern.frequency < 3) {
        this.learningPatterns.delete(key);
      }
    }
    
    this.saveToStorage();
  }

  // Export user data
  exportData(): string {
    return JSON.stringify({
      userId: this.userId,
      preferences: this.preferences,
      searchHistory: this.searchHistory,
      interactions: this.interactions,
      learningPatterns: Array.from(this.learningPatterns.entries()),
      exportDate: new Date().toISOString(),
    }, null, 2);
  }

  // Clear all data
  clearAllData(): void {
    this.preferences = this.getDefaultPreferences();
    this.searchHistory = [];
    this.interactions = [];
    this.learningPatterns.clear();
    
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`${this.storagePrefix}_preferences`);
        localStorage.removeItem(`${this.storagePrefix}_history`);
        localStorage.removeItem(`${this.storagePrefix}_interactions`);
        localStorage.removeItem(`${this.storagePrefix}_patterns`);
      }
    } catch (error) {
      console.warn('Failed to clear storage:', error);
    }
  }
}

// Global instance for default user
export const defaultUserProfile = new UserProfileManager(); 