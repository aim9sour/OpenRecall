import { useState, type ReactNode } from "react";

export function DisclosurePanel({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const buttonId = `${id}-button`;

  return (
    <section className="section-disclosure">
      <h2>
        <button
          id={buttonId}
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            const nextExpanded = !expanded;
            setExpanded(nextExpanded);
            if (nextExpanded) setOpened(true);
          }}
        >
          {label}
        </button>
      </h2>
      <div
        id={id}
        role="region"
        aria-labelledby={buttonId}
        hidden={!expanded}
        className="section-disclosure-panel"
      >
        {opened ? children : null}
      </div>
    </section>
  );
}
