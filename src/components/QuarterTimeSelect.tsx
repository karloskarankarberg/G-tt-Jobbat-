import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface QuarterTimeSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

export function QuarterTimeSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Välj tid',
  ariaLabel,
}: QuarterTimeSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allOptions = useMemo(() => {
    if (value && !options.includes(value)) {
      return [value, ...options];
    }
    return options;
  }, [value, options]);

  useEffect(() => {
    if (!open) return;

    const handleOutside = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const targetVal = value || '08:00';
    const targetEl = listRef.current.querySelector<HTMLElement>(
      `[data-time-option="${CSS.escape(targetVal)}"]`
    );
    if (targetEl) {
      const list = listRef.current;
      list.scrollTop = Math.max(
        0,
        targetEl.offsetTop - list.clientHeight / 2 + targetEl.offsetHeight / 2
      );
    }
  }, [open, value]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm font-mono tabular-nums flex items-center justify-between gap-2 text-left disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-700"
      >
        <span className={value ? 'text-slate-900' : 'text-slate-500'}>
          {value || placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && !disabled && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === ''}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
              value === ''
                ? 'bg-teal-50 text-teal-800 font-semibold'
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {placeholder}
          </button>

          {allOptions.map((t) => {
            const isWholeHour = t.endsWith(':00');
            const isSelected = value === t;
            return (
              <button
                key={t}
                type="button"
                role="option"
                data-time-option={t}
                aria-selected={isSelected}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className={`w-full text-left font-mono tabular-nums transition-colors cursor-pointer ${
                  isWholeHour
                    ? 'px-3 py-1.5 text-sm font-semibold'
                    : 'pl-6 pr-3 py-0.5 text-[11px] font-normal'
                } ${
                  isSelected
                    ? 'bg-teal-50 text-teal-800'
                    : isWholeHour
                      ? 'text-slate-900 hover:bg-slate-100'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
