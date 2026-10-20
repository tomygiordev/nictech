export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  erp: {
    Tables: {
      account_reconciliations: {
        Row: {
          account_id: string
          as_of_date: string
          branch_id: string
          created_at: string
          created_by: string | null
          difference_amount: number
          general_ledger_balance: number
          id: string
          organization_id: string
          reason: string
          status: Database["erp"]["Enums"]["reconciliation_status"]
          subledger_balance: number
        }
        Insert: {
          account_id: string
          as_of_date: string
          branch_id: string
          created_at?: string
          created_by?: string | null
          difference_amount: number
          general_ledger_balance: number
          id?: string
          organization_id: string
          reason: string
          status: Database["erp"]["Enums"]["reconciliation_status"]
          subledger_balance: number
        }
        Update: {
          account_id?: string
          as_of_date?: string
          branch_id?: string
          created_at?: string
          created_by?: string | null
          difference_amount?: number
          general_ledger_balance?: number
          id?: string
          organization_id?: string
          reason?: string
          status?: Database["erp"]["Enums"]["reconciliation_status"]
          subledger_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_reconciliations_account_fk"
            columns: ["account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "account_reconciliations_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "account_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_account_roles: {
        Row: {
          account_id: string
          created_at: string
          id: string
          organization_id: string
          role_code: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          organization_id: string
          role_code: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_account_roles_account_fk"
            columns: ["account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "accounting_account_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_periods: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          organization_id: string
          period_end: string
          period_start: string
          status: Database["erp"]["Enums"]["accounting_period_status"]
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          period_end: string
          period_start: string
          status?: Database["erp"]["Enums"]["accounting_period_status"]
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          status?: Database["erp"]["Enums"]["accounting_period_status"]
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_source_events: {
        Row: {
          created_at: string
          id: string
          journal_entry_id: string
          organization_id: string
          posting_kind: string
          source_id: string
          source_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          journal_entry_id: string
          organization_id: string
          posting_kind: string
          source_id: string
          source_type: string
        }
        Update: {
          created_at?: string
          id?: string
          journal_entry_id?: string
          organization_id?: string
          posting_kind?: string
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_source_events_entry_fk"
            columns: ["journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "accounting_source_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          branch_id: string | null
          correlation_id: string
          id: number
          metadata: Json
          new_values: Json | null
          occurred_at: string
          old_values: Json | null
          organization_id: string | null
          reason: string | null
          record_id: string | null
          request_id: string | null
          schema_name: string
          table_name: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          branch_id?: string | null
          correlation_id?: string
          id?: never
          metadata?: Json
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          organization_id?: string | null
          reason?: string | null
          record_id?: string | null
          request_id?: string | null
          schema_name: string
          table_name: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          branch_id?: string | null
          correlation_id?: string
          id?: never
          metadata?: Json
          new_values?: Json | null
          occurred_at?: string
          old_values?: Json | null
          organization_id?: string | null
          reason?: string | null
          record_id?: string | null
          request_id?: string | null
          schema_name?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_branch_organization_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "audit_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: Json
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: Json
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: Json
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_close_counts: {
        Row: {
          cash_closure_id: string
          counted_amount: number
          created_at: string
          currency_code: string
          difference_amount: number
          expected_amount: number
          id: string
          organization_id: string
        }
        Insert: {
          cash_closure_id: string
          counted_amount: number
          created_at?: string
          currency_code: string
          difference_amount: number
          expected_amount: number
          id?: string
          organization_id: string
        }
        Update: {
          cash_closure_id?: string
          counted_amount?: number
          created_at?: string
          currency_code?: string
          difference_amount?: number
          expected_amount?: number
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_close_counts_closure_fk"
            columns: ["cash_closure_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cash_closures"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_close_counts_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "cash_close_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_closures: {
        Row: {
          branch_id: string
          cash_session_id: string
          closed_at: string
          closed_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          reason: string
          request_hash: string
        }
        Insert: {
          branch_id: string
          cash_session_id: string
          closed_at?: string
          closed_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          reason: string
          request_hash: string
        }
        Update: {
          branch_id?: string
          cash_session_id?: string
          closed_at?: string
          closed_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          reason?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_closures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_closures_session_fk"
            columns: ["cash_session_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          actor_id: string | null
          amount: number
          branch_id: string
          cash_session_id: string
          currency_code: string
          id: string
          idempotency_key: string
          kind: Database["erp"]["Enums"]["cash_movement_kind"]
          occurred_at: string
          organization_id: string
          payment_id: string | null
          reason: string
          receivable_payment_id: string | null
          request_hash: string
          reversal_of_movement_id: string | null
          supplier_payment_id: string | null
        }
        Insert: {
          actor_id?: string | null
          amount: number
          branch_id: string
          cash_session_id: string
          currency_code: string
          id?: string
          idempotency_key: string
          kind: Database["erp"]["Enums"]["cash_movement_kind"]
          occurred_at?: string
          organization_id: string
          payment_id?: string | null
          reason: string
          receivable_payment_id?: string | null
          request_hash: string
          reversal_of_movement_id?: string | null
          supplier_payment_id?: string | null
        }
        Update: {
          actor_id?: string | null
          amount?: number
          branch_id?: string
          cash_session_id?: string
          currency_code?: string
          id?: string
          idempotency_key?: string
          kind?: Database["erp"]["Enums"]["cash_movement_kind"]
          occurred_at?: string
          organization_id?: string
          payment_id?: string | null
          reason?: string
          receivable_payment_id?: string | null
          request_hash?: string
          reversal_of_movement_id?: string | null
          supplier_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "cash_movements_opened_currency_fk"
            columns: [
              "cash_session_id",
              "organization_id",
              "branch_id",
              "currency_code",
            ]
            isOneToOne: false
            referencedRelation: "cash_session_opening_counts"
            referencedColumns: [
              "cash_session_id",
              "organization_id",
              "branch_id",
              "currency_code",
            ]
          },
          {
            foreignKeyName: "cash_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_payment_fk"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_receivable_payment_fk"
            columns: ["receivable_payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "receivable_payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_reversal_fk"
            columns: ["reversal_of_movement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_session_fk"
            columns: ["cash_session_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "cash_movements_supplier_payment_fk"
            columns: ["supplier_payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          branch_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          branch_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          branch_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_registers_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_registers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_session_opening_counts: {
        Row: {
          amount: number
          branch_id: string
          cash_session_id: string
          created_at: string
          currency_code: string
          id: string
          organization_id: string
        }
        Insert: {
          amount: number
          branch_id: string
          cash_session_id: string
          created_at?: string
          currency_code: string
          id?: string
          organization_id: string
        }
        Update: {
          amount?: number
          branch_id?: string
          cash_session_id?: string
          created_at?: string
          currency_code?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_opening_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "cash_opening_session_fk"
            columns: ["cash_session_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "cash_session_opening_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          branch_id: string
          cash_register_id: string
          id: string
          idempotency_key: string
          opened_at: string
          opened_by: string | null
          organization_id: string
          reason: string
          request_hash: string
        }
        Insert: {
          branch_id: string
          cash_register_id: string
          id?: string
          idempotency_key: string
          opened_at?: string
          opened_by?: string | null
          organization_id: string
          reason: string
          request_hash: string
        }
        Update: {
          branch_id?: string
          cash_register_id?: string
          id?: string
          idempotency_key?: string
          opened_at?: string
          opened_by?: string | null
          organization_id?: string
          reason?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_register_fk"
            columns: ["cash_register_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          account_type: Database["erp"]["Enums"]["account_type"]
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_control: boolean
          name: string
          normal_balance: Database["erp"]["Enums"]["account_normal_balance"]
          organization_id: string
          parent_account_id: string | null
        }
        Insert: {
          account_type: Database["erp"]["Enums"]["account_type"]
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_control?: boolean
          name: string
          normal_balance: Database["erp"]["Enums"]["account_normal_balance"]
          organization_id: string
          parent_account_id?: string | null
        }
        Update: {
          account_type?: Database["erp"]["Enums"]["account_type"]
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_control?: boolean
          name?: string
          normal_balance?: Database["erp"]["Enums"]["account_normal_balance"]
          organization_id?: string
          parent_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_fk"
            columns: ["parent_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      communication_attachments: {
        Row: {
          branch_id: string
          byte_size: number
          id: string
          message_id: string
          mime_type: string
          organization_id: string
          private_object_path: string
          sha256: string
        }
        Insert: {
          branch_id: string
          byte_size: number
          id?: string
          message_id: string
          mime_type: string
          organization_id: string
          private_object_path: string
          sha256: string
        }
        Update: {
          branch_id?: string
          byte_size?: number
          id?: string
          message_id?: string
          mime_type?: string
          organization_id?: string
          private_object_path?: string
          sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_attachments_message_fk"
            columns: ["message_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "communication_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_automation_executions: {
        Row: {
          branch_id: string
          executed_at: string
          id: string
          message_id: string | null
          organization_id: string
          outcome: string
          reason: string
          rule_id: string
          source_event_id: string
          source_event_type: string
        }
        Insert: {
          branch_id: string
          executed_at?: string
          id?: string
          message_id?: string | null
          organization_id: string
          outcome: string
          reason: string
          rule_id: string
          source_event_id: string
          source_event_type: string
        }
        Update: {
          branch_id?: string
          executed_at?: string
          id?: string
          message_id?: string | null
          organization_id?: string
          outcome?: string
          reason?: string
          rule_id?: string
          source_event_id?: string
          source_event_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_automation_executions_message_fk"
            columns: ["message_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "communication_automation_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_automation_executions_rule_fk"
            columns: ["rule_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "communication_automation_rules"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      communication_automation_rules: {
        Row: {
          branch_id: string | null
          code: string
          conditions: Json
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          is_active: boolean
          organization_id: string
          template_version_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id?: string | null
          code: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          is_active?: boolean
          organization_id: string
          template_version_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string | null
          code?: string
          conditions?: Json
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          template_version_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_automation_rules_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "communication_automation_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_automation_rules_template_fk"
            columns: ["template_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "message_template_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      communication_consents: {
        Row: {
          branch_id: string
          channel: Database["erp"]["Enums"]["communication_channel"]
          customer_id: string
          event_sequence: number
          granted: boolean
          id: string
          organization_id: string
          reason: string
          recorded_at: string
          recorded_by: string | null
          source: string
        }
        Insert: {
          branch_id: string
          channel: Database["erp"]["Enums"]["communication_channel"]
          customer_id: string
          event_sequence?: never
          granted: boolean
          id?: string
          organization_id: string
          reason: string
          recorded_at?: string
          recorded_by?: string | null
          source: string
        }
        Update: {
          branch_id?: string
          channel?: Database["erp"]["Enums"]["communication_channel"]
          customer_id?: string
          event_sequence?: never
          granted?: boolean
          id?: string
          organization_id?: string
          reason?: string
          recorded_at?: string
          recorded_by?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_consents_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "communication_consents_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "communication_consents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_message_events: {
        Row: {
          branch_id: string
          error_message: string | null
          event_sequence: number
          id: string
          message_id: string
          occurred_at: string
          organization_id: string
          provider: string | null
          provider_event_id: string | null
          provider_message_id: string | null
          response_sha256: string | null
          status: Database["erp"]["Enums"]["communication_status"]
        }
        Insert: {
          branch_id: string
          error_message?: string | null
          event_sequence?: never
          id?: string
          message_id: string
          occurred_at?: string
          organization_id: string
          provider?: string | null
          provider_event_id?: string | null
          provider_message_id?: string | null
          response_sha256?: string | null
          status: Database["erp"]["Enums"]["communication_status"]
        }
        Update: {
          branch_id?: string
          error_message?: string | null
          event_sequence?: never
          id?: string
          message_id?: string
          occurred_at?: string
          organization_id?: string
          provider?: string | null
          provider_event_id?: string | null
          provider_message_id?: string | null
          response_sha256?: string | null
          status?: Database["erp"]["Enums"]["communication_status"]
        }
        Relationships: [
          {
            foreignKeyName: "communication_message_events_message_fk"
            columns: ["message_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "communication_messages"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "communication_message_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_messages: {
        Row: {
          body_snapshot: string
          branch_id: string
          channel: Database["erp"]["Enums"]["communication_channel"]
          conversation_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          direction: Database["erp"]["Enums"]["communication_direction"]
          id: string
          organization_id: string
          recipient_address: string | null
          template_version_id: string | null
          variables_snapshot: Json
        }
        Insert: {
          body_snapshot: string
          branch_id: string
          channel: Database["erp"]["Enums"]["communication_channel"]
          conversation_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          direction: Database["erp"]["Enums"]["communication_direction"]
          id?: string
          organization_id: string
          recipient_address?: string | null
          template_version_id?: string | null
          variables_snapshot?: Json
        }
        Update: {
          body_snapshot?: string
          branch_id?: string
          channel?: Database["erp"]["Enums"]["communication_channel"]
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          direction?: Database["erp"]["Enums"]["communication_direction"]
          id?: string
          organization_id?: string
          recipient_address?: string | null
          template_version_id?: string | null
          variables_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "communication_messages_conversation_fk"
            columns: ["conversation_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "communication_messages_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "communication_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_messages_template_fk"
            columns: ["template_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "message_template_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      configuration_values: {
        Row: {
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          is_secret: boolean
          is_system: boolean
          key: string
          organization_id: string
          updated_at: string
          updated_by: string | null
          value: Json
          version: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_secret?: boolean
          is_system?: boolean
          key: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          value: Json
          version?: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_secret?: boolean
          is_system?: boolean
          key?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "configuration_branch_organization_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "configuration_values_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuration_values_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          assigned_user_id: string | null
          branch_id: string
          conversation_id: string
          event_sequence: number
          id: string
          organization_id: string
          reason: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_user_id?: string | null
          branch_id: string
          conversation_id: string
          event_sequence?: never
          id?: string
          organization_id: string
          reason: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          assigned_user_id?: string | null
          branch_id?: string
          conversation_id?: string
          event_sequence?: never
          id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_assignments_conversation_fk"
            columns: ["conversation_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "conversation_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          branch_id: string
          channel: Database["erp"]["Enums"]["communication_channel"]
          closed_at: string | null
          customer_id: string | null
          id: string
          opened_at: string
          organization_id: string
          provider_conversation_id: string | null
        }
        Insert: {
          branch_id: string
          channel: Database["erp"]["Enums"]["communication_channel"]
          closed_at?: string | null
          customer_id?: string | null
          id?: string
          opened_at?: string
          organization_id: string
          provider_conversation_id?: string | null
        }
        Update: {
          branch_id?: string
          channel?: Database["erp"]["Enums"]["communication_channel"]
          closed_at?: string | null
          customer_id?: string | null
          id?: string
          opened_at?: string
          organization_id?: string
          provider_conversation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_account_entries: {
        Row: {
          actor_id: string | null
          amount_base_delta: number
          branch_id: string
          customer_id: string
          entry_kind: string
          id: number
          occurred_at: string
          organization_id: string
          payment_id: string | null
          receivable_id: string
        }
        Insert: {
          actor_id?: string | null
          amount_base_delta: number
          branch_id: string
          customer_id: string
          entry_kind: string
          id?: never
          occurred_at?: string
          organization_id: string
          payment_id?: string | null
          receivable_id: string
        }
        Update: {
          actor_id?: string | null
          amount_base_delta?: number
          branch_id?: string
          customer_id?: string
          entry_kind?: string
          id?: never
          occurred_at?: string
          organization_id?: string
          payment_id?: string | null
          receivable_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_account_entries_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "customer_account_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_account_entries_payment_fk"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "customer_account_entries_receivable_fk"
            columns: ["receivable_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "customer_receivables"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      customer_equipment: {
        Row: {
          brand_id: string | null
          brand_snapshot: string
          color_snapshot: string | null
          created_at: string
          created_by: string | null
          equipment_type: string
          id: string
          imei: string | null
          model_id: string | null
          model_snapshot: string
          normalized_imei: string | null
          normalized_serial_number: string | null
          notes: string | null
          organization_id: string
          serial_number: string | null
        }
        Insert: {
          brand_id?: string | null
          brand_snapshot: string
          color_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          equipment_type: string
          id?: string
          imei?: string | null
          model_id?: string | null
          model_snapshot: string
          normalized_imei?: string | null
          normalized_serial_number?: string | null
          notes?: string | null
          organization_id: string
          serial_number?: string | null
        }
        Update: {
          brand_id?: string | null
          brand_snapshot?: string
          color_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          equipment_type?: string
          id?: string
          imei?: string | null
          model_id?: string | null
          model_snapshot?: string
          normalized_imei?: string | null
          normalized_serial_number?: string | null
          notes?: string | null
          organization_id?: string
          serial_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_equipment_brand_fk"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "customer_equipment_model_fk"
            columns: ["model_id", "organization_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id", "organization_id", "brand_id"]
          },
          {
            foreignKeyName: "customer_equipment_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_private_details: {
        Row: {
          address: Json
          communication_consent: boolean
          consent_recorded_at: string | null
          created_at: string
          customer_id: string
          id: string
          identity_document: string | null
          internal_notes: string | null
          organization_id: string
          tax_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: Json
          communication_consent?: boolean
          consent_recorded_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          identity_document?: string | null
          internal_notes?: string | null
          organization_id: string
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: Json
          communication_consent?: boolean
          consent_recorded_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          identity_document?: string | null
          internal_notes?: string | null
          organization_id?: string
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_private_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "customer_private_details_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_receivables: {
        Row: {
          branch_id: string
          created_at: string
          currency_code: string
          customer_id: string
          id: string
          organization_id: string
          original_amount: number
          original_amount_base: number
          sale_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          currency_code: string
          customer_id: string
          id?: string
          organization_id: string
          original_amount: number
          original_amount_base: number
          sale_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          currency_code?: string
          customer_id?: string
          id?: string
          organization_id?: string
          original_amount?: number
          original_amount_base?: number
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_receivables_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "customer_receivables_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "customer_receivables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_receivables_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      customers: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          kind: Database["erp"]["Enums"]["party_kind"]
          legal_name: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          updated_by: string | null
          whatsapp_phone: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          display_name: string
          email?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["erp"]["Enums"]["party_kind"]
          legal_name?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          whatsapp_phone?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["erp"]["Enums"]["party_kind"]
          legal_name?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_counters: {
        Row: {
          branch_id: string
          invoice_kind: string
          last_number: number
          organization_id: string
        }
        Insert: {
          branch_id: string
          invoice_kind: string
          last_number?: number
          organization_id: string
        }
        Update: {
          branch_id?: string
          invoice_kind?: string
          last_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_counters_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_events: {
        Row: {
          actor_id: string | null
          branch_id: string
          document_id: string
          event_sequence: number
          id: string
          occurred_at: string
          organization_id: string
          reason: string
          status: Database["erp"]["Enums"]["document_status"]
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          document_id: string
          event_sequence?: never
          id?: string
          occurred_at?: string
          organization_id: string
          reason: string
          status: Database["erp"]["Enums"]["document_status"]
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          document_id?: string
          event_sequence?: never
          id?: string
          occurred_at?: string
          organization_id?: string
          reason?: string
          status?: Database["erp"]["Enums"]["document_status"]
        }
        Relationships: [
          {
            foreignKeyName: "document_events_document_fk"
            columns: ["document_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "document_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          organization_id: string
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: Json
          id?: string
          organization_id: string
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          organization_id?: string
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_template_versions_template_fk"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      document_templates: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          document_kind: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          document_kind: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          document_kind?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          branch_id: string
          content_sha256: string
          customer_snapshot: Json
          document_number: string
          id: string
          invoice_kind: string | null
          issued_at: string
          issued_by: string | null
          organization_id: string
          owner_id: string
          owner_type: string
          private_object_path: string | null
          status: Database["erp"]["Enums"]["document_status"]
          template_version_id: string
        }
        Insert: {
          branch_id: string
          content_sha256: string
          customer_snapshot: Json
          document_number: string
          id?: string
          invoice_kind?: string | null
          issued_at?: string
          issued_by?: string | null
          organization_id: string
          owner_id: string
          owner_type: string
          private_object_path?: string | null
          status?: Database["erp"]["Enums"]["document_status"]
          template_version_id: string
        }
        Update: {
          branch_id?: string
          content_sha256?: string
          customer_snapshot?: Json
          document_number?: string
          id?: string
          invoice_kind?: string | null
          issued_at?: string
          issued_by?: string | null
          organization_id?: string
          owner_id?: string
          owner_type?: string
          private_object_path?: string | null
          status?: Database["erp"]["Enums"]["document_status"]
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_template_fk"
            columns: ["template_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      equipment_ownership_events: {
        Row: {
          actor_id: string | null
          customer_id: string
          effective_at: string
          equipment_id: string
          event_sequence: number
          id: string
          organization_id: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          customer_id: string
          effective_at?: string
          equipment_id: string
          event_sequence?: never
          id?: string
          organization_id: string
          reason: string
        }
        Update: {
          actor_id?: string | null
          customer_id?: string
          effective_at?: string
          equipment_id?: string
          event_sequence?: never
          id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_ownership_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "equipment_ownership_equipment_fk"
            columns: ["equipment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "equipment_ownership_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rate_snapshots: {
        Row: {
          base_currency: string
          captured_at: string
          created_at: string
          exchange_rate_id: string
          id: string
          organization_id: string
          quote_currency: string
          quoted_at: string
          rate_to_base: number
          source: string
        }
        Insert: {
          base_currency: string
          captured_at: string
          created_at?: string
          exchange_rate_id: string
          id?: string
          organization_id: string
          quote_currency: string
          quoted_at: string
          rate_to_base: number
          source: string
        }
        Update: {
          base_currency?: string
          captured_at?: string
          created_at?: string
          exchange_rate_id?: string
          id?: string
          organization_id?: string
          quote_currency?: string
          quoted_at?: string
          rate_to_base?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rate_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_rate_snapshots_rate_fk"
            columns: ["exchange_rate_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          base_currency: string
          captured_at: string
          captured_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          quote_currency: string
          quoted_at: string
          rate_to_base: number
          request_hash: string
          source: string
        }
        Insert: {
          base_currency: string
          captured_at?: string
          captured_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          quote_currency: string
          quoted_at: string
          rate_to_base: number
          request_hash: string
          source: string
        }
        Update: {
          base_currency?: string
          captured_at?: string
          captured_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          quote_currency?: string
          quoted_at?: string
          rate_to_base?: number
          request_hash?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_base_currency_fk"
            columns: ["organization_id", "base_currency"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "exchange_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_rates_quote_currency_fk"
            columns: ["organization_id", "quote_currency"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
        ]
      }
      financing_account_entries: {
        Row: {
          actor_id: string | null
          amount_base_delta: number
          branch_id: string
          contract_id: string
          customer_id: string
          entry_kind: string
          id: number
          occurred_at: string
          organization_id: string
          receivable_payment_id: string
        }
        Insert: {
          actor_id?: string | null
          amount_base_delta: number
          branch_id: string
          contract_id: string
          customer_id: string
          entry_kind: string
          id?: never
          occurred_at?: string
          organization_id: string
          receivable_payment_id: string
        }
        Update: {
          actor_id?: string | null
          amount_base_delta?: number
          branch_id?: string
          contract_id?: string
          customer_id?: string
          entry_kind?: string
          id?: never
          occurred_at?: string
          organization_id?: string
          receivable_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financing_account_entries_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "financing_account_entries_contract_fk"
            columns: ["contract_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financing_contracts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "financing_account_entries_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "financing_account_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_account_entries_payment_fk"
            columns: ["receivable_payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "receivable_payments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      financing_contracts: {
        Row: {
          branch_id: string
          contract_reference: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          customer_id: string
          down_payment_amount: number
          exchange_snapshot_id: string | null
          financed_amount: number
          first_due_date: string
          id: string
          idempotency_key: string
          installment_count: number
          monthly_interest_rate: number
          organization_id: string
          principal_amount: number
          reason: string
          status: Database["erp"]["Enums"]["financing_status"]
        }
        Insert: {
          branch_id: string
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          customer_id: string
          down_payment_amount?: number
          exchange_snapshot_id?: string | null
          financed_amount: number
          first_due_date: string
          id?: string
          idempotency_key: string
          installment_count: number
          monthly_interest_rate?: number
          organization_id: string
          principal_amount: number
          reason: string
          status?: Database["erp"]["Enums"]["financing_status"]
        }
        Update: {
          branch_id?: string
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          customer_id?: string
          down_payment_amount?: number
          exchange_snapshot_id?: string | null
          financed_amount?: number
          first_due_date?: string
          id?: string
          idempotency_key?: string
          installment_count?: number
          monthly_interest_rate?: number
          organization_id?: string
          principal_amount?: number
          reason?: string
          status?: Database["erp"]["Enums"]["financing_status"]
        }
        Relationships: [
          {
            foreignKeyName: "financing_contracts_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "financing_contracts_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "financing_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financing_contracts_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      financing_installments: {
        Row: {
          contract_id: string
          created_at: string
          due_date: string
          id: string
          installment_number: number
          interest_due: number
          late_fee_due: number
          organization_id: string
          paid_interest: number
          paid_late_fee: number
          paid_principal: number
          principal_due: number
          status: Database["erp"]["Enums"]["financing_installment_status"]
        }
        Insert: {
          contract_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          interest_due?: number
          late_fee_due?: number
          organization_id: string
          paid_interest?: number
          paid_late_fee?: number
          paid_principal?: number
          principal_due: number
          status?: Database["erp"]["Enums"]["financing_installment_status"]
        }
        Update: {
          contract_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          interest_due?: number
          late_fee_due?: number
          organization_id?: string
          paid_interest?: number
          paid_late_fee?: number
          paid_principal?: number
          principal_due?: number
          status?: Database["erp"]["Enums"]["financing_installment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "financing_installments_contract_fk"
            columns: ["contract_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financing_contracts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "financing_installments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_counters: {
        Row: {
          fiscal_point_id: string
          last_number: number
          organization_id: string
          voucher_type: string
        }
        Insert: {
          fiscal_point_id: string
          last_number?: number
          organization_id: string
          voucher_type: string
        }
        Update: {
          fiscal_point_id?: string
          last_number?: number
          organization_id?: string
          voucher_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_counters_point_fk"
            columns: ["fiscal_point_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "fiscal_points"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      fiscal_events: {
        Row: {
          branch_id: string
          cae: string | null
          cae_expires_on: string | null
          error_code: string | null
          error_message: string | null
          event_sequence: number
          fiscal_request_id: string
          id: string
          occurred_at: string
          organization_id: string
          provider: string
          provider_event_id: string
          response_sha256: string
          status: Database["erp"]["Enums"]["fiscal_status"]
        }
        Insert: {
          branch_id: string
          cae?: string | null
          cae_expires_on?: string | null
          error_code?: string | null
          error_message?: string | null
          event_sequence?: never
          fiscal_request_id: string
          id?: string
          occurred_at?: string
          organization_id: string
          provider: string
          provider_event_id: string
          response_sha256: string
          status: Database["erp"]["Enums"]["fiscal_status"]
        }
        Update: {
          branch_id?: string
          cae?: string | null
          cae_expires_on?: string | null
          error_code?: string | null
          error_message?: string | null
          event_sequence?: never
          fiscal_request_id?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          provider?: string
          provider_event_id?: string
          response_sha256?: string
          status?: Database["erp"]["Enums"]["fiscal_status"]
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_events_request_fk"
            columns: ["fiscal_request_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "fiscal_requests"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      fiscal_points: {
        Row: {
          branch_id: string
          code: number
          environment: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          branch_id: string
          code: number
          environment: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          branch_id?: string
          code?: number
          environment?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_points_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "fiscal_points_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_requests: {
        Row: {
          branch_id: string
          document_id: string
          fiscal_point_id: string
          id: string
          organization_id: string
          request_sha256: string
          requested_at: string
          requested_by: string | null
          voucher_number: number
          voucher_type: string
        }
        Insert: {
          branch_id: string
          document_id: string
          fiscal_point_id: string
          id?: string
          organization_id: string
          request_sha256: string
          requested_at?: string
          requested_by?: string | null
          voucher_number: number
          voucher_type: string
        }
        Update: {
          branch_id?: string
          document_id?: string
          fiscal_point_id?: string
          id?: string
          organization_id?: string
          request_sha256?: string
          requested_at?: string
          requested_by?: string | null
          voucher_number?: number
          voucher_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_requests_document_fk"
            columns: ["document_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "fiscal_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_requests_point_fk"
            columns: ["fiscal_point_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "fiscal_points"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      integration_attempts: {
        Row: {
          attempt_number: number
          attempted_at: string
          attempted_by: string | null
          error_message: string | null
          id: string
          organization_id: string
          outbox_id: string
          retry_request_id: string | null
          status: Database["erp"]["Enums"]["integration_attempt_status"]
          worker_claim_token: string | null
        }
        Insert: {
          attempt_number: number
          attempted_at?: string
          attempted_by?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          outbox_id: string
          retry_request_id?: string | null
          status: Database["erp"]["Enums"]["integration_attempt_status"]
          worker_claim_token?: string | null
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          attempted_by?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          outbox_id?: string
          retry_request_id?: string | null
          status?: Database["erp"]["Enums"]["integration_attempt_status"]
          worker_claim_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_attempts_outbox_fk"
            columns: ["outbox_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "integration_attempts_retry_request_fk"
            columns: ["retry_request_id", "outbox_id"]
            isOneToOne: false
            referencedRelation: "integration_retry_requests"
            referencedColumns: ["id", "outbox_id"]
          },
        ]
      }
      integration_dead_letters: {
        Row: {
          branch_id: string
          id: string
          moved_at: string
          moved_by: string | null
          organization_id: string
          outbox_id: string
          reason: string
        }
        Insert: {
          branch_id: string
          id?: string
          moved_at?: string
          moved_by?: string | null
          organization_id: string
          outbox_id: string
          reason: string
        }
        Update: {
          branch_id?: string
          id?: string
          moved_at?: string
          moved_by?: string | null
          organization_id?: string
          outbox_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_dead_letters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_dead_letters_outbox_fk"
            columns: ["outbox_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      integration_outbox: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          available_at: string
          branch_id: string
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          organization_id: string
          payload: Json
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          available_at?: string
          branch_id: string
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          organization_id: string
          payload: Json
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          available_at?: string
          branch_id?: string
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "integration_outbox_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "integration_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_retry_claims: {
        Row: {
          branch_id: string
          claim_token: string
          claimed_at: string
          id: string
          lease_expires_at: string
          organization_id: string
          outbox_id: string
          retry_request_id: string
        }
        Insert: {
          branch_id: string
          claim_token?: string
          claimed_at?: string
          id?: string
          lease_expires_at: string
          organization_id: string
          outbox_id: string
          retry_request_id: string
        }
        Update: {
          branch_id?: string
          claim_token?: string
          claimed_at?: string
          id?: string
          lease_expires_at?: string
          organization_id?: string
          outbox_id?: string
          retry_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_retry_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_retry_claims_outbox_fk"
            columns: ["outbox_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "integration_retry_claims_request_fk"
            columns: ["retry_request_id", "outbox_id"]
            isOneToOne: false
            referencedRelation: "integration_retry_requests"
            referencedColumns: ["id", "outbox_id"]
          },
        ]
      }
      integration_retry_requests: {
        Row: {
          action: Database["erp"]["Enums"]["integration_retry_action"]
          attempt_count_snapshot: number
          available_at: string
          branch_id: string
          id: string
          operation_key: string
          organization_id: string
          outbox_id: string
          reason: string
          request_hash: string
          request_origin: string
          requested_at: string
          requested_by: string | null
          retry_sequence: number
          root_request_id: string
        }
        Insert: {
          action: Database["erp"]["Enums"]["integration_retry_action"]
          attempt_count_snapshot: number
          available_at: string
          branch_id: string
          id?: string
          operation_key: string
          organization_id: string
          outbox_id: string
          reason: string
          request_hash: string
          request_origin: string
          requested_at?: string
          requested_by?: string | null
          retry_sequence: number
          root_request_id: string
        }
        Update: {
          action?: Database["erp"]["Enums"]["integration_retry_action"]
          attempt_count_snapshot?: number
          available_at?: string
          branch_id?: string
          id?: string
          operation_key?: string
          organization_id?: string
          outbox_id?: string
          reason?: string
          request_hash?: string
          request_origin?: string
          requested_at?: string
          requested_by?: string | null
          retry_sequence?: number
          root_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_retry_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_retry_requests_outbox_fk"
            columns: ["outbox_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "integration_retry_requests_root_fk"
            columns: ["root_request_id"]
            isOneToOne: false
            referencedRelation: "integration_retry_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_cost_balances: {
        Row: {
          branch_id: string
          id: string
          organization_id: string
          product_id: string
          total_cost_base: number
          updated_at: string
          valued_quantity: number
          variant_id: string | null
          variant_key: string | null
          weighted_average_cost: number
        }
        Insert: {
          branch_id: string
          id?: string
          organization_id: string
          product_id: string
          total_cost_base: number
          updated_at?: string
          valued_quantity: number
          variant_id?: string | null
          variant_key?: string | null
          weighted_average_cost: number
        }
        Update: {
          branch_id?: string
          id?: string
          organization_id?: string
          product_id?: string
          total_cost_base?: number
          updated_at?: string
          valued_quantity?: number
          variant_id?: string | null
          variant_key?: string | null
          weighted_average_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cost_balances_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_cost_balances_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_balances_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_balances_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      inventory_cost_entries: {
        Row: {
          branch_id: string
          entry_kind: Database["erp"]["Enums"]["cost_entry_kind"]
          id: number
          inventory_unit_id: string | null
          occurred_at: string
          organization_id: string
          product_id: string
          quantity_delta: number
          receipt_id: string
          receipt_line_id: string
          total_cost_base: number
          unit_cost_base: number
          variant_id: string | null
        }
        Insert: {
          branch_id: string
          entry_kind: Database["erp"]["Enums"]["cost_entry_kind"]
          id?: never
          inventory_unit_id?: string | null
          occurred_at?: string
          organization_id: string
          product_id: string
          quantity_delta: number
          receipt_id: string
          receipt_line_id: string
          total_cost_base: number
          unit_cost_base: number
          variant_id?: string | null
        }
        Update: {
          branch_id?: string
          entry_kind?: Database["erp"]["Enums"]["cost_entry_kind"]
          id?: never
          inventory_unit_id?: string | null
          occurred_at?: string
          organization_id?: string
          product_id?: string
          quantity_delta?: number
          receipt_id?: string
          receipt_line_id?: string
          total_cost_base?: number
          unit_cost_base?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_cost_entries_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_line_fk"
            columns: ["receipt_line_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipt_lines"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_receipt_fk"
            columns: ["receipt_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_cost_entries_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      inventory_count_lines: {
        Row: {
          count_id: string
          counted_at: string | null
          counted_by: string | null
          counted_quantity: number | null
          expected_quantity: number
          id: string
          inventory_unit_id: string | null
          notes: string | null
          organization_id: string
          product_id: string
          variant_id: string | null
        }
        Insert: {
          count_id: string
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          expected_quantity: number
          id?: string
          inventory_unit_id?: string | null
          notes?: string | null
          organization_id: string
          product_id: string
          variant_id?: string | null
        }
        Update: {
          count_id?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          expected_quantity?: number
          id?: string
          inventory_unit_id?: string | null
          notes?: string | null
          organization_id?: string
          product_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_count_fk"
            columns: ["count_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          branch_id: string
          code: string
          created_at: string
          created_by: string | null
          freeze_at: string | null
          id: string
          location_id: string
          notes: string | null
          organization_id: string
          posted_document_id: string | null
          started_at: string | null
          status: Database["erp"]["Enums"]["inventory_count_status"]
          submitted_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          code: string
          created_at?: string
          created_by?: string | null
          freeze_at?: string | null
          id?: string
          location_id: string
          notes?: string | null
          organization_id: string
          posted_document_id?: string | null
          started_at?: string | null
          status?: Database["erp"]["Enums"]["inventory_count_status"]
          submitted_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          freeze_at?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          organization_id?: string
          posted_document_id?: string | null
          started_at?: string | null
          status?: Database["erp"]["Enums"]["inventory_count_status"]
          submitted_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_document_fk"
            columns: ["posted_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_counts_location_fk"
            columns: ["location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "inventory_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_units: {
        Row: {
          acquired_at: string | null
          acquisition_cost: number
          created_at: string
          created_by: string | null
          current_location_id: string | null
          id: string
          imei: string | null
          is_active: boolean
          normalized_imei: string | null
          normalized_serial_number: string | null
          organization_id: string
          product_id: string
          serial_number: string | null
          status: Database["erp"]["Enums"]["inventory_unit_status"]
          updated_at: string
          updated_by: string | null
          variant_id: string | null
        }
        Insert: {
          acquired_at?: string | null
          acquisition_cost?: number
          created_at?: string
          created_by?: string | null
          current_location_id?: string | null
          id?: string
          imei?: string | null
          is_active?: boolean
          normalized_imei?: string | null
          normalized_serial_number?: string | null
          organization_id: string
          product_id: string
          serial_number?: string | null
          status?: Database["erp"]["Enums"]["inventory_unit_status"]
          updated_at?: string
          updated_by?: string | null
          variant_id?: string | null
        }
        Update: {
          acquired_at?: string | null
          acquisition_cost?: number
          created_at?: string
          created_by?: string | null
          current_location_id?: string | null
          id?: string
          imei?: string | null
          is_active?: boolean
          normalized_imei?: string | null
          normalized_serial_number?: string | null
          organization_id?: string
          product_id?: string
          serial_number?: string | null
          status?: Database["erp"]["Enums"]["inventory_unit_status"]
          updated_at?: string
          updated_by?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_units_location_fk"
            columns: ["current_location_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_units_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_units_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          id: string
          idempotency_key: string
          organization_id: string
          period_id: string
          posted_at: string | null
          posted_by: string | null
          reversal_of_entry_id: string | null
          source_id: string | null
          source_type: string | null
          status: Database["erp"]["Enums"]["accounting_entry_status"]
          total_credit: number
          total_debit: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          description: string
          entry_date: string
          id?: string
          idempotency_key: string
          organization_id: string
          period_id: string
          posted_at?: string | null
          posted_by?: string | null
          reversal_of_entry_id?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["erp"]["Enums"]["accounting_entry_status"]
          total_credit?: number
          total_debit?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          period_id?: string
          posted_at?: string | null
          posted_by?: string | null
          reversal_of_entry_id?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["erp"]["Enums"]["accounting_entry_status"]
          total_credit?: number
          total_debit?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "journal_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_period_fk"
            columns: ["period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_fk"
            columns: ["reversal_of_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          currency_code: string
          debit: number
          description: string
          exchange_rate: number
          id: string
          journal_entry_id: string
          line_number: number
          organization_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          currency_code?: string
          debit?: number
          description: string
          exchange_rate?: number
          id?: string
          journal_entry_id: string
          line_number: number
          organization_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          currency_code?: string
          debit?: number
          description?: string
          exchange_rate?: number
          id?: string
          journal_entry_id?: string
          line_number?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_fk"
            columns: ["account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "journal_entry_lines_entry_fk"
            columns: ["journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "journal_entry_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          allows_negative_stock: boolean
          allows_sale: boolean
          branch_id: string
          code: string
          contributes_to_web_stock: boolean
          created_at: string
          id: string
          is_active: boolean
          kind: Database["erp"]["Enums"]["location_kind"]
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          allows_negative_stock?: boolean
          allows_sale?: boolean
          branch_id: string
          code: string
          contributes_to_web_stock?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["erp"]["Enums"]["location_kind"]
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          allows_negative_stock?: boolean
          allows_sale?: boolean
          branch_id?: string
          code?: string
          contributes_to_web_stock?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["erp"]["Enums"]["location_kind"]
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_branch_organization_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_template_versions: {
        Row: {
          body: string
          created_at: string
          id: string
          language_code: string
          organization_id: string
          provider_template_name: string | null
          template_id: string
          variable_keys: Json
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          language_code?: string
          organization_id: string
          provider_template_name?: string | null
          template_id: string
          variable_keys?: Json
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          language_code?: string
          organization_id?: string
          provider_template_name?: string | null
          template_id?: string
          variable_keys?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "message_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_template_versions_template_fk"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      message_templates: {
        Row: {
          channel: Database["erp"]["Enums"]["communication_channel"]
          code: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          channel: Database["erp"]["Enums"]["communication_channel"]
          code: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          channel?: Database["erp"]["Enums"]["communication_channel"]
          code?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      online_order_refunds: {
        Row: {
          branch_id: string
          id: string
          idempotency_key: string
          journal_reversal_entry_id: string
          organization_id: string
          original_journal_entry_id: string
          payment_reversal_ids: Json
          physical_return_confirmed: boolean
          reason: string
          refund_payment_event_id: string
          refunded_at: string
          refunded_by: string | null
          request_hash: string
          sale_cancellation_event_id: string
          sale_id: string
          stock_reversal_document_id: string
          web_order_id: string
        }
        Insert: {
          branch_id: string
          id?: string
          idempotency_key: string
          journal_reversal_entry_id: string
          organization_id: string
          original_journal_entry_id: string
          payment_reversal_ids: Json
          physical_return_confirmed: boolean
          reason: string
          refund_payment_event_id: string
          refunded_at?: string
          refunded_by?: string | null
          request_hash: string
          sale_cancellation_event_id: string
          sale_id: string
          stock_reversal_document_id: string
          web_order_id: string
        }
        Update: {
          branch_id?: string
          id?: string
          idempotency_key?: string
          journal_reversal_entry_id?: string
          organization_id?: string
          original_journal_entry_id?: string
          payment_reversal_ids?: Json
          physical_return_confirmed?: boolean
          reason?: string
          refund_payment_event_id?: string
          refunded_at?: string
          refunded_by?: string | null
          request_hash?: string
          sale_cancellation_event_id?: string
          sale_id?: string
          stock_reversal_document_id?: string
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_order_refunds_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "online_order_refunds_cancellation_event_fk"
            columns: ["sale_cancellation_event_id"]
            isOneToOne: false
            referencedRelation: "sale_state_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_refunds_event_fk"
            columns: [
              "refund_payment_event_id",
              "organization_id",
              "web_order_id",
            ]
            isOneToOne: false
            referencedRelation: "web_payment_events"
            referencedColumns: ["id", "organization_id", "web_order_id"]
          },
          {
            foreignKeyName: "online_order_refunds_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "online_order_refunds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_refunds_original_journal_fk"
            columns: ["original_journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "online_order_refunds_reversal_journal_fk"
            columns: ["journal_reversal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "online_order_refunds_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "online_order_refunds_stock_fk"
            columns: ["stock_reversal_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      organization_currencies: {
        Row: {
          created_at: string
          currency_code: string
          decimal_places: number
          id: string
          is_active: boolean
          is_base: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code: string
          decimal_places?: number
          id?: string
          is_active?: boolean
          is_base?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          decimal_places?: number
          id?: string
          is_active?: boolean
          is_base?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_currencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_currency: string
          display_name: string
          id: string
          is_active: boolean
          legal_name: string
          tax_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          display_name: string
          id?: string
          is_active?: boolean
          legal_name: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          display_name?: string
          id?: string
          is_active?: boolean
          legal_name?: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          max_installments: number
          name: string
          organization_id: string
          requires_cash_session: boolean
          settlement_kind: string
          surcharge_percent: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          max_installments?: number
          name: string
          organization_id: string
          requires_cash_session?: boolean
          settlement_kind?: string
          surcharge_percent?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          max_installments?: number
          name?: string
          organization_id?: string
          requires_cash_session?: boolean
          settlement_kind?: string
          surcharge_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          actor_id: string | null
          amount: number
          amount_base: number
          branch_id: string
          cash_session_id: string | null
          currency_code: string
          id: string
          idempotency_key: string
          occurred_at: string
          organization_id: string
          payment_method_id: string
          provider_reference: string | null
          reason: string
          repair_order_id: string | null
          request_hash: string
          reversal_of_payment_id: string | null
          sale_id: string | null
        }
        Insert: {
          actor_id?: string | null
          amount: number
          amount_base: number
          branch_id: string
          cash_session_id?: string | null
          currency_code: string
          id?: string
          idempotency_key: string
          occurred_at?: string
          organization_id: string
          payment_method_id: string
          provider_reference?: string | null
          reason: string
          repair_order_id?: string | null
          request_hash: string
          reversal_of_payment_id?: string | null
          sale_id?: string | null
        }
        Update: {
          actor_id?: string | null
          amount?: number
          amount_base?: number
          branch_id?: string
          cash_session_id?: string | null
          currency_code?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string
          payment_method_id?: string
          provider_reference?: string | null
          reason?: string
          repair_order_id?: string | null
          request_hash?: string
          reversal_of_payment_id?: string | null
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "payments_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_repair_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "payments_repair_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "payments_reversal_fk"
            columns: ["reversal_of_payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payments_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "payments_session_fk"
            columns: ["cash_session_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      pc_build_completions: {
        Row: {
          branch_id: string
          completed_at: string
          completed_by: string | null
          equipment_id: string
          id: string
          organization_id: string
          project_id: string
          reservation_batch_id: string
          revision_id: string
          stock_document_id: string
        }
        Insert: {
          branch_id: string
          completed_at?: string
          completed_by?: string | null
          equipment_id: string
          id?: string
          organization_id: string
          project_id: string
          reservation_batch_id: string
          revision_id: string
          stock_document_id: string
        }
        Update: {
          branch_id?: string
          completed_at?: string
          completed_by?: string | null
          equipment_id?: string
          id?: string
          organization_id?: string
          project_id?: string
          reservation_batch_id?: string
          revision_id?: string
          stock_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_completions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_completions_batch_fk"
            columns: ["reservation_batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_reservation_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_completions_equipment_fk"
            columns: ["equipment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_completions_revision_fk"
            columns: [
              "revision_id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
            isOneToOne: false
            referencedRelation: "pc_build_revisions"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
          },
          {
            foreignKeyName: "pc_completions_stock_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_build_components: {
        Row: {
          id: string
          inventory_unit_id: string | null
          line_number: number
          organization_id: string
          product_id: string
          quantity: number
          revision_id: string
          serial_snapshot: string | null
          slot_code: string
          specification_snapshot: Json
          unit_cost_snapshot: number
          variant_id: string | null
          warranty_snapshot: Json
        }
        Insert: {
          id?: string
          inventory_unit_id?: string | null
          line_number: number
          organization_id: string
          product_id: string
          quantity: number
          revision_id: string
          serial_snapshot?: string | null
          slot_code: string
          specification_snapshot: Json
          unit_cost_snapshot: number
          variant_id?: string | null
          warranty_snapshot?: Json
        }
        Update: {
          id?: string
          inventory_unit_id?: string | null
          line_number?: number
          organization_id?: string
          product_id?: string
          quantity?: number
          revision_id?: string
          serial_snapshot?: string | null
          slot_code?: string
          specification_snapshot?: Json
          unit_cost_snapshot?: number
          variant_id?: string | null
          warranty_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_components_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_components_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "pc_components_revision_fk"
            columns: ["revision_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_build_revisions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_components_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_components_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      pc_build_projects: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          organization_id: string
          title: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          organization_id: string
          title: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_projects_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_projects_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_build_reservations: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          project_id: string
          reservation_batch_id: string
          revision_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          project_id: string
          reservation_batch_id: string
          revision_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          reservation_batch_id?: string
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_reservations_batch_fk"
            columns: ["reservation_batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_reservation_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_reservations_project_fk"
            columns: ["project_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "pc_build_projects"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "pc_reservations_project_fk"
            columns: ["project_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "pc_build_projects_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "pc_reservations_revision_fk"
            columns: [
              "revision_id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
            isOneToOne: false
            referencedRelation: "pc_build_revisions"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
          },
        ]
      }
      pc_build_revisions: {
        Row: {
          branch_id: string
          configuration: Json
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          project_id: string
          rule_set_version_id: string
          spec_version_id: string
          supersedes_revision_id: string | null
          version: number
        }
        Insert: {
          branch_id: string
          configuration: Json
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          project_id: string
          rule_set_version_id: string
          spec_version_id: string
          supersedes_revision_id?: string | null
          version: number
        }
        Update: {
          branch_id?: string
          configuration?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          rule_set_version_id?: string
          spec_version_id?: string
          supersedes_revision_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_revisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_revisions_project_fk"
            columns: ["project_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "pc_build_projects"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "pc_revisions_project_fk"
            columns: ["project_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "pc_build_projects_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "pc_revisions_rules_fk"
            columns: ["rule_set_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_rule_set_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_revisions_spec_fk"
            columns: ["spec_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_spec_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_revisions_supersedes_fk"
            columns: [
              "supersedes_revision_id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
            isOneToOne: false
            referencedRelation: "pc_build_revisions"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
          },
        ]
      }
      pc_build_state_events: {
        Row: {
          actor_id: string | null
          branch_id: string
          event_sequence: number
          id: string
          occurred_at: string
          organization_id: string
          project_id: string
          reason: string
          state: Database["erp"]["Enums"]["pc_build_state"]
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          event_sequence?: never
          id?: string
          occurred_at?: string
          organization_id: string
          project_id: string
          reason: string
          state: Database["erp"]["Enums"]["pc_build_state"]
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          event_sequence?: never
          id?: string
          occurred_at?: string
          organization_id?: string
          project_id?: string
          reason?: string
          state?: Database["erp"]["Enums"]["pc_build_state"]
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_state_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_state_project_fk"
            columns: ["project_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "pc_build_projects"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "pc_state_project_fk"
            columns: ["project_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "pc_build_projects_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      pc_compatibility_results: {
        Row: {
          details: Json
          id: string
          message: string
          organization_id: string
          outcome: Database["erp"]["Enums"]["pc_compatibility_outcome"]
          result_code: string
          rule_id: string | null
          run_id: string
        }
        Insert: {
          details?: Json
          id?: string
          message: string
          organization_id: string
          outcome: Database["erp"]["Enums"]["pc_compatibility_outcome"]
          result_code: string
          rule_id?: string | null
          run_id: string
        }
        Update: {
          details?: Json
          id?: string
          message?: string
          organization_id?: string
          outcome?: Database["erp"]["Enums"]["pc_compatibility_outcome"]
          result_code?: string
          rule_id?: string | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_results_rule_fk"
            columns: ["rule_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_rules"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_results_run_fk"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_compatibility_rule_set_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          rule_set_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          rule_set_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          rule_set_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_rule_set_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_rule_set_versions_set_fk"
            columns: ["rule_set_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_rule_sets"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_compatibility_rule_sets: {
        Row: {
          code: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_rule_sets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pc_compatibility_rules: {
        Row: {
          code: string
          definition: Json
          id: string
          message: string
          organization_id: string
          rule_order: number
          rule_set_version_id: string
          severity: Database["erp"]["Enums"]["pc_compatibility_outcome"]
        }
        Insert: {
          code: string
          definition: Json
          id?: string
          message: string
          organization_id: string
          rule_order: number
          rule_set_version_id: string
          severity: Database["erp"]["Enums"]["pc_compatibility_outcome"]
        }
        Update: {
          code?: string
          definition?: Json
          id?: string
          message?: string
          organization_id?: string
          rule_order?: number
          rule_set_version_id?: string
          severity?: Database["erp"]["Enums"]["pc_compatibility_outcome"]
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_rules_version_fk"
            columns: ["rule_set_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_rule_set_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_compatibility_runs: {
        Row: {
          branch_id: string
          completed_at: string
          id: string
          organization_id: string
          outcome: Database["erp"]["Enums"]["pc_compatibility_outcome"]
          project_id: string
          responsible_id: string | null
          revision_id: string
          run_sequence: number
        }
        Insert: {
          branch_id: string
          completed_at?: string
          id?: string
          organization_id: string
          outcome: Database["erp"]["Enums"]["pc_compatibility_outcome"]
          project_id: string
          responsible_id?: string | null
          revision_id: string
          run_sequence?: never
        }
        Update: {
          branch_id?: string
          completed_at?: string
          id?: string
          organization_id?: string
          outcome?: Database["erp"]["Enums"]["pc_compatibility_outcome"]
          project_id?: string
          responsible_id?: string | null
          revision_id?: string
          run_sequence?: never
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_runs_revision_fk"
            columns: [
              "revision_id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
            isOneToOne: false
            referencedRelation: "pc_build_revisions"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
          },
        ]
      }
      pc_compatibility_spec_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          required_slots: Json
          spec_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          required_slots: Json
          spec_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          required_slots?: Json
          spec_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_spec_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_spec_versions_spec_fk"
            columns: ["spec_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_compatibility_specs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_compatibility_specs: {
        Row: {
          code: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_compatibility_specs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pc_component_lineage: {
        Row: {
          completion_id: string
          component_id: string
          id: string
          inventory_unit_id: string | null
          organization_id: string
          product_id: string
          quantity: number
          serial_snapshot: string | null
          unit_cost_snapshot: number
          variant_id: string | null
          warranty_snapshot: Json
        }
        Insert: {
          completion_id: string
          component_id: string
          id?: string
          inventory_unit_id?: string | null
          organization_id: string
          product_id: string
          quantity: number
          serial_snapshot?: string | null
          unit_cost_snapshot: number
          variant_id?: string | null
          warranty_snapshot: Json
        }
        Update: {
          completion_id?: string
          component_id?: string
          id?: string
          inventory_unit_id?: string | null
          organization_id?: string
          product_id?: string
          quantity?: number
          serial_snapshot?: string | null
          unit_cost_snapshot?: number
          variant_id?: string | null
          warranty_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pc_component_lineage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_lineage_completion_fk"
            columns: ["completion_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_build_completions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_lineage_component_fk"
            columns: ["component_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_build_components"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_lineage_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_lineage_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "pc_lineage_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_lineage_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      pc_test_results: {
        Row: {
          id: string
          item_key: string
          measured_value: Json | null
          notes: string | null
          organization_id: string
          result: Database["erp"]["Enums"]["repair_test_result"]
          test_run_id: string
        }
        Insert: {
          id?: string
          item_key: string
          measured_value?: Json | null
          notes?: string | null
          organization_id: string
          result: Database["erp"]["Enums"]["repair_test_result"]
          test_run_id: string
        }
        Update: {
          id?: string
          item_key?: string
          measured_value?: Json | null
          notes?: string | null
          organization_id?: string
          result?: Database["erp"]["Enums"]["repair_test_result"]
          test_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_test_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_test_results_run_fk"
            columns: ["test_run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_test_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_test_runs: {
        Row: {
          branch_id: string
          completed_at: string
          id: string
          notes: string | null
          organization_id: string
          project_id: string
          responsible_id: string
          revision_id: string
          run_sequence: number
          template_version_id: string
        }
        Insert: {
          branch_id: string
          completed_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          project_id: string
          responsible_id: string
          revision_id: string
          run_sequence?: never
          template_version_id: string
        }
        Update: {
          branch_id?: string
          completed_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          project_id?: string
          responsible_id?: string
          revision_id?: string
          run_sequence?: never
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_test_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_test_runs_revision_fk"
            columns: [
              "revision_id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
            isOneToOne: false
            referencedRelation: "pc_build_revisions"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "project_id",
            ]
          },
          {
            foreignKeyName: "pc_test_runs_template_fk"
            columns: ["template_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_test_template_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_test_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          organization_id: string
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: Json
          id?: string
          organization_id: string
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          organization_id?: string
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pc_test_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_test_versions_template_fk"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pc_test_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pc_test_templates: {
        Row: {
          code: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pc_test_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_sensitive: boolean
          module: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_sensitive?: boolean
          module: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_sensitive?: boolean
          module?: string
          name?: string
        }
        Relationships: []
      }
      price_change_applications: {
        Row: {
          applied_at: string
          applied_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          preview_id: string
          reason: string
          request_hash: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          preview_id: string
          reason: string
          request_hash: string
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          preview_id?: string
          reason?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_change_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_change_applications_preview_fk"
            columns: ["preview_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "price_change_previews"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      price_change_preview_lines: {
        Row: {
          baseline_entry_id: number | null
          created_at: string
          current_price: number | null
          id: string
          line_number: number
          organization_id: string
          preview_id: string
          product_id: string
          proposed_price: number
          variant_id: string | null
          variant_key: string | null
        }
        Insert: {
          baseline_entry_id?: number | null
          created_at?: string
          current_price?: number | null
          id?: string
          line_number: number
          organization_id: string
          preview_id: string
          product_id: string
          proposed_price: number
          variant_id?: string | null
          variant_key?: string | null
        }
        Update: {
          baseline_entry_id?: number | null
          created_at?: string
          current_price?: number | null
          id?: string
          line_number?: number
          organization_id?: string
          preview_id?: string
          product_id?: string
          proposed_price?: number
          variant_id?: string | null
          variant_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_change_preview_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_preview_lines_baseline_fk"
            columns: ["baseline_entry_id"]
            isOneToOne: false
            referencedRelation: "price_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_preview_lines_preview_fk"
            columns: ["preview_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "price_change_previews"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "price_preview_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "price_preview_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "price_preview_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      price_change_previews: {
        Row: {
          created_at: string
          created_by: string | null
          formula: Json
          id: string
          idempotency_key: string
          organization_id: string
          price_list_id: string
          reason: string
          request_hash: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          formula: Json
          id?: string
          idempotency_key: string
          organization_id: string
          price_list_id: string
          reason: string
          request_hash: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          formula?: Json
          id?: string
          idempotency_key?: string
          organization_id?: string
          price_list_id?: string
          reason?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_change_previews_list_fk"
            columns: ["price_list_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "price_change_previews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      price_entries: {
        Row: {
          amount: number
          application_id: string
          created_at: string
          currency_code: string
          effective_at: string
          id: number
          organization_id: string
          price_list_id: string
          product_id: string
          variant_id: string | null
          variant_key: string | null
        }
        Insert: {
          amount: number
          application_id: string
          created_at?: string
          currency_code: string
          effective_at: string
          id?: never
          organization_id: string
          price_list_id: string
          product_id: string
          variant_id?: string | null
          variant_key?: string | null
        }
        Update: {
          amount?: number
          application_id?: string
          created_at?: string
          currency_code?: string
          effective_at?: string
          id?: never
          organization_id?: string
          price_list_id?: string
          product_id?: string
          variant_id?: string | null
          variant_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_entries_application_fk"
            columns: ["application_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "price_change_applications"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "price_entries_list_fk"
            columns: ["price_list_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "price_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_entries_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "price_entries_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "price_entries_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      price_lists: {
        Row: {
          code: string
          created_at: string
          currency_code: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          payment_method_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency_code: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          payment_method_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency_code?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          payment_method_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "price_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_payment_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      product_categories: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_fk"
            columns: ["parent_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      product_identifiers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          kind: Database["erp"]["Enums"]["identifier_kind"]
          normalized_value: string | null
          organization_id: string
          product_id: string
          updated_at: string
          updated_by: string | null
          value: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          kind: Database["erp"]["Enums"]["identifier_kind"]
          normalized_value?: string | null
          organization_id: string
          product_id: string
          updated_at?: string
          updated_by?: string | null
          value: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          kind?: Database["erp"]["Enums"]["identifier_kind"]
          normalized_value?: string | null
          organization_id?: string
          product_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_identifiers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_identifiers_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_identifiers_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "product_identifiers_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      product_models: {
        Row: {
          brand_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_models_brand_fk"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_models_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_types: {
        Row: {
          code: string
          created_at: string
          default_tracking_mode: Database["erp"]["Enums"]["inventory_tracking_mode"]
          id: string
          is_active: boolean
          item_kind: Database["erp"]["Enums"]["catalog_item_kind"]
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_tracking_mode: Database["erp"]["Enums"]["inventory_tracking_mode"]
          id?: string
          is_active?: boolean
          item_kind: Database["erp"]["Enums"]["catalog_item_kind"]
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_tracking_mode?: Database["erp"]["Enums"]["inventory_tracking_mode"]
          id?: string
          is_active?: boolean
          item_kind?: Database["erp"]["Enums"]["catalog_item_kind"]
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attributes: Json
          code: string
          created_at: string
          id: string
          image_path: string | null
          is_active: boolean
          name: string
          organization_id: string
          price_delta: number
          product_id: string
          updated_at: string
        }
        Insert: {
          attributes?: Json
          code: string
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          name: string
          organization_id: string
          price_delta?: number
          product_id: string
          updated_at?: string
        }
        Update: {
          attributes?: Json
          code?: string
          created_at?: string
          id?: string
          image_path?: string | null
          is_active?: boolean
          name?: string
          organization_id?: string
          price_delta?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
        ]
      }
      products: {
        Row: {
          admission_date: string
          allow_online_sale: boolean
          base_cost: number
          base_sale_price: number
          brand_id: string | null
          can_sell: boolean
          can_use_as_repair_part: boolean
          category_id: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_code: string
          internal_description: string | null
          internal_image_path: string | null
          internal_name: string
          inventory_tracking: Database["erp"]["Enums"]["inventory_tracking_mode"]
          is_active: boolean
          item_kind: Database["erp"]["Enums"]["catalog_item_kind"]
          minimum_stock: number
          model_id: string | null
          normalized_internal_code: string | null
          organization_id: string
          product_type_id: string
          public_description: string | null
          public_name: string | null
          publish_on_web: boolean
          purchase_currency: string
          service_price_mode: Database["erp"]["Enums"]["service_price_mode"]
          target_margin_percent: number | null
          tax_rate_percent: number
          unit_id: string
          updated_at: string
          updated_by: string | null
          warranty_days: number
          web_image_path: string | null
          zero_stock_behavior: Database["erp"]["Enums"]["zero_stock_behavior"]
        }
        Insert: {
          admission_date?: string
          allow_online_sale?: boolean
          base_cost?: number
          base_sale_price?: number
          brand_id?: string | null
          can_sell?: boolean
          can_use_as_repair_part?: boolean
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_code: string
          internal_description?: string | null
          internal_image_path?: string | null
          internal_name: string
          inventory_tracking: Database["erp"]["Enums"]["inventory_tracking_mode"]
          is_active?: boolean
          item_kind: Database["erp"]["Enums"]["catalog_item_kind"]
          minimum_stock?: number
          model_id?: string | null
          normalized_internal_code?: string | null
          organization_id: string
          product_type_id: string
          public_description?: string | null
          public_name?: string | null
          publish_on_web?: boolean
          purchase_currency?: string
          service_price_mode?: Database["erp"]["Enums"]["service_price_mode"]
          target_margin_percent?: number | null
          tax_rate_percent?: number
          unit_id: string
          updated_at?: string
          updated_by?: string | null
          warranty_days?: number
          web_image_path?: string | null
          zero_stock_behavior?: Database["erp"]["Enums"]["zero_stock_behavior"]
        }
        Update: {
          admission_date?: string
          allow_online_sale?: boolean
          base_cost?: number
          base_sale_price?: number
          brand_id?: string | null
          can_sell?: boolean
          can_use_as_repair_part?: boolean
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_code?: string
          internal_description?: string | null
          internal_image_path?: string | null
          internal_name?: string
          inventory_tracking?: Database["erp"]["Enums"]["inventory_tracking_mode"]
          is_active?: boolean
          item_kind?: Database["erp"]["Enums"]["catalog_item_kind"]
          minimum_stock?: number
          model_id?: string | null
          normalized_internal_code?: string | null
          organization_id?: string
          product_type_id?: string
          public_description?: string | null
          public_name?: string | null
          publish_on_web?: boolean
          purchase_currency?: string
          service_price_mode?: Database["erp"]["Enums"]["service_price_mode"]
          target_margin_percent?: number | null
          tax_rate_percent?: number
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
          warranty_days?: number
          web_image_path?: string | null
          zero_stock_behavior?: Database["erp"]["Enums"]["zero_stock_behavior"]
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_organization_fk"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_organization_fk"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "products_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_model_organization_fk"
            columns: ["model_id", "organization_id", "brand_id"]
            isOneToOne: false
            referencedRelation: "product_models"
            referencedColumns: ["id", "organization_id", "brand_id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_product_type_fk"
            columns: ["product_type_id", "organization_id", "item_kind"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id", "organization_id", "item_kind"]
          },
          {
            foreignKeyName: "products_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_unit_organization_fk"
            columns: ["unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      profile_permission_overrides: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          effect: Database["erp"]["Enums"]["permission_effect"]
          id: string
          organization_id: string
          permission_id: string
          profile_id: string
          reason: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          effect: Database["erp"]["Enums"]["permission_effect"]
          id?: string
          organization_id: string
          permission_id: string
          profile_id: string
          reason: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          effect?: Database["erp"]["Enums"]["permission_effect"]
          id?: string
          organization_id?: string
          permission_id?: string
          profile_id?: string
          reason?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_override_branch_organization_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "permission_override_profile_organization_fk"
            columns: ["profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "profile_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_permission_overrides_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_roles: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          profile_id: string
          role_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          profile_id: string
          role_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          profile_id?: string
          role_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_roles_branch_organization_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "profile_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_roles_profile_organization_fk"
            columns: ["profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "profile_roles_role_organization_fk"
            columns: ["role_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          employee_code: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          organization_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          employee_code?: string | null
          id: string
          is_active?: boolean
          last_seen_at?: string | null
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          employee_code?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          organization_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_webhook_events: {
        Row: {
          branch_id: string
          event_type: string
          id: string
          organization_id: string
          payload_sha256: string
          provider: string
          provider_event_id: string
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          branch_id: string
          event_type: string
          id?: string
          organization_id: string
          payload_sha256: string
          provider: string
          provider_event_id: string
          received_at?: string
          signature_valid: boolean
        }
        Update: {
          branch_id?: string
          event_type?: string
          id?: string
          organization_id?: string
          payload_sha256?: string
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "provider_webhook_events_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "provider_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_approval_events: {
        Row: {
          action: Database["erp"]["Enums"]["purchase_approval_action"]
          actor_id: string | null
          branch_id: string
          id: string
          idempotency_key: string
          occurred_at: string
          organization_id: string
          purchase_order_id: string
          reason: string
          request_hash: string
        }
        Insert: {
          action: Database["erp"]["Enums"]["purchase_approval_action"]
          actor_id?: string | null
          branch_id: string
          id?: string
          idempotency_key: string
          occurred_at?: string
          organization_id: string
          purchase_order_id: string
          reason: string
          request_hash: string
        }
        Update: {
          action?: Database["erp"]["Enums"]["purchase_approval_action"]
          actor_id?: string | null
          branch_id?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string
          purchase_order_id?: string
          reason?: string
          request_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_approval_events_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_approval_events_order_fk"
            columns: ["purchase_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "purchase_approval_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_expense_allocations: {
        Row: {
          amount_base: number
          created_at: string
          expense_id: string
          id: string
          organization_id: string
          receipt_id: string
          receipt_line_id: string
        }
        Insert: {
          amount_base: number
          created_at?: string
          expense_id: string
          id?: string
          organization_id: string
          receipt_id: string
          receipt_line_id: string
        }
        Update: {
          amount_base?: number
          created_at?: string
          expense_id?: string
          id?: string
          organization_id?: string
          receipt_id?: string
          receipt_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_expense_allocations_expense_fk"
            columns: ["expense_id", "organization_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipt_expenses"
            referencedColumns: ["id", "organization_id", "receipt_id"]
          },
          {
            foreignKeyName: "purchase_expense_allocations_line_fk"
            columns: ["receipt_line_id", "organization_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipt_lines"
            referencedColumns: ["id", "organization_id", "receipt_id"]
          },
          {
            foreignKeyName: "purchase_expense_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          created_at: string
          id: string
          line_number: number
          ordered_quantity: number
          organization_id: string
          product_id: string
          purchase_order_id: string
          tax_amount: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          line_number: number
          ordered_quantity: number
          organization_id: string
          product_id: string
          purchase_order_id: string
          tax_amount?: number
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          line_number?: number
          ordered_quantity?: number
          organization_id?: string
          product_id?: string
          purchase_order_id?: string
          tax_amount?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_order_fk"
            columns: ["purchase_order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          branch_id: string
          created_by: string | null
          currency_code: string
          exchange_rate: number
          exchange_snapshot_id: string
          id: string
          idempotency_key: string
          ordered_at: string
          organization_id: string
          reason: string
          request_hash: string
          supplier_id: string
        }
        Insert: {
          branch_id: string
          created_by?: string | null
          currency_code: string
          exchange_rate: number
          exchange_snapshot_id: string
          id?: string
          idempotency_key: string
          ordered_at?: string
          organization_id: string
          reason: string
          request_hash: string
          supplier_id: string
        }
        Update: {
          branch_id?: string
          created_by?: string | null
          currency_code?: string
          exchange_rate?: number
          exchange_snapshot_id?: string
          id?: string
          idempotency_key?: string
          ordered_at?: string
          organization_id?: string
          reason?: string
          request_hash?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_fk"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      purchase_receipt_expenses: {
        Row: {
          amount_base: number
          created_at: string
          description: string
          expense_number: number
          id: string
          kind: Database["erp"]["Enums"]["purchase_expense_kind"]
          organization_id: string
          payable_to_supplier: boolean
          receipt_id: string
        }
        Insert: {
          amount_base: number
          created_at?: string
          description: string
          expense_number: number
          id?: string
          kind: Database["erp"]["Enums"]["purchase_expense_kind"]
          organization_id: string
          payable_to_supplier: boolean
          receipt_id: string
        }
        Update: {
          amount_base?: number
          created_at?: string
          description?: string
          expense_number?: number
          id?: string
          kind?: Database["erp"]["Enums"]["purchase_expense_kind"]
          organization_id?: string
          payable_to_supplier?: boolean
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_expenses_receipt_fk"
            columns: ["receipt_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      purchase_receipt_lines: {
        Row: {
          allocated_expense_base: number
          branch_id: string
          created_at: string
          goods_cost_base: number
          id: string
          inventory_unit_id: string | null
          landed_cost_base: number
          line_number: number
          organization_id: string
          product_id: string
          purchase_order_line_id: string
          quantity: number
          receipt_id: string
          rounding_adjustment_base: number
          to_location_id: string
          unit_landed_cost: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          allocated_expense_base: number
          branch_id: string
          created_at?: string
          goods_cost_base: number
          id?: string
          inventory_unit_id?: string | null
          landed_cost_base: number
          line_number: number
          organization_id: string
          product_id: string
          purchase_order_line_id: string
          quantity: number
          receipt_id: string
          rounding_adjustment_base?: number
          to_location_id: string
          unit_landed_cost: number
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          allocated_expense_base?: number
          branch_id?: string
          created_at?: string
          goods_cost_base?: number
          id?: string
          inventory_unit_id?: string | null
          landed_cost_base?: number
          line_number?: number
          organization_id?: string
          product_id?: string
          purchase_order_line_id?: string
          quantity?: number
          receipt_id?: string
          rounding_adjustment_base?: number
          to_location_id?: string
          unit_landed_cost?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_lines_location_fk"
            columns: ["to_location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_order_line_fk"
            columns: ["purchase_order_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_receipt_fk"
            columns: ["receipt_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipt_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          branch_id: string
          currency_code: string
          exchange_rate: number
          exchange_snapshot_id: string
          expense_total_base: number
          goods_total_base: number
          id: string
          idempotency_key: string
          landed_total_base: number
          organization_id: string
          payable_created: boolean
          purchase_order_id: string
          reason: string
          received_at: string
          received_by: string | null
          request_hash: string
          stock_document_id: string | null
          supplier_id: string
        }
        Insert: {
          branch_id: string
          currency_code: string
          exchange_rate: number
          exchange_snapshot_id: string
          expense_total_base: number
          goods_total_base: number
          id: string
          idempotency_key: string
          landed_total_base: number
          organization_id: string
          payable_created: boolean
          purchase_order_id: string
          reason: string
          received_at?: string
          received_by?: string | null
          request_hash: string
          stock_document_id?: string | null
          supplier_id: string
        }
        Update: {
          branch_id?: string
          currency_code?: string
          exchange_rate?: number
          exchange_snapshot_id?: string
          expense_total_base?: number
          goods_total_base?: number
          id?: string
          idempotency_key?: string
          landed_total_base?: number
          organization_id?: string
          payable_created?: boolean
          purchase_order_id?: string
          reason?: string
          received_at?: string
          received_by?: string | null
          request_hash?: string
          stock_document_id?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipts_order_fk"
            columns: ["purchase_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "purchase_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipts_stock_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_receipts_supplier_fk"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      receivable_payment_allocations: {
        Row: {
          created_at: string
          id: string
          installment_id: string
          interest_amount: number
          late_fee_amount: number
          organization_id: string
          payment_id: string
          principal_amount: number
        }
        Insert: {
          created_at?: string
          id?: string
          installment_id: string
          interest_amount?: number
          late_fee_amount?: number
          organization_id: string
          payment_id: string
          principal_amount?: number
        }
        Update: {
          created_at?: string
          id?: string
          installment_id?: string
          interest_amount?: number
          late_fee_amount?: number
          organization_id?: string
          payment_id?: string
          principal_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "receivable_payment_allocations_installment_fk"
            columns: ["installment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financing_installments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receivable_payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivable_payment_allocations_payment_fk"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "receivable_payments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      receivable_payments: {
        Row: {
          amount: number
          amount_base: number | null
          branch_id: string
          cash_session_id: string | null
          contract_id: string
          created_by: string | null
          currency_code: string
          exchange_rate: number | null
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          organization_id: string
          paid_at: string
          payment_method_id: string | null
          reason: string
          reference: string | null
          request_hash: string | null
          reversed_payment_id: string | null
          settlement_account_id: string | null
        }
        Insert: {
          amount: number
          amount_base?: number | null
          branch_id: string
          cash_session_id?: string | null
          contract_id: string
          created_by?: string | null
          currency_code: string
          exchange_rate?: number | null
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          organization_id: string
          paid_at?: string
          payment_method_id?: string | null
          reason: string
          reference?: string | null
          request_hash?: string | null
          reversed_payment_id?: string | null
          settlement_account_id?: string | null
        }
        Update: {
          amount?: number
          amount_base?: number | null
          branch_id?: string
          cash_session_id?: string | null
          contract_id?: string
          created_by?: string | null
          currency_code?: string
          exchange_rate?: number | null
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          organization_id?: string
          paid_at?: string
          payment_method_id?: string | null
          reason?: string
          reference?: string | null
          request_hash?: string | null
          reversed_payment_id?: string | null
          settlement_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receivable_payments_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receivable_payments_contract_fk"
            columns: ["contract_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "financing_contracts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receivable_payments_journal_fk"
            columns: ["journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receivable_payments_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receivable_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivable_payments_reversal_fk"
            columns: ["reversed_payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "receivable_payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receivable_payments_session_fk"
            columns: ["cash_session_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "receivable_payments_settlement_account_fk"
            columns: ["settlement_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_assignment_events: {
        Row: {
          actor_id: string | null
          assigned_profile_id: string | null
          branch_id: string
          event_sequence: number
          id: string
          occurred_at: string
          organization_id: string
          reason: string
          repair_order_id: string
        }
        Insert: {
          actor_id?: string | null
          assigned_profile_id?: string | null
          branch_id: string
          event_sequence?: never
          id?: string
          occurred_at?: string
          organization_id: string
          reason: string
          repair_order_id: string
        }
        Update: {
          actor_id?: string | null
          assigned_profile_id?: string | null
          branch_id?: string
          event_sequence?: never
          id?: string
          occurred_at?: string
          organization_id?: string
          reason?: string
          repair_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_assignment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_assignment_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_assignment_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_assignment_profile_fk"
            columns: ["assigned_profile_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_commands: {
        Row: {
          branch_id: string
          command_name: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id: string | null
        }
        Insert: {
          branch_id: string
          command_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id?: string | null
        }
        Update: {
          branch_id?: string
          command_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_commands_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_commands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_credential_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_material: string
          key_version: number
          organization_id: string
          rotated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_material: string
          key_version: number
          organization_id: string
          rotated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_material?: string
          key_version?: number
          organization_id?: string
          rotated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_credential_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_credentials: {
        Row: {
          branch_id: string
          cipher_version: number
          ciphertext: string
          created_at: string
          created_by: string | null
          credential_version: number
          id: string
          key_id: string
          organization_id: string
          repair_order_id: string
        }
        Insert: {
          branch_id: string
          cipher_version?: number
          ciphertext: string
          created_at?: string
          created_by?: string | null
          credential_version: number
          id?: string
          key_id: string
          organization_id: string
          repair_order_id: string
        }
        Update: {
          branch_id?: string
          cipher_version?: number
          ciphertext?: string
          created_at?: string
          created_by?: string | null
          credential_version?: number
          id?: string
          key_id?: string
          organization_id?: string
          repair_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_credentials_key_fk"
            columns: ["key_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_credential_keys"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_credentials_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_credentials_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_deliveries: {
        Row: {
          branch_id: string
          delivered_at: string
          delivered_by: string | null
          id: string
          organization_id: string
          recipient_document_suffix: string | null
          recipient_name: string
          repair_order_id: string
          signature_method: string
          signature_reference: string | null
        }
        Insert: {
          branch_id: string
          delivered_at?: string
          delivered_by?: string | null
          id?: string
          organization_id: string
          recipient_document_suffix?: string | null
          recipient_name: string
          repair_order_id: string
          signature_method: string
          signature_reference?: string | null
        }
        Update: {
          branch_id?: string
          delivered_at?: string
          delivered_by?: string | null
          id?: string
          organization_id?: string
          recipient_document_suffix?: string | null
          recipient_name?: string
          repair_order_id?: string
          signature_method?: string
          signature_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_delivery_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_delivery_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      repair_label_events: {
        Row: {
          branch_id: string
          copies: number
          id: string
          organization_id: string
          printed_at: string
          printed_by: string | null
          printer_snapshot: string | null
          repair_order_id: string
          template_code: string
        }
        Insert: {
          branch_id: string
          copies: number
          id?: string
          organization_id: string
          printed_at?: string
          printed_by?: string | null
          printer_snapshot?: string | null
          repair_order_id: string
          template_code: string
        }
        Update: {
          branch_id?: string
          copies?: number
          id?: string
          organization_id?: string
          printed_at?: string
          printed_by?: string | null
          printer_snapshot?: string | null
          repair_order_id?: string
          template_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_label_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_label_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_label_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      repair_labor_facts: {
        Row: {
          branch_id: string
          description: string
          id: string
          organization_id: string
          performed_at: string
          performed_by: string | null
          quantity_hours: number
          repair_order_id: string
          total_cost_base: number | null
          unit_cost_base: number
        }
        Insert: {
          branch_id: string
          description: string
          id?: string
          organization_id: string
          performed_at?: string
          performed_by?: string | null
          quantity_hours: number
          repair_order_id: string
          total_cost_base?: number | null
          unit_cost_base: number
        }
        Update: {
          branch_id?: string
          description?: string
          id?: string
          organization_id?: string
          performed_at?: string
          performed_by?: string | null
          quantity_hours?: number
          repair_order_id?: string
          total_cost_base?: number | null
          unit_cost_base?: number
        }
        Relationships: [
          {
            foreignKeyName: "repair_labor_facts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_labor_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_labor_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      repair_media_upload_tokens: {
        Row: {
          allowed_mime_types: string[]
          branch_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          max_file_count: number
          max_total_bytes: number
          organization_id: string
          repair_order_id: string
          revoked_at: string | null
          token_digest: string
          token_family_id: string
        }
        Insert: {
          allowed_mime_types: string[]
          branch_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          max_file_count: number
          max_total_bytes: number
          organization_id: string
          repair_order_id: string
          revoked_at?: string | null
          token_digest: string
          token_family_id?: string
        }
        Update: {
          allowed_mime_types?: string[]
          branch_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          max_file_count?: number
          max_total_bytes?: number
          organization_id?: string
          repair_order_id?: string
          revoked_at?: string | null
          token_digest?: string
          token_family_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_media_tokens_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_media_tokens_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_media_upload_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_number_counters: {
        Row: {
          branch_id: string
          next_number: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          next_number: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          next_number?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_number_counters_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_number_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_orders: {
        Row: {
          branch_id: string
          customer_id: string
          equipment_id: string
          id: string
          intake_accessories: Json
          intake_condition: string
          intake_damage: string | null
          intake_notes: string | null
          opened_at: string
          opened_by: string | null
          order_code: string
          order_number: number
          organization_id: string
          reported_fault: string
          tracking_token_digest: string
        }
        Insert: {
          branch_id: string
          customer_id: string
          equipment_id: string
          id?: string
          intake_accessories?: Json
          intake_condition: string
          intake_damage?: string | null
          intake_notes?: string | null
          opened_at?: string
          opened_by?: string | null
          order_code: string
          order_number: number
          organization_id: string
          reported_fault: string
          tracking_token_digest: string
        }
        Update: {
          branch_id?: string
          customer_id?: string
          equipment_id?: string
          id?: string
          intake_accessories?: Json
          intake_condition?: string
          intake_damage?: string | null
          intake_notes?: string | null
          opened_at?: string
          opened_by?: string | null
          order_code?: string
          order_number?: number
          organization_id?: string
          reported_fault?: string
          tracking_token_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_orders_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_orders_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_orders_equipment_fk"
            columns: ["equipment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_part_events: {
        Row: {
          action: Database["erp"]["Enums"]["repair_part_action"]
          actor_id: string | null
          branch_id: string
          id: string
          occurred_at: string
          organization_id: string
          repair_order_id: string
          reservation_batch_id: string | null
          reverses_event_id: string | null
          stock_document_id: string | null
        }
        Insert: {
          action: Database["erp"]["Enums"]["repair_part_action"]
          actor_id?: string | null
          branch_id: string
          id?: string
          occurred_at?: string
          organization_id: string
          repair_order_id: string
          reservation_batch_id?: string | null
          reverses_event_id?: string | null
          stock_document_id?: string | null
        }
        Update: {
          action?: Database["erp"]["Enums"]["repair_part_action"]
          actor_id?: string | null
          branch_id?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          repair_order_id?: string
          reservation_batch_id?: string | null
          reverses_event_id?: string | null
          stock_document_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_part_batch_fk"
            columns: ["reservation_batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_reservation_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_part_document_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_part_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_part_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_part_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_part_reverse_fk"
            columns: ["reverses_event_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_part_events"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      repair_private_media: {
        Row: {
          branch_id: string
          byte_size: number
          client_filename: string
          file_slot: number
          id: string
          mime_type: string
          object_path: string
          organization_id: string
          recorded_at: string
          repair_order_id: string
          sha256_digest: string
          upload_token_id: string
        }
        Insert: {
          branch_id: string
          byte_size: number
          client_filename: string
          file_slot: number
          id?: string
          mime_type: string
          object_path: string
          organization_id: string
          recorded_at?: string
          repair_order_id: string
          sha256_digest: string
          upload_token_id: string
        }
        Update: {
          branch_id?: string
          byte_size?: number
          client_filename?: string
          file_slot?: number
          id?: string
          mime_type?: string
          object_path?: string
          organization_id?: string
          recorded_at?: string
          repair_order_id?: string
          sha256_digest?: string
          upload_token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_private_media_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_private_media_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_private_media_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_private_media_token_fk"
            columns: [
              "upload_token_id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
            isOneToOne: false
            referencedRelation: "repair_media_upload_tokens"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
          },
        ]
      }
      repair_quote_lines: {
        Row: {
          description: string
          id: string
          inventory_unit_id: string | null
          kind: Database["erp"]["Enums"]["sale_line_kind"]
          line_number: number
          line_total: number
          organization_id: string
          product_id: string | null
          quantity: number
          quote_id: string
          tax_amount: number
          tax_rate_percent: number
          unit_cost_snapshot: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          description: string
          id?: string
          inventory_unit_id?: string | null
          kind: Database["erp"]["Enums"]["sale_line_kind"]
          line_number: number
          line_total: number
          organization_id: string
          product_id?: string | null
          quantity: number
          quote_id: string
          tax_amount: number
          tax_rate_percent: number
          unit_cost_snapshot: number
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          description?: string
          id?: string
          inventory_unit_id?: string | null
          kind?: Database["erp"]["Enums"]["sale_line_kind"]
          line_number?: number
          line_total?: number
          organization_id?: string
          product_id?: string | null
          quantity?: number
          quote_id?: string
          tax_amount?: number
          tax_rate_percent?: number
          unit_cost_snapshot?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_quote_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_quote_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "repair_quote_lines_quote_fk"
            columns: ["quote_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_quote_lines_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_quote_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      repair_quote_response_events: {
        Row: {
          branch_id: string
          customer_message: string | null
          decision: Database["erp"]["Enums"]["repair_quote_decision"]
          id: string
          occurred_at: string
          organization_id: string
          quote_id: string
          repair_order_id: string
          token_id: string
        }
        Insert: {
          branch_id: string
          customer_message?: string | null
          decision: Database["erp"]["Enums"]["repair_quote_decision"]
          id?: string
          occurred_at?: string
          organization_id: string
          quote_id: string
          repair_order_id: string
          token_id: string
        }
        Update: {
          branch_id?: string
          customer_message?: string | null
          decision?: Database["erp"]["Enums"]["repair_quote_decision"]
          id?: string
          occurred_at?: string
          organization_id?: string
          quote_id?: string
          repair_order_id?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_quote_response_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_response_quote_fk"
            columns: [
              "quote_id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
          },
          {
            foreignKeyName: "repair_quote_response_token_fk"
            columns: ["token_id", "organization_id", "branch_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "repair_quote_response_tokens"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "quote_id",
            ]
          },
        ]
      }
      repair_quote_response_tokens: {
        Row: {
          branch_id: string
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          quote_id: string
          revoked_at: string | null
          token_digest: string
          used_at: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          quote_id: string
          revoked_at?: string | null
          token_digest: string
          used_at?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          quote_id?: string
          revoked_at?: string | null
          token_digest?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_quote_response_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_tokens_quote_fk"
            columns: ["quote_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      repair_quotes: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          exchange_rate: number
          exchange_snapshot_id: string
          expires_at: string | null
          id: string
          issued_at: string | null
          organization_id: string
          repair_order_id: string
          subtotal_amount: number
          supersedes_quote_id: string | null
          tax_amount: number
          total_amount: number
          version: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          exchange_rate: number
          exchange_snapshot_id: string
          expires_at?: string | null
          id?: string
          issued_at?: string | null
          organization_id: string
          repair_order_id: string
          subtotal_amount: number
          supersedes_quote_id?: string | null
          tax_amount: number
          total_amount: number
          version: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          exchange_rate?: number
          exchange_snapshot_id?: string
          expires_at?: string | null
          id?: string
          issued_at?: string | null
          organization_id?: string
          repair_order_id?: string
          subtotal_amount?: number
          supersedes_quote_id?: string | null
          tax_amount?: number
          total_amount?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "repair_quotes_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "repair_quotes_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_quotes_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_quotes_supersedes_fk"
            columns: [
              "supersedes_quote_id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
          },
        ]
      }
      repair_state_events: {
        Row: {
          actor_id: string | null
          branch_id: string
          event_sequence: number
          id: string
          internal_reason: string
          occurred_at: string
          organization_id: string
          public_message: string
          repair_order_id: string
          status_id: string
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          event_sequence?: never
          id?: string
          internal_reason: string
          occurred_at?: string
          organization_id: string
          public_message: string
          repair_order_id: string
          status_id: string
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          event_sequence?: never
          id?: string
          internal_reason?: string
          occurred_at?: string
          organization_id?: string
          public_message?: string
          repair_order_id?: string
          status_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_state_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_state_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_state_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_state_status_fk"
            columns: ["status_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_statuses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_status_transitions: {
        Row: {
          created_at: string
          from_status_id: string
          id: string
          is_active: boolean
          organization_id: string
          required_permission: string
          to_status_id: string
        }
        Insert: {
          created_at?: string
          from_status_id: string
          id?: string
          is_active?: boolean
          organization_id: string
          required_permission?: string
          to_status_id: string
        }
        Update: {
          created_at?: string
          from_status_id?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          required_permission?: string
          to_status_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_status_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_transition_from_fk"
            columns: ["from_status_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_statuses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_transition_to_fk"
            columns: ["to_status_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_statuses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_statuses: {
        Row: {
          code: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_initial: boolean
          is_terminal: boolean
          name: string
          organization_id: string
          public_message: string
          requires_final_tests: boolean
        }
        Insert: {
          code: string
          created_at?: string
          display_order: number
          id?: string
          is_active?: boolean
          is_initial?: boolean
          is_terminal?: boolean
          name: string
          organization_id: string
          public_message: string
          requires_final_tests?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_initial?: boolean
          is_terminal?: boolean
          name?: string
          organization_id?: string
          public_message?: string
          requires_final_tests?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "repair_statuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_test_results: {
        Row: {
          id: string
          item_key: string
          measured_value: Json | null
          notes: string | null
          organization_id: string
          result: Database["erp"]["Enums"]["repair_test_result"]
          test_run_id: string
        }
        Insert: {
          id?: string
          item_key: string
          measured_value?: Json | null
          notes?: string | null
          organization_id: string
          result: Database["erp"]["Enums"]["repair_test_result"]
          test_run_id: string
        }
        Update: {
          id?: string
          item_key?: string
          measured_value?: Json | null
          notes?: string | null
          organization_id?: string
          result?: Database["erp"]["Enums"]["repair_test_result"]
          test_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_test_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_test_results_run_fk"
            columns: ["test_run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_test_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_test_runs: {
        Row: {
          branch_id: string
          completed_at: string
          id: string
          kind: Database["erp"]["Enums"]["repair_test_kind"]
          notes: string | null
          organization_id: string
          repair_order_id: string
          responsible_id: string
          run_sequence: number
          template_version_id: string
        }
        Insert: {
          branch_id: string
          completed_at?: string
          id?: string
          kind: Database["erp"]["Enums"]["repair_test_kind"]
          notes?: string | null
          organization_id: string
          repair_order_id: string
          responsible_id: string
          run_sequence?: never
          template_version_id: string
        }
        Update: {
          branch_id?: string
          completed_at?: string
          id?: string
          kind?: Database["erp"]["Enums"]["repair_test_kind"]
          notes?: string | null
          organization_id?: string
          repair_order_id?: string
          responsible_id?: string
          run_sequence?: never
          template_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_test_runs_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_test_runs_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_test_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_test_runs_version_fk"
            columns: ["template_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_test_template_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_test_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          organization_id: string
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: Json
          id?: string
          organization_id: string
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          organization_id?: string
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "repair_test_template_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_test_versions_template_fk"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_test_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_test_templates: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: Database["erp"]["Enums"]["repair_test_kind"]
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["erp"]["Enums"]["repair_test_kind"]
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["erp"]["Enums"]["repair_test_kind"]
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_test_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_tracking_tokens: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          organization_id: string
          repair_order_id: string
          revoked_at: string | null
          token_digest: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          organization_id: string
          repair_order_id: string
          revoked_at?: string | null
          token_digest: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          repair_order_id?: string
          revoked_at?: string | null
          token_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_tracking_tokens_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_tracking_tokens_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_tracking_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_warranties: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          delivery_id: string
          ends_at: string
          id: string
          organization_id: string
          repair_order_id: string
          starts_at: string
          terms_snapshot: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          delivery_id: string
          ends_at: string
          id?: string
          organization_id: string
          repair_order_id: string
          starts_at: string
          terms_snapshot: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          delivery_id?: string
          ends_at?: string
          id?: string
          organization_id?: string
          repair_order_id?: string
          starts_at?: string
          terms_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_warranties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_warranty_delivery_fk"
            columns: [
              "delivery_id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
            isOneToOne: false
            referencedRelation: "repair_deliveries"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "repair_order_id",
            ]
          },
          {
            foreignKeyName: "repair_warranty_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_warranty_order_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      repair_warranty_claims: {
        Row: {
          branch_id: string
          claim_code: string
          id: string
          opened_at: string
          opened_by: string | null
          organization_id: string
          reported_issue: string
          warranty_id: string
        }
        Insert: {
          branch_id: string
          claim_code: string
          id?: string
          opened_at?: string
          opened_by?: string | null
          organization_id: string
          reported_issue: string
          warranty_id: string
        }
        Update: {
          branch_id?: string
          claim_code?: string
          id?: string
          opened_at?: string
          opened_by?: string | null
          organization_id?: string
          reported_issue?: string
          warranty_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_claim_warranty_fk"
            columns: ["warranty_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_warranties"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "repair_warranty_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          organization_id: string
          permission_id: string
          role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          permission_id: string
          role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          permission_id?: string
          role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_organization_fk"
            columns: ["role_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_discount_authorizations: {
        Row: {
          authorized_amount: number
          authorized_at: string
          authorized_by: string | null
          id: string
          organization_id: string
          reason: string
          sale_id: string
          sale_line_id: string
        }
        Insert: {
          authorized_amount: number
          authorized_at?: string
          authorized_by?: string | null
          id?: string
          organization_id: string
          reason: string
          sale_id: string
          sale_line_id: string
        }
        Update: {
          authorized_amount?: number
          authorized_at?: string
          authorized_by?: string | null
          id?: string
          organization_id?: string
          reason?: string
          sale_id?: string
          sale_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_discount_authorizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_discount_line_fk"
            columns: ["sale_line_id", "organization_id", "sale_id"]
            isOneToOne: false
            referencedRelation: "sale_lines"
            referencedColumns: ["id", "organization_id", "sale_id"]
          },
        ]
      }
      sale_lines: {
        Row: {
          branch_id: string
          created_at: string
          description: string
          discount_amount: number
          from_location_id: string | null
          id: string
          inventory_unit_id: string | null
          kind: Database["erp"]["Enums"]["sale_line_kind"]
          line_number: number
          line_total: number
          organization_id: string
          product_id: string | null
          quantity: number
          sale_id: string
          tax_amount: number
          tax_rate_percent: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          description: string
          discount_amount?: number
          from_location_id?: string | null
          id?: string
          inventory_unit_id?: string | null
          kind: Database["erp"]["Enums"]["sale_line_kind"]
          line_number: number
          line_total: number
          organization_id: string
          product_id?: string | null
          quantity: number
          sale_id: string
          tax_amount: number
          tax_rate_percent: number
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          description?: string
          discount_amount?: number
          from_location_id?: string | null
          id?: string
          inventory_unit_id?: string | null
          kind?: Database["erp"]["Enums"]["sale_line_kind"]
          line_number?: number
          line_total?: number
          organization_id?: string
          product_id?: string | null
          quantity?: number
          sale_id?: string
          tax_amount?: number
          tax_rate_percent?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_lines_location_fk"
            columns: ["from_location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "sale_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "sale_lines_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "sale_lines_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      sale_state_events: {
        Row: {
          actor_id: string | null
          branch_id: string
          delivery_state: Database["erp"]["Enums"]["sale_delivery_state"] | null
          event_sequence: number
          id: string
          idempotency_key: string
          occurred_at: string
          organization_id: string
          payment_state: Database["erp"]["Enums"]["sale_payment_state"] | null
          reason: string
          sale_id: string
          sale_state: Database["erp"]["Enums"]["sale_state"] | null
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          delivery_state?:
            | Database["erp"]["Enums"]["sale_delivery_state"]
            | null
          event_sequence?: never
          id?: string
          idempotency_key: string
          occurred_at?: string
          organization_id: string
          payment_state?: Database["erp"]["Enums"]["sale_payment_state"] | null
          reason: string
          sale_id: string
          sale_state?: Database["erp"]["Enums"]["sale_state"] | null
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          delivery_state?:
            | Database["erp"]["Enums"]["sale_delivery_state"]
            | null
          event_sequence?: never
          id?: string
          idempotency_key?: string
          occurred_at?: string
          organization_id?: string
          payment_state?: Database["erp"]["Enums"]["sale_payment_state"] | null
          reason?: string
          sale_id?: string
          sale_state?: Database["erp"]["Enums"]["sale_state"] | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_state_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_state_events_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      sales: {
        Row: {
          branch_id: string
          confirmed_at: string
          confirmed_by: string | null
          currency_code: string
          customer_id: string | null
          discount_amount: number
          exchange_rate: number
          exchange_snapshot_id: string
          id: string
          idempotency_key: string
          organization_id: string
          reason: string
          request_hash: string
          stock_document_id: string | null
          subtotal_amount: number
          tax_amount: number
          total_amount: number
        }
        Insert: {
          branch_id: string
          confirmed_at?: string
          confirmed_by?: string | null
          currency_code: string
          customer_id?: string | null
          discount_amount: number
          exchange_rate: number
          exchange_snapshot_id: string
          id?: string
          idempotency_key: string
          organization_id: string
          reason: string
          request_hash: string
          stock_document_id?: string | null
          subtotal_amount: number
          tax_amount: number
          total_amount: number
        }
        Update: {
          branch_id?: string
          confirmed_at?: string
          confirmed_by?: string | null
          currency_code?: string
          customer_id?: string | null
          discount_amount?: number
          exchange_rate?: number
          exchange_snapshot_id?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          reason?: string
          request_hash?: string
          stock_document_id?: string | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "sales_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_stock_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      serialized_acquisition_costs: {
        Row: {
          acquired_at: string
          acquisition_cost_base: number
          created_at: string
          id: string
          inventory_unit_id: string
          organization_id: string
          receipt_line_id: string
        }
        Insert: {
          acquired_at: string
          acquisition_cost_base: number
          created_at?: string
          id?: string
          inventory_unit_id: string
          organization_id: string
          receipt_line_id: string
        }
        Update: {
          acquired_at?: string
          acquisition_cost_base?: number
          created_at?: string
          id?: string
          inventory_unit_id?: string
          organization_id?: string
          receipt_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "serialized_acquisition_costs_line_fk"
            columns: ["receipt_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipt_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "serialized_acquisition_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serialized_acquisition_costs_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stage7_commands: {
        Row: {
          branch_id: string
          command_name: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id: string | null
        }
        Insert: {
          branch_id: string
          command_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id?: string | null
        }
        Update: {
          branch_id?: string
          command_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage7_commands_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stage7_commands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stage8_commands: {
        Row: {
          branch_id: string
          command_name: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id: string | null
        }
        Insert: {
          branch_id: string
          command_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id?: string | null
        }
        Update: {
          branch_id?: string
          command_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          result_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage8_commands_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stage8_commands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          branch_id: string
          id: string
          location_id: string
          organization_id: string
          product_id: string
          quantity_on_hand: number
          quantity_reserved: number
          updated_at: string
          variant_id: string | null
          variant_key: string | null
        }
        Insert: {
          branch_id: string
          id?: string
          location_id: string
          organization_id: string
          product_id: string
          quantity_on_hand?: number
          quantity_reserved?: number
          updated_at?: string
          variant_id?: string | null
          variant_key?: string | null
        }
        Update: {
          branch_id?: string
          id?: string
          location_id?: string
          organization_id?: string
          product_id?: string
          quantity_on_hand?: number
          quantity_reserved?: number
          updated_at?: string
          variant_id?: string | null
          variant_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_location_fk"
            columns: ["location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "stock_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_balances_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "stock_balances_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      stock_cost_movements: {
        Row: {
          actor_id: string | null
          branch_id: string
          document_id: string
          document_line_id: string
          id: number
          inventory_unit_id: string | null
          location_id: string
          occurred_at: string
          organization_id: string
          product_id: string
          purchase_cost_entry_id: number | null
          quantity_delta: number
          reversal_of_cost_movement_id: number | null
          source_stock_movement_id: number
          unit_cost_snapshot: number
          value_delta_base: number
          variant_id: string | null
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          document_id: string
          document_line_id: string
          id?: never
          inventory_unit_id?: string | null
          location_id: string
          occurred_at?: string
          organization_id: string
          product_id: string
          purchase_cost_entry_id?: number | null
          quantity_delta: number
          reversal_of_cost_movement_id?: number | null
          source_stock_movement_id: number
          unit_cost_snapshot: number
          value_delta_base: number
          variant_id?: string | null
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          document_id?: string
          document_line_id?: string
          id?: never
          inventory_unit_id?: string | null
          location_id?: string
          occurred_at?: string
          organization_id?: string
          product_id?: string
          purchase_cost_entry_id?: number | null
          quantity_delta?: number
          reversal_of_cost_movement_id?: number | null
          source_stock_movement_id?: number
          unit_cost_snapshot?: number
          value_delta_base?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_cost_movements_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_document_fk"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_line_fk"
            columns: ["document_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_document_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_location_fk"
            columns: ["location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_movements_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_purchase_entry_fk"
            columns: ["purchase_cost_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_cost_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_reversal_fk"
            columns: ["reversal_of_cost_movement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_cost_movements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_source_movement_fk"
            columns: ["source_stock_movement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_cost_movements_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      stock_document_lines: {
        Row: {
          created_at: string
          document_id: string
          from_location_id: string | null
          id: string
          inventory_unit_id: string | null
          line_number: number
          organization_id: string
          product_id: string
          quantity: number
          to_location_id: string | null
          unit_cost: number
          unit_status_after:
            | Database["erp"]["Enums"]["inventory_unit_status"]
            | null
          unit_status_before:
            | Database["erp"]["Enums"]["inventory_unit_status"]
            | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          document_id: string
          from_location_id?: string | null
          id?: string
          inventory_unit_id?: string | null
          line_number: number
          organization_id: string
          product_id: string
          quantity: number
          to_location_id?: string | null
          unit_cost?: number
          unit_status_after?:
            | Database["erp"]["Enums"]["inventory_unit_status"]
            | null
          unit_status_before?:
            | Database["erp"]["Enums"]["inventory_unit_status"]
            | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string
          from_location_id?: string | null
          id?: string
          inventory_unit_id?: string | null
          line_number?: number
          organization_id?: string
          product_id?: string
          quantity?: number
          to_location_id?: string | null
          unit_cost?: number
          unit_status_after?:
            | Database["erp"]["Enums"]["inventory_unit_status"]
            | null
          unit_status_before?:
            | Database["erp"]["Enums"]["inventory_unit_status"]
            | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_document_lines_document_fk"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_document_lines_from_location_fk"
            columns: ["from_location_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_document_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_document_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_document_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "stock_document_lines_to_location_fk"
            columns: ["to_location_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_document_lines_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_document_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      stock_documents: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          idempotency_key: string
          kind: Database["erp"]["Enums"]["stock_document_kind"]
          organization_id: string
          posted_at: string
          posted_by: string | null
          reason: string
          request_hash: string
          reversed_document_id: string | null
          source_id: string | null
          source_type: string | null
          status: Database["erp"]["Enums"]["stock_document_status"]
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          kind: Database["erp"]["Enums"]["stock_document_kind"]
          organization_id: string
          posted_at?: string
          posted_by?: string | null
          reason: string
          request_hash: string
          reversed_document_id?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["erp"]["Enums"]["stock_document_status"]
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: Database["erp"]["Enums"]["stock_document_kind"]
          organization_id?: string
          posted_at?: string
          posted_by?: string | null
          reason?: string
          request_hash?: string
          reversed_document_id?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["erp"]["Enums"]["stock_document_status"]
        }
        Relationships: [
          {
            foreignKeyName: "stock_documents_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_documents_reversed_document_fk"
            columns: ["reversed_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          actor_id: string | null
          branch_id: string
          document_id: string
          document_line_id: string
          id: number
          inventory_unit_id: string | null
          location_id: string
          occurred_at: string
          organization_id: string
          product_id: string
          quantity_delta: number
          unit_cost: number
          variant_id: string | null
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          document_id: string
          document_line_id: string
          id?: never
          inventory_unit_id?: string | null
          location_id: string
          occurred_at?: string
          organization_id: string
          product_id: string
          quantity_delta: number
          unit_cost?: number
          variant_id?: string | null
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          document_id?: string
          document_line_id?: string
          id?: never
          inventory_unit_id?: string | null
          location_id?: string
          occurred_at?: string
          organization_id?: string
          product_id?: string
          quantity_delta?: number
          unit_cost?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_document_fk"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_movements_line_fk"
            columns: ["document_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_document_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_movements_location_fk"
            columns: ["location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "stock_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_movements_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "stock_movements_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_movements_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      stock_reservation_batches: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          fulfilled_at: string | null
          id: string
          idempotency_key: string
          organization_id: string
          reason: string | null
          released_at: string | null
          request_hash: string
          source_id: string | null
          source_type: string
          status: Database["erp"]["Enums"]["stock_reservation_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          fulfilled_at?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          reason?: string | null
          released_at?: string | null
          request_hash: string
          source_id?: string | null
          source_type: string
          status?: Database["erp"]["Enums"]["stock_reservation_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          fulfilled_at?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          reason?: string | null
          released_at?: string | null
          request_hash?: string
          source_id?: string | null
          source_type?: string
          status?: Database["erp"]["Enums"]["stock_reservation_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservation_batches_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_reservation_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          inventory_unit_id: string | null
          location_id: string
          organization_id: string
          product_id: string
          quantity: number
          variant_id: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          inventory_unit_id?: string | null
          location_id: string
          organization_id: string
          product_id: string
          quantity: number
          variant_id?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          inventory_unit_id?: string | null
          location_id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_batch_fk"
            columns: ["batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_reservation_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_reservations_location_fk"
            columns: ["location_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_reservations_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "stock_reservations_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_reservations_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      storefront_payment_syncs: {
        Row: {
          branch_id: string
          id: string
          journal_entry_id: string
          organization_id: string
          payment_event_id: string
          processed_at: string
          provider: string
          provider_event_id: string
          provider_payment_id: string
          request_hash: string
          sale_id: string
          stock_document_id: string
          storefront_order_id: string
          web_order_id: string
        }
        Insert: {
          branch_id: string
          id?: string
          journal_entry_id: string
          organization_id: string
          payment_event_id: string
          processed_at?: string
          provider: string
          provider_event_id: string
          provider_payment_id: string
          request_hash: string
          sale_id: string
          stock_document_id: string
          storefront_order_id: string
          web_order_id: string
        }
        Update: {
          branch_id?: string
          id?: string
          journal_entry_id?: string
          organization_id?: string
          payment_event_id?: string
          processed_at?: string
          provider?: string
          provider_event_id?: string
          provider_payment_id?: string
          request_hash?: string
          sale_id?: string
          stock_document_id?: string
          storefront_order_id?: string
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "storefront_payment_syncs_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "storefront_payment_syncs_journal_fk"
            columns: ["journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "storefront_payment_syncs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_payment_syncs_payment_event_fk"
            columns: ["payment_event_id", "organization_id", "web_order_id"]
            isOneToOne: false
            referencedRelation: "web_payment_events"
            referencedColumns: ["id", "organization_id", "web_order_id"]
          },
          {
            foreignKeyName: "storefront_payment_syncs_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "storefront_payment_syncs_stock_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "storefront_payment_syncs_web_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      supplier_account_entries: {
        Row: {
          actor_id: string | null
          amount_base_delta: number
          branch_id: string
          entry_kind: string
          id: number
          occurred_at: string
          organization_id: string
          payable_id: string
          supplier_id: string
          supplier_payment_id: string | null
          supplier_payment_reversal_id: string | null
        }
        Insert: {
          actor_id?: string | null
          amount_base_delta: number
          branch_id: string
          entry_kind?: string
          id?: never
          occurred_at?: string
          organization_id: string
          payable_id: string
          supplier_id: string
          supplier_payment_id?: string | null
          supplier_payment_reversal_id?: string | null
        }
        Update: {
          actor_id?: string | null
          amount_base_delta?: number
          branch_id?: string
          entry_kind?: string
          id?: never
          occurred_at?: string
          organization_id?: string
          payable_id?: string
          supplier_id?: string
          supplier_payment_id?: string | null
          supplier_payment_reversal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_account_entries_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_account_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_account_entries_payable_fk"
            columns: ["payable_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "supplier_payables"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "supplier_account_entries_payment_fk"
            columns: ["supplier_payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_account_entries_payment_reversal_fk"
            columns: ["supplier_payment_reversal_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supplier_payment_reversals"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_account_entries_supplier_fk"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      supplier_payables: {
        Row: {
          amount_base: number
          amount_currency: number
          branch_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          due_at: string
          exchange_snapshot_id: string
          id: string
          organization_id: string
          receipt_id: string
          supplier_id: string
        }
        Insert: {
          amount_base: number
          amount_currency: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          due_at: string
          exchange_snapshot_id: string
          id?: string
          organization_id: string
          receipt_id: string
          supplier_id: string
        }
        Update: {
          amount_base?: number
          amount_currency?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          due_at?: string
          exchange_snapshot_id?: string
          id?: string
          organization_id?: string
          receipt_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payables_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payables_receipt_fk"
            columns: ["receipt_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "supplier_payables_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payables_supplier_fk"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      supplier_payment_reversals: {
        Row: {
          branch_id: string
          created_by: string | null
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          occurred_at: string
          organization_id: string
          reason: string
          request_hash: string
          supplier_payment_id: string
        }
        Insert: {
          branch_id: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          occurred_at?: string
          organization_id: string
          reason: string
          request_hash: string
          supplier_payment_id: string
        }
        Update: {
          branch_id?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          occurred_at?: string
          organization_id?: string
          reason?: string
          request_hash?: string
          supplier_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_reversals_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payment_reversals_journal_fk"
            columns: ["journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payment_reversals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_reversals_payment_fk"
            columns: ["supplier_payment_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount_base: number
          amount_currency: number
          branch_id: string
          cash_session_id: string | null
          created_by: string | null
          currency_code: string
          exchange_rate: number
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          occurred_at: string
          organization_id: string
          payable_id: string
          payment_method_id: string
          reason: string
          reference: string | null
          request_hash: string
          settlement_account_id: string
          supplier_id: string
        }
        Insert: {
          amount_base: number
          amount_currency: number
          branch_id: string
          cash_session_id?: string | null
          created_by?: string | null
          currency_code: string
          exchange_rate: number
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          occurred_at?: string
          organization_id: string
          payable_id: string
          payment_method_id: string
          reason: string
          reference?: string | null
          request_hash: string
          settlement_account_id: string
          supplier_id: string
        }
        Update: {
          amount_base?: number
          amount_currency?: number
          branch_id?: string
          cash_session_id?: string | null
          created_by?: string | null
          currency_code?: string
          exchange_rate?: number
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          occurred_at?: string
          organization_id?: string
          payable_id?: string
          payment_method_id?: string
          reason?: string
          reference?: string | null
          request_hash?: string
          settlement_account_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payments_currency_fk"
            columns: ["organization_id", "currency_code"]
            isOneToOne: false
            referencedRelation: "organization_currencies"
            referencedColumns: ["organization_id", "currency_code"]
          },
          {
            foreignKeyName: "supplier_payments_journal_fk"
            columns: ["journal_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payments_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_payable_fk"
            columns: ["payable_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "supplier_payables"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "supplier_payments_session_fk"
            columns: ["cash_session_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "supplier_payments_settlement_account_fk"
            columns: ["settlement_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_fk"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: Json
          code: string
          created_at: string
          created_by: string | null
          default_currency: string
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          legal_name: string | null
          notes: string | null
          organization_id: string
          payment_terms_days: number
          phone: string | null
          tax_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: Json
          code: string
          created_at?: string
          created_by?: string | null
          default_currency?: string
          display_name: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          notes?: string | null
          organization_id: string
          payment_terms_days?: number
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: Json
          code?: string
          created_at?: string
          created_by?: string | null
          default_currency?: string
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          legal_name?: string | null
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          branch_id: string | null
          branch_scope: string
          key: string
          organization_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          branch_id?: string | null
          branch_scope?: string
          key: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          branch_id?: string | null
          branch_scope?: string
          key?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_settings_branch_organization_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "system_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_in_evaluation_reviews: {
        Row: {
          branch_id: string
          decision: Database["erp"]["Enums"]["trade_in_review_decision"]
          evaluation_id: string
          event_sequence: number
          id: string
          organization_id: string
          reason: string
          reviewed_at: string
          reviewed_by: string
          trade_in_id: string
        }
        Insert: {
          branch_id: string
          decision: Database["erp"]["Enums"]["trade_in_review_decision"]
          evaluation_id: string
          event_sequence?: never
          id?: string
          organization_id: string
          reason: string
          reviewed_at?: string
          reviewed_by: string
          trade_in_id: string
        }
        Update: {
          branch_id?: string
          decision?: Database["erp"]["Enums"]["trade_in_review_decision"]
          evaluation_id?: string
          event_sequence?: never
          id?: string
          organization_id?: string
          reason?: string
          reviewed_at?: string
          reviewed_by?: string
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_eval_reviews_eval_fk"
            columns: [
              "evaluation_id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
            isOneToOne: false
            referencedRelation: "trade_in_evaluations"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
          },
          {
            foreignKeyName: "trade_in_evaluation_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_in_evaluations: {
        Row: {
          appraised_value_base: number
          branch_id: string
          condition_snapshot: Json
          created_at: string
          created_by: string | null
          estimated_refurbishment_cost_base: number
          id: string
          organization_id: string
          supersedes_evaluation_id: string | null
          trade_in_id: string
          version: number
        }
        Insert: {
          appraised_value_base: number
          branch_id: string
          condition_snapshot: Json
          created_at?: string
          created_by?: string | null
          estimated_refurbishment_cost_base: number
          id?: string
          organization_id: string
          supersedes_evaluation_id?: string | null
          trade_in_id: string
          version: number
        }
        Update: {
          appraised_value_base?: number
          branch_id?: string
          condition_snapshot?: Json
          created_at?: string
          created_by?: string | null
          estimated_refurbishment_cost_base?: number
          id?: string
          organization_id?: string
          supersedes_evaluation_id?: string | null
          trade_in_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "trade_evaluations_supersedes_fk"
            columns: [
              "supersedes_evaluation_id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
            isOneToOne: false
            referencedRelation: "trade_in_evaluations"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
          },
          {
            foreignKeyName: "trade_evaluations_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_evaluations_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_in_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_in_imei_requests: {
        Row: {
          branch_id: string
          id: string
          imei_ciphertext: string
          imei_hmac: string
          key_id: string
          organization_id: string
          provider: string
          request_version: number
          requested_at: string
          requested_by: string | null
          trade_in_id: string
        }
        Insert: {
          branch_id: string
          id?: string
          imei_ciphertext: string
          imei_hmac: string
          key_id: string
          organization_id: string
          provider: string
          request_version: number
          requested_at?: string
          requested_by?: string | null
          trade_in_id: string
        }
        Update: {
          branch_id?: string
          id?: string
          imei_ciphertext?: string
          imei_hmac?: string
          key_id?: string
          organization_id?: string
          provider?: string
          request_version?: number
          requested_at?: string
          requested_by?: string | null
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_imei_requests_key_fk"
            columns: ["key_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "repair_credential_keys"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_imei_requests_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_imei_requests_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_in_imei_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_in_imei_results: {
        Row: {
          branch_id: string
          checked_at: string
          checked_by: string | null
          event_sequence: number
          evidence: Json
          id: string
          organization_id: string
          provider_reference: string | null
          reason: string
          request_hash: string
          request_id: string | null
          source: string
          status: Database["erp"]["Enums"]["imei_check_status"]
          trade_in_id: string
        }
        Insert: {
          branch_id: string
          checked_at?: string
          checked_by?: string | null
          event_sequence?: never
          evidence?: Json
          id?: string
          organization_id: string
          provider_reference?: string | null
          reason: string
          request_hash: string
          request_id?: string | null
          source: string
          status: Database["erp"]["Enums"]["imei_check_status"]
          trade_in_id: string
        }
        Update: {
          branch_id?: string
          checked_at?: string
          checked_by?: string | null
          event_sequence?: never
          evidence?: Json
          id?: string
          organization_id?: string
          provider_reference?: string | null
          reason?: string
          request_hash?: string
          request_id?: string | null
          source?: string
          status?: Database["erp"]["Enums"]["imei_check_status"]
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_imei_results_request_fk"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trade_in_imei_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_imei_results_request_owner_fk"
            columns: [
              "request_id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
            isOneToOne: false
            referencedRelation: "trade_in_imei_requests"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
          },
          {
            foreignKeyName: "trade_imei_results_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_imei_results_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_in_imei_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_in_provenance_declarations: {
        Row: {
          branch_id: string
          declaration: string
          declared_at: string
          declared_by: string | null
          declared_owner_name: string
          id: string
          organization_id: string
          trade_in_id: string
        }
        Insert: {
          branch_id: string
          declaration: string
          declared_at?: string
          declared_by?: string | null
          declared_owner_name: string
          id?: string
          organization_id: string
          trade_in_id: string
        }
        Update: {
          branch_id?: string
          declaration?: string
          declared_at?: string
          declared_by?: string | null
          declared_owner_name?: string
          id?: string
          organization_id?: string
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_provenance_declarations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_provenance_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_provenance_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      trade_in_provenance_evidence: {
        Row: {
          branch_id: string
          captured_at: string
          captured_by: string | null
          evidence_type: string
          id: string
          metadata: Json
          organization_id: string
          private_object_path: string
          sha256: string
          trade_in_id: string
        }
        Insert: {
          branch_id: string
          captured_at?: string
          captured_by?: string | null
          evidence_type: string
          id?: string
          metadata?: Json
          organization_id: string
          private_object_path: string
          sha256: string
          trade_in_id: string
        }
        Update: {
          branch_id?: string
          captured_at?: string
          captured_by?: string | null
          evidence_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
          private_object_path?: string
          sha256?: string
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_evidence_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_evidence_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_in_provenance_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_in_provenance_reviews: {
        Row: {
          branch_id: string
          decision: Database["erp"]["Enums"]["trade_in_review_decision"]
          event_sequence: number
          id: string
          organization_id: string
          reason: string
          reviewed_at: string
          reviewed_by: string
          trade_in_id: string
        }
        Insert: {
          branch_id: string
          decision: Database["erp"]["Enums"]["trade_in_review_decision"]
          event_sequence?: never
          id?: string
          organization_id: string
          reason: string
          reviewed_at?: string
          reviewed_by: string
          trade_in_id: string
        }
        Update: {
          branch_id?: string
          decision?: Database["erp"]["Enums"]["trade_in_review_decision"]
          event_sequence?: never
          id?: string
          organization_id?: string
          reason?: string
          reviewed_at?: string
          reviewed_by?: string
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_provenance_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_provenance_review_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_provenance_review_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      trade_in_refurbishments: {
        Row: {
          actual_cost_base: number
          branch_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          organization_id: string
          repair_order_id: string | null
          trade_in_id: string
        }
        Insert: {
          actual_cost_base: number
          branch_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          organization_id: string
          repair_order_id?: string | null
          trade_in_id: string
        }
        Update: {
          actual_cost_base?: number
          branch_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          organization_id?: string
          repair_order_id?: string | null
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_refurbishments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_refurb_repair_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_refurb_repair_fk"
            columns: ["repair_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "repair_orders_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_refurb_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_refurb_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      trade_in_releases: {
        Row: {
          accepted_value_base: number
          branch_id: string
          destination_location_id: string
          evaluation_id: string
          id: string
          organization_id: string
          refurbishment_cost_base: number
          released_at: string
          released_by: string | null
          stock_document_id: string
          total_cost_base: number
          trade_in_id: string
        }
        Insert: {
          accepted_value_base: number
          branch_id: string
          destination_location_id: string
          evaluation_id: string
          id?: string
          organization_id: string
          refurbishment_cost_base: number
          released_at?: string
          released_by?: string | null
          stock_document_id: string
          total_cost_base: number
          trade_in_id: string
        }
        Update: {
          accepted_value_base?: number
          branch_id?: string
          destination_location_id?: string
          evaluation_id?: string
          id?: string
          organization_id?: string
          refurbishment_cost_base?: number
          released_at?: string
          released_by?: string | null
          stock_document_id?: string
          total_cost_base?: number
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_releases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_releases_eval_fk"
            columns: [
              "evaluation_id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
            isOneToOne: false
            referencedRelation: "trade_in_evaluations"
            referencedColumns: [
              "id",
              "organization_id",
              "branch_id",
              "trade_in_id",
            ]
          },
          {
            foreignKeyName: "trade_releases_location_fk"
            columns: ["destination_location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_releases_stock_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_releases_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_releases_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      trade_in_sale_payment_events: {
        Row: {
          actor_id: string | null
          amount: number
          branch_id: string
          event_kind: string
          id: string
          occurred_at: string
          organization_id: string
          payment_id: string
          reverses_event_id: string | null
          sale_id: string
          trade_in_id: string
        }
        Insert: {
          actor_id?: string | null
          amount: number
          branch_id: string
          event_kind: string
          id?: string
          occurred_at?: string
          organization_id: string
          payment_id: string
          reverses_event_id?: string | null
          sale_id: string
          trade_in_id: string
        }
        Update: {
          actor_id?: string | null
          amount?: number
          branch_id?: string
          event_kind?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          payment_id?: string
          reverses_event_id?: string | null
          sale_id?: string
          trade_in_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_in_sale_payment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_payment_payment_fk"
            columns: ["payment_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_payment_reverses_fk"
            columns: ["reverses_event_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trade_in_sale_payment_events"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_payment_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_payment_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_payment_trade_fk"
            columns: ["trade_in_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "trade_ins_overview"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
        ]
      }
      trade_ins: {
        Row: {
          branch_id: string
          customer_id: string
          declared_value_base: number
          id: string
          inventory_unit_id: string
          organization_id: string
          product_id: string
          quarantine_location_id: string
          received_at: string
          received_by: string | null
          variant_id: string | null
        }
        Insert: {
          branch_id: string
          customer_id: string
          declared_value_base: number
          id?: string
          inventory_unit_id: string
          organization_id: string
          product_id: string
          quarantine_location_id: string
          received_at?: string
          received_by?: string | null
          variant_id?: string | null
        }
        Update: {
          branch_id?: string
          customer_id?: string
          declared_value_base?: number
          id?: string
          inventory_unit_id?: string
          organization_id?: string
          product_id?: string
          quarantine_location_id?: string
          received_at?: string
          received_by?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_ins_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_location_fk"
            columns: ["quarantine_location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "trade_ins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_ins_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          allows_decimals: boolean
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          allows_decimals?: boolean
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          allows_decimals?: boolean
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_of_measure_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      web_order_events: {
        Row: {
          actor_id: string | null
          branch_id: string
          delivery_state: Database["erp"]["Enums"]["sale_delivery_state"] | null
          event_sequence: number
          id: string
          idempotency_key: string
          occurred_at: string
          order_state: string | null
          organization_id: string
          payment_state: Database["erp"]["Enums"]["sale_payment_state"] | null
          reason: string
          request_hash: string
          source_payment_event_id: string | null
          web_order_id: string
        }
        Insert: {
          actor_id?: string | null
          branch_id: string
          delivery_state?:
            | Database["erp"]["Enums"]["sale_delivery_state"]
            | null
          event_sequence?: never
          id?: string
          idempotency_key: string
          occurred_at?: string
          order_state?: string | null
          organization_id: string
          payment_state?: Database["erp"]["Enums"]["sale_payment_state"] | null
          reason: string
          request_hash: string
          source_payment_event_id?: string | null
          web_order_id: string
        }
        Update: {
          actor_id?: string | null
          branch_id?: string
          delivery_state?:
            | Database["erp"]["Enums"]["sale_delivery_state"]
            | null
          event_sequence?: never
          id?: string
          idempotency_key?: string
          occurred_at?: string
          order_state?: string | null
          organization_id?: string
          payment_state?: Database["erp"]["Enums"]["sale_payment_state"] | null
          reason?: string
          request_hash?: string
          source_payment_event_id?: string | null
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_order_events_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_order_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_events_payment_event_fk"
            columns: [
              "source_payment_event_id",
              "organization_id",
              "web_order_id",
            ]
            isOneToOne: false
            referencedRelation: "web_payment_events"
            referencedColumns: ["id", "organization_id", "web_order_id"]
          },
        ]
      }
      web_order_fulfillments: {
        Row: {
          branch_id: string
          fulfilled_at: string
          fulfilled_by: string | null
          id: string
          organization_id: string
          reservation_batch_id: string
          sale_id: string
          stock_document_id: string
          web_order_id: string
        }
        Insert: {
          branch_id: string
          fulfilled_at?: string
          fulfilled_by?: string | null
          id?: string
          organization_id: string
          reservation_batch_id: string
          sale_id: string
          stock_document_id: string
          web_order_id: string
        }
        Update: {
          branch_id?: string
          fulfilled_at?: string
          fulfilled_by?: string | null
          id?: string
          organization_id?: string
          reservation_batch_id?: string
          sale_id?: string
          stock_document_id?: string
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_order_fulfillments_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_order_fulfillments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_fulfillments_reservation_fk"
            columns: ["reservation_batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_reservation_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_order_fulfillments_sale_fk"
            columns: ["sale_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_order_fulfillments_stock_fk"
            columns: ["stock_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_documents"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      web_order_lines: {
        Row: {
          branch_id: string
          created_at: string
          description: string
          id: string
          inventory_unit_id: string | null
          line_number: number
          line_total: number
          location_id: string
          organization_id: string
          product_id: string
          quantity: number
          tax_amount: number
          tax_rate_percent: number
          unit_price: number
          variant_id: string | null
          web_order_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          description: string
          id?: string
          inventory_unit_id?: string | null
          line_number: number
          line_total: number
          location_id: string
          organization_id: string
          product_id: string
          quantity: number
          tax_amount: number
          tax_rate_percent: number
          unit_price: number
          variant_id?: string | null
          web_order_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          description?: string
          id?: string
          inventory_unit_id?: string | null
          line_number?: number
          line_total?: number
          location_id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          tax_amount?: number
          tax_rate_percent?: number
          unit_price?: number
          variant_id?: string | null
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_order_lines_location_fk"
            columns: ["location_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_order_lines_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_order_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_order_lines_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "web_order_lines_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_order_lines_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      web_orders: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          customer_id: string | null
          exchange_rate: number
          exchange_snapshot_id: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          reservation_batch_id: string | null
          total_amount: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          customer_id?: string | null
          exchange_rate: number
          exchange_snapshot_id: string
          expires_at: string
          id?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          reservation_batch_id?: string | null
          total_amount: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          customer_id?: string | null
          exchange_rate?: number
          exchange_snapshot_id?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          reservation_batch_id?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "web_orders_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_orders_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_orders_reservation_fk"
            columns: ["reservation_batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_reservation_batches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_orders_snapshot_fk"
            columns: ["exchange_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "exchange_rate_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      web_payment_events: {
        Row: {
          actor_id: string | null
          amount: number | null
          applied: boolean
          branch_id: string
          error_message: string | null
          id: string
          organization_id: string
          payload: Json
          payment_method_id: string | null
          provider: string
          provider_event_id: string
          provider_occurred_at: string
          provider_payment_id: string | null
          received_at: string
          status: Database["erp"]["Enums"]["web_payment_status"]
          web_order_id: string
        }
        Insert: {
          actor_id?: string | null
          amount?: number | null
          applied: boolean
          branch_id: string
          error_message?: string | null
          id?: string
          organization_id: string
          payload?: Json
          payment_method_id?: string | null
          provider: string
          provider_event_id: string
          provider_occurred_at: string
          provider_payment_id?: string | null
          received_at?: string
          status: Database["erp"]["Enums"]["web_payment_status"]
          web_order_id: string
        }
        Update: {
          actor_id?: string | null
          amount?: number | null
          applied?: boolean
          branch_id?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          payload?: Json
          payment_method_id?: string | null
          provider?: string
          provider_event_id?: string
          provider_occurred_at?: string
          provider_payment_id?: string | null
          received_at?: string
          status?: Database["erp"]["Enums"]["web_payment_status"]
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_payment_events_method_fk"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "web_payment_events_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_payment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      web_provider_payments: {
        Row: {
          branch_id: string
          claimed_at: string
          organization_id: string
          provider: string
          provider_payment_id: string
          web_order_id: string
        }
        Insert: {
          branch_id: string
          claimed_at?: string
          organization_id: string
          provider: string
          provider_payment_id: string
          web_order_id: string
        }
        Update: {
          branch_id?: string
          claimed_at?: string
          organization_id?: string
          provider?: string
          provider_payment_id?: string
          web_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_provider_payments_order_fk"
            columns: ["web_order_id", "organization_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id", "organization_id", "branch_id"]
          },
          {
            foreignKeyName: "web_provider_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      pc_build_projects_overview: {
        Row: {
          branch_id: string | null
          built_serial_number: string | null
          compatibility_checked_at: string | null
          completed_at: string | null
          completion_id: string | null
          components_count: number | null
          configuration: Json | null
          created_at: string | null
          current_state: Database["erp"]["Enums"]["pc_build_state"] | null
          customer_code: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          equipment_id: string | null
          fulfillment_stock_document_id: string | null
          id: string | null
          latest_compatibility_outcome:
            | Database["erp"]["Enums"]["pc_compatibility_outcome"]
            | null
          latest_revision_id: string | null
          latest_revision_version: number | null
          latest_test_run_id: string | null
          notes: string | null
          organization_id: string | null
          reservation_batch_id: string | null
          reservation_expires_at: string | null
          reservation_status:
            | Database["erp"]["Enums"]["stock_reservation_status"]
            | null
          rule_set_version_id: string | null
          spec_version_id: string | null
          state_changed_at: string | null
          test_completed_at: string | null
          title: string | null
          total_components_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pc_build_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pc_projects_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pc_projects_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      repair_orders_overview: {
        Row: {
          active_parts_count: number | null
          branch_id: string | null
          brand_snapshot: string | null
          customer_code: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          delivery_id: string | null
          equipment_id: string | null
          equipment_type: string | null
          id: string | null
          intake_accessories: Json | null
          intake_condition: string | null
          intake_damage: string | null
          intake_notes: string | null
          latest_quote: Json | null
          model_snapshot: string | null
          opened_at: string | null
          order_code: string | null
          order_number: number | null
          organization_id: string | null
          qc_passed: boolean | null
          recipient_document_suffix: string | null
          recipient_name: string | null
          reported_fault: string | null
          status_code: string | null
          status_id: string | null
          status_is_initial: boolean | null
          status_is_terminal: boolean | null
          status_name: string | null
          status_public_message: string | null
          status_requires_final_tests: boolean | null
          status_updated_at: string | null
          warranty_ends_at: string | null
          warranty_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_orders_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_orders_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_orders_equipment_fk"
            columns: ["equipment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customer_equipment"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "repair_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_ins_overview: {
        Row: {
          actual_refurbishment_cost: number | null
          appraised_value_base: number | null
          branch_id: string | null
          customer_code: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          declared_value_base: number | null
          estimated_refurbishment_cost_base: number | null
          evaluation_decision:
            | Database["erp"]["Enums"]["trade_in_review_decision"]
            | null
          evaluation_id: string | null
          evaluation_version: number | null
          id: string | null
          imei: string | null
          imei_checked_at: string | null
          imei_request_version: number | null
          imei_source: string | null
          imei_status: Database["erp"]["Enums"]["imei_check_status"] | null
          inventory_unit_id: string | null
          organization_id: string | null
          payment_amount: number | null
          payment_applied_at: string | null
          payment_id: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          provenance_decision:
            | Database["erp"]["Enums"]["trade_in_review_decision"]
            | null
          provenance_reviewed_at: string | null
          received_at: string | null
          release_id: string | null
          release_location_id: string | null
          release_total_cost: number | null
          released_at: string | null
          sale_id: string | null
          serial_number: string | null
          stage: string | null
          unit_status: Database["erp"]["Enums"]["inventory_unit_status"] | null
          variant_code: string | null
          variant_id: string | null
          variant_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_ins_branch_fk"
            columns: ["branch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_customer_fk"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_ins_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_product_fk"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "v_profitability_by_line"
            referencedColumns: ["product_id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_unit_fk"
            columns: ["inventory_unit_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trade_ins_variant_fk"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      v_iva_compras: {
        Row: {
          alicuota: number | null
          base_imponible: number | null
          base_imponible_base: number | null
          branch_id: string | null
          currency_code: string | null
          exchange_rate: number | null
          iva: number | null
          iva_base: number | null
          organization_id: string | null
          purchase_date: string | null
          purchase_order_id: string | null
          purchase_receipt_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_iva_ventas: {
        Row: {
          alicuota: number | null
          base_imponible: number | null
          base_imponible_base: number | null
          branch_id: string | null
          currency_code: string | null
          exchange_rate: number | null
          iva: number | null
          iva_base: number | null
          organization_id: string | null
          sale_date: string | null
          sale_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_profitability_by_line: {
        Row: {
          avg_unit_landed_cost: number | null
          estimated_cost: number | null
          gross_revenue: number | null
          internal_code: string | null
          internal_name: string | null
          margin: number | null
          organization_id: string | null
          product_id: string | null
          quantity_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trial_balance: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          balance: number | null
          organization_id: string | null
          period_end: string | null
          period_id: string | null
          period_start: string | null
          total_credit: number | null
          total_debit: number | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_period_fk"
            columns: ["period_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Functions: {
      apply_price_change: {
        Args: {
          operation_key: string
          operation_reason: string
          target_preview_id: string
        }
        Returns: string
      }
      apply_trade_in_sale_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          target_sale_id: string
          target_trade_in_id: string
        }
        Returns: string
      }
      approve_purchase_order: {
        Args: {
          operation_key: string
          operation_reason: string
          target_purchase_order_id: string
        }
        Returns: string
      }
      assert_pc_project_mutable: {
        Args: { target_organization_id: string; target_project_id: string }
        Returns: {
          branch_id: string
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          notes: string | null
          organization_id: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "pc_build_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_conversation: {
        Args: {
          operation_key: string
          operation_reason: string
          target_conversation_id: string
          target_user_id: string
        }
        Returns: string
      }
      assign_repair_order: {
        Args: {
          operation_key: string
          operation_reason: string
          target_profile_id: string
          target_repair_order_id: string
        }
        Returns: string
      }
      bootstrap_chart_of_accounts: { Args: never; Returns: undefined }
      bootstrap_owner: {
        Args: { auth_user_id: string; target_organization_id: string }
        Returns: undefined
      }
      calculate_financing_status: {
        Args: { target_contract_id: string }
        Returns: Database["erp"]["Enums"]["financing_status"]
      }
      cancel_sale: {
        Args: {
          operation_key: string
          operation_reason: string
          target_refund_cash_session_id?: string
          target_sale_id: string
        }
        Returns: string
      }
      capture_exchange_rate: {
        Args: {
          captured_rate_to_base: number
          operation_key: string
          operation_reason: string
          quote_time: string
          rate_source: string
          target_quote_currency: string
        }
        Returns: string
      }
      claim_due_integration_retries: {
        Args: { batch_limit?: number; lease_seconds?: number }
        Returns: {
          action: Database["erp"]["Enums"]["integration_retry_action"]
          branch_id: string
          claim_token: string
          event_type: string
          idempotency_key: string
          organization_id: string
          outbox_id: string
          payload: Json
          retry_request_id: string
          retry_sequence: number
        }[]
      }
      claim_repair_command: {
        Args: {
          command: string
          operation_key: string
          request_body: Json
          target_branch_id: string
          target_organization_id: string
        }
        Returns: {
          branch_id: string
          command_name: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "repair_commands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_stage7_command: {
        Args: {
          command: string
          operation_key: string
          request_body: Json
          target_branch_id: string
          target_organization_id: string
        }
        Returns: {
          branch_id: string
          command_name: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stage7_commands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_stage8_command: {
        Args: {
          command: string
          operation_key: string
          request_body: Json
          target_branch_id: string
          target_organization_id: string
        }
        Returns: {
          branch_id: string
          command_name: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          result_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "stage8_commands"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_accounting_period: {
        Args: { operation_reason: string; target_period_id: string }
        Returns: undefined
      }
      close_cash_session: {
        Args: {
          counted_amounts: Json
          operation_key: string
          operation_reason: string
          target_cash_session_id: string
        }
        Returns: string
      }
      complete_pc_build: {
        Args: {
          build_serial: string
          operation_key: string
          operation_reason: string
          target_project_id: string
          target_reservation_batch_id: string
          target_revision_id: string
          warranty_snapshot: Json
        }
        Returns: string
      }
      complete_repair_command: {
        Args: { command_id: string; command_result_id: string }
        Returns: undefined
      }
      complete_stage7_command: {
        Args: { command_id: string; command_result_id: string }
        Returns: undefined
      }
      complete_stage8_command: {
        Args: { command_id: string; command_result_id: string }
        Returns: undefined
      }
      configure_communication_automation: {
        Args: {
          active: boolean
          conditions: Json
          event_type: string
          operation_key: string
          operation_reason: string
          rule_code: string
          target_branch_id: string
          target_template_version_id: string
        }
        Returns: string
      }
      consume_repair_part_direct: {
        Args: {
          operation_reason?: string
          target_location_id: string
          target_product_id: string
          target_quantity?: number
          target_repair_order_id: string
          target_variant_id?: string
        }
        Returns: string
      }
      consume_repair_parts: {
        Args: {
          operation_key: string
          operation_reason: string
          target_batch_id: string
          target_repair_order_id: string
        }
        Returns: string
      }
      create_catalog_product_with_variants: {
        Args: {
          p_base_cost?: number
          p_base_sale_price?: number
          p_brand_id?: string
          p_category_id?: string
          p_internal_code: string
          p_internal_name: string
          p_inventory_tracking?: Database["erp"]["Enums"]["inventory_tracking_mode"]
          p_item_kind?: Database["erp"]["Enums"]["catalog_item_kind"]
          p_model_id?: string
          p_tax_rate_percent?: number
          p_unit_id?: string
          p_variants?: Json
        }
        Returns: Json
      }
      create_customer_equipment: {
        Args: {
          brand_snapshot: string
          equipment_type: string
          imei: string
          model_snapshot: string
          operation_key: string
          operation_reason: string
          serial_number: string
          target_branch_id: string
          target_brand_id: string
          target_customer_id: string
          target_model_id: string
        }
        Returns: string
      }
      create_customer_with_private_details: {
        Args: {
          new_address?: Json
          new_display_name: string
          new_email?: string
          new_identity_document?: string
          new_internal_notes?: string
          new_kind: Database["erp"]["Enums"]["party_kind"]
          new_legal_name?: string
          new_phone?: string
          new_tax_id?: string
        }
        Returns: string
      }
      create_document_template_version: {
        Args: {
          definition: Json
          operation_key: string
          operation_reason: string
          target_template_id: string
        }
        Returns: string
      }
      create_financing_contract: {
        Args: {
          currency: string
          down_payment: number
          first_due: string
          installments_count: number
          interest_rate: number
          operation_key: string
          operation_reason: string
          principal: number
          target_branch_id: string
          target_customer_id: string
        }
        Returns: string
      }
      create_message_template_version: {
        Args: {
          body: string
          language_code: string
          operation_key: string
          operation_reason: string
          provider_template_name: string
          target_template_id: string
          variable_keys: Json
        }
        Returns: string
      }
      create_pc_build_atomic: {
        Args: {
          build_notes: string
          build_title: string
          components_list: Json
          operation_reason?: string
          target_branch_id: string
          target_customer_id: string
        }
        Returns: Json
      }
      create_pc_build_project: {
        Args: {
          operation_key: string
          operation_reason: string
          project_notes: string
          project_title: string
          target_branch_id: string
          target_customer_id: string
        }
        Returns: string
      }
      create_pc_build_revision: {
        Args: {
          components: Json
          configuration: Json
          operation_key: string
          operation_reason: string
          target_project_id: string
          target_rule_set_version_id: string
          target_spec_version_id: string
        }
        Returns: string
      }
      create_purchase_order: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          order_currency: string
          target_branch_id: string
          target_exchange_snapshot_id: string
          target_supplier_id: string
        }
        Returns: string
      }
      create_repair_media_upload_token: {
        Args: {
          allowed_mime_types: string[]
          expires_at: string
          max_file_count: number
          max_total_bytes: number
          operation_key: string
          target_repair_order_id: string
        }
        Returns: {
          upload_token: string
          upload_token_id: string
        }[]
      }
      create_repair_order: {
        Args: {
          accessories: Json
          intake_condition: string
          intake_damage: string
          intake_notes: string
          operation_key: string
          operation_reason: string
          reported_fault: string
          target_branch_id: string
          target_customer_id: string
          target_equipment_id: string
        }
        Returns: {
          order_code: string
          repair_order_id: string
          tracking_token: string
        }[]
      }
      create_repair_quote_version: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          quote_currency: string
          target_exchange_snapshot_id: string
          target_repair_order_id: string
        }
        Returns: string
      }
      create_repair_quote_version_unchecked: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          quote_currency: string
          target_exchange_snapshot_id: string
          target_repair_order_id: string
        }
        Returns: string
      }
      create_sale: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          payment_lines?: Json
          sale_currency: string
          target_branch_id: string
          target_customer_id: string
          target_exchange_snapshot_id: string
          target_reservation_batch_id?: string
        }
        Returns: string
      }
      create_sale_with_fiscal_document: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          payment_lines?: Json
          sale_currency: string
          target_branch_id: string
          target_customer_id: string
          target_exchange_snapshot_id: string
          target_reservation_batch_id?: string
        }
        Returns: Json
      }
      create_sale_with_invoice: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          payment_lines?: Json
          sale_currency: string
          target_branch_id: string
          target_customer_id: string
          target_exchange_snapshot_id: string
          target_invoice_kind: string
          target_reservation_batch_id?: string
        }
        Returns: Json
      }
      create_stock_reservation: {
        Args: {
          expiration_time: string
          lines: Json
          operation_key: string
          reservation_source_id: string
          reservation_source_type: string
          target_branch_id: string
        }
        Returns: string
      }
      create_trade_in: {
        Args: {
          declared_owner_name: string
          declared_value_base: number
          evidence: Json
          imei: string
          operation_key: string
          operation_reason: string
          provenance_declaration: string
          serial_number: string
          target_branch_id: string
          target_customer_id: string
          target_product_id: string
          target_variant_id: string
        }
        Returns: string
      }
      create_trade_in_evaluation: {
        Args: {
          appraised_value_base: number
          condition_snapshot: Json
          estimated_refurbishment_cost_base: number
          operation_key: string
          operation_reason: string
          target_trade_in_id: string
        }
        Returns: string
      }
      create_web_order: {
        Args: {
          expiration_time: string
          lines: Json
          operation_key: string
          order_currency: string
          target_branch_id: string
          target_customer_id: string
          target_exchange_snapshot_id: string
        }
        Returns: string
      }
      current_organization_id: { Args: never; Returns: string }
      deliver_repair_order: {
        Args: {
          operation_key: string
          operation_reason: string
          recipient_document_suffix: string
          recipient_name: string
          signature_method: string
          signature_reference: string
          target_repair_order_id: string
          warranty_days: number
          warranty_terms: string
        }
        Returns: string
      }
      ensure_default_accounting_setup: {
        Args: { target_organization_id: string }
        Returns: undefined
      }
      ensure_open_period: {
        Args: { target_date: string; target_organization_id: string }
        Returns: string
      }
      ensure_open_period_internal: {
        Args: { target_date: string; target_organization_id: string }
        Returns: string
      }
      ensure_settlement_accounting_setup: {
        Args: { target_organization_id: string }
        Returns: undefined
      }
      expire_stock_reservations: {
        Args: { batch_limit?: number; target_branch_id: string }
        Returns: number
      }
      export_report_rows: {
        Args: {
          date_from?: string
          date_to?: string
          filters?: Json
          operation_reason: string
          report_code: string
          row_limit?: number
          target_branch_id?: string
        }
        Returns: Json
      }
      fulfill_online_order: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_reference: string
          target_order_id: string
        }
        Returns: Json
      }
      fulfill_stock_reservation: {
        Args: {
          operation_key: string
          operation_reason: string
          target_batch_id: string
        }
        Returns: string
      }
      fulfill_stock_reservation_core: {
        Args: {
          operation_key: string
          operation_reason: string
          target_batch_id: string
        }
        Returns: string
      }
      fulfill_web_order: {
        Args: {
          operation_key: string
          operation_reason: string
          target_web_order_id: string
        }
        Returns: string
      }
      get_current_erp_context: { Args: never; Returns: Json }
      get_customer_equipment_identifiers: {
        Args: { target_equipment_id: string }
        Returns: {
          equipment_id: string
          imei: string
          normalized_imei: string
          normalized_serial_number: string
          serial_number: string
        }[]
      }
      get_customer_private_details: {
        Args: { target_customer_id: string }
        Returns: {
          address: Json
          communication_consent: boolean
          consent_recorded_at: string
          customer_id: string
          identity_document: string
          internal_notes: string
          tax_id: string
        }[]
      }
      get_document_sale_receipts: {
        Args: { target_document_ids: string[] }
        Returns: {
          document_id: string
          receipt: Json
        }[]
      }
      get_inventory_unit_identifiers: {
        Args: { target_unit_id: string }
        Returns: {
          imei: string
          inventory_unit_id: string
          normalized_imei: string
          normalized_serial_number: string
          serial_number: string
        }[]
      }
      get_or_create_exchange_snapshot: {
        Args: { target_quote_currency?: string }
        Returns: string
      }
      get_or_create_pos_customer: {
        Args: { p_display_name?: string }
        Returns: string
      }
      get_or_open_pos_cash_session: {
        Args: { target_branch_id?: string }
        Returns: string
      }
      get_pc_build_costs: {
        Args: { target_completion_id: string }
        Returns: {
          component_id: string
          quantity: number
          unit_cost_snapshot: number
        }[]
      }
      get_repair_credentials: {
        Args: { target_repair_order_id: string }
        Returns: Json
      }
      get_repair_quote_costs: {
        Args: { target_quote_id: string }
        Returns: {
          line_id: string
          line_number: number
          unit_cost_snapshot: number
        }[]
      }
      get_trade_in_costs: {
        Args: { target_trade_in_id: string }
        Returns: {
          accepted_value_base: number
          intake_declared_value_base: number
          refurbishment_cost_base: number
          total_cost_base: number
        }[]
      }
      get_trade_in_imei_provider_request: {
        Args: { target_request_id: string }
        Returns: {
          imei: string
          provider: string
          request_id: string
        }[]
      }
      has_permission: {
        Args: { permission_code: string; target_branch_id?: string }
        Returns: boolean
      }
      intake_repair_order: {
        Args: {
          accessories?: Json
          brand_name: string
          equipment_type: string
          imei?: string
          intake_condition?: string
          intake_damage?: string
          intake_notes?: string
          model_name: string
          operation_reason?: string
          reported_fault?: string
          serial_number?: string
          target_branch_id: string
          target_customer_id: string
        }
        Returns: Json
      }
      intake_trade_in_direct: {
        Args: {
          declaration_text: string
          declared_value: number
          device_imei: string
          device_serial: string
          evidence_doc?: string
          operation_reason?: string
          owner_name: string
          target_branch_id: string
          target_customer_id: string
          target_product_id: string
          target_variant_id: string
        }
        Returns: string
      }
      is_finite_numeric_text: { Args: { value: string }; Returns: boolean }
      issue_document: {
        Args: {
          content_sha256: string
          customer_snapshot: Json
          document_number: string
          operation_key: string
          operation_reason: string
          owner_id: string
          owner_type: string
          private_object_path: string
          target_branch_id: string
          target_template_version_id: string
        }
        Returns: string
      }
      issue_invoice_document: {
        Args: {
          content_sha256: string
          customer_snapshot: Json
          document_number: string
          operation_key: string
          operation_reason: string
          target_branch_id: string
          target_invoice_kind: string
          target_owner_id: string
          target_template_version_id: string
        }
        Returns: string
      }
      issue_repair_quote: {
        Args: {
          expires_at: string
          operation_key: string
          operation_reason: string
          target_quote_id: string
        }
        Returns: {
          quote_id: string
          response_token: string
        }[]
      }
      list_available_inventory_units_for_pos: {
        Args: never
        Returns: {
          current_location_id: string
          id: string
          imei: string
          product_id: string
          serial_number: string
          variant_id: string
        }[]
      }
      list_document_sale_amounts: {
        Args: { target_document_ids: string[] }
        Returns: {
          amount_ars: number
          document_id: string
        }[]
      }
      list_receivable_cash_sessions: {
        Args: { target_branch_id: string }
        Returns: {
          branch_id: string
          cash_register_code: string
          cash_register_name: string
          currencies: string[]
          id: string
          opened_at: string
        }[]
      }
      list_receivable_payment_methods: {
        Args: { target_branch_id: string }
        Returns: {
          code: string
          id: string
          name: string
          requires_cash_session: boolean
          settlement_kind: string
        }[]
      }
      list_supplier_cash_sessions: {
        Args: { target_branch_id: string }
        Returns: {
          branch_id: string
          cash_register_code: string
          cash_register_name: string
          currencies: string[]
          id: string
          opened_at: string
        }[]
      }
      list_supplier_open_payables: {
        Args: { target_supplier_id: string }
        Returns: {
          amount_currency: number
          branch_id: string
          currency_code: string
          due_at: string
          id: string
          outstanding_base: number
          outstanding_currency: number
          supplier_id: string
        }[]
      }
      list_supplier_payment_methods: {
        Args: { target_branch_id: string }
        Returns: {
          code: string
          id: string
          name: string
          requires_cash_session: boolean
          settlement_kind: string
        }[]
      }
      move_integration_to_dead_letter: {
        Args: { operation_reason: string; target_outbox_id: string }
        Returns: string
      }
      open_cash_session: {
        Args: {
          opening_counts: Json
          operation_key: string
          operation_reason: string
          target_cash_register_id: string
        }
        Returns: string
      }
      open_repair_warranty_claim: {
        Args: {
          operation_key: string
          operation_reason: string
          reported_issue: string
          target_warranty_id: string
        }
        Returns: string
      }
      post_cash_movement: {
        Args: {
          movement_amount: number
          movement_currency: string
          movement_kind: Database["erp"]["Enums"]["cash_movement_kind"]
          operation_key: string
          operation_reason: string
          target_cash_session_id: string
        }
        Returns: string
      }
      post_erp_source_event: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          target_branch_id: string
          target_entry_date: string
          target_source_id: string
          target_source_type: string
        }
        Returns: string
      }
      post_internal_journal_entry: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          target_branch_id: string
          target_entry_date: string
          target_organization_id: string
          target_posting_kind: string
          target_source_id: string
          target_source_type: string
        }
        Returns: string
      }
      post_journal_entry: {
        Args: {
          lines: Json
          operation_key: string
          operation_reason: string
          target_branch_id: string
          target_entry_date: string
          target_source_id: string
          target_source_type: string
        }
        Returns: string
      }
      post_online_order_accounting_internal: {
        Args: {
          ignored_lines: Json
          operation_key: string
          operation_reason: string
          target_branch_id: string
          target_entry_date: string
          target_source_id: string
          target_source_type: string
        }
        Returns: string
      }
      post_purchase_receipt: {
        Args: {
          create_payable?: boolean
          expenses?: Json
          lines: Json
          operation_key: string
          operation_reason: string
          target_purchase_order_id: string
        }
        Returns: string
      }
      post_purchase_receipt_unchecked: {
        Args: {
          create_payable?: boolean
          expenses?: Json
          lines: Json
          operation_key: string
          operation_reason: string
          target_purchase_order_id: string
        }
        Returns: string
      }
      post_stock_document: {
        Args: {
          allow_negative?: boolean
          document_kind: Database["erp"]["Enums"]["stock_document_kind"]
          lines: Json
          operation_key: string
          operation_reason: string
          source_id?: string
          source_type?: string
          target_branch_id: string
        }
        Returns: string
      }
      post_stock_document_core: {
        Args: {
          allow_negative?: boolean
          document_kind: Database["erp"]["Enums"]["stock_document_kind"]
          lines: Json
          operation_key: string
          operation_reason: string
          source_id?: string
          source_type?: string
          target_branch_id: string
        }
        Returns: string
      }
      post_stock_document_stage4_core: {
        Args: {
          allow_negative?: boolean
          document_kind: Database["erp"]["Enums"]["stock_document_kind"]
          lines: Json
          operation_key: string
          operation_reason: string
          source_id?: string
          source_type?: string
          target_branch_id: string
        }
        Returns: string
      }
      post_stock_document_stage7_core: {
        Args: {
          allow_negative?: boolean
          document_kind: Database["erp"]["Enums"]["stock_document_kind"]
          lines: Json
          operation_key: string
          operation_reason: string
          source_id?: string
          source_type?: string
          target_branch_id: string
        }
        Returns: string
      }
      preview_price_change: {
        Args: {
          changes: Json
          operation_key: string
          operation_reason: string
          target_price_list_id: string
        }
        Returns: string
      }
      process_mercadopago_payment: {
        Args: {
          p_branch_id: string
          p_currency_code: string
          p_customer_id: string
          p_exchange_snapshot_id: string
          p_external_reference: string
          p_items: Json
          p_location_id: string
          p_organization_id: string
          p_payer: Json
          p_payment_method_id: string
          p_provider_event_id: string
          p_provider_occurred_at: string
          p_provider_payment_id: string
          p_raw_data: Json
          p_status: string
          p_storefront_order_id: string
          p_total: number
        }
        Returns: Json
      }
      process_stock_document_costs: {
        Args: { target_document_id: string }
        Returns: undefined
      }
      provision_repair_credential_key: {
        Args: {
          new_key_material: string
          operation_reason: string
          target_organization_id: string
        }
        Returns: string
      }
      queue_customer_message: {
        Args: {
          operation_key: string
          operation_reason: string
          recipient_address: string
          target_branch_id: string
          target_conversation_id: string
          target_customer_id: string
          target_template_version_id: string
          variables: Json
        }
        Returns: string
      }
      reconcile_account_balance: {
        Args: {
          operation_reason: string
          target_account_id: string
          target_as_of_date: string
          target_branch_id: string
          target_general_ledger_balance: number
          target_subledger_balance: number
        }
        Returns: string
      }
      record_claimed_integration_attempt: {
        Args: {
          attempt_error?: string
          attempt_status: Database["erp"]["Enums"]["integration_attempt_status"]
          target_claim_token: string
        }
        Returns: string
      }
      record_communication_automation_execution: {
        Args: {
          target_execution_outcome: string
          target_execution_reason: string
          target_message_id: string
          target_rule_id: string
          target_source_event_id: string
          target_source_event_type: string
        }
        Returns: string
      }
      record_communication_consent: {
        Args: {
          granted: boolean
          operation_key: string
          operation_reason: string
          source: string
          target_branch_id: string
          target_channel: Database["erp"]["Enums"]["communication_channel"]
          target_customer_id: string
        }
        Returns: string
      }
      record_fiscal_provider_result: {
        Args: {
          cae: string
          cae_expires_on: string
          error_code: string
          error_message: string
          provider: string
          provider_event_id: string
          response_sha256: string
          result_status: Database["erp"]["Enums"]["fiscal_status"]
          target_request_id: string
        }
        Returns: string
      }
      record_inbound_message: {
        Args: {
          target_body: string
          target_channel: Database["erp"]["Enums"]["communication_channel"]
          target_customer_id: string
          target_occurred_at: string
          target_provider_conversation_id: string
          target_provider_message_id: string
          target_response_sha256: string
          target_sender_address: string
          target_webhook_id: string
        }
        Returns: string
      }
      record_integration_attempt: {
        Args: {
          attempt_error?: string
          attempt_status: Database["erp"]["Enums"]["integration_attempt_status"]
          target_outbox_id: string
        }
        Returns: string
      }
      record_pc_compatibility_run: {
        Args: {
          operation_key: string
          operation_reason: string
          target_revision_id: string
        }
        Returns: string
      }
      record_pc_test_run: {
        Args: {
          operation_key: string
          results: Json
          run_notes: string
          target_revision_id: string
          target_template_version_id: string
        }
        Returns: string
      }
      record_provider_message_event: {
        Args: {
          error_message: string
          new_status: Database["erp"]["Enums"]["communication_status"]
          provider: string
          provider_event_id: string
          provider_message_id: string
          response_sha256: string
          target_message_id: string
        }
        Returns: string
      }
      record_provider_webhook: {
        Args: {
          target_branch_id: string
          target_event_type: string
          target_payload_sha256: string
          target_provider: string
          target_provider_event_id: string
          target_signature_valid: boolean
        }
        Returns: string
      }
      record_purchase_receipt_cost_entry: {
        Args: { target_cost_entry_id: number }
        Returns: undefined
      }
      record_receivable_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          target_branch_id: string
          target_contract_id: string
        }
        Returns: string
      }
      record_receivable_payment_settlement: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          payment_reference?: string
          target_branch_id: string
          target_cash_session_id: string
          target_contract_id: string
          target_payment_method_id: string
        }
        Returns: string
      }
      record_repair_label_event: {
        Args: {
          copies: number
          operation_key: string
          printer_snapshot: string
          target_repair_order_id: string
          template_code: string
        }
        Returns: string
      }
      record_repair_labor: {
        Args: {
          description: string
          operation_key: string
          quantity_hours: number
          target_repair_order_id: string
          unit_cost_base: number
        }
        Returns: string
      }
      record_repair_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          payment_currency: string
          provider_reference?: string
          target_cash_session_id: string
          target_exchange_snapshot_id: string
          target_payment_method_id: string
          target_repair_order_id: string
        }
        Returns: string
      }
      record_repair_test_run: {
        Args: {
          operation_key: string
          results: Json
          run_notes: string
          target_repair_order_id: string
          target_template_version_id: string
        }
        Returns: string
      }
      record_sale_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          provider_reference?: string
          target_cash_session_id: string
          target_payment_method_id: string
          target_sale_id: string
        }
        Returns: string
      }
      record_sale_payment_core: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          provider_reference?: string
          target_cash_session_id: string
          target_payment_method_id: string
          target_sale_id: string
        }
        Returns: string
      }
      record_supplier_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          payment_amount: number
          payment_reference: string
          target_cash_session_id: string
          target_payable_id: string
          target_payment_method_id: string
        }
        Returns: string
      }
      record_trade_in_imei_manual_fallback: {
        Args: {
          documentation: Json
          fallback_status: Database["erp"]["Enums"]["imei_check_status"]
          operation_key: string
          operation_reason: string
          target_trade_in_id: string
        }
        Returns: string
      }
      record_trade_in_imei_provider_result: {
        Args: {
          operation_reason: string
          provider_reference: string
          result_evidence: Json
          result_status: Database["erp"]["Enums"]["imei_check_status"]
          target_request_id: string
        }
        Returns: string
      }
      record_trade_in_refurbishment: {
        Args: {
          actual_cost_base: number
          completed: boolean
          description: string
          operation_key: string
          operation_reason: string
          target_repair_order_id: string
          target_trade_in_id: string
        }
        Returns: string
      }
      record_web_order_event: {
        Args: {
          operation_key: string
          operation_reason: string
          target_delivery_state: Database["erp"]["Enums"]["sale_delivery_state"]
          target_order_state: string
          target_web_order_id: string
        }
        Returns: string
      }
      record_web_payment_event: {
        Args: {
          event_amount: number
          event_payload?: Json
          event_status: Database["erp"]["Enums"]["web_payment_status"]
          provider_event_key: string
          provider_event_time: string
          provider_name: string
          provider_payment_key: string
          target_payment_method_id: string
          target_web_order_id: string
        }
        Returns: string
      }
      refund_fulfilled_online_order: {
        Args: {
          operation_key: string
          operation_reason: string
          physical_return_confirmed: boolean
          target_refund_cash_session_id?: string
          target_refund_payment_event_id: string
          target_web_order_id: string
        }
        Returns: Json
      }
      register_communication_attachment: {
        Args: {
          target_byte_size: number
          target_message_id: string
          target_mime_type: string
          target_sha256: string
        }
        Returns: string
      }
      register_inventory_unit: {
        Args: {
          acquisition_cost?: number
          imei: string
          serial_number: string
          target_product_id: string
          target_variant_id: string
        }
        Returns: string
      }
      reissue_repair_media_upload_token: {
        Args: {
          new_expires_at: string
          operation_reason: string
          target_upload_token_id: string
        }
        Returns: {
          upload_token: string
          upload_token_id: string
        }[]
      }
      reissue_repair_quote_token: {
        Args: {
          new_expires_at: string
          operation_reason: string
          target_quote_id: string
        }
        Returns: {
          quote_id: string
          response_token: string
        }[]
      }
      reject_purchase_order: {
        Args: {
          operation_key: string
          operation_reason: string
          target_purchase_order_id: string
        }
        Returns: string
      }
      release_repair_parts: {
        Args: {
          operation_key: string
          operation_reason: string
          target_batch_id: string
          target_repair_order_id: string
        }
        Returns: string
      }
      release_stock_reservation: {
        Args: { release_reason: string; target_batch_id: string }
        Returns: undefined
      }
      release_trade_in_to_stock: {
        Args: {
          operation_key: string
          operation_reason: string
          target_location_id: string
          target_trade_in_id: string
        }
        Returns: string
      }
      release_web_order_reservation_core: {
        Args: {
          release_reason: string
          target_batch_id: string
          target_organization_id: string
          target_web_order_id: string
        }
        Returns: undefined
      }
      repair_latest_final_test_passes: {
        Args: { target_organization_id: string; target_repair_order_id: string }
        Returns: boolean
      }
      request_fiscal_issuance: {
        Args: {
          operation_key: string
          operation_reason: string
          target_document_id: string
          target_fiscal_point_id: string
          voucher_type: string
        }
        Returns: string
      }
      request_integration_retry: {
        Args: {
          operation_key: string
          operation_reason: string
          requested_action: Database["erp"]["Enums"]["integration_retry_action"]
          target_outbox_id: string
        }
        Returns: string
      }
      request_trade_in_imei_check: {
        Args: {
          operation_key: string
          operation_reason: string
          provider_name: string
          target_trade_in_id: string
        }
        Returns: string
      }
      reservation_source_permission: {
        Args: { source_kind: string }
        Returns: string
      }
      reserve_pc_build_components: {
        Args: {
          expires_at: string
          lines: Json
          operation_key: string
          operation_reason: string
          target_project_id: string
          target_revision_id: string
        }
        Returns: string
      }
      reserve_repair_parts: {
        Args: {
          expires_at: string
          lines: Json
          operation_key: string
          operation_reason: string
          target_repair_order_id: string
        }
        Returns: string
      }
      respond_quote_direct: {
        Args: {
          customer_message?: string
          decision: string
          target_quote_id: string
        }
        Returns: string
      }
      reverse_internal_journal_entry: {
        Args: {
          operation_key: string
          operation_reason: string
          target_entry_id: string
          target_organization_id: string
          target_source_id: string
          target_source_type: string
        }
        Returns: string
      }
      reverse_journal_entry:
        | {
            Args: {
              operation_key: string
              operation_reason: string
              target_entry_id: string
            }
            Returns: string
          }
        | {
            Args: {
              operation_key: string
              operation_reason: string
              target_entry_id: string
              target_reversal_date: string
            }
            Returns: string
          }
      reverse_manual_cash_movement: {
        Args: {
          operation_key: string
          operation_reason: string
          target_cash_movement_id: string
        }
        Returns: string
      }
      reverse_receivable_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          target_payment_id: string
          target_refund_cash_session_id?: string
        }
        Returns: string
      }
      reverse_repair_part_consumption: {
        Args: {
          operation_key: string
          operation_reason: string
          target_repair_order_id: string
          target_stock_document_id: string
        }
        Returns: string
      }
      reverse_repair_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          target_payment_id: string
          target_refund_cash_session_id?: string
        }
        Returns: string
      }
      reverse_sale_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          target_payment_id: string
          target_refund_cash_session_id?: string
        }
        Returns: string
      }
      reverse_sale_payment_stage7_core: {
        Args: {
          operation_key: string
          operation_reason: string
          target_payment_id: string
          target_refund_cash_session_id?: string
        }
        Returns: string
      }
      reverse_stock_document: {
        Args: {
          operation_key: string
          operation_reason: string
          original_document_id: string
        }
        Returns: string
      }
      reverse_stock_document_core: {
        Args: {
          operation_key: string
          operation_reason: string
          original_document_id: string
        }
        Returns: string
      }
      reverse_stock_document_stage7_core: {
        Args: {
          operation_key: string
          operation_reason: string
          original_document_id: string
        }
        Returns: string
      }
      reverse_supplier_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          target_supplier_payment_id: string
        }
        Returns: string
      }
      reverse_trade_in_sale_payment: {
        Args: {
          operation_key: string
          operation_reason: string
          target_payment_id: string
        }
        Returns: string
      }
      review_trade_in_evaluation: {
        Args: {
          decision: Database["erp"]["Enums"]["trade_in_review_decision"]
          operation_reason: string
          target_evaluation_id: string
        }
        Returns: string
      }
      review_trade_in_provenance: {
        Args: {
          decision: Database["erp"]["Enums"]["trade_in_review_decision"]
          operation_reason: string
          target_trade_in_id: string
        }
        Returns: string
      }
      revoke_repair_media_upload_token: {
        Args: { operation_reason: string; target_upload_token_id: string }
        Returns: undefined
      }
      revoke_repair_tracking_token: {
        Args: { operation_reason: string; target_repair_order_id: string }
        Returns: undefined
      }
      rotate_repair_credentials: {
        Args: {
          credentials: Json
          operation_reason: string
          target_repair_order_id: string
        }
        Returns: string
      }
      rotate_repair_tracking_token: {
        Args: {
          new_expires_at: string
          operation_reason: string
          target_repair_order_id: string
        }
        Returns: string
      }
      stage8_json_has_forbidden_key: {
        Args: { forbidden_keys: string[]; value: Json }
        Returns: boolean
      }
      transfer_customer_equipment: {
        Args: {
          operation_key: string
          operation_reason: string
          target_branch_id: string
          target_customer_id: string
          target_equipment_id: string
        }
        Returns: string
      }
      transition_repair_order: {
        Args: {
          operation_key: string
          operation_reason: string
          public_message: string
          target_repair_order_id: string
          target_status_id: string
        }
        Returns: string
      }
      upsert_customer_private_details: {
        Args: {
          new_address?: Json
          new_communication_consent?: boolean
          new_consent_recorded_at?: string
          new_identity_document?: string
          new_internal_notes?: string
          new_tax_id?: string
          target_customer_id: string
        }
        Returns: string
      }
      void_document: {
        Args: {
          operation_key: string
          operation_reason: string
          target_document_id: string
        }
        Returns: string
      }
    }
    Enums: {
      account_normal_balance: "debit" | "credit"
      account_type: "asset" | "liability" | "equity" | "income" | "expense"
      accounting_entry_status: "draft" | "posted" | "reversed"
      accounting_period_status: "open" | "closed"
      cash_movement_kind:
        | "payment"
        | "refund"
        | "contribution"
        | "withdrawal"
        | "expense"
      catalog_item_kind: "product" | "service"
      communication_channel: "whatsapp" | "email"
      communication_direction: "inbound" | "outbound"
      communication_status: "queued" | "sent" | "delivered" | "read" | "failed"
      cost_entry_kind: "purchase_receipt"
      document_status: "issued" | "voided"
      financing_installment_status:
        | "upcoming"
        | "due"
        | "partially_paid"
        | "paid"
        | "cancelled"
      financing_status:
        | "current"
        | "due"
        | "partially_paid"
        | "refinanced"
        | "cancelled"
        | "uncollectible"
        | "paid"
      fiscal_status: "queued" | "authorized" | "rejected" | "failed"
      identifier_kind: "internal" | "manufacturer" | "barcode" | "additional"
      imei_check_status:
        | "clear"
        | "blocked"
        | "not_required"
        | "unavailable"
        | "error"
      integration_attempt_status: "succeeded" | "failed"
      integration_retry_action: "retry" | "recover"
      inventory_count_status:
        | "draft"
        | "counting"
        | "review"
        | "posted"
        | "cancelled"
      inventory_tracking_mode: "none" | "quantity" | "serial" | "imei"
      inventory_unit_status:
        | "available"
        | "reserved"
        | "in_transit"
        | "in_repair"
        | "sold"
        | "warranty"
        | "quarantine"
        | "retired"
      location_kind:
        | "store"
        | "warehouse"
        | "workshop"
        | "repair_reserve"
        | "web_reserve"
        | "warranty"
        | "transit"
        | "quarantine"
        | "other"
      party_kind: "person" | "business"
      pc_build_state:
        | "draft"
        | "reserved"
        | "tested"
        | "completed"
        | "cancelled"
      pc_compatibility_outcome: "pass" | "warning" | "fail"
      permission_effect: "allow" | "deny"
      purchase_approval_action: "approved" | "rejected"
      purchase_expense_kind:
        | "freight"
        | "tax"
        | "insurance"
        | "customs"
        | "other"
      reconciliation_status: "matched" | "unmatched"
      repair_part_action:
        | "reserved"
        | "released"
        | "consumed"
        | "consumption_reversed"
      repair_quote_decision: "approved" | "rejected"
      repair_test_kind: "intake" | "final"
      repair_test_result: "pass" | "fail" | "not_applicable"
      sale_delivery_state:
        | "pending"
        | "preparing"
        | "ready"
        | "dispatched"
        | "delivered"
        | "returned"
      sale_line_kind: "product" | "service" | "free_concept"
      sale_payment_state: "unpaid" | "partial" | "paid" | "refunded"
      sale_state: "confirmed" | "cancelled"
      service_price_mode: "fixed" | "suggested" | "editable"
      stock_document_kind:
        | "opening"
        | "receipt"
        | "sale"
        | "transfer"
        | "adjustment"
        | "reservation_fulfillment"
        | "repair_consumption"
        | "return"
        | "physical_count"
      stock_document_status: "posted" | "reversed"
      stock_reservation_status: "active" | "released" | "fulfilled" | "expired"
      trade_in_review_decision: "approved" | "rejected"
      web_payment_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "refunded"
      zero_stock_behavior: "hidden" | "out_of_stock" | "inquiry"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  erp: {
    Enums: {
      account_normal_balance: ["debit", "credit"],
      account_type: ["asset", "liability", "equity", "income", "expense"],
      accounting_entry_status: ["draft", "posted", "reversed"],
      accounting_period_status: ["open", "closed"],
      cash_movement_kind: [
        "payment",
        "refund",
        "contribution",
        "withdrawal",
        "expense",
      ],
      catalog_item_kind: ["product", "service"],
      communication_channel: ["whatsapp", "email"],
      communication_direction: ["inbound", "outbound"],
      communication_status: ["queued", "sent", "delivered", "read", "failed"],
      cost_entry_kind: ["purchase_receipt"],
      document_status: ["issued", "voided"],
      financing_installment_status: [
        "upcoming",
        "due",
        "partially_paid",
        "paid",
        "cancelled",
      ],
      financing_status: [
        "current",
        "due",
        "partially_paid",
        "refinanced",
        "cancelled",
        "uncollectible",
        "paid",
      ],
      fiscal_status: ["queued", "authorized", "rejected", "failed"],
      identifier_kind: ["internal", "manufacturer", "barcode", "additional"],
      imei_check_status: [
        "clear",
        "blocked",
        "not_required",
        "unavailable",
        "error",
      ],
      integration_attempt_status: ["succeeded", "failed"],
      integration_retry_action: ["retry", "recover"],
      inventory_count_status: [
        "draft",
        "counting",
        "review",
        "posted",
        "cancelled",
      ],
      inventory_tracking_mode: ["none", "quantity", "serial", "imei"],
      inventory_unit_status: [
        "available",
        "reserved",
        "in_transit",
        "in_repair",
        "sold",
        "warranty",
        "quarantine",
        "retired",
      ],
      location_kind: [
        "store",
        "warehouse",
        "workshop",
        "repair_reserve",
        "web_reserve",
        "warranty",
        "transit",
        "quarantine",
        "other",
      ],
      party_kind: ["person", "business"],
      pc_build_state: ["draft", "reserved", "tested", "completed", "cancelled"],
      pc_compatibility_outcome: ["pass", "warning", "fail"],
      permission_effect: ["allow", "deny"],
      purchase_approval_action: ["approved", "rejected"],
      purchase_expense_kind: [
        "freight",
        "tax",
        "insurance",
        "customs",
        "other",
      ],
      reconciliation_status: ["matched", "unmatched"],
      repair_part_action: [
        "reserved",
        "released",
        "consumed",
        "consumption_reversed",
      ],
      repair_quote_decision: ["approved", "rejected"],
      repair_test_kind: ["intake", "final"],
      repair_test_result: ["pass", "fail", "not_applicable"],
      sale_delivery_state: [
        "pending",
        "preparing",
        "ready",
        "dispatched",
        "delivered",
        "returned",
      ],
      sale_line_kind: ["product", "service", "free_concept"],
      sale_payment_state: ["unpaid", "partial", "paid", "refunded"],
      sale_state: ["confirmed", "cancelled"],
      service_price_mode: ["fixed", "suggested", "editable"],
      stock_document_kind: [
        "opening",
        "receipt",
        "sale",
        "transfer",
        "adjustment",
        "reservation_fulfillment",
        "repair_consumption",
        "return",
        "physical_count",
      ],
      stock_document_status: ["posted", "reversed"],
      stock_reservation_status: ["active", "released", "fulfilled", "expired"],
      trade_in_review_decision: ["approved", "rejected"],
      web_payment_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "refunded",
      ],
      zero_stock_behavior: ["hidden", "out_of_stock", "inquiry"],
    },
  },
} as const

