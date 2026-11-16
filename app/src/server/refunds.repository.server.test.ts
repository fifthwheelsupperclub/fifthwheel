import test from "node:test";
import assert from "node:assert/strict";
import { createRefundRepository } from "./refunds.repository.server.ts";

// Found by the W12 real-stack journey: Table-cancellation and removal obligations made the whole admin refund queue unreadable.
test("refund list accepts every obligation source the database can hold", async () => {
  const item = (source: string, n: number) => ({ obligationId: `00000000-0000-4000-8000-00000000000${n}`, source, state: "open", amountCents: 1500, currency: "USD",
    createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z", memberName: "Ada L", tableTitle: "Autumn Table", reservedCents: 0, availableCents: 1500,
    latestSafeCode: null, canDispatch: true, dispatchBlockedReason: null });
  const body = { items: ["late_checkout_ineligible", "cancellation", "table_cancellation", "removal"].map(item), nextCursor: null };
  const repository = createRefundRepository({ url: "http://127.0.0.1:1", secretKey: "k", fetch: async () => Response.json(body) });
  const list = await repository.listAdminRefunds("00000000-0000-4000-8000-000000000009", null, 25, true);
  assert.deepEqual(list.items.map((i) => i.source), ["late_checkout_ineligible", "cancellation", "table_cancellation", "removal"]);
});
