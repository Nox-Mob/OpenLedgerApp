// A small disclosure dropdown: a button that opens a panel of links/buttons.
// Closes on Escape (focus returns to the button), outside click, or `close()`.
// Keyboard users Tab through the items. SSR-safe: listeners attach in effects.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Dropdown({
  label,
  trigger,
  triggerClassName = "",
  panelClassName = "",
  align = "start",
  onOpenChange,
  children,
}: {
  /** Accessible name for the trigger when its content isn't descriptive. */
  label?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  align?: "start" | "end";
  /** Called when the panel opens or closes (e.g. to load what it shows). */
  onOpenChange?: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    changed.current?.(open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={id}
          className={`absolute top-full z-40 mt-1.5 min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg ${
            align === "end" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export const itemClass =
  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent";
