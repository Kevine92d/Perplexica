export interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
  enabled: boolean;
  translationProvider?: 'google' | 'deepl' | 'openai' | 'custom';
}

export interface TranslationRequest {
  text: string;
  sourceLang?: string;
  targetLang: string;
  context?: string;
  domain?: 'general' | 'technical' | 'academic' | 'medical';
}

export interface TranslationResult {
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  confidence: number;
  provider: string;
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  alternatives: Array<{ language: string; confidence: number }>;
}

export abstract class BaseTranslationProvider {
  abstract translate(request: TranslationRequest): Promise<TranslationResult>;
  abstract detectLanguage(text: string): Promise<LanguageDetectionResult>;
  abstract getSupportedLanguages(): string[];
}

export class MultiLanguageManager {
  private translationProviders: Map<string, BaseTranslationProvider> = new Map();
  private languages: Map<string, LanguageConfig> = new Map();
  private defaultProvider: string = 'openai';

  constructor() {
    this.initializeDefaultLanguages();
  }

  private initializeDefaultLanguages(): void {
    const defaultLanguages: LanguageConfig[] = [
      { code: 'en', name: 'English', nativeName: 'English', rtl: false, enabled: true },
      { code: 'zh', name: 'Chinese', nativeName: '中文', rtl: false, enabled: true },
      { code: 'zh-cn', name: 'Chinese Simplified', nativeName: '简体中文', rtl: false, enabled: true },
      { code: 'zh-tw', name: 'Chinese Traditional', nativeName: '繁體中文', rtl: false, enabled: true },
      { code: 'ja', name: 'Japanese', nativeName: '日本語', rtl: false, enabled: true },
      { code: 'ko', name: 'Korean', nativeName: '한국어', rtl: false, enabled: true },
      { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false, enabled: true },
      { code: 'fr', name: 'French', nativeName: 'Français', rtl: false, enabled: true },
      { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false, enabled: true },
      { code: 'it', name: 'Italian', nativeName: 'Italiano', rtl: false, enabled: true },
      { code: 'pt', name: 'Portuguese', nativeName: 'Português', rtl: false, enabled: true },
      { code: 'ru', name: 'Russian', nativeName: 'Русский', rtl: false, enabled: true },
      { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true, enabled: true },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', rtl: false, enabled: true },
      { code: 'th', name: 'Thai', nativeName: 'ไทย', rtl: false, enabled: true },
      { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', rtl: false, enabled: true },
      { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', rtl: false, enabled: true },
      { code: 'pl', name: 'Polish', nativeName: 'Polski', rtl: false, enabled: true },
      { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', rtl: false, enabled: true },
      { code: 'sv', name: 'Swedish', nativeName: 'Svenska', rtl: false, enabled: true },
    ];

    defaultLanguages.forEach(lang => {
      this.languages.set(lang.code, lang);
    });
  }

  registerTranslationProvider(name: string, provider: BaseTranslationProvider): void {
    this.translationProviders.set(name, provider);
  }

  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    const provider = this.translationProviders.get(this.defaultProvider);
    if (!provider) {
      // Fallback to simple detection
      return this.simpleLanguageDetection(text);
    }

    try {
      return await provider.detectLanguage(text);
    } catch (error) {
      console.warn('Language detection failed, using fallback:', error);
      return this.simpleLanguageDetection(text);
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const provider = this.translationProviders.get(this.defaultProvider);
    if (!provider) {
      throw new Error(`Translation provider ${this.defaultProvider} not available`);
    }

    return await provider.translate(request);
  }

  async translateToEnglish(text: string, sourceLang?: string): Promise<string> {
    if (!sourceLang) {
      const detection = await this.detectLanguage(text);
      sourceLang = detection.language;
    }

    if (sourceLang === 'en' || sourceLang === 'eng') {
      return text;
    }

    const result = await this.translate({
      text,
      sourceLang,
      targetLang: 'en',
    });

    return result.translatedText;
  }

  async translateFromEnglish(text: string, targetLang: string): Promise<string> {
    if (targetLang === 'en' || targetLang === 'eng') {
      return text;
    }

    const result = await this.translate({
      text,
      sourceLang: 'en',
      targetLang,
    });

    return result.translatedText;
  }

  getLanguage(code: string): LanguageConfig | undefined {
    return this.languages.get(code);
  }

  getEnabledLanguages(): LanguageConfig[] {
    return Array.from(this.languages.values()).filter(lang => lang.enabled);
  }

  getSupportedLanguages(): string[] {
    const provider = this.translationProviders.get(this.defaultProvider);
    if (provider) {
      return provider.getSupportedLanguages();
    }
    return Array.from(this.languages.keys());
  }

  isRTL(languageCode: string): boolean {
    const language = this.getLanguage(languageCode);
    return language?.rtl || false;
  }

  normalizeLanguageCode(code: string): string {
    // Normalize common language code variations
    const normalizations: Record<string, string> = {
      'zh-cn': 'zh',
      'zh-hans': 'zh',
      'zh-tw': 'zh-tw',
      'zh-hant': 'zh-tw',
      'pt-br': 'pt',
      'pt-pt': 'pt',
      'en-us': 'en',
      'en-gb': 'en',
      'es-es': 'es',
      'es-mx': 'es',
    };

    const normalized = normalizations[code.toLowerCase()] || code.toLowerCase();
    return normalized;
  }

  private simpleLanguageDetection(text: string): LanguageDetectionResult {
    // Simple language detection based on character patterns
    const patterns = {
      zh: /[\u4e00-\u9fff]/,
      ja: /[\u3040-\u309f\u30a0-\u30ff]/,
      ko: /[\uac00-\ud7af]/,
      ar: /[\u0600-\u06ff]/,
      ru: /[\u0400-\u04ff]/,
      th: /[\u0e00-\u0e7f]/,
      hi: /[\u0900-\u097f]/,
    };

    for (const [lang, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) {
        return {
          language: lang,
          confidence: 0.8,
          alternatives: [],
        };
      }
    }

    // Default to English if no pattern matches
    return {
      language: 'en',
      confidence: 0.6,
      alternatives: [],
    };
  }

  async getLocalizedSearchTerms(query: string, targetLanguages: string[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    
    // Detect source language
    const detection = await this.detectLanguage(query);
    const sourceLang = detection.language;

    // Translate to each target language
    for (const targetLang of targetLanguages) {
      if (targetLang === sourceLang) {
        results[targetLang] = query;
        continue;
      }

      try {
        const translation = await this.translate({
          text: query,
          sourceLang,
          targetLang,
          context: 'search query',
        });
        results[targetLang] = translation.translatedText;
      } catch (error) {
        console.warn(`Translation to ${targetLang} failed:`, error);
        results[targetLang] = query; // Fallback to original
      }
    }

    return results;
  }
}

 