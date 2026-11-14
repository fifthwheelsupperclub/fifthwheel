import test from "node:test";
import assert from "node:assert/strict";
import { createRefundService } from "./refunds.service.server.ts";
import type { ProviderRefund, RefundRepository, RefundServiceDependencies, RefundWorkItem, RefundWorkResult } from "./refunds.contract.server.ts";

const admin = Object.freeze({ userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", emailNormalized: "admin@example.test", emailVerified: true,
  staffRoles: new Set(["admin"] as const), admission: { state: "none" as const, authUserId: null, emailNormalized: null },
  assignedTableIds: new Set<string>(), assignedVenueIds: new Set<string>() });
const workerJob: RefundWorkItem = Object.freeze({ jobId: "11111111-1111-4111-8111-111111111111", leaseToken: "22222222-2222-4222-8222-222222222222",
  operationId: "33333333-3333-4333-8333-333333333333", action: "dispatch", mode: "test", providerAccountId: "",
  providerPaymentIntentId: "pi_1234567890", providerRefundId: null, amountCents: 1250, currency: "USD" });
function deps(override: Partial<RefundServiceDependencies> = {}) {
  const finished: RefundWorkResult[] = [], created: Array<{ idempotencyKey: string; amountCents: number; paymentIntentId: string }> = [];
  const repository = {
    async listAdminRefunds() { return { items: [], nextCursor: null }; },
    async readAdminRefund() { throw new Error("unused"); },
    async dispatchRefund(_actor: string, _obligation: string, operationId: string) { return { operation: { operationId }, obligation: {} } as never; },
    async retryRefundOperation(_actor: string, operationId: string) { return { operation: { operationId }, obligation: {} } as never; },
    async reconcileRefundOperation(_actor: string, operationId: string) { return { operation: { operationId }, obligation: {} } as never; },
    async claimRefundWork() { return [workerJob]; },
    async finishRefundWork(result: RefundWorkResult) { finished.push(result); },
  } as unknown as RefundRepository;
  const provider = {
    async createRefund(input: { idempotencyKey: string; amountCents: number; paymentIntentId: string }) {
      created.push(input); return { id: "re_abcdef", mode: "test", paymentIntentId: input.paymentIntentId, amountCents: input.amountCents, currency: "usd", status: "succeeded" } as ProviderRefund;
    },
    async retrieveRefund() { return { id: "re_abcdef", mode: "test", paymentIntentId: workerJob.providerPaymentIntentId, amountCents: 1250, currency: "usd", status: "succeeded" } as ProviderRefund; },
  };
  const base: RefundServiceDependencies = { resolvePrincipal: async (token) => token === "admin-token" ? admin : null,
    repository, provider, providerAvailable: true };
  return { service: createRefundService({ ...base, ...override, repository, provider }), finished, created, repository };
}

test("refund operations require an authenticated admin", async () => {
  const { service, repository } = deps();
  const anonymous = await service.listAdminRefunds({});
  assert.equal(anonymous.ok, false);
  if (!anonymous.ok) assert.equal(anonymous.error.code, "unauthenticated");
  const memberPrincipal = Object.freeze({ ...admin, staffRoles: new Set<"admin">() });
  const member = createRefundService({ resolvePrincipal: async () => memberPrincipal, repository,
    provider: { createRefund: async () => { throw new Error("not called"); }, retrieveRefund: async () => { throw new Error("not called"); } }, providerAvailable: true });
  const forbidden = await member.listAdminRefunds({ accessToken: "member-token" });
  assert.equal(forbidden.ok, false);
  if (!forbidden.ok) assert.equal(forbidden.error.code, "forbidden");
});

test("worker dispatch uses the persisted operation UUID as Stripe idempotency key", async () => {
  const { service, created, finished } = deps();
  const result = await service.runWorkerOnce({ workerId: "44444444-4444-4444-8444-444444444444" });
  assert.deepEqual(created, [{ idempotencyKey: workerJob.operationId, amountCents: workerJob.amountCents,
    currency: "usd", mode: "test", paymentIntentId: workerJob.providerPaymentIntentId }]);
  assert.equal(result.completed, 1);
  assert.equal(finished[0]?.outcome, "succeeded");
  assert.equal(finished[0]?.providerRefund?.id, "re_abcdef");
});

test("provider amount mismatch becomes unknown and cannot settle", async () => {
  const { repository, finished } = deps();
  const provider = { createRefund: async () => ({ id: "re_wrong", mode: "test", paymentIntentId: "pi_1234567890", amountCents: 2500, currency: "usd", status: "succeeded" } as ProviderRefund),
    retrieveRefund: async () => { throw new Error("unused"); } };
  const service = createRefundService({ resolvePrincipal: async () => admin, repository, provider, providerAvailable: true });
  const result = await service.runWorkerOnce({ workerId: "44444444-4444-4444-8444-444444444444" });
  assert.equal(result.unknown, 1);
  assert.equal(finished[0]?.outcome, "unknown");
  assert.equal(finished[0]?.safeCode, "payment_mismatch");
  assert.equal(finished[0]?.providerRefund, null);
});

test("worker refuses to claim work when provider or fulfillment readiness is false", async () => {
  let claimed = false;
  const repository = { ...deps().repository, async claimRefundWork() { claimed = true; return []; } } as RefundRepository;
  const service = createRefundService({ resolvePrincipal: async () => admin, repository,
    provider: { createRefund: async () => { throw new Error("must not call"); }, retrieveRefund: async () => { throw new Error("must not call"); } }, providerAvailable: false });
  await assert.rejects(service.runWorkerOnce({ workerId: "44444444-4444-4444-8444-444444444444" }), /refund_provider_unavailable/);
  assert.equal(claimed, false);
});
