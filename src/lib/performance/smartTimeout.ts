export interface TimeoutConfig {
  baseTimeout: number;
  maxTimeout: number;
  minTimeout: number;
  adaptiveEnabled: boolean;
  historySize: number;
}

export interface RequestMetrics {
  duration: number;
  timestamp: number;
  success: boolean;
  requestType: string;
}

export class SmartTimeout {
  private config: TimeoutConfig;
  private metrics = new Map<string, RequestMetrics[]>();
  private currentTimeouts = new Map<string, number>();

  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = {
      baseTimeout: config.baseTimeout || 30000,
      maxTimeout: config.maxTimeout || 120000,
      minTimeout: config.minTimeout || 5000,
      adaptiveEnabled: config.adaptiveEnabled !== false,
      historySize: config.historySize || 100,
    };
  }

  async executeWithTimeout<T>(
    requestType: string,
    requestFn: () => Promise<T>,
    customTimeout?: number
  ): Promise<T> {
    const timeout = customTimeout || this.getTimeoutForType(requestType);
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        requestFn(),
        this.createTimeoutPromise(timeout, requestType),
      ]);

      // Record successful execution
      this.recordMetrics(requestType, Date.now() - startTime, true);
      return result as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      const isTimeout = duration >= timeout - 100; // 100ms tolerance

      // Record failed execution
      this.recordMetrics(requestType, duration, false);

      if (isTimeout) {
        throw new TimeoutError(`Request of type '${requestType}' timed out after ${timeout}ms`, timeout);
      }
      throw error;
    }
  }

  private createTimeoutPromise(timeout: number, requestType: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(`Request of type '${requestType}' timed out after ${timeout}ms`, timeout));
      }, timeout);
    });
  }

  private getTimeoutForType(requestType: string): number {
    if (!this.config.adaptiveEnabled) {
      return this.config.baseTimeout;
    }

    const currentTimeout = this.currentTimeouts.get(requestType);
    if (currentTimeout) {
      return currentTimeout;
    }

    // Calculate adaptive timeout based on historical data
    const adaptiveTimeout = this.calculateAdaptiveTimeout(requestType);
    this.currentTimeouts.set(requestType, adaptiveTimeout);
    return adaptiveTimeout;
  }

  private calculateAdaptiveTimeout(requestType: string): number {
    const history = this.metrics.get(requestType) || [];
    
    if (history.length === 0) {
      return this.config.baseTimeout;
    }

    // Filter recent successful requests
    const recentSuccessful = history
      .filter(m => m.success)
      .slice(-Math.min(20, this.config.historySize));

    if (recentSuccessful.length === 0) {
      return this.config.baseTimeout;
    }

    // Calculate statistics
    const durations = recentSuccessful.map(m => m.duration);
    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    
    // Calculate 95th percentile
    durations.sort((a, b) => a - b);
    const p95Index = Math.ceil(durations.length * 0.95) - 1;
    const p95Duration = durations[p95Index] || maxDuration;

    // Use 95th percentile + buffer as timeout
    const buffer = Math.max(averageDuration * 0.5, 2000); // At least 2 seconds buffer
    let adaptiveTimeout = Math.ceil(p95Duration + buffer);

    // Apply bounds
    adaptiveTimeout = Math.max(this.config.minTimeout, adaptiveTimeout);
    adaptiveTimeout = Math.min(this.config.maxTimeout, adaptiveTimeout);

    return adaptiveTimeout;
  }

  private recordMetrics(requestType: string, duration: number, success: boolean): void {
    if (!this.metrics.has(requestType)) {
      this.metrics.set(requestType, []);
    }

    const history = this.metrics.get(requestType)!;
    history.push({
      duration,
      timestamp: Date.now(),
      success,
      requestType,
    });

    // Keep only recent history
    if (history.length > this.config.historySize) {
      history.splice(0, history.length - this.config.historySize);
    }

    // Update timeout if needed
    if (this.config.adaptiveEnabled && history.length % 10 === 0) {
      const newTimeout = this.calculateAdaptiveTimeout(requestType);
      this.currentTimeouts.set(requestType, newTimeout);
    }
  }

  // Batch execution with different timeouts per task
  async executeBatchWithTimeouts<T>(
    tasks: Array<{
      id: string;
      requestType: string;
      requestFn: () => Promise<T>;
      customTimeout?: number;
    }>
  ): Promise<Array<{
    id: string;
    result?: T;
    error?: Error;
    duration: number;
    timedOut: boolean;
  }>> {
    const promises = tasks.map(async (task) => {
      const startTime = Date.now();
      try {
        const result = await this.executeWithTimeout(
          task.requestType,
          task.requestFn,
          task.customTimeout
        );
        return {
          id: task.id,
          result,
          duration: Date.now() - startTime,
          timedOut: false,
        };
      } catch (error) {
        return {
          id: task.id,
          error: error as Error,
          duration: Date.now() - startTime,
          timedOut: error instanceof TimeoutError,
        };
      }
    });

    return Promise.all(promises);
  }

  // Progressive timeout - start with short timeout, gradually increase
  async executeWithProgressiveTimeout<T>(
    requestType: string,
    requestFn: () => Promise<T>,
    timeouts: number[] = [5000, 15000, 30000]
  ): Promise<T> {
    let lastError: Error | null = null;

    for (const timeout of timeouts) {
      try {
        return await this.executeWithTimeout(requestType, requestFn, timeout);
      } catch (error) {
        lastError = error as Error;
        if (!(error instanceof TimeoutError)) {
          throw error; // If it's not a timeout error, don't retry
        }
      }
    }

    throw lastError;
  }

  getStats() {
    const stats: Record<string, any> = {};
    
    for (const [requestType, history] of this.metrics) {
      const successful = history.filter(m => m.success);
      const failed = history.filter(m => !m.success);
      
      stats[requestType] = {
        totalRequests: history.length,
        successfulRequests: successful.length,
        failedRequests: failed.length,
        successRate: history.length > 0 ? successful.length / history.length : 0,
        averageDuration: successful.length > 0 
          ? successful.reduce((sum, m) => sum + m.duration, 0) / successful.length 
          : 0,
        currentTimeout: this.currentTimeouts.get(requestType) || this.config.baseTimeout,
      };
    }

    return {
      requestTypes: stats,
      config: this.config,
      totalMetrics: Array.from(this.metrics.values()).reduce((sum, arr) => sum + arr.length, 0),
    };
  }

  clearMetrics(requestType?: string): void {
    if (requestType) {
      this.metrics.delete(requestType);
      this.currentTimeouts.delete(requestType);
    } else {
      this.metrics.clear();
      this.currentTimeouts.clear();
    }
  }

  updateConfig(newConfig: Partial<TimeoutConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Recalculate timeouts if adaptive mode changed
    if (newConfig.adaptiveEnabled !== undefined) {
      this.currentTimeouts.clear();
    }
  }
}

export class TimeoutError extends Error {
  public readonly timeout: number;

  constructor(message: string, timeout: number) {
    super(message);
    this.name = 'TimeoutError';
    this.timeout = timeout;
  }
}

// Search-specific timeout manager
export class SearchTimeoutManager extends SmartTimeout {
  constructor() {
    super({
      baseTimeout: 30000,
      maxTimeout: 90000,
      minTimeout: 10000,
      adaptiveEnabled: true,
      historySize: 50,
    });
  }

  async executeSearchWithTimeout<T>(
    searchType: 'web' | 'academic' | 'copilot' | 'youtube' | 'reddit',
    searchFn: () => Promise<T>
  ): Promise<T> {
    return this.executeWithTimeout(`search-${searchType}`, searchFn);
  }

  async executePageExtractionWithTimeout<T>(
    extractionFn: () => Promise<T>
  ): Promise<T> {
    return this.executeWithTimeout('page-extraction', extractionFn);
  }

  async executeEmbeddingWithTimeout<T>(
    embeddingFn: () => Promise<T>
  ): Promise<T> {
    return this.executeWithTimeout('embedding', embeddingFn);
  }
}

// Global timeout manager
export const globalTimeoutManager = new SearchTimeoutManager(); 