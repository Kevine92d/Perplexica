import { NextRequest, NextResponse } from 'next/server';
import { searchResultCache, documentCache } from '@/lib/cache/searchCache';
import { globalProcessor } from '@/lib/performance/parallelProcessor';
import { globalDeduplicator } from '@/lib/performance/requestDeduplicator';
import { globalTimeoutManager } from '@/lib/performance/smartTimeout';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const component = searchParams.get('component');

    switch (component) {
      case 'cache':
        return NextResponse.json({
          searchCache: searchResultCache.getStats(),
          documentCache: documentCache.getStats(),
        });

      case 'parallel':
        return NextResponse.json({
          parallel: globalProcessor.getStats(),
        });

      case 'deduplicator':
        return NextResponse.json({
          deduplicator: globalDeduplicator.getStats(),
        });

      case 'timeout':
        return NextResponse.json({
          timeout: globalTimeoutManager.getStats(),
        });

      case 'all':
      default:
        return NextResponse.json({
          cache: {
            searchCache: searchResultCache.getStats(),
            documentCache: documentCache.getStats(),
          },
          parallel: globalProcessor.getStats(),
          deduplicator: globalDeduplicator.getStats(),
          timeout: globalTimeoutManager.getStats(),
          timestamp: new Date().toISOString(),
        });
    }
  } catch (error) {
    console.error('Performance stats error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve performance stats' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, component } = await request.json();

    switch (action) {
      case 'clear':
        switch (component) {
          case 'cache':
            searchResultCache.clear();
            documentCache.clear();
            break;
          case 'parallel':
            globalProcessor.clear();
            break;
          case 'deduplicator':
            globalDeduplicator.clear();
            break;
          case 'timeout':
            globalTimeoutManager.clearMetrics();
            break;
          case 'all':
            searchResultCache.clear();
            documentCache.clear();
            globalProcessor.clear();
            globalDeduplicator.clear();
            globalTimeoutManager.clearMetrics();
            break;
          default:
            return NextResponse.json(
              { error: 'Invalid component' },
              { status: 400 }
            );
        }
        
        return NextResponse.json({ 
          success: true, 
          message: `${component} cleared successfully` 
        });

      case 'cleanup':
        if (component === 'cache' || component === 'all') {
          const searchCleaned = searchResultCache.cleanup();
          const docCleaned = documentCache.cleanup();
          
          return NextResponse.json({
            success: true,
            message: `Cleaned up ${searchCleaned + docCleaned} expired cache entries`
          });
        }
        break;

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Performance action error:', error);
    return NextResponse.json(
      { error: 'Failed to execute performance action' },
      { status: 500 }
    );
  }
} 