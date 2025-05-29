import { Brain, Lightbulb, Search, Zap } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CopilotStatusProps {
  isActive: boolean;
  currentStep?: string;
  progress?: number;
  queries?: string[];
  sources?: number;
}

const CopilotStatus = ({
  isActive,
  currentStep = '',
  progress = 0,
  queries = [],
  sources = 0,
}: CopilotStatusProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isActive) return null;

  const getStepIcon = (step: string) => {
    switch (step) {
      case 'generating_queries':
        return <Lightbulb size={16} className="text-yellow-500" />;
      case 'searching':
        return <Search size={16} className="text-blue-500" />;
      case 'processing':
        return <Brain size={16} className="text-purple-500" />;
      case 'reasoning':
        return <Zap size={16} className="text-green-500" />;
      default:
        return <Brain size={16} className="text-gray-500" />;
    }
  };

  const getStepLabel = (step: string) => {
    switch (step) {
      case 'generating_queries':
        return 'Generating search queries...';
      case 'searching':
        return 'Searching multiple sources...';
      case 'processing':
        return 'Processing results...';
      case 'reasoning':
        return 'Reasoning and synthesizing...';
      default:
        return 'Thinking...';
    }
  };

  return (
    <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            {getStepIcon(currentStep)}
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Copilot Active
            </span>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400">
            {getStepLabel(currentStep)}
          </div>
        </div>
        
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {isExpanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {/* Progress bar */}
      <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-4 space-y-3">
          {queries.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Generated Queries:
              </h4>
              <ul className="space-y-1">
                {queries.map((query, index) => (
                  <li
                    key={index}
                    className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 rounded px-2 py-1"
                  >
                    {query}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {sources > 0 && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Found {sources} relevant sources
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CopilotStatus; 