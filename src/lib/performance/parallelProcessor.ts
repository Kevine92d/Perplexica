export interface ParallelTask<T> {
  id: string;
  task: () => Promise<T>;
  priority?: number;
  timeout?: number;
}

export interface ProcessorConfig {
  maxConcurrency: number;
  defaultTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export class ParallelProcessor {
  private config: ProcessorConfig;
  private activeJobs = new Map<string, Promise<any>>();
  private queue: ParallelTask<any>[] = [];
  private running = 0;

  constructor(config: Partial<ProcessorConfig> = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency || 5,
      defaultTimeout: config.defaultTimeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
    };
  }

  async execute<T>(tasks: ParallelTask<T>[]): Promise<T[]> {
    const promises = tasks.map(task => this.executeTask(task));
    return Promise.all(promises);
  }

  async executeWithResults<T>(tasks: ParallelTask<T>[]): Promise<Array<{
    id: string;
    result?: T;
    error?: Error;
    duration: number;
  }>> {
    const promises = tasks.map(async (task) => {
      const startTime = Date.now();
      try {
        const result = await this.executeTask(task);
        return {
          id: task.id,
          result,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          id: task.id,
          error: error as Error,
          duration: Date.now() - startTime,
        };
      }
    });

    return Promise.all(promises);
  }

  private async executeTask<T>(task: ParallelTask<T>): Promise<T> {
    // Check if task is already running
    if (this.activeJobs.has(task.id)) {
      return this.activeJobs.get(task.id) as Promise<T>;
    }

    const promise = this.runTaskWithRetry(task);
    this.activeJobs.set(task.id, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.activeJobs.delete(task.id);
    }
  }

  private async runTaskWithRetry<T>(task: ParallelTask<T>): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await this.runTaskWithTimeout(task);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retryAttempts) {
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }

    throw lastError;
  }

  private async runTaskWithTimeout<T>(task: ParallelTask<T>): Promise<T> {
    const timeout = task.timeout || this.config.defaultTimeout;
    
    return Promise.race([
      task.task(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Task ${task.id} timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);
  }

  async executeBatched<T>(
    tasks: ParallelTask<T>[],
    batchSize?: number
  ): Promise<T[]> {
    const size = batchSize || this.config.maxConcurrency;
    const results: T[] = [];

    // Sort by priority if provided
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (let i = 0; i < sortedTasks.length; i += size) {
      const batch = sortedTasks.slice(i, i + size);
      const batchResults = await this.execute(batch);
      results.push(...batchResults);
    }

    return results;
  }

  async executeWithLimit<T>(
    taskGenerator: () => ParallelTask<T>[],
    limit: number
  ): Promise<T[]> {
    const semaphore = new Semaphore(limit);
    const tasks = taskGenerator();

    const promises = tasks.map(async (task) => {
      await semaphore.acquire();
      try {
        return await this.executeTask(task);
      } finally {
        semaphore.release();
      }
    });

    return Promise.all(promises);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      activeJobs: this.activeJobs.size,
      queueLength: this.queue.length,
      running: this.running,
      maxConcurrency: this.config.maxConcurrency,
    };
  }

  clear(): void {
    this.activeJobs.clear();
    this.queue = [];
  }
}

export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) next();
    } else {
      this.permits++;
    }
  }
}

// Search-specific parallel processing utilities
export class SearchParallelProcessor extends ParallelProcessor {
  async executeSearches<T>(
    queries: string[],
    searchFunction: (query: string) => Promise<T>,
    options: { priority?: number; timeout?: number } = {}
  ): Promise<T[]> {
    const tasks: ParallelTask<T>[] = queries.map((query, index) => ({
      id: `search-${index}-${query.slice(0, 20)}`,
      task: () => searchFunction(query),
      priority: options.priority,
      timeout: options.timeout,
    }));

    return this.execute(tasks);
  }

  async executeWithFallback<T>(
    primaryTasks: ParallelTask<T>[],
    fallbackTasks: ParallelTask<T>[]
  ): Promise<T[]> {
    try {
      return await this.execute(primaryTasks);
    } catch (error) {
      console.warn('Primary tasks failed, falling back:', error);
      return this.execute(fallbackTasks);
    }
  }
}

// Global processor instance
export const globalProcessor = new SearchParallelProcessor({
  maxConcurrency: 8,
  defaultTimeout: 30000,
  retryAttempts: 2,
  retryDelay: 1000,
}); 