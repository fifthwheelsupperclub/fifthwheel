/** Branded guest notice templates. Pure functions of server-supplied facts: no tokens, ballots, report text or full names. */

export type NoticeKind = "seat_confirmed" | "cancellation_decision" | "table_cancelled" | "member_removed" | "t48_reminder";
export type NoticeContext = Readonly<{
  firstName: string; tableTitle: string; localDate: string | null; startLocalTime: string | null; neighborhood: string | null;
  decision?: string; reason?: string | null; refundCents?: number; invitationId?: string | null;
}>;
export type RenderedNotice = Readonly<{ subject: string; text: string; html: string }>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const when = (c: NoticeContext) => {
  if (!c.localDate || !c.startLocalTime || !/^\d{4}-\d{2}-\d{2}$/.test(c.localDate) || !/^\d{2}:\d{2}$/.test(c.startLocalTime)) return "";
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${c.localDate}T00:00:00Z`));
  const [h, m] = c.startLocalTime.split(":").map(Number);
  return `${date} at ${new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, h, m)))} (Atlanta time)`;
};

function frame(origin: string, heading: string, paragraphs: readonly string[], action: Readonly<{ label: string; href: string }>): RenderedNotice & { heading: string } {
  const text = [heading, "", ...paragraphs, "", `${action.label}: ${action.href}`, "", "Fifth Wheel · Questions? Reply to hello@fifthwheel.community", `Terms: ${origin.replace("app.", "")}/terms · Privacy: ${origin.replace("app.", "")}/privacy`].join("\n");
  const html = `<div style="font-family:Georgia,serif;background:#161009;color:#f3e9d8;padding:32px"><div style="max-width:520px;margin:0 auto"><p style="color:#c79a4b;letter-spacing:.14em;font:700 11px Arial,sans-serif">FIFTH WHEEL</p>`
    + `<h1 style="font-weight:400;font-size:28px;margin:8px 0 18px">${esc(heading)}</h1>${paragraphs.map((p) => `<p style="font:15px/1.6 Arial,sans-serif;color:#d8c9ae">${esc(p)}</p>`).join("")}`
    + `<p><a href="${esc(action.href)}" style="display:inline-block;background:#c79a4b;color:#21190d;padding:12px 18px;border-radius:10px;font:700 14px Arial,sans-serif;text-decoration:none">${esc(action.label)}</a></p>`
    + `<p style="font:12px/1.6 Arial,sans-serif;color:#a6947c">Questions? Reply to hello@fifthwheel.community</p></div></div>`;
  return { subject: "", text, html, heading };
}

/** `origin` is the app origin; links never carry a sign-in token (the guest signs in normally). */
export function renderNotice(kind: NoticeKind, c: NoticeContext, origin: string): RenderedNotice {
  const seats = `${origin}/my-seats`;
  const title = c.tableTitle;
  const refund = (cents: number | undefined) => (cents && cents > 0 ? `A refund of ${usd(cents)} is on its way to your original payment method; it can take several business days to appear.` : "");
  let subject: string, built: ReturnType<typeof frame>;
  switch (kind) {
    case "seat_confirmed":
      subject = `Your Seat is confirmed: ${title}`;
      built = frame(origin, "Your Seat is confirmed", [`Hi ${c.firstName}, your payment went through and your Seat at ${title} is confirmed.`, when(c), "Your itinerary and calendar file are in My Seats. If your plans change, request a cancellation there; our team reviews every request."].filter(Boolean), { label: "View your Seat", href: seats });
      break;
    case "cancellation_decision": {
      const approved = c.decision === "approved";
      subject = approved ? `Your cancellation was approved: ${title}` : `About your cancellation request: ${title}`;
      built = frame(origin, approved ? "Your cancellation was approved" : "We couldn’t approve your cancellation", [`Hi ${c.firstName}, we reviewed your request for ${title}.`,
        approved ? "Your Seat is released." : "Your Seat remains confirmed.", c.reason ?? "", approved ? refund(c.refundCents) || "No refund applies to this cancellation." : ""].filter(Boolean), { label: "View My Seats", href: seats });
      break;
    }
    case "table_cancelled":
      subject = `${title} has been cancelled`;
      built = frame(origin, "This Table has been cancelled", [`Hi ${c.firstName}, we’re sorry: ${title}${when(c) ? ` on ${when(c)}` : ""} has been cancelled.`, "If you had paid, the full amount is being refunded to your original payment method; it can take several business days to appear.", "You don’t need to do anything. We’d love to see you at another Table."], { label: "Browse Tables", href: `${origin}/tables` });
      break;
    case "member_removed":
      subject = `Your place at ${title}`;
      built = frame(origin, "Your place at this Table was removed", [`Hi ${c.firstName}, our team removed you from ${title}.`, refund(c.refundCents) || "No payment is owed from you.", "If you have questions, reply to this email."], { label: "View My Seats", href: seats });
      break;
    case "t48_reminder":
      subject = `Reminder: your Table invitation for ${title}`;
      built = frame(origin, "Your Table invitation is waiting", [`Hi ${c.firstName}, you’re invited to ${title}${when(c) ? ` on ${when(c)}` : ""}.`, "Your Seat isn’t confirmed until you complete payment. Spots are limited."], { label: "View your invitation", href: `${origin}/sign-in?returnTo=${encodeURIComponent(`/invitations/${c.invitationId ?? ""}`)}` });
      break;
  }
  return { subject, text: built.text, html: built.html };
}
