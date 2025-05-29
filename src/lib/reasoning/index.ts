export interface ReasoningStep {
  id: string;
  type: 'observation' | 'hypothesis' | 'deduction' | 'induction' | 'analogy' | 'synthesis';
  content: string;
  confidence: number;
  dependencies: string[];
  sources?: string[];
  timestamp: number;
}

export interface ReasoningChain {
  id: string;
  query: string;
  steps: ReasoningStep[];
  conclusion: string;
  confidence: number;
  metadata: {
    strategy: ReasoningStrategy;
    totalSteps: number;
    duration: number;
    sources: string[];
  };
}

export type ReasoningStrategy = 
  | 'chain-of-thought'
  | 'tree-of-thought'
  | 'causal-reasoning'
  | 'analogical-reasoning'
  | 'abductive-reasoning'
  | 'meta-reasoning';

export interface ReasoningContext {
  query: string;
  domain?: string;
  priorKnowledge?: string[];
  constraints?: string[];
  goal: 'explanation' | 'prediction' | 'decision' | 'analysis';
}

export abstract class BaseReasoningEngine {
  abstract reason(context: ReasoningContext): Promise<ReasoningChain>;
  abstract getStrategy(): ReasoningStrategy;
  abstract isApplicable(context: ReasoningContext): boolean;
}

export class ReasoningManager {
  private engines: Map<ReasoningStrategy, BaseReasoningEngine> = new Map();
  private activeChains: Map<string, ReasoningChain> = new Map();

  registerEngine(engine: BaseReasoningEngine): void {
    this.engines.set(engine.getStrategy(), engine);
  }

  async reason(context: ReasoningContext): Promise<ReasoningChain> {
    // Select the most appropriate reasoning strategy
    const strategy = this.selectStrategy(context);
    const engine = this.engines.get(strategy);
    
    if (!engine) {
      throw new Error(`No reasoning engine available for strategy: ${strategy}`);
    }

    const startTime = Date.now();
    const chain = await engine.reason(context);
    chain.metadata.duration = Date.now() - startTime;

    // Cache the reasoning chain
    this.activeChains.set(chain.id, chain);

    return chain;
  }

  async combineReasoningChains(chains: ReasoningChain[]): Promise<ReasoningChain> {
    const combinedId = `combined-${Date.now()}`;
    const allSteps: ReasoningStep[] = [];
    const allSources: string[] = [];

    // Merge all steps and remove duplicates
    for (const chain of chains) {
      allSteps.push(...chain.steps);
      allSources.push(...chain.metadata.sources);
    }

    // Remove duplicate sources
    const uniqueSources = [...new Set(allSources)];

    // Create synthesis step
    const synthesisStep: ReasoningStep = {
      id: `synthesis-${Date.now()}`,
      type: 'synthesis',
      content: this.synthesizeConclusions(chains),
      confidence: this.calculateCombinedConfidence(chains),
      dependencies: chains.map(c => c.id),
      timestamp: Date.now(),
    };

    allSteps.push(synthesisStep);

    const combinedChain: ReasoningChain = {
      id: combinedId,
      query: chains[0].query,
      steps: allSteps,
      conclusion: synthesisStep.content,
      confidence: synthesisStep.confidence,
      metadata: {
        strategy: 'meta-reasoning',
        totalSteps: allSteps.length,
        duration: Math.max(...chains.map(c => c.metadata.duration)),
        sources: uniqueSources,
      },
    };

    this.activeChains.set(combinedId, combinedChain);
    return combinedChain;
  }

  private selectStrategy(context: ReasoningContext): ReasoningStrategy {
    // Strategy selection based on context and goal
    const { goal, domain, query } = context;

    // Check if engines are applicable
    const applicableEngines = Array.from(this.engines.values())
      .filter(engine => engine.isApplicable(context));

    if (applicableEngines.length === 0) {
      return 'chain-of-thought'; // Default fallback
    }

    // Priority-based selection
    if (goal === 'explanation' && this.hasKeywords(query, ['why', 'how', 'cause', 'reason'])) {
      return 'causal-reasoning';
    }

    if (goal === 'analysis' && this.hasKeywords(query, ['like', 'similar', 'compare'])) {
      return 'analogical-reasoning';
    }

    if (goal === 'decision' || this.hasKeywords(query, ['should', 'best', 'choose', 'decide'])) {
      return 'tree-of-thought';
    }

    if (this.hasKeywords(query, ['hypothesis', 'might', 'possibly', 'could be'])) {
      return 'abductive-reasoning';
    }

    return 'chain-of-thought';
  }

  private hasKeywords(text: string, keywords: string[]): boolean {
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword));
  }

  private synthesizeConclusions(chains: ReasoningChain[]): string {
    if (chains.length === 1) {
      return chains[0].conclusion;
    }

    const conclusions = chains.map(c => c.conclusion);
    const weightedConcl = chains.map((c, i) => `[${c.metadata.strategy}] ${c.conclusion}`);
    
    return `Based on multiple reasoning approaches:\n\n${weightedConcl.join('\n\n')}\n\nSynthesis: The evidence suggests ${this.findCommonThemes(conclusions)}`;
  }

  private findCommonThemes(conclusions: string[]): string {
    // Simple approach to find common themes
    if (conclusions.length === 0) return 'insufficient evidence for conclusion';
    
    const words = conclusions.join(' ').toLowerCase().split(/\s+/);
    const frequency = new Map<string, number>();
    
    words.forEach(word => {
      if (word.length > 3) { // Only consider meaningful words
        frequency.set(word, (frequency.get(word) || 0) + 1);
      }
    });

    const commonWords = Array.from(frequency.entries())
      .filter(([_, count]) => count > 1)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 3)
      .map(([word, _]) => word);

    if (commonWords.length > 0) {
      return `convergent evidence around: ${commonWords.join(', ')}`;
    }

    return 'multiple perspectives that complement each other';
  }

  private calculateCombinedConfidence(chains: ReasoningChain[]): number {
    if (chains.length === 0) return 0;
    
    // Use weighted average with slight boost for consensus
    const avgConfidence = chains.reduce((sum, c) => sum + c.confidence, 0) / chains.length;
    const consensusBoost = chains.length > 1 ? 0.1 : 0;
    
    return Math.min(avgConfidence + consensusBoost, 1.0);
  }

  getReasoningChain(id: string): ReasoningChain | undefined {
    return this.activeChains.get(id);
  }

  getActiveChains(): ReasoningChain[] {
    return Array.from(this.activeChains.values());
  }

  clearChains(): void {
    this.activeChains.clear();
  }
}

export const globalReasoningManager = new ReasoningManager(); 