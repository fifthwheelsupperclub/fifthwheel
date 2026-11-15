export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type DbTable<Row, Insert, Update> = Readonly<{ Row: Row; Insert: Insert; Update: Update; Relationships: readonly [] }>;
type CheckoutRuntimeRow = { table_id: string; state: string; version: number; updated_at: string };
type CheckoutAttemptRow = {
  attempt_id: string; invitation_id: string; table_id: string; guest_id: string; auth_user_id: string;
  proposal_revision: number; profile_revision: number; supply_revision_id: string; state: string;
  hold_until: string; provider_session_expires_at: string; amount_cents: number; currency: string;
  provider_mode: string; provider_idempotency_key: string; provider_session_id: string | null;
  provider_create_lease_until: string | null; last_provider_error_code: string | null;
  disclosure_version: string; disclosure_accepted_at: string | null; created_at: string; updated_at: string;
};
type CheckoutOperationRow = { operation_id: string; actor_user_id: string; action: string; request_hash: string; attempt_id: string; created_at: string };
type PaymentRow = { payment_id: string; attempt_id: string; provider_mode: string; provider_payment_id: string; amount_cents: number; currency: string; state: string; verified_at: string; created_at: string };
type SeatRow = { seat_id: string; invitation_id: string; table_id: string; guest_id: string; payment_id: string; state: string; created_at: string; cancelled_at: string | null };
type StripeCheckoutEventRow = { event_id: string; provider_mode: string; provider_account_id: string; event_type: string; session_id: string; event_created_at: string; signature_verified: boolean; state: string; result_code: string | null; attempt_count: number; last_attempt_at: string | null; created_at: string; updated_at: string };
type RefundObligationRow = { obligation_id: string; payment_id: string; source: string; amount_cents: number; currency: string; state: string; created_at: string; updated_at: string };
type RefundOperationRow = { operation_id: string; obligation_id: string; payment_id: string; provider_mode: string; provider_account_id: string; provider_refund_id: string | null; amount_cents: number; currency: string; state: string; safe_code: string | null; created_by: string; created_at: string; updated_at: string };
type RefundActionOperationRow = { request_id: string; actor_user_id: string; action: string; request_hash: string; refund_operation_id: string; result: Json; created_at: string };
type RefundWorkItemRow = { job_id: string; request_id: string; operation_id: string; action: string; state: string; attempts: number; available_at: string; lease_token: string | null; lease_until: string | null; created_at: string; updated_at: string };
type SeatCancellationRequestRow = { cancellation_request_id: string; seat_id: string; state: string; requested_at: string; decided_at: string | null; guest_safe_reason: string | null; member_reason: string | null; version: number; refund_cents: number | null; decided_by: string | null };
type SeatCancellationOperationRow = { operation_id: string; actor_user_id: string; action: string; request_hash: string; cancellation_request_id: string; result: Json; created_at: string };
type SeatCancellationNoticeRow = { outbox_id: string; cancellation_request_id: string; notice_kind: string; state: string; created_at: string };

