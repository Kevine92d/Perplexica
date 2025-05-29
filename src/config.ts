export interface Config {
  // ... existing code ...
  
  // Copilot Configuration
  COPILOT: {
    MAX_QUERIES: number;
    MAX_SOURCES_PER_QUERY: number;
    RERANK_THRESHOLD: number;
    ENABLE_PAGE_EXTRACTION: boolean;
    ENABLE_ADVANCED_REASONING: boolean;
  };
}

// ... existing code ...

const config: Config = {
  // ... existing code ...
  
  COPILOT: {
    MAX_QUERIES: parseInt(process.env.COPILOT_MAX_QUERIES || '3'),
    MAX_SOURCES_PER_QUERY: parseInt(process.env.COPILOT_MAX_SOURCES_PER_QUERY || '5'),
    RERANK_THRESHOLD: parseFloat(process.env.COPILOT_RERANK_THRESHOLD || '0.7'),
    ENABLE_PAGE_EXTRACTION: process.env.COPILOT_ENABLE_PAGE_EXTRACTION === 'true',
    ENABLE_ADVANCED_REASONING: process.env.COPILOT_ENABLE_ADVANCED_REASONING === 'true',
  },
};

// ... existing code ... 