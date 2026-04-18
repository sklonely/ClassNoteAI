import { ReactNode } from "react";

interface CardProps {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
}

/**
 * Rounded section used across all Settings tabs. Keeps the visual
 * language consistent (same border/shadow/header) so the tabs feel
 * part of one page even though they're separate component files.
 */
export function Card({ title, subtitle, icon, children }: CardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-900/50">
        <h3 className="text-lg font-medium flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {subtitle}
          </p>
        )}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}

/**
 * iOS-style segmented control for 2–3 mutually exclusive options.
 * The selected segment takes a solid background; unselected segments are
 * flat. Use this when the choice drives a swap in the UI below it.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div
      className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-slate-900 p-1 gap-1 w-full max-w-lg"
      role="radiogroup"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
              selected
                ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm font-medium"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            {opt.icon}
            <span className="flex flex-col items-start leading-tight">
              <span>{opt.label}</span>
              {opt.hint && (
                <span
                  className={`text-[10px] ${
                    selected
                      ? "text-gray-500 dark:text-gray-400"
                      : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {opt.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
