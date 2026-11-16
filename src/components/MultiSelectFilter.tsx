import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  color?: string;
}

interface MultiSelectFilterProps {
  label?: string;
  allLabel: string;
  pluralUnit: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (nextValues: string[]) => void;
  compact?: boolean;
  ariaLabel?: string;
}

export function MultiSelectFilter({
  label,
  allLabel,
  pluralUnit,
  options,
  selectedValues,
  onChange,
  compact = false,
  ariaLabel,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggleValue = (val: string) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  let buttonText = allLabel;
  if (selectedValues.length === 1) {
    const match = options.find((o) => o.value === selectedValues[0]);
    buttonText = match ? match.label : `1 vald`;
  } else if (selectedValues.length > 1) {
    buttonText = `${selectedValues.length} ${pluralUnit}`;
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel || label || allLabel}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 rounded-lg border text-left transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-700 ${
          compact ? 'h-9 px-2.5 text-xs' : 'h-10 px-3 text-sm'
        } ${
          selectedValues.length > 0
            ? 'border-teal-600 bg-teal-50/50 text-slate-900 font-medium'
            : 'border-slate-300 bg-white text-slate-700 font-medium'
        }`}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 mt-1.5 z-40 min-w-[230px] max-w-[300px] w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500">
              {selectedValues.length === 0
                ? 'Alla valda'
                : `${selectedValues.length} av ${options.length} valda`}
            </span>
            {selectedValues.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
              >
                Visa alla
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
            {options.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-slate-500 text-center">
                Inga alternativ tillgängliga
              </p>
            ) : (
              options.map((opt) => {
                const checked = selectedValues.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleValue(opt.value)}
                    className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                      checked
                        ? 'bg-teal-50 text-slate-900'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
                        checked
                          ? 'bg-teal-700 border-teal-700 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 stroke-[2.5]" />}
                    </span>
                    {opt.color && (
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: opt.color }}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{opt.label}</p>
                      {opt.sublabel && (
                        <p className="text-[11px] text-slate-400 truncate">{opt.sublabel}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
