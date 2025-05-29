# Perplexica Copilot Mode

## Overview

Copilot mode is an advanced search feature in Perplexica that enhances the search experience by generating multiple intelligent queries, extracting content from web pages, and providing more comprehensive answers through advanced reasoning.

## Features

### 🔍 Multi-Query Generation
- Automatically generates multiple related search queries from a single user input
- Uses advanced language models to create diverse and comprehensive search terms
- Improves search coverage and result quality

### 🌐 Advanced Web Content Extraction
- Extracts full content from web pages, not just snippets
- Processes and analyzes complete articles and documents
- Provides deeper context for better answers

### 🧠 Enhanced Reasoning
- Synthesizes information from multiple sources
- Provides more detailed and nuanced responses
- Connects related concepts across different sources

### ⚡ Real-time Progress Tracking
- Shows current processing step (query generation, searching, processing, reasoning)
- Displays progress bar and detailed status information
- Transparent about the search and reasoning process

## How to Use

### Enabling Copilot Mode

1. **In Chat Interface**: Toggle the "Copilot" switch in the message input area
2. **In Empty Chat**: Use the Copilot toggle in the initial message input

### Configuration

Copilot mode can be configured through environment variables:

```bash
# Maximum number of queries to generate per search
COPILOT_MAX_QUERIES=3

# Maximum sources to retrieve per query
COPILOT_MAX_SOURCES_PER_QUERY=5

# Threshold for result reranking (0.0-1.0)
COPILOT_RERANK_THRESHOLD=0.7

# Enable full page content extraction
COPILOT_ENABLE_PAGE_EXTRACTION=true

# Enable advanced reasoning capabilities
COPILOT_ENABLE_ADVANCED_REASONING=true
```

## Technical Implementation

### Architecture

```
User Query → Copilot Search Agent → Multi-Query Generation → Parallel Search → Content Extraction → Reranking → Synthesis → Response
```

### Key Components

#### CopilotSearchAgent
- Main orchestrator for the Copilot search process
- Handles query generation, search execution, and result processing
- Located in `src/lib/search/copilotSearchAgent.ts`

#### Query Generation
- Uses advanced prompts to generate diverse search queries
- Considers conversation history for context
- Generates 1-5 queries depending on complexity

#### Content Extraction
- Fetches full page content from search results
- Processes HTML and extracts meaningful text
- Handles various content types and formats

#### Result Reranking
- Uses embedding similarity to rank results
- Filters out low-quality or irrelevant content
- Ensures the most relevant information is prioritized

### API Integration

The Copilot mode integrates with the existing chat API:

```typescript
// Request body includes copilotEnabled flag
{
  message: "Your question",
  copilotEnabled: true,
  // ... other parameters
}
```

## Performance Considerations

### Resource Usage
- Copilot mode uses more computational resources than standard search
- Generates multiple API calls to search engines and language models
- May take longer to complete than standard searches

### Optimization
- Results are cached to improve performance
- Parallel processing for multiple queries
- Configurable limits to control resource usage

## Best Practices

### When to Use Copilot Mode
- ✅ Complex research questions requiring comprehensive answers
- ✅ Topics that benefit from multiple perspectives
- ✅ When you need detailed, well-sourced information
- ✅ Academic or professional research

### When to Use Standard Mode
- ✅ Simple factual queries
- ✅ Quick lookups
- ✅ When speed is more important than comprehensiveness
- ✅ Resource-constrained environments

## Troubleshooting

### Common Issues

#### Copilot Mode Not Working
1. Check that the feature is enabled in configuration
2. Verify API keys for language models are properly set
3. Ensure sufficient rate limits for API calls

#### Slow Performance
1. Reduce `COPILOT_MAX_QUERIES` value
2. Lower `COPILOT_MAX_SOURCES_PER_QUERY`
3. Disable page extraction if not needed

#### Poor Results Quality
1. Increase `COPILOT_RERANK_THRESHOLD`
2. Enable advanced reasoning
3. Check language model configuration

### Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Copilot mode unavailable" | Feature not configured | Check environment variables |
| "Query generation failed" | LLM API issues | Verify API keys and rate limits |
| "Search timeout" | Network issues | Check internet connection |

## Development

### Adding New Features

To extend Copilot functionality:

1. Modify `CopilotSearchAgent` class
2. Update configuration options
3. Add corresponding UI components
4. Write tests for new functionality

### Testing

Run Copilot-specific tests:

```bash
npm test -- --testPathPattern=copilot
```

### Contributing

When contributing to Copilot features:

1. Follow existing code patterns
2. Add comprehensive tests
3. Update documentation
4. Consider performance implications

## Future Enhancements

### Planned Features
- [ ] Custom query templates
- [ ] Source preference settings
- [ ] Result export functionality
- [ ] Integration with external knowledge bases
- [ ] Multi-language support improvements

### Research Areas
- Advanced reasoning techniques
- Better content extraction methods
- Improved query generation strategies
- Performance optimization

## Support

For issues related to Copilot mode:

1. Check this documentation first
2. Review the troubleshooting section
3. Open an issue on GitHub with detailed information
4. Include configuration and error logs

---

*Last updated: [Current Date]*
*Version: 1.0.0* 