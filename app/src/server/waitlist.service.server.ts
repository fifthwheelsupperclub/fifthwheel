/** Server-only waitlist intake service. Successful outcomes stay deliberately neutral. */

import type {
  ServiceResult,
  WaitlistRepository,
  WaitlistSubmitResponse,
} from "./admission.contracts.server.ts";
import { WaitlistRepositoryError } from "./waitlist.repository.server.ts";
import { validateWaitlistIntake } from "./waitlist.validation.server.ts";

export type WaitlistServiceDependencies = Readonly<{
  repository: Pick<WaitlistRepository, "insertIfAbsent">;
  now?: () => Date;
}>;

export interface WaitlistService {
  submit(payload: unknown): Promise<ServiceResult<WaitlistSubmitResponse>>;
}

const acceptedKeys = new Set([
  "first_name", "last_name", "email", "birthdate", "match_age_min", "match_age_max",
  "neighborhood", "identity", "open_to", "nights", "looking_for", "surprise_game",
  "referral", "source", "submitted_at", "_gotcha",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationFailure(fields: Readonly<Record<string, string>>): ServiceResult<never> {
  return {
    ok: false,
    error: {
      code: "validation_failed",
      safeMessage: "Check the form fields and try again.",
      fields,
    },
  };
}

export function createWaitlistService(dependencies: WaitlistServiceDependencies): WaitlistService {
  const now = dependencies.now ?? (() => new Date());
  return Object.freeze({
    async submit(payload: unknown): Promise<ServiceResult<WaitlistSubmitResponse>> {
      const parsed = validateWaitlistIntake(payload, now());
      if (parsed.kind === "honeypot") return { ok: true, value: { received: true } };
      if (parsed.kind === "invalid") return validationFailure(parsed.fields);
      if (!isRecord(payload) || Object.keys(payload).some((key) => !acceptedKeys.has(key))) {
        return validationFailure({ form: "Submit the supported waitlist fields." });
      }

      try {
        // Whether newly inserted or already present, the public response is
        // identical and the repository never overwrites existing intake.
        await dependencies.repository.insertIfAbsent(parsed.value);
        return { ok: true, value: { received: true } };
      } catch (error) {
        if (error instanceof WaitlistRepositoryError) {
          return {
            ok: false,
            error: {
              code: "temporarily_unavailable",
              safeMessage: "We couldn’t receive the form right now. Try again shortly.",
            },
          };
        }
        return {
          ok: false,
          error: {
            code: "temporarily_unavailable",
            safeMessage: "We couldn’t receive the form right now. Try again shortly.",
          },
        };
      }
    },
  });
}
