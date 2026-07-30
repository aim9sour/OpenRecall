import { useEffect, useId, useRef } from "react";

export interface ErrorSummaryItem {
  readonly id: string;
  readonly message: string;
  readonly targetId?: string;
}

export function ErrorSummary({
  errors,
  focus,
  title,
}: {
  readonly errors: readonly ErrorSummaryItem[];
  readonly focus: boolean;
  readonly title: string;
}) {
  const headingId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus && errors.length > 0) summaryRef.current?.focus();
  }, [errors, focus]);

  if (errors.length === 0) return null;
  return (
    <div
      ref={summaryRef}
      className="error-summary"
      role="alert"
      tabIndex={-1}
      aria-labelledby={headingId}
    >
      <h3 id={headingId}>{title}</h3>
      <ul>
        {errors.map((error) => (
          <li key={error.id}>
            {error.targetId === undefined ? (
              error.message
            ) : (
              <a
                href={`#${error.targetId}`}
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(error.targetId!)?.focus();
                }}
              >
                {error.message}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
