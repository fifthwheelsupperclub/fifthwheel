import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";

// Native <dialog>: focus trap, Escape and focus return come from the browser.
// Title names the action and object ("Delete report?"); the confirm label repeats the verb ("Delete report").
export function ConfirmDialog({ open, title, children, confirmLabel, destructive, busy, onConfirm, onCancel }: Readonly<{
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirm-dialog-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="confirm-dialog-title">{title}</h2>
    <div className="confirm-dialog-body">{children}</div>
    <div className="confirm-dialog-actions">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
    </div>
  </dialog>;
}
