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
      setMessage(body?.error?.safeMessage ?? "Table cancellation is temporarily unavailable. Try again shortly."); setState("error");
    } catch { setMessage("The result is unknown. Try the same confirmation again; it cannot cancel twice."); setState("error"); }
  }

  return <section className="supply-danger-zone" aria-labelledby="table-cancel-title" style={{ margin: "32px auto", maxWidth: 960, padding: "0 16px" }}>
    <div className="supply-review-actions">
      <p id="table-cancel-title"><TriangleAlert aria-hidden="true" /> <strong>Cancel this Table.</strong> Closes requests and invitations, cancels every Seat and records refunds for all payments.</p>
      <div><button className="button button-outline" type="button" onClick={start}>Cancel Table…</button></div>
    </div>
    {open && <div className="supply-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && state !== "working") setOpen(false); }}>
      <section className="supply-modal supply-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="table-cancel-dialog-title">
        <span className="supply-modal-icon"><CircleAlert aria-hidden="true" /></span>
        <p className="eyebrow">CANCEL TABLE</p>
        {state === "done" && summary ? <>
          <h2 id="table-cancel-dialog-title">Table cancelled</h2>
          <p>{summary.cancelledSeats} Seat{summary.cancelledSeats === 1 ? "" : "s"} cancelled, {summary.closedRequests} request{summary.closedRequests === 1 ? "" : "s"} and {summary.closedInvitations} invitation{summary.closedInvitations === 1 ? "" : "s"} closed.
            {" "}{summary.refundObligations === 0 ? "No refunds are owed." : `${summary.refundObligations} refund${summary.refundObligations === 1 ? "" : "s"} totalling ${usd(summary.refundTotalCents)} are now owed; send them from Refunds.`}</p>
          <div className="supply-modal-actions"><a className="button button-primary" href="/admin/refunds">Open Refunds</a><button className="button button-outline" type="button" onClick={() => setOpen(false)}>Close</button></div>
        </> : <>
          <h2 id="table-cancel-dialog-title">Cancel this Table?</h2>
          <p>This cannot be undone. Applications and invitations close, holds are released, every paid Seat is cancelled, and the remaining balance on every payment becomes a refund you then send. Guests are not emailed automatically.</p>
          <label className="supply-field"><span>Reason for the record (1–500 characters)</span>
            <textarea value={reason} maxLength={500} rows={3} onChange={(event) => setReason(event.currentTarget.value)} disabled={state === "working"} /></label>
          {message && <p role="alert" className="supply-inline-error">{message}</p>}
          <div className="supply-modal-actions"><button className="button button-outline" type="button" onClick={() => setOpen(false)} disabled={state === "working"}>Keep Table</button>
            <button className="button button-primary" type="button" onClick={() => void confirm()} disabled={state === "working" || reason.trim().length === 0}>{state === "working" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}{state === "working" ? "Cancelling…" : "Confirm cancellation"}</button></div>
        </>}
      </section>
    </div>}
  </section>;
}