export type Database = {
  public: {
    Tables: {
      app_table_runtime: DbTable<CheckoutRuntimeRow,
        { table_id: string; state?: string; version?: number; updated_at?: string },
        { state?: string; version?: number; updated_at?: string }>;
      app_checkout_attempts: DbTable<CheckoutAttemptRow,
        { attempt_id?: string; invitation_id: string; table_id: string; guest_id: string; auth_user_id: string; proposal_revision: number; profile_revision: number; supply_revision_id: string; state?: string; hold_until: string; provider_session_expires_at: string; amount_cents?: number; currency?: string; provider_mode: string; provider_idempotency_key: string; provider_session_id?: string | null; provider_create_lease_until?: string | null; last_provider_error_code?: string | null; disclosure_version: string; disclosure_accepted_at?: string | null; created_at?: string; updated_at?: string },
        { state?: string; provider_session_id?: string | null; provider_create_lease_until?: string | null; last_provider_error_code?: string | null; updated_at?: string }>;
      app_checkout_operations: DbTable<CheckoutOperationRow,
        { operation_id: string; actor_user_id: string; action: string; request_hash: string; attempt_id: string; created_at?: string },
        never>;
      app_payments: DbTable<PaymentRow,
        { payment_id?: string; attempt_id: string; provider_mode: string; provider_payment_id: string; amount_cents: number; currency: string; state: string; verified_at: string; created_at?: string },
        { state?: string }>;
      app_seats: DbTable<SeatRow,
        { seat_id?: string; invitation_id: string; table_id: string; guest_id: string; payment_id: string; state?: string; created_at?: string; cancelled_at?: string | null },
        { state?: string; cancelled_at?: string | null }>;
      app_stripe_checkout_events: DbTable<StripeCheckoutEventRow,
        { event_id: string; provider_mode: string; provider_account_id?: string; event_type: string; session_id: string; event_created_at: string; signature_verified?: boolean; state?: string; result_code?: string | null; attempt_count?: number; last_attempt_at?: string | null; created_at?: string; updated_at?: string },
        { state?: string; result_code?: string | null; attempt_count?: number; last_attempt_at?: string | null; updated_at?: string }>;
      app_refund_obligations: DbTable<RefundObligationRow,
        { obligation_id?: string; payment_id: string; source: string; amount_cents: number; currency?: string; state?: string; created_at?: string; updated_at?: string },
        { state?: string; updated_at?: string }>;
      app_refund_operations: DbTable<RefundOperationRow,
        { operation_id: string; obligation_id: string; payment_id: string; provider_mode: string; provider_account_id?: string; provider_refund_id?: string | null; amount_cents: number; currency?: string; state?: string; safe_code?: string | null; created_by: string; created_at?: string; updated_at?: string },
        { provider_refund_id?: string | null; state?: string; safe_code?: string | null; updated_at?: string }>;
      app_refund_action_operations: DbTable<RefundActionOperationRow,
        { request_id: string; actor_user_id: string; action: string; request_hash: string; refund_operation_id: string; result: Json; created_at?: string }, never>;
      app_refund_work_items: DbTable<RefundWorkItemRow,
        { job_id?: string; request_id: string; operation_id: string; action: string; state?: string; attempts?: number; available_at?: string; lease_token?: string | null; lease_until?: string | null; created_at?: string; updated_at?: string },
        { state?: string; attempts?: number; available_at?: string; lease_token?: string | null; lease_until?: string | null; updated_at?: string }>;
      app_seat_cancellation_requests: DbTable<SeatCancellationRequestRow,
        { cancellation_request_id?: string; seat_id: string; state: string; requested_at?: string; decided_at?: string | null; guest_safe_reason?: string | null; member_reason?: string | null; version?: number; refund_cents?: number | null; decided_by?: string | null },
        { state?: string; decided_at?: string | null; guest_safe_reason?: string | null; member_reason?: string | null; version?: number; refund_cents?: number | null; decided_by?: string | null }>;
      app_seat_cancellation_operations: DbTable<SeatCancellationOperationRow,
        { operation_id: string; actor_user_id: string; action: string; request_hash: string; cancellation_request_id: string; result: Json; created_at?: string }, never>;
      app_seat_cancellation_notice_outbox: DbTable<SeatCancellationNoticeRow,
        { outbox_id?: string; cancellation_request_id: string; notice_kind: string; state?: string; created_at?: string }, never>;
      app_admissions: {
        Row: {
          activated_at: string | null
          approved_at: string
          approved_by: string
          auth_user_id: string | null
          created_at: string
          deleted_at: string | null
          email_normalized: string
          id: string
          state: string
          updated_at: string
          waitlist_signup_id: string
        }
        Insert: {
          activated_at?: string | null
          approved_at?: string
          approved_by: string
          auth_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          email_normalized: string
          id?: string
          state?: string
          updated_at?: string
          waitlist_signup_id: string
        }
        Update: {
          activated_at?: string | null
          approved_at?: string
          approved_by?: string
          auth_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          email_normalized?: string
          id?: string
          state?: string
          updated_at?: string
          waitlist_signup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_admissions_email_normalized_fkey"
            columns: ["email_normalized"]
            isOneToOne: true
            referencedRelation: "waitlist_signups"
            referencedColumns: ["email_normalized"]
          },
          {
            foreignKeyName: "app_admissions_waitlist_signup_id_fkey"
            columns: ["waitlist_signup_id"]
            isOneToOne: true
            referencedRelation: "waitlist_signups"
            referencedColumns: ["id"]
          },
        ]
      }
      app_audit_events: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          event_id: string
          metadata: Json
          occurred_at: string
          operation_id: string | null
          request_id: string | null
          subject_id: string
          subject_type: string
          system_actor: string | null
        }
        Insert: {
          action: string
          actor_type: string
          actor_user_id?: string | null
          event_id?: string
          metadata?: Json
          occurred_at?: string
          operation_id?: string | null
          request_id?: string | null
          subject_id: string
          subject_type: string
          system_actor?: string | null
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          event_id?: string
          metadata?: Json
          occurred_at?: string
          operation_id?: string | null
          request_id?: string | null
          subject_id?: string
          subject_type?: string
          system_actor?: string | null
        }
        Relationships: []
      }
      app_invitation_deliveries: {
        Row: {
          accepted_at: string | null
          admission_id: string
          attempt_count: number
          attempted_at: string | null
          created_at: string
          created_by: string
          delivered_at: string | null
          error_code: string | null
          id: string
          lease_until: string | null
          next_attempt_at: string
          operation_id: string
          provider_message_id: string | null
          queued_at: string
          state: string
        }
        Insert: {
          accepted_at?: string | null
          admission_id: string
          attempt_count?: number
          attempted_at?: string | null
          created_at?: string
          created_by: string
          delivered_at?: string | null
          error_code?: string | null
          id?: string
          lease_until?: string | null
          next_attempt_at?: string
          operation_id: string
          provider_message_id?: string | null
          queued_at?: string
          state?: string
        }
        Update: {
          accepted_at?: string | null
          admission_id?: string
          attempt_count?: number
          attempted_at?: string | null
          created_at?: string
          created_by?: string
          delivered_at?: string | null
          error_code?: string | null
          id?: string
          lease_until?: string | null
          next_attempt_at?: string
          operation_id?: string
          provider_message_id?: string | null
          queued_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_invitation_deliveries_admission_id_fkey"
            columns: ["admission_id"]
            isOneToOne: false
            referencedRelation: "app_admissions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_invitation_delivery_attempts: {
        Row: {
          attempt_number: number
          delivery_id: string
          error_code: string | null
          finished_at: string | null
          id: string
          operation_id: string
          provider_message_id: string | null
          started_at: string
          started_by_user_id: string | null
          state: string
        }
        Insert: {
          attempt_number: number
          delivery_id: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          operation_id?: string
          provider_message_id?: string | null
          started_at?: string
          started_by_user_id?: string | null
          state: string
        }
        Update: {
          attempt_number?: number
          delivery_id?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          operation_id?: string
          provider_message_id?: string | null
          started_at?: string
          started_by_user_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_invitation_delivery_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "app_invitation_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      app_member_link_cooldowns: {
        Row: {
          admission_id: string
          last_requested_at: string
        }
        Insert: {
          admission_id: string
          last_requested_at: string
        }
        Update: {
          admission_id?: string
          last_requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_member_link_cooldowns_admission_id_fkey"
            columns: ["admission_id"]
            isOneToOne: true
            referencedRelation: "app_admissions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist_signups: {
        Row: {
          birthdate: string
          created_at: string
          email_normalized: string
          first_name: string
          id: string
          identity: string
          last_name: string
          looking_for: string
          match_age_max: number
          match_age_min: number
          neighborhood: string
          nights: string[]
          open_to: string[]
          received_at: string
          referral: string
          source: string
          surprise_game: string
        }
        Insert: {
          birthdate: string
          created_at?: string
          email_normalized: string
          first_name: string
          id?: string
          identity: string
          last_name: string
          looking_for: string
          match_age_max: number
          match_age_min: number
          neighborhood: string
          nights?: string[]
          open_to: string[]
          received_at?: string
          referral?: string
          source?: string
          surprise_game: string
        }
        Update: {
          birthdate?: string
          created_at?: string
          email_normalized?: string
          first_name?: string
          id?: string
          identity?: string
          last_name?: string
          looking_for?: string
          match_age_max?: number
          match_age_min?: number
          neighborhood?: string
          nights?: string[]
          open_to?: string[]
          received_at?: string
          referral?: string
          source?: string
          surprise_game?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bind_table_checkout_session: {
        Args: { p_actor: string; p_attempt_id: string; p_expires_at: string; p_mode: string; p_session_id: string }
        Returns: Json
      }
      mark_table_checkout_unknown: {
        Args: { p_actor: string; p_attempt_id: string }
        Returns: undefined
      }
      read_checkout_eligibility: {
        Args: { p_actor: string; p_disclosure_text: string | null; p_disclosure_version: string | null; p_invitation_id: string; p_requires_ack: boolean }
        Returns: Json
      }
      read_my_checkout_attempt: {
        Args: { p_actor: string; p_attempt_id: string }
        Returns: Json
      }
      read_checkout_return_binding: {
        Args: { p_actor: string; p_attempt_id: string; p_invitation_id: string }
        Returns: Json
      }
      read_checkout_webhook_binding: {
        Args: { p_provider_mode: string; p_session_id: string }
        Returns: Json
      }
      persist_stripe_checkout_event: {
        Args: { p_event_created_at: string; p_event_id: string; p_event_type: string; p_provider_account_id: string; p_provider_mode: string; p_session_id: string }
        Returns: Json
      }
      mark_stripe_checkout_event_result: {
        Args: { p_event_id: string; p_provider_account_id: string; p_provider_mode: string; p_safe_code: string | null; p_state: string }
        Returns: undefined
      }
      expire_table_checkout_session: {
        Args: { p_provider_mode: string; p_session_id: string }
        Returns: Json
      }
      release_failed_checkout_session: {
        Args: { p_event_id: string; p_provider_account_id: string; p_provider_mode: string; p_session_id: string }
        Returns: Json
      }
      fulfill_paid_checkout_session: {
        Args: { p_amount_total: number; p_attempt_id: string; p_currency: string; p_event_id: string | null; p_payment_intent_id: string; p_payment_status: string; p_provider_account_id: string; p_provider_mode: string; p_session_id: string; p_session_status: string; p_verified_at: string }
        Returns: Json
      }
      read_my_seats: {
        Args: { p_actor: string; p_cursor_created_at: string | null; p_cursor_seat_id: string | null; p_limit: number }
        Returns: Json
      }
      read_my_seat: {
        Args: { p_actor: string; p_seat_id: string }
        Returns: Json
      }
      read_invitation_seat_status: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      read_my_seat_cancellation_requests: {
        Args: { p_actor: string; p_seat_id: string }
        Returns: Json
      }
      request_seat_cancellation: {
        Args: { p_actor: string; p_seat_id: string; p_operation_id: string; p_member_reason: string | null }
        Returns: Json
      }
      list_admin_seat_cancellations: {
        Args: { p_actor: string; p_cursor_requested_at: string | null; p_cursor_request_id: string | null; p_limit: number }
        Returns: Json
      }
      read_admin_seat_cancellation: {
        Args: { p_actor: string; p_request_id: string }
        Returns: Json
      }
      decide_seat_cancellation: {
        Args: { p_actor: string; p_request_id: string; p_operation_id: string; p_expected_version: number; p_decision: string; p_refund_cents: number; p_member_safe_reason: string }
        Returns: Json
      }
      list_admin_refunds: {
        Args: { p_actor: string; p_cursor_created_at: string | null; p_cursor_obligation_id: string | null; p_limit: number; p_provider_available: boolean }
        Returns: Json
      }
      read_admin_refund: {
        Args: { p_actor: string; p_obligation_id: string; p_provider_available: boolean }
        Returns: Json
      }
      queue_refund_dispatch: {
        Args: { p_actor: string; p_obligation_id: string; p_operation_id: string; p_provider_available: boolean }
        Returns: Json
      }
      queue_refund_retry: {
        Args: { p_actor: string; p_operation_id: string; p_request_id: string; p_provider_available: boolean }
        Returns: Json
      }
      queue_refund_reconcile: {
        Args: { p_actor: string; p_operation_id: string; p_request_id: string; p_provider_available: boolean }
        Returns: Json
      }
      claim_refund_work: {
        Args: { p_worker_id: string; p_limit: number }
        Returns: Json
      }
      finish_refund_work: {
        Args: { p_job_id: string; p_lease_token: string; p_outcome: string; p_safe_code: string | null; p_refund_id: string | null; p_mode: string | null; p_account_id: string | null; p_payment_intent_id: string | null; p_amount_cents: number | null; p_currency: string | null; p_provider_status: string | null }
        Returns: Json
      }
      release_table_checkout_attempt: {
        Args: { p_actor: string; p_attempt_id: string; p_safe_error_code: string }
        Returns: Json
      }
      reserve_table_checkout_attempt: {
        Args: { p_actor: string; p_disclosure_accepted_at: string | null; p_disclosure_version: string; p_expected_profile_revision: number; p_expected_proposal_revision: number; p_invitation_id: string; p_operation_id: string; p_provider_mode: string }
        Returns: Json
      }
      activate_app_admission: {
        Args: {
          p_activated_at: string
          p_auth_user_id: string
          p_email_normalized: string
        }
        Returns: Json
      }
      admit_waitlist_signup: {
        Args: {
          p_approved_by: string
          p_operation_id: string
          p_signup_id: string
        }
        Returns: Json
      }
      begin_invitation_delivery_attempt: {
        Args: {
          p_delivery_id: string
          p_operation_id: string
          p_started_by_user_id: string
        }
        Returns: Json
      }
      claim_member_link_cooldown: {
        Args: {
          p_admission_id: string
          p_cooldown_seconds: number
          p_requested_at: string
        }
        Returns: boolean
      }
      finish_invitation_delivery_attempt: {
        Args: {
          p_attempt_id: string
          p_error_code: string
          p_finished_at: string
          p_provider_message_id: string
          p_state: string
        }
        Returns: Json
      }
      reconcile_unknown_invitation_attempt: {
        Args: {
          p_attempt_id: string
          p_provider_message_id: string
          p_resolved_at: string
          p_state: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

