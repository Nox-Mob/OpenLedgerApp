export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  ledger: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          subtype: string | null
          type: Database["ledger"]["Enums"]["account_type"]
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          subtype?: string | null
          type: Database["ledger"]["Enums"]["account_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          subtype?: string | null
          type?: Database["ledger"]["Enums"]["account_type"]
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          created_at: string
          id: string
          kind: string
          ok: boolean
          org_id: string
          page_count: number | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          ok?: boolean
          org_id: string
          page_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          ok?: boolean
          org_id?: string
          page_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          kind: string
          org_id: string
          recorded_change: Json | null
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          kind?: string
          org_id: string
          recorded_change?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          kind?: string
          org_id?: string
          recorded_change?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          account_id: string
          amount_cents: number
          bank_date: string
          batch_id: string | null
          created_at: string
          description: string
          external_id: string | null
          fingerprint: string
          id: string
          needs_review: boolean
          org_id: string
          raw: Json | null
          row_seq: number | null
          transaction_id: string | null
        }
        ComputedFields: never
        Insert: {
          account_id: string
          amount_cents: number
          bank_date: string
          batch_id?: string | null
          created_at?: string
          description: string
          external_id?: string | null
          fingerprint: string
          id?: string
          needs_review?: boolean
          org_id: string
          raw?: Json | null
          row_seq?: number | null
          transaction_id?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          bank_date?: string
          batch_id?: string | null
          created_at?: string
          description?: string
          external_id?: string | null
          fingerprint?: string
          id?: string
          needs_review?: boolean
          org_id?: string
          raw?: Json | null
          row_seq?: number | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_batch_id_fkey"
            columns: ["batch_id"]
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          fund_id: string | null
          id: string
          org_id: string
          period_start: string
          period_type: string
          project_id: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          fund_id?: string | null
          id: string
          org_id: string
          period_start: string
          period_type: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          fund_id?: string | null
          id?: string
          org_id?: string
          period_start?: string
          period_type?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_fund_id_fkey"
            columns: ["fund_id"]
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          type: Database["ledger"]["Enums"]["account_type"]
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          type?: Database["ledger"]["Enums"]["account_type"]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          type?: Database["ledger"]["Enums"]["account_type"]
        }
        Relationships: []
      }
      deleted_organizations: {
        Row: {
          deleted_at: string
          deleted_by: string
          id: string
          name: string
          org_id: string
        }
        ComputedFields: never
        Insert: {
          deleted_at?: string
          deleted_by: string
          id: string
          name: string
          org_id: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      entries: {
        Row: {
          account_id: string
          amount_cents: number
          category_id: string | null
          created_at: string
          fund_id: string | null
          id: string
          memo: string | null
          org_id: string
          project_id: string | null
          reconciliation_id: string | null
          transaction_id: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          amount_cents: number
          category_id?: string | null
          created_at?: string
          fund_id?: string | null
          id?: string
          memo?: string | null
          org_id: string
          project_id?: string | null
          reconciliation_id?: string | null
          transaction_id: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          category_id?: string | null
          created_at?: string
          fund_id?: string | null
          id?: string
          memo?: string | null
          org_id?: string
          project_id?: string | null
          reconciliation_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entries_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_fund_id_fkey"
            columns: ["fund_id"]
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      funds: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_restricted: boolean
          name: string
          org_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_restricted?: boolean
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_restricted?: boolean
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          account_id: string
          balance_mismatch_cents: number | null
          beginning_balance_cents: number | null
          created_at: string
          created_by: string | null
          ending_balance_cents: number | null
          file_name: string
          format: Database["ledger"]["Enums"]["import_format"]
          id: string
          org_id: string
          rows_duplicate: number
          rows_error: number
          rows_imported: number
          rows_total: number
          statement_end: string | null
          statement_start: string | null
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          balance_mismatch_cents?: number | null
          beginning_balance_cents?: number | null
          created_at?: string
          created_by?: string | null
          ending_balance_cents?: number | null
          file_name: string
          format: Database["ledger"]["Enums"]["import_format"]
          id?: string
          org_id: string
          rows_duplicate?: number
          rows_error?: number
          rows_imported?: number
          rows_total?: number
          statement_end?: string | null
          statement_start?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          balance_mismatch_cents?: number | null
          beginning_balance_cents?: number | null
          created_at?: string
          created_by?: string | null
          ending_balance_cents?: number | null
          file_name?: string
          format?: Database["ledger"]["Enums"]["import_format"]
          id?: string
          org_id?: string
          rows_duplicate?: number
          rows_error?: number
          rows_imported?: number
          rows_total?: number
          statement_end?: string | null
          statement_start?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      import_profiles: {
        Row: {
          account_id: string
          created_at: string
          id: string
          mapping: NonNullable<Json>
          name: string
          org_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          mapping?: NonNullable<Json>
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          mapping?: NonNullable<Json>
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_profiles_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          document_type: string
          id: string
          user_id: string
          version: string
        }
        ComputedFields: never
        Insert: {
          accepted_at?: string
          document_type: string
          id?: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          document_type?: string
          id?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      member_roles: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      org_settings: {
        Row: {
          ai_pdf_enabled: boolean
          books_locked_through: string | null
          currency: string
          fiscal_year_start_month: number
          org_id: string
          org_type: Database["ledger"]["Enums"]["org_type"]
          recurring_mode: string
          require_mfa: boolean
          term_overrides: NonNullable<Json>
          terminology: string
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          ai_pdf_enabled?: boolean
          books_locked_through?: string | null
          currency?: string
          fiscal_year_start_month?: number
          org_id: string
          org_type?: Database["ledger"]["Enums"]["org_type"]
          recurring_mode?: string
          require_mfa?: boolean
          term_overrides?: NonNullable<Json>
          terminology?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          ai_pdf_enabled?: boolean
          books_locked_through?: string | null
          currency?: string
          fiscal_year_start_month?: number
          org_id?: string
          org_type?: Database["ledger"]["Enums"]["org_type"]
          recurring_mode?: string
          require_mfa?: boolean
          term_overrides?: NonNullable<Json>
          terminology?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      period_closes: {
        Row: {
          closed_by: string
          created_at: string
          fiscal_year_end: string
          id: string
          net_income_cents: number
          org_id: string
          transaction_id: string | null
        }
        ComputedFields: never
        Insert: {
          closed_by: string
          created_at?: string
          fiscal_year_end: string
          id?: string
          net_income_cents: number
          org_id: string
          transaction_id?: string | null
        }
        Update: {
          closed_by?: string
          created_at?: string
          fiscal_year_end?: string
          id?: string
          net_income_cents?: number
          org_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "period_closes_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      pledge_payments: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          kind: string
          org_id: string
          paid_date: string
          pledge_id: string
          transaction_id: string
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          id: string
          kind?: string
          org_id: string
          paid_date: string
          pledge_id: string
          transaction_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          kind?: string
          org_id?: string
          paid_date?: string
          pledge_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pledge_payments_pledge_id_fkey"
            columns: ["pledge_id"]
            referencedRelation: "pledges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledge_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      pledges: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          donor_name: string
          expected_date: string | null
          fund_id: string | null
          id: string
          note: string | null
          org_id: string
          pledge_date: string
          status: string
          transaction_id: string | null
        }
        ComputedFields: never
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          donor_name: string
          expected_date?: string | null
          fund_id?: string | null
          id: string
          note?: string | null
          org_id: string
          pledge_date: string
          status?: string
          transaction_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          donor_name?: string
          expected_date?: string | null
          fund_id?: string | null
          id?: string
          note?: string | null
          org_id?: string
          pledge_date?: string
          status?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pledges_fund_id_fkey"
            columns: ["fund_id"]
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_cents: number
          created_at: string
          id: string
          name: string
          org_id: string
          status: string
        }
        ComputedFields: never
        Insert: {
          budget_cents?: number
          created_at?: string
          id?: string
          name: string
          org_id: string
          status?: string
        }
        Update: {
          budget_cents?: number
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          status?: string
        }
        Relationships: []
      }
      reconciliations: {
        Row: {
          account_id: string
          batch_id: string | null
          beginning_balance_cents: number
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          ending_balance_cents: number
          id: string
          mode: Database["ledger"]["Enums"]["reconcile_mode"]
          org_id: string
          period_end: string
          period_start: string
          status: Database["ledger"]["Enums"]["reconcile_status"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          batch_id?: string | null
          beginning_balance_cents?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          ending_balance_cents?: number
          id?: string
          mode?: Database["ledger"]["Enums"]["reconcile_mode"]
          org_id: string
          period_end: string
          period_start: string
          status?: Database["ledger"]["Enums"]["reconcile_status"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          batch_id?: string | null
          beginning_balance_cents?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          ending_balance_cents?: number
          id?: string
          mode?: Database["ledger"]["Enums"]["reconcile_mode"]
          org_id?: string
          period_end?: string
          period_start?: string
          status?: Database["ledger"]["Enums"]["reconcile_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_batch_id_fkey"
            columns: ["batch_id"]
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_occurrences: {
        Row: {
          created_at: string
          due_date: string
          id: string
          org_id: string
          status: string
          template_id: string
          transaction_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          due_date: string
          id: string
          org_id: string
          status: string
          template_id: string
          transaction_id?: string | null
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          org_id?: string
          status?: string
          template_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_occurrences_template_id_fkey"
            columns: ["template_id"]
            referencedRelation: "transaction_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_occurrences_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      transaction_tags: {
        Row: {
          org_id: string
          tag_id: string
          transaction_id: string
        }
        ComputedFields: never
        Insert: {
          org_id: string
          tag_id: string
          transaction_id: string
        }
        Update: {
          org_id?: string
          tag_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_tag_id_fkey"
            columns: ["tag_id"]
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_templates: {
        Row: {
          active: boolean
          created_at: string
          description: string
          frequency: string | null
          id: string
          lines: NonNullable<Json>
          name: string
          next_due: string | null
          org_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          created_at?: string
          description: string
          frequency?: string | null
          id: string
          lines?: NonNullable<Json>
          name: string
          next_due?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          frequency?: string | null
          id?: string
          lines?: NonNullable<Json>
          name?: string
          next_due?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: string
          idempotency_key: string | null
          org_id: string
          posted_date: string | null
          source: Database["ledger"]["Enums"]["transaction_source"]
          status: Database["ledger"]["Enums"]["transaction_status"]
          transaction_date: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          idempotency_key?: string | null
          org_id: string
          posted_date?: string | null
          source?: Database["ledger"]["Enums"]["transaction_source"]
          status?: Database["ledger"]["Enums"]["transaction_status"]
          transaction_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          idempotency_key?: string | null
          org_id?: string
          posted_date?: string | null
          source?: Database["ledger"]["Enums"]["transaction_source"]
          status?: Database["ledger"]["Enums"]["transaction_status"]
          transaction_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          term_overrides: NonNullable<Json>
          terminology: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          term_overrides?: NonNullable<Json>
          terminology?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          term_overrides?: NonNullable<Json>
          terminology?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      audit_append_in_write: {
        Args: { p_audit: Json; p_org: string; p_user: string }
        Returns: undefined
      }
      audited_write: {
        Args: { p_audit: Json; p_ops: Json; p_org: string; p_user?: string }
        Returns: Json
      }
      can_close_books: { Args: { p_org: string }; Returns: boolean }
      can_edit: { Args: { p_org: string }; Returns: boolean }
      can_read: { Args: { p_org: string }; Returns: boolean }
      is_admin: { Args: { p_org: string }; Returns: boolean }
      is_treasurer: { Args: { p_org: string }; Returns: boolean }
      log_org_deletion: { Args: { p_org: string }; Returns: undefined }
      mfa_ok: { Args: { p_org: string }; Returns: boolean }
      normalize_name: { Args: { p: string }; Returns: string }
      on_invitation_accepted: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      post_transaction_atomic: {
        Args: { p_audit: Json; p_entries: Json; p_tags: Json; p_tx: Json }
        Returns: undefined
      }
      readable_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      void_transaction_atomic: {
        Args: { p_audit: Json; p_id: string; p_org: string }
        Returns: boolean
      }
      writable_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
    }
    Enums: {
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      import_format: "csv" | "ofx" | "qfx" | "pdf"
      org_type: "nonprofit" | "business"
      reconcile_mode: "simple" | "full"
      reconcile_status: "in_progress" | "completed"
      transaction_source:
        | "manual"
        | "import"
        | "opening_balance"
        | "adjustment"
        | "transfer"
        | "closing"
        | "release"
        | "pledge"
      transaction_status: "posted" | "void"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      instance_settings: {
        Row: {
          billing_enabled: boolean
          hub_url: string | null
          id: boolean
        }
        ComputedFields: never
        Insert: {
          billing_enabled?: boolean
          hub_url?: string | null
          id?: boolean
        }
        Update: {
          billing_enabled?: boolean
          hub_url?: string | null
          id?: boolean
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          app: string | null
          app_payload: NonNullable<Json>
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"] | null
          token_hash: string
        }
        ComputedFields: never
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          app?: string | null
          app_payload?: NonNullable<Json>
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          invited_by?: string | null
          org_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"] | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          app?: string | null
          app_payload?: NonNullable<Json>
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"] | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          name: string
          slug: string | null
          time_zone: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name: string
          slug?: string | null
          time_zone?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name?: string
          slug?: string | null
          time_zone?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _clean_org_name: { Args: { p_name: string }; Returns: string }
      _is_active_user: { Args: { p_user: string }; Returns: boolean }
      _member_confirm_text: { Args: { p_user: string }; Returns: string }
      _require_uid: { Args: Record<PropertyKey, never>; Returns: string }
      _token_hash: { Args: { p_token: string }; Returns: string }
      accept_invitation: {
        Args: { p_token: string }
        Returns: {
          app: string
          app_payload: Json
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      can_write: { Args: { p_app: string; p_org: string }; Returns: boolean }
      create_invitation: {
        Args: {
          p_app?: string
          p_days?: number
          p_email: string
          p_org: string
          p_payload?: Json
          p_role: Database["public"]["Enums"]["org_role"]
        }
        Returns: {
          invitation_id: string
          token: string
        }[]
      }
      create_organization: { Args: { p_name: string }; Returns: string }
      delete_organization: {
        Args: { p_confirm_name: string; p_org: string }
        Returns: undefined
      }
      get_invitation: {
        Args: { p_token: string }
        Returns: {
          app: string
          email: string
          org_name: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
        }[]
      }
      has_app_access: {
        Args: { p_app: string; p_org: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          p_org: string
          p_roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      is_member: { Args: { p_org: string }; Returns: boolean }
      list_invitations: {
        Args: { p_org: string }
        Returns: {
          app: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          invited_by_name: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
        }[]
      }
      org_member_directory: {
        Args: { p_org: string }
        Returns: {
          display_name: string
          email: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }[]
      }
      ownership_transfer_candidates: {
        Args: { p_org: string }
        Returns: {
          display_name: string
          email: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }[]
      }
      rename_organization: {
        Args: { p_name: string; p_org: string }
        Returns: undefined
      }
      revoke_invitation: { Args: { p_id: string }; Returns: undefined }
      set_organization_preferences: {
        Args: { p_currency: string; p_org: string; p_time_zone: string }
        Returns: undefined
      }
      shares_org: { Args: { p_user: string }; Returns: boolean }
      transfer_ownership:
        | { Args: { p_new_owner: string; p_org: string }; Returns: undefined }
        | {
            Args: { p_confirm: string; p_new_owner: string; p_org: string }
            Returns: undefined
          }
    }
    Enums: {
      org_role: "owner" | "admin" | "member" | "viewer"
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
  ledger: {
    Enums: {
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
      import_format: ["csv", "ofx", "qfx", "pdf"],
      org_type: ["nonprofit", "business"],
      reconcile_mode: ["simple", "full"],
      reconcile_status: ["in_progress", "completed"],
      transaction_source: [
        "manual",
        "import",
        "opening_balance",
        "adjustment",
        "transfer",
        "closing",
        "release",
        "pledge",
      ],
      transaction_status: ["posted", "void"],
    },
  },
  public: {
    Enums: {
      org_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const
