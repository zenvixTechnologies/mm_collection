"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Admin form controls built on the storefront's .field-label / .field-input styles,
 * in the compact .field-sm size.
 */

interface WrapProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  /** Element shown at the right of the label row (e.g. character count). */
  aside?: ReactNode;
}

function FieldWrap({ id, label, hint, error, required, className, aside, children }: WrapProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="field-label">
          {label}
          {required && (
            <span className="text-accent" aria-hidden>
              {" "}
              *
            </span>
          )}
        </label>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = WrapProps & Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { prefix?: string; inputClassName?: string };

export function TextField({ label, hint, error, required, className, aside, prefix, inputClassName, id: givenId, ...props }: InputProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} required={required} className={className} aside={aside}>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-muted">{prefix}</span>}
        <input
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn("field-input field-sm", prefix && "pl-8", inputClassName)}
          {...props}
        />
      </div>
    </FieldWrap>
  );
}

type AreaProps = WrapProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">;

export function TextAreaField({ label, hint, error, required, className, aside, id: givenId, rows = 3, ...props }: AreaProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} required={required} className={className} aside={aside}>
      <textarea
        id={id}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        className="field-input h-auto min-h-20 rounded-[0.625rem] px-3.5 py-2.5 text-sm leading-6"
        {...props}
      />
    </FieldWrap>
  );
}

type SelectProps = WrapProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & { options: { value: string; label: string }[] };

export function SelectField({ label, hint, error, required, className, aside, options, id: givenId, ...props }: SelectProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} required={required} className={className} aside={aside}>
      <select id={id} required={required} aria-invalid={error ? true : undefined} className="field-input field-sm" {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

/** Accessible on/off switch (role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  description,
  hideLabel,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-line",
      )}
    >
      <span
        className={cn("inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")}
        aria-hidden
      />
    </button>
  );
  if (hideLabel) return <span className={className}>{control}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {control}
    </div>
  );
}

/** Section inside a long form: small heading + grid of fields. */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0 border-t border-line pt-5 first:border-t-0 first:pt-0", className)}>
      <legend className="sr-only">{title}</legend>
      <p className="text-sm font-semibold text-ink" aria-hidden>
        {title}
      </p>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
