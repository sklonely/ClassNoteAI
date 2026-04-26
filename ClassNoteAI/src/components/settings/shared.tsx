import { ReactNode } from "react";
import s from "./shared.module.css";

interface CardProps {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  children: ReactNode;
}

/**
 * H18 Settings Card. Surface + header + body. icon 走 :global svg
 * 著色 (--h18-accent)，所以 caller 不用每個 panel 重設 className。
 */
export function Card({ title, subtitle, icon, children }: CardProps) {
  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <h3 className={s.cardTitle}>
          {icon}
          {title}
        </h3>
        {subtitle && <p className={s.cardSubtitle}>{subtitle}</p>}
      </div>
      <div className={s.cardBody}>{children}</div>
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
 * H18 segmented control · 2-3 互斥選項。selected segment 用 surface
 * 浮起，flat unselected。Token-driven dark/light。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className={s.segmented} role="radiogroup">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`${s.segmentedBtn} ${selected ? s.segmentedBtnSelected : ''}`}
          >
            {opt.icon}
            <span className={s.segmentedBtnLabel}>
              <span>{opt.label}</span>
              {opt.hint && <span className={s.segmentedBtnHint}>{opt.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
