import crypto from 'crypto';

export interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
  requestCount: number;
}

export interface DeduplicatorConfig {
  maxPendingTime: number;
  cleanupInterval: number;
  enabled: boolean;
}

export class RequestDeduplicator {
  private pendingRequests = new Map<string, PendingRequest<any>>();
  private config: DeduplicatorConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<DeduplicatorConfig> = {}) {
    this.config = {
      maxPendingTime: config.maxPendingTime || 30000,
      cleanupInterval: config.cleanupInterval || 10000,
      enabled: config.enabled !== false,
    };

    if (this.config.enabled) {
      this.startCleanup();
    }
  }

  private generateKey(
    url: string,
    method: string = 'GET',
    body?: any,
    headers?: Record<string, string>
  ): string {
    const data = JSON.stringify({
      url,
      method: method.toUpperCase(),
      body: body || null,
      headers: headers || {},
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async deduplicate<T>(
    key: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enabled) {
      return requestFn();
    }

    const existing = this.pendingRequests.get(key);
    
    if (existing) {
      if (Date.now() - existing.timestamp < this.config.maxPendingTime) {
        existing.requestCount++;
        return existing.promise;
      } else {
        this.pendingRequests.delete(key);
      }
    }

    const promise = requestFn();
    const pendingRequest: PendingRequest<T> = {
      promise,
      timestamp: Date.now(),
      requestCount: 1,
    };

    this.pendingRequests.set(key, pendingRequest);

    try {
      const result = await promise;
      return result;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  async deduplicateHttpRequest<T>(
    url: string,
    requestFn: () => Promise<T>,
    options: {
      method?: string;
      body?: any;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const key = this.generateKey(url, options.method, options.body, options.headers);
    return this.deduplicate(key, requestFn);
  }

  async deduplicateSearchRequest<T>(
    query: string,
    focusMode: string,
    requestFn: () => Promise<T>,
    options: any = {}
  ): Promise<T> {
    const searchKey = this.generateSearchKey(query, focusMode, options);
    return this.deduplicate(searchKey, requestFn);
  }

  private generateSearchKey(
    query: string,
    focusMode: string,
    options: any = {}
  ): string {
    const data = JSON.stringify({
      query: query.toLowerCase().trim(),
      focusMode,
      options,
    });
    return `search:${crypto.createHash('sha256').update(data).digest('hex')}`;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, pending] of this.pendingRequests) {
      if (now - pending.timestamp > this.config.maxPendingTime) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => {
      this.pendingRequests.delete(key);
    });
  }

  getStats() {
    const requests = Array.from(this.pendingRequests.values());
    return {
      pendingCount: this.pendingRequests.size,
      totalRequestsSaved: requests.reduce((sum, req) => sum + (req.requestCount - 1), 0),
      averageAge: requests.length > 0
        ? requests.reduce((sum, req) => sum + (Date.now() - req.timestamp), 0) / requests.length
        : 0,
      config: this.config,
    };
  }

  clear(): void {
    this.pendingRequests.clear();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
  }
}

export class SearchRequestDeduplicator extends RequestDeduplicator {
  async deduplicateSearch<T>(
    query: string,
    focusMode: string,
    requestFn: () => Promise<T>,
    options: {
      chatModel?: string;
      embeddingModel?: string;
    } = {}
  ): Promise<T> {
    return this.deduplicateSearchRequest(query, focusMode, requestFn, options);
  }

  async deduplicatePageExtraction<T>(
    url: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    const key = `page:${crypto.createHash('sha256').update(url).digest('hex')}`;
    return this.deduplicate(key, requestFn);
  }

  async deduplicateEmbedding<T>(
    text: string,
    model: string,
    requestFn: () => Promise<T>
  ): Promise<T> {
    const key = `embedding:${crypto.createHash('sha256').update(`${model}:${text}`).digest('hex')}`;
    return this.deduplicate(key, requestFn);
  }
}

export const globalDeduplicator = new SearchRequestDeduplicator({
  maxPendingTime: 30000,
  cleanupInterval: 15000,
  enabled: true,
});

export const httpDeduplicator = new RequestDeduplicator({
  maxPendingTime: 10000,
  cleanupInterval: 5000,
  enabled: true,
}); 