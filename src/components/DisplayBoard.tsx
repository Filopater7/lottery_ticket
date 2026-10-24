'use client';

import { useState, useMemo, useCallback } from 'react';
import type { LotteryItem } from '@/types';
import { PRICE_TIERS } from '@/types';
import TicketCard from './TicketCard';
import SearchBar from './SearchBar';
import FilterBar, { type FilterValue } from './FilterBar';

interface DisplayBoardProps {
  initialItems: LotteryItem[];
}

export default function DisplayBoard({ initialItems }: DisplayBoardProps) {
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');

  // Count items per price tier (across all items, ignoring search)
  const counts = useMemo(() => {
    const result: Record<FilterValue, number> = { all: initialItems.length } as Record<FilterValue, number>;
    for (const tier of PRICE_TIERS) {
      result[tier] = initialItems.filter((item) => item.price === tier).length;
    }
    return result;
  }, [initialItems]);

  const filtered = useMemo(() => {
    let list = initialItems;

    // Price filter
    if (filter !== 'all') {
      list = list.filter((item) => item.price === filter);
    }

    // Text search
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.number.toString().includes(q) ||
          item.title.toLowerCase().includes(q)
      );
    }

    return list;
  }, [initialItems, filter, query]);

  const handleSearch = useCallback((q: string) => setQuery(q), []);
  const handleFilter = useCallback((v: FilterValue) => {
    setFilter(v);
    setQuery(''); // clear search when switching category
  }, []);

  if (initialItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-600">No tickets available</p>
        <p className="text-xs text-slate-400 mt-1">Check back soon or contact the administrator.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <FilterBar active={filter} counts={counts} onChange={handleFilter} />

      {/* Search + result count */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <SearchBar onSearch={handleSearch} />
        {(query || filter !== 'all') && (
          <p className="text-xs text-slate-500 tabular-nums">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            {filter !== 'all' && <span className="text-slate-400"> in ${filter}</span>}
          </p>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-slate-500">
            {query ? `No results for "${query}"` : `No $${filter} tickets available`}
          </p>
          <p className="text-xs text-slate-400 mt-1">Try a different filter or search term.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
          {filtered.map((item) => (
            <TicketCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
