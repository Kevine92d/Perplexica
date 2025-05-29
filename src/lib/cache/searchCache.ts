import crypto from 'crypto';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  hits: number;
}

export interface CacheConfig {
  maxSize: number;
  defaultTTL: number; // Time to live in milliseconds
  maxMemoryUsage: number; // Max memory usage in bytes
}

export class SearchCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder = new Set<string>();
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: config.maxSize || 1000,
      defaultTTL: config.defaultTTL || 30 * 60 * 1000, // 30 minutes
      maxMemoryUsage: config.maxMemoryUsage || 100 * 1024 * 1024, // 100MB
    };
  }

  private generateKey(query: string, focusMode: string, options: any = {}): string {
    const data = JSON.stringify({ query, focusMode, options });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() > entry.expiresAt;
  }

  private evictLRU(): void {
    const oldestKey = this.accessOrder.values().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
  }

  private updateAccessOrder(key: string): void {
    this.accessOrder.delete(key);
    this.accessOrder.add(key);
  }

  set(
    query: string,
    focusMode: string,
    data: T,
    options: any = {},
    ttl: number = this.config.defaultTTL
  ): void {
    const key = this.generateKey(query, focusMode, options);
    const now = Date.now();

    // Remove if already exists
    if (this.cache.has(key)) {
      this.accessOrder.delete(key);
    }

    // Evict if cache is full
    while (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + ttl,
      hits: 0,
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
  }

  get(query: string, focusMode: string, options: any = {}): T | null {
    const key = this.generateKey(query, focusMode, options);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      return null;
    }

    // Update hit count and access order
    entry.hits++;
    this.updateAccessOrder(key);

    return entry.data;
  }

  has(query: string, focusMode: string, options: any = {}): boolean {
    const key = this.generateKey(query, focusMode, options);
    const entry = this.cache.get(key);
    
    if (!entry || this.isExpired(entry)) {
      if (entry) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
      }
      return false;
    }

    return true;
  }

  delete(query: string, focusMode: string, options: any = {}): boolean {
    const key = this.generateKey(query, focusMode, options);
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.accessOrder.delete(key);
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder.clear();
  }

  getStats() {
    const entries = Array.from(this.cache.values());
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      totalHits: entries.reduce((sum, entry) => sum + entry.hits, 0),
      averageAge: entries.length > 0 
        ? entries.reduce((sum, entry) => sum + (Date.now() - entry.timestamp), 0) / entries.length
        : 0,
      memoryUsage: this.getMemoryUsage(),
    };
  }

  private getMemoryUsage(): number {
    // Rough estimation of memory usage
    let size = 0;
    for (const [key, entry] of this.cache) {
      size += key.length * 2; // UTF-16 characters
      size += JSON.stringify(entry).length * 2;
    }
    return size;
  }

  // Cleanup expired entries
  cleanup(): number {
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Global cache instances
export const searchResultCache = new SearchCache({
  maxSize: 500,
  defaultTTL: 15 * 60 * 1000, // 15 minutes
});

export const documentCache = new SearchCache({
  maxSize: 1000,
  defaultTTL: 60 * 60 * 1000, // 1 hour
});

// Periodic cleanup
setInterval(() => {
  searchResultCache.cleanup();
  documentCache.cleanup();
}, 5 * 60 * 1000); // Every 5 minutes 