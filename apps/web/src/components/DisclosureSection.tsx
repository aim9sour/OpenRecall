import { useId, useState, type ReactNode } from "react";

export function DisclosureSection({
  children,
  defaultExpanded = false,
  heading,
  className = "panel",
}: {
  readonly children: ReactNode;
  readonly defaultExpanded?: boolean;
  readonly heading: string;
  readonly className?: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [opened, setOpened] = useState(defaultExpanded);
  return (
    <section className={className}>
      <h2>
        <button
          aria-controls={id}
          aria-expanded={expanded}
          className="disclosure-toggle"
          onClick={() => {
            setExpanded((current) => !current);
            setOpened(true);
          }}
          type="button"
        >
          {heading}
        </button>
      </h2>
      {opened && <div hidden={!expanded} id={id}>{children}</div>}
    </section>
  );
}
