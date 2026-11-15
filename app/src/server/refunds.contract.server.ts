import type {
  RefundActionDTO, RefundDetailDTO, RefundListDTO, RefundObligationSummaryDTO, RefundOperationDTO,
} from "../refunds.contract.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";

export type RefundCursor = Readonly<{ createdAt: string; obligationId: string }>;
export type RefundActionFailureCode = import("../refunds.contract.ts").RefundErrorCode;
export type RefundResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: RefundActionFailureCode; safeMessage: string; retryable: boolean }> }>;
export type RefundActionInput = Readonly<{ operationId: string }>;
export type RefundRequestInput = Readonly<{ requestId: string }>;
export type RefundListInput = Readonly<{ accessToken?: string | null; cursor?: string | null; limit?: number }>;
export type RefundDetailInput = Readonly<{ accessToken?: string | null; obligationId: string }>;
export type RefundDispatchInput = RefundDetailInput & Readonly<{ request: RefundActionInput }>;
export type RefundOperationInput = Readonly<{ accessToken?: string | null; operationId: string; request: RefundRequestInput }>;

export interface RefundRepository {
  listAdminRefunds(actorUserId: string, cursor: RefundCursor | null, limit: number, providerAvailable: boolean): Promise<RefundListDTO>;
  readAdminRefund(actorUserId: string, obligationId: string, providerAvailable: boolean): Promise<RefundDetailDTO>;
  dispatchRefund(actorUserId: string, obligationId: string, operationId: string, providerAvailable: boolean): Promise<RefundActionDTO>;
  retryRefundOperation(actorUserId: string, operationId: string, requestId: string, providerAvailable: boolean): Promise<RefundActionDTO>;
  reconcileRefundOperation(actorUserId: string, operationId: string, requestId: string, providerAvailable: boolean): Promise<RefundActionDTO>;
  claimRefundWork(workerId: string, limit: number): Promise<readonly RefundWorkItem[]>;
  finishRefundWork(input: RefundWorkResult): Promise<void>;
}

export type RefundWorkItem = Readonly<{
  jobId: string;
  leaseToken: string;
  operationId: string;
  action: "dispatch" | "reconcile";
  mode: "test" | "live";
  providerAccountId: string;
  providerPaymentIntentId: string;
  providerRefundId: string | null;
  amountCents: number;
  currency: "USD";
}>;

export type ProviderRefund = Readonly<{
  id: string;
  mode: "test" | "live";
  paymentIntentId: string | null;
  amountCents: number;
  currency: string;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
}>;

export type RefundWorkResult = Readonly<{
  jobId: string;
  leaseToken: string;
  outcome: "pending" | "succeeded" | "failed" | "unknown";
  safeCode: string | null;
  providerRefund: ProviderRefund | null;
}>;

export interface RefundProvider {
  createRefund(input: Readonly<{
    paymentIntentId: string;
    amountCents: number;
    currency: "usd";
    idempotencyKey: string;
    mode: "test" | "live";
  }>): Promise<ProviderRefund>;
  retrieveRefund(input: Readonly<{ refundId: string; mode: "test" | "live" }>): Promise<ProviderRefund>;
  /** Read-only lookup by our own operation id (stored as refund metadata). Safe at any age, unlike an idempotency-key replay (24h). */
  findRefundByOperation(input: Readonly<{ paymentIntentId: string; operationId: string; mode: "test" | "live" }>): Promise<ProviderRefund | null>;
}

export type RefundServiceDependencies = Readonly<{
  resolvePrincipal: VerifiedPrincipalResolver;
  repository: RefundRepository;
  providerAvailable: boolean;
  provider: RefundProvider;
}>;

export interface RefundService {
  listAdminRefunds(input: RefundListInput): Promise<RefundResult<RefundListDTO>>;
  readAdminRefund(input: RefundDetailInput): Promise<RefundResult<RefundDetailDTO>>;
  dispatchRefund(input: RefundDispatchInput): Promise<RefundResult<RefundActionDTO>>;
  retryRefundOperation(input: RefundOperationInput): Promise<RefundResult<RefundActionDTO>>;
  reconcileRefundOperation(input: RefundOperationInput): Promise<RefundResult<RefundActionDTO>>;
  runWorkerOnce(input: Readonly<{ workerId: string; limit?: number }>): Promise<Readonly<{ claimed: number; completed: number; unknown: number }>>;
}

export type RefundHttpHandlerMethods = Readonly<{
  listAdminRefunds(request: Request): Promise<Response>;
  readAdminRefund(request: Request, obligationId: string): Promise<Response>;
  dispatchRefund(request: Request, obligationId: string): Promise<Response>;
  retryRefundOperation(request: Request, operationId: string): Promise<Response>;
  reconcileRefundOperation(request: Request, operationId: string): Promise<Response>;
}>;

export type RefundDTO = RefundObligationSummaryDTO | RefundOperationDTO;
