'use client';

import { PRICE_TIERS, type PriceTier } from '@/types';

export type FilterValue = 'all' | PriceTier;

interface FilterBarProps {
  active: FilterValue;
  counts: Record<FilterValue, number>;
  onChange: (value: FilterValue) => void;
}

export default function FilterBar({ active, counts, onChange }: FilterBarProps) {
  return (
    <div className="w-full overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1.5 min-w-max pb-0.5">
        {/* All / Featured tab — styled with underline accent like reference */}
        <button
          onClick={() => onChange('all')}
          className={`relative flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
            ${active === 'all'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900'
            }`}
          aria-pressed={active === 'all'}
        >
          All Tickets
          {counts['all'] > 0 && (
            <span className={`text-xs font-medium tabular-nums ${active === 'all' ? 'text-slate-300' : 'text-slate-400'}`}>
              {counts['all']}
            </span>
          )}
          {active === 'all' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-400 rounded-full" />
          )}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-slate-200 mx-1 flex-shrink-0" />

        {/* Price tier pills */}
        {PRICE_TIERS.map((tier) => (
          <button
            key={tier}
            onClick={() => onChange(tier)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-full whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
              ${active === tier
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            aria-pressed={active === tier}
          >
            ${tier}
            {counts[tier] > 0 && (
              <span className={`text-xs tabular-nums ${active === tier ? 'text-slate-300' : 'text-slate-400'}`}>
                {counts[tier]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
