import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { 
  BaseReasoningEngine, 
  ReasoningContext, 
  ReasoningChain, 
  ReasoningStep, 
  ReasoningStrategy 
} from './index';

export class ChainOfThoughtEngine extends BaseReasoningEngine {
  private llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    super();
    this.llm = llm;
  }

  getStrategy(): ReasoningStrategy {
    return 'chain-of-thought';
  }

  isApplicable(context: ReasoningContext): boolean {
    // Chain of thought is always applicable as a fallback
    return true;
  }

  async reason(context: ReasoningContext): Promise<ReasoningChain> {
    const { query, domain, priorKnowledge = [], constraints = [], goal } = context;
    
    const prompt = this.buildChainOfThoughtPrompt(query, domain, priorKnowledge, constraints, goal);
    
    try {
      const response = await this.llm.invoke(prompt);
      const steps = this.parseReasoningSteps(response.content as string);
      
      const chainId = `cot-${Date.now()}`;
      const conclusion = steps.length > 0 ? steps[steps.length - 1].content : 'No conclusion reached';
      const confidence = this.calculateOverallConfidence(steps);

      return {
        id: chainId,
        query,
        steps,
        conclusion,
        confidence,
        metadata: {
          strategy: 'chain-of-thought',
          totalSteps: steps.length,
          duration: 0, // Will be set by ReasoningManager
          sources: [],
        },
      };
    } catch (error) {
      console.error('Chain of thought reasoning failed:', error);
      throw error;
    }
  }

  private buildChainOfThoughtPrompt(
    query: string,
    domain?: string,
    priorKnowledge: string[] = [],
    constraints: string[] = [],
    goal: string = 'analysis'
  ): string {
    let prompt = `You are an expert reasoning system. Use step-by-step chain-of-thought reasoning to analyze the following query.

Query: "${query}"`;

    if (domain) {
      prompt += `\nDomain: ${domain}`;
    }

    if (goal) {
      prompt += `\nGoal: ${goal}`;
    }

    if (priorKnowledge.length > 0) {
      prompt += `\nPrior Knowledge:\n${priorKnowledge.map(k => `- ${k}`).join('\n')}`;
    }

    if (constraints.length > 0) {
      prompt += `\nConstraints:\n${constraints.map(c => `- ${c}`).join('\n')}`;
    }

    prompt += `

Please think through this step by step. Format your response as follows:

STEP 1: [observation/hypothesis/deduction/induction]
[Your reasoning for this step]
Confidence: [0.0-1.0]

STEP 2: [observation/hypothesis/deduction/induction]
[Your reasoning for this step]
Confidence: [0.0-1.0]

[Continue with additional steps as needed]

CONCLUSION:
[Your final conclusion based on the chain of reasoning]
Confidence: [0.0-1.0]

Begin your reasoning:`;

    return prompt;
  }

  private parseReasoningSteps(response: string): ReasoningStep[] {
    const steps: ReasoningStep[] = [];
    const lines = response.split('\n');
    
    let currentStep: Partial<ReasoningStep> | null = null;
    let stepContent: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check for step header
      const stepMatch = trimmed.match(/^STEP\s+(\d+):\s*\[(observation|hypothesis|deduction|induction|analogy)\]/i);
      if (stepMatch) {
        // Save previous step if exists
        if (currentStep && stepContent.length > 0) {
          currentStep.content = stepContent.join(' ').trim();
          steps.push(currentStep as ReasoningStep);
        }
        
        // Start new step
        currentStep = {
          id: `step-${Date.now()}-${stepMatch[1]}`,
          type: stepMatch[2].toLowerCase() as any,
          confidence: 0.5, // Default confidence
          dependencies: steps.map(s => s.id),
          timestamp: Date.now(),
        };
        stepContent = [];
        continue;
      }
      
      // Check for confidence
      const confidenceMatch = trimmed.match(/^Confidence:\s*([0-9.]+)/i);
      if (confidenceMatch && currentStep) {
        currentStep.confidence = Math.max(0, Math.min(1, parseFloat(confidenceMatch[1])));
        continue;
      }
      
      // Check for conclusion
      const conclusionMatch = trimmed.match(/^CONCLUSION:/i);
      if (conclusionMatch) {
        // Save current step if exists
        if (currentStep && stepContent.length > 0) {
          currentStep.content = stepContent.join(' ').trim();
          steps.push(currentStep as ReasoningStep);
        }
        
        // Start conclusion step
        currentStep = {
          id: `conclusion-${Date.now()}`,
          type: 'synthesis',
          confidence: 0.5,
          dependencies: steps.map(s => s.id),
          timestamp: Date.now(),
        };
        stepContent = [];
        continue;
      }
      
      // Collect content for current step
      if (currentStep && trimmed && !trimmed.startsWith('STEP') && !trimmed.startsWith('Confidence:')) {
        stepContent.push(trimmed);
      }
    }
    
    // Save final step
    if (currentStep && stepContent.length > 0) {
      currentStep.content = stepContent.join(' ').trim();
      steps.push(currentStep as ReasoningStep);
    }
    
    return steps.filter(step => step.content && step.content.length > 0);
  }

  private calculateOverallConfidence(steps: ReasoningStep[]): number {
    if (steps.length === 0) return 0;
    
    // Use weighted average, giving more weight to later steps
    let totalWeight = 0;
    let weightedSum = 0;
    
    steps.forEach((step, index) => {
      const weight = index + 1; // Later steps have higher weight
      totalWeight += weight;
      weightedSum += step.confidence * weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }
} 