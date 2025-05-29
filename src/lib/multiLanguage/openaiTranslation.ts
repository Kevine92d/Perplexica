import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseTranslationProvider, TranslationRequest, TranslationResult, LanguageDetectionResult } from './index';

export class OpenAITranslationProvider extends BaseTranslationProvider {
  private llm: BaseChatModel;

  constructor(llm: BaseChatModel) {
    super();
    this.llm = llm;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { text, sourceLang, targetLang, context, domain } = request;

    const prompt = this.buildTranslationPrompt(text, sourceLang, targetLang, context, domain);

    try {
      const response = await this.llm.invoke(prompt);
      const translatedText = this.extractTranslation(response.content as string);

      return {
        translatedText,
        sourceLang: sourceLang || 'auto',
        targetLang,
        confidence: 0.9, // OpenAI generally provides high-quality translations
        provider: 'openai',
      };
    } catch (error) {
      console.error('OpenAI translation failed:', error);
      throw new Error(`Translation failed: ${error}`);
    }
  }

  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    const prompt = `
You are a language detection expert. Analyze the following text and determine its language.

Text: "${text}"

Respond with a JSON object containing:
- language: ISO 639-1 language code (e.g., "en", "zh", "ja")
- confidence: confidence score between 0 and 1
- alternatives: array of up to 3 alternative languages with their confidence scores

Example response:
{
  "language": "en",
  "confidence": 0.95,
  "alternatives": [
    {"language": "es", "confidence": 0.03},
    {"language": "fr", "confidence": 0.02}
  ]
}

JSON response:`;

    try {
      const response = await this.llm.invoke(prompt);
      const result = this.parseLanguageDetectionResponse(response.content as string);
      return result;
    } catch (error) {
      console.error('Language detection failed:', error);
      // Fallback to simple detection
      return {
        language: 'en',
        confidence: 0.5,
        alternatives: [],
      };
    }
  }

  getSupportedLanguages(): string[] {
    return [
      'en', 'zh', 'zh-cn', 'zh-tw', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru',
      'ar', 'hi', 'th', 'vi', 'tr', 'pl', 'nl', 'sv', 'da', 'no', 'fi', 'cs',
      'sk', 'hu', 'ro', 'bg', 'hr', 'sl', 'et', 'lv', 'lt', 'mt', 'el', 'he',
      'fa', 'ur', 'bn', 'ta', 'te', 'ml', 'kn', 'gu', 'pa', 'or', 'as', 'ne',
      'si', 'my', 'km', 'lo', 'ka', 'am', 'sw', 'zu', 'af', 'sq', 'eu', 'ca',
      'cy', 'ga', 'is', 'lb', 'mk', 'ms', 'tl', 'id', 'jv', 'su', 'ceb', 'ny',
      'ha', 'ig', 'mg', 'st', 'so', 'rw', 'yo', 'xh', 'sn'
    ];
  }

  private buildTranslationPrompt(
    text: string,
    sourceLang?: string,
    targetLang?: string,
    context?: string,
    domain?: string
  ): string {
    let prompt = 'You are a professional translator with expertise in multiple languages.\n\n';

    if (sourceLang) {
      prompt += `Source language: ${sourceLang}\n`;
    }
    prompt += `Target language: ${targetLang}\n`;

    if (domain) {
      prompt += `Domain: ${domain} (Please use appropriate terminology for this domain)\n`;
    }

    if (context) {
      prompt += `Context: ${context}\n`;
    }

    prompt += `\nTranslate the following text accurately while preserving the original meaning, tone, and style:\n\n"${text}"\n\n`;
    prompt += 'Translation:';

    return prompt;
  }

  private extractTranslation(response: string): string {
    // Remove any extra formatting or explanations
    const lines = response.split('\n');
    
    // Look for the actual translation (usually the first substantial line)
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('Translation:') && !trimmed.startsWith('Here') && trimmed.length > 0) {
        // Remove quotes if present
        return trimmed.replace(/^["']|["']$/g, '');
      }
    }

    return response.trim();
  }

  private parseLanguageDetectionResponse(response: string): LanguageDetectionResult {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          language: result.language || 'en',
          confidence: result.confidence || 0.5,
          alternatives: result.alternatives || [],
        };
      }
    } catch (error) {
      console.warn('Failed to parse language detection response:', error);
    }

    // Fallback parsing
    const languageMatch = response.match(/language["']?\s*:\s*["']?([a-z-]{2,5})["']?/i);
    const confidenceMatch = response.match(/confidence["']?\s*:\s*([0-9.]+)/i);

    return {
      language: languageMatch ? languageMatch[1] : 'en',
      confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      alternatives: [],
    };
  }
} 