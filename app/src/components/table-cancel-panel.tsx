import { useRef, useState } from "react";
import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";

type Summary = Readonly<{ cancelledSeats: number; closedRequests: number; closedInvitations: number; refundObligations: number; refundTotalCents: number }>;
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** Admin-only full Table cancellation. The operation ID is fixed per dialog so a retry can never cancel or refund twice. */
export function TableCancelPanel({ tableId }: Readonly<{ tableId: string }>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const operationId = useRef<string>("");

  function start() { operationId.current = crypto.randomUUID(); setReason(""); setState("idle"); setMessage(""); setOpen(true); }
  async function confirm() {
    setState("working"); setMessage("");
    try {
      const response = await fetch(`/api/admin/tables/${encodeURIComponent(tableId)}/cancel`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: operationId.current, reason: reason.trim() }) });
      const body = await response.json().catch(() => null) as { ok?: boolean; data?: Summary; error?: { safeMessage?: string } } | null;
      if (response.ok && body?.ok && body.data) { setSummary(body.data); setState("done"); return; }
      setMessage(body?.error?.safeMessage ?? "We couldn’t cancel the table. Try again in a moment."); setState("error");
    } catch { setMessage("We’re not sure that worked. Try again. It’s safe and won’t cancel twice."); setState("error"); }
  }

  return <section className="supply-danger-zone" aria-labelledby="table-cancel-title">
    <h2 className="danger-zone-title">Danger zone</h2>
    <div className="supply-review-actions">
      <p id="table-cancel-title"><TriangleAlert aria-hidden="true" /> <strong>Cancel this table.</strong> Ends requests and invitations, cancels every paid seat and owes each guest a refund.</p>
      <div><button className="button button-danger" type="button" onClick={start}>Cancel table…</button></div>
    </div>
    {open && <div className="supply-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && state !== "working") setOpen(false); }}>
      <section className="supply-modal supply-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="table-cancel-dialog-title">
        <span className="supply-modal-icon"><CircleAlert aria-hidden="true" /></span>
                {state === "done" && summary ? <>
          <h2 id="table-cancel-dialog-title">Table cancelled</h2>
          <p>{summary.refundObligations === 0 ? `${summary.cancelledSeats} seats cancelled. No refunds to send.` : `${summary.cancelledSeats} seat${summary.cancelledSeats === 1 ? "" : "s"} cancelled, ${usd(summary.refundTotalCents)} in refunds to send.`}</p>
          <div className="supply-modal-actions"><a className="button button-primary" href="/admin/refunds">Go to Refunds</a><button className="button button-outline" type="button" onClick={() => setOpen(false)}>Close</button></div>
        </> : <>
          <h2 id="table-cancel-dialog-title">Cancel this table?</h2>
          <p>This can’t be undone. Seat requests and invitations end. Every paid seat is cancelled. Each guest is owed a full refund, which you send from Refunds. Paid guests get an email.</p>
          <label className="supply-field"><span>Reason (only staff see this)</span>
            <textarea value={reason} maxLength={500} rows={3} onChange={(event) => setReason(event.currentTarget.value)} disabled={state === "working"} /></label>
          {message && <p role="alert" className="supply-inline-error">{message}</p>}
          <div className="supply-modal-actions"><button className="button button-outline" type="button" onClick={() => setOpen(false)} disabled={state === "working"}>Keep table</button>
            <button className="button button-danger" type="button" onClick={() => void confirm()} disabled={state === "working" || reason.trim().length === 0}>{state === "working" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}{state === "working" ? "Cancelling…" : "Cancel table"}</button></div>
        </>}
      </section>
    </div>}
  </section>;
}
