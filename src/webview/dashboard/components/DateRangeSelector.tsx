import React from 'react';

interface DateRangeSelectorProps {
  selected: number;
  onSelect: (days: number) => void;
}

const TABS: { label: string; days: number }[] = [
  { label: '24h', days: 1 },
  { label: '3d', days: 3 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
];

export function DateRangeSelector({ selected, onSelect }: DateRangeSelectorProps): React.ReactElement {
  return (
    <div className="date-range-strip" role="tablist" aria-label="Date range">
      {TABS.map(({ label, days }) => (
        <button
          key={days}
          className={`date-range-tab${selected === days ? ' active' : ''}`}
          role="tab"
          aria-selected={selected === days}
          onClick={() => onSelect(days)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
