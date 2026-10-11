import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { avatarColor, describeError, initials } from "../lib/ui";

// ---- Avatar -------------------------------------------------------------

export function Avatar({
  name,
  size = "md",
  title,
}: {
  name: string;
  size?: "sm" | "md";
  title?: string;
}) {
  return (
    <span
      className={`avatar${size === "sm" ? " avatar-sm" : ""}`}
      style={{ background: avatarColor(name) }}
      title={title ?? name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}

// ---- Badge --------------------------------------------------------------

export function Badge({
  color,
  children,
  soft,
}: {
  color: string;
  children: ReactNode;
  soft?: boolean;
}) {
  return (
    <span
      className="badge"
      style={
        soft
          ? { background: `color-mix(in srgb, ${color} 14%, transparent)`, color }
          : { background: color, color: "#fff" }
      }
    >
      {!soft && <i className="dot" style={{ background: "#fff" }} />}
      {children}
    </span>
  );
}

// ---- Progress -----------------------------------------------------------

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-fill" style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

// ---- Modal --------------------------------------------------------------

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay center" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {subtitle ? <div className="muted" style={{ marginBottom: 16 }}>{subtitle}</div> : null}
        {children}
        {footer ? <div className="row" style={{ marginTop: 20, justifyContent: "flex-end" }}>{footer}</div> : null}
      </div>
    </div>
  );
}

// ---- Drawer -------------------------------------------------------------

export function Drawer({
  title,
  onClose,
  children,
  header,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  header?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <aside
        className="drawer"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="drawer-head">
          <h2>{title}</h2>
          {header}
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

// ---- Confirm dialog -----------------------------------------------------

export function ConfirmButton({
  label,
  confirmLabel = "确认",
  className = "btn btn-sm",
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  className?: string;
  onConfirm: () => unknown;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = async () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <button className={className} onClick={run} disabled={busy}>
      {busy ? "处理中…" : armed ? confirmLabel : label}
    </button>
  );
}

// ---- Toast --------------------------------------------------------------

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const node = message ? <div className="toast">{message}</div> : null;
  return { push, node };
}

// ---- Error boundary helper for async handlers ---------------------------

export function useAsync() {
  const [error, setError] = useState<string | null>(null);

  const wrap = useCallback(
    async (fn: () => Promise<unknown>, onError?: (e: unknown) => void) => {
      setError(null);
      try {
        await fn();
      } catch (err) {
        if (onError) onError(err);
        else setError(describeError(err));
      }
    },
    [],
  );

  return { error, setError, wrap };
}

// ---- Empty state --------------------------------------------------------

export function EmptyState({
  emoji = "🗂️",
  title,
  hint,
  action,
}: {
  emoji?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="emoji">{emoji}</span>
      <div style={{ fontWeight: 600, color: "var(--text-dim)" }}>{title}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: 13 }}>{hint}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}
