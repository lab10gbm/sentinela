
import React, { useState } from 'react';
import { Tag, Plus, X } from 'lucide-react';

interface KeywordManagerProps {
  keywords: string[];
  onAddKeyword: (keyword: string) => void;
  onRemoveKeyword: (keyword: string) => void;
  disabled?: boolean;
  placeholder?: string;
  colorTheme?: 'fire' | 'blue';
}

const KeywordManager: React.FC<KeywordManagerProps> = ({ 
  keywords, 
  onAddKeyword, 
  onRemoveKeyword,
  disabled = false,
  placeholder = "Ex: Termo",
  colorTheme = 'fire'
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  const add = () => {
    const val = inputValue.trim();
    if (val && !keywords.includes(val)) {
      onAddKeyword(val);
      setInputValue('');
    }
  };

  const bgLight = colorTheme === 'fire' ? 'bg-fire-100' : 'bg-blue-100';
  const textDark = colorTheme === 'fire' ? 'text-fire-800' : 'text-blue-800';
  const borderLight = colorTheme === 'fire' ? 'border-fire-200' : 'border-blue-200';
  const iconColor = colorTheme === 'fire' ? 'text-fire-600' : 'text-blue-600';
  const focusRing = colorTheme === 'fire' ? 'focus:ring-fire-500' : 'focus:ring-blue-500';
  const focusBorder = colorTheme === 'fire' ? 'focus:border-fire-500' : 'focus:border-blue-500';

  return (
    <div className="w-full">
      <div className="flex gap-2 mb-3">
        <div className="relative flex-grow">
          <input
            type="text"
            className={`block w-full px-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-400 focus:outline-none ${focusBorder} focus:ring-1 ${focusRing} sm:text-xs disabled:bg-gray-100`}
            placeholder={placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          />
        </div>
        <button
          onClick={add}
          disabled={disabled || !inputValue.trim()}
          className="bg-gray-800 text-white px-3 py-2 rounded-md hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 min-h-[20px]">
        {keywords.map((keyword) => (
          <span 
            key={keyword} 
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bgLight} ${textDark} border ${borderLight}`}
          >
            {keyword}
            {!disabled && (
              <button
                type="button"
                className={`flex-shrink-0 ml-1.5 h-3.5 w-3.5 rounded-full inline-flex items-center justify-center ${iconColor} hover:bg-white focus:outline-none`}
                onClick={() => onRemoveKeyword(keyword)}
              >
                <span className="sr-only">Remover {keyword}</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
};

export default KeywordManager;
