import { useQuery } from '@tanstack/react-query';
import { History, Sparkles } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { formatCurrency } from '../utils/format.js';

export default function NameCombobox({
  value,
  onChange,
  onSelectSuggestion,
  categoryId,
  disabled = false,
  placeholder = 'Ex: Continente, Restaurante...'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [debouncedQuery, setDebouncedQuery] = useState(value || '');
  const containerRef = useRef(null);

  // Debounce input by ~150ms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(value || '');
    }, 150);
    return () => clearTimeout(handler);
  }, [value]);

  // Fetch suggestions with TanStack Query keyed by (categoryId, debouncedQuery)
  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ['suggestions', categoryId, debouncedQuery],
    queryFn: () => (categoryId ? api.getNameSuggestions(categoryId, debouncedQuery) : []),
    enabled: Boolean(categoryId) && !disabled,
    staleTime: 1000 * 60 // 1 minute
  });

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(suggestion) {
    onChange(suggestion.name);
    if (onSelectSuggestion) {
      onSelectSuggestion(suggestion);
    }
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e) {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        setIsOpen(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        disabled={disabled}
        placeholder={
          disabled
            ? 'Selecione uma categoria primeiro...'
            : placeholder
        }
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => {
          if (!disabled && categoryId) {
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        className={`w-full text-sm bg-white border rounded-xl px-3 py-2 text-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 ${
          disabled
            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
            : 'border-slate-200 hover:border-slate-300'
        }`}
      />

      {/* Dropdown Menu */}
      {isOpen && !disabled && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden max-h-60 overflow-y-auto animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              Sugestões nesta categoria
            </span>
            {isFetching && <span className="text-[10px] text-slate-400 animate-pulse">A atualizar...</span>}
          </div>

          <div className="py-1">
            {suggestions.map((suggestion, idx) => {
              const isHighlighted = idx === highlightedIndex;
              const isColdStart = suggestion.uses === 0;

              return (
                <button
                  key={`${suggestion.name}-${idx}`}
                  type="button"
                  onClick={() => handleSelect(suggestion)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors ${
                    isHighlighted ? 'bg-emerald-50 text-emerald-950 font-medium' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate mr-2 font-medium">{suggestion.name}</span>

                  <div className="flex items-center gap-2 shrink-0">
                    {suggestion.last_amount_cents > 0 && (
                      <span className="font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                        {formatCurrency(suggestion.last_amount_cents)}
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        isColdStart
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {isColdStart ? 'Recorrente' : `${suggestion.uses}x`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
