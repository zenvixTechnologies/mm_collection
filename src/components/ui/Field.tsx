import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, name, className, optional, ...props },
  ref,
) {
  const fieldId = id ?? name;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="field-label">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : <span className="text-accent" aria-hidden> *</span>}
      </label>
      <input
        ref={ref}
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn("field-input")}
        {...props}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
