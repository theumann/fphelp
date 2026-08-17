import type { ComponentProps, ReactNode } from 'react'

/**
 * The shared visual vocabulary.
 *
 * Deliberately small and unclever: these are the four or five shapes the app actually
 * repeats — a panel, a labelled field, a button, a status message — extracted so the
 * pages stop re-declaring `rounded-lg border border-neutral-300 … dark:border-neutral-700`
 * and drifting apart. Colours come from the tokens in `globals.css`, never from raw
 * palette classes, so dark mode is defined in one place.
 *
 * No `'use client'`: everything here is presentational, so it stays usable from Server
 * Components as well as client ones.
 */

/** Page shell. Max width is the phone-first column every page already used. */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto flex w-full max-w-xl flex-col gap-5 p-4 pb-16 sm:p-6 ${className}`}>
      {children}
    </div>
  )
}

/** The page's own heading block: what this screen is, and what it is about. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
    </header>
  )
}

interface CardProps {
  title?: string
  /** One line under the title explaining why this section exists, not what it does. */
  hint?: ReactNode
  /** Rendered on the title row, right-aligned — a running total, a count, a toggle. */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

export function Card({ title, hint, aside, children, className = '' }: CardProps) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}
    >
      {title && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {hint && <p className="text-sm text-muted">{hint}</p>}
          </div>
          {aside && <div className="shrink-0 text-sm text-muted">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Input styling as a constant, for the cases that need a bare `<input>` or a `<select>`. */
export const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-base text-foreground placeholder:text-faint focus-visible:outline-ring disabled:opacity-50'

interface FieldProps {
  label: string
  /** Sub-label under the control. Explanation, not error text. */
  hint?: ReactNode
  /** A unit rendered inside the right edge of the input, e.g. `%`. */
  suffix?: string
  children: ReactNode
}

export function Field({ label, hint, suffix, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="relative">
        {children}
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
            {suffix}
          </span>
        )}
      </div>
      {hint && <span className="text-xs leading-relaxed text-muted">{hint}</span>}
    </label>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-foreground hover:opacity-90',
  secondary: 'border border-line-strong bg-surface hover:bg-surface-muted',
  ghost: 'text-muted hover:bg-surface-muted hover:text-foreground',
  danger: 'text-danger hover:bg-danger-surface',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  const sizing = size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2.5 text-sm'
  // The pointer cursor is restored globally in globals.css, since hand-rolled buttons need
  // it too. Only the disabled case is the primitive's business.
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg font-medium transition-opacity transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${sizing} ${className}`}
    />
  )
}

type Tone = 'info' | 'success' | 'warning' | 'danger'

const TONES: Record<Tone, string> = {
  info: 'bg-surface-muted text-foreground',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-warning',
  danger: 'bg-danger-surface text-danger',
}

export function Alert({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-lg p-3 text-sm leading-relaxed ${TONES[tone]} ${className}`}
    >
      {children}
    </div>
  )
}

/** A labelled figure in a summary block: `Pot … $1,800.00`. */
export function SummaryRow({
  label,
  value,
  emphasis = false,
  tone,
}: {
  label: ReactNode
  value: ReactNode
  emphasis?: boolean
  tone?: 'danger'
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        emphasis ? 'mt-1 border-t border-line pt-2 font-medium' : 'text-muted'
      }`}
    >
      <dt className="text-sm">{label}</dt>
      <dd className={`text-sm tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  )
}
