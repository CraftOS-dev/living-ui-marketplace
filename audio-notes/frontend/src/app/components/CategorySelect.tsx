import { useState, useRef, useEffect } from 'react';
import { Tag, Check, ChevronDown } from 'lucide-react';

export const CATEGORY_OPTIONS = [
  'Meeting',
  'Interview',
  'Lecture',
  'Voice Memo',
  'Brainstorm',
  'Personal',
  'General',
];

interface CategorySelectProps {
  value: string;
  onChange: (newCategory: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function CategorySelect({
  value,
  onChange,
  className = '',
  size = 'md',
}: CategorySelectProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const currentCategory = value || 'General';

  return (
    <div ref={dropdownRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 rounded-md border border-[var(--lui-border)]/80 bg-[var(--lui-surface)] hover:bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] font-medium transition-colors ${
          size === 'sm'
            ? 'px-2 py-0.5 text-[11px]'
            : 'px-2.5 py-1 text-xs'
        }`}
        title="Change category"
      >
        <Tag size={size === 'sm' ? 11 : 12} className="opacity-70 text-[var(--lui-muted)]" />
        <span>{currentCategory}</span>
        <ChevronDown size={size === 'sm' ? 11 : 12} className="opacity-60" />
      </button>

      {/* Dropdown Menu Popup - theme-native */}
      {isOpen && (
        <div className="absolute left-0 mt-1 w-40 rounded-lg doc-box p-1 z-50 shadow-lg flex flex-col gap-0.5">
          {CATEGORY_OPTIONS.map((cat) => {
            const isSelected = cat.toLowerCase() === currentCategory.toLowerCase();
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  onChange(cat);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-[#FF4F18] text-white font-semibold shadow-xs'
                    : 'text-[var(--lui-foreground)] hover:bg-[#FF4F18]/10 hover:text-[#FF4F18]'
                }`}
              >
                <span>{cat}</span>
                {isSelected && <Check size={12} className="text-white shrink-0 ml-1.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
