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
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
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
            isOneToOne: false
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
          mapping: Json
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          mapping?: Json
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          mapping?: Json
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
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
          term_overrides: Json
          terminology: string
          timezone: string
          updated_at: string
        }
        Insert: {
          ai_pdf_enabled?: boolean
          books_locked_through?: string | null
          currency?: string
          fiscal_year_start_month?: number
          org_id: string
          org_type?: Database["ledger"]["Enums"]["org_type"]
          recurring_mode?: string
          require_mfa?: boolean
          term_overrides?: Json
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
          term_overrides?: Json
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
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "pledges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledge_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pledges_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliations_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "api_tasks"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "recurring_occurrences_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "transaction_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_occurrences_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
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
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
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
          lines: Json
          name: string
          next_due: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description: string
          frequency?: string | null
          id: string
          lines?: Json
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
          lines?: Json
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
          term_overrides: Json
          terminology: string
          updated_at: string
          user_id: string
        }
        Insert: {
          term_overrides?: Json
          terminology?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          term_overrides?: Json
          terminology?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      api_budgets: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_type: string | null
          amount_cents: number | null
          fund_id: string | null
          id: string | null
          org_id: string | null
          period_end: string | null
          period_start: string | null
          period_type: string | null
          project_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_fund_id_fkey"
            columns: ["fund_id"]
            isOneToOne: false
            referencedRelation: "funds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      api_people: {
        Row: {
          org_id: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          org_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          org_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      api_period_summaries: {
        Row: {
          currency: string | null
          expense_cents: number | null
          month: string | null
          net_cents: number | null
          org_id: string | null
          revenue_cents: number | null
          transaction_count: number | null
        }
        Relationships: []
      }
      api_tasks: {
        Row: {
          completable: boolean | null
          due_on: string | null
          item_id: string | null
          kind: string | null
          link: string | null
          org_id: string | null
          title: string | null
        }
        Insert: {
          completable?: never
          due_on?: string | null
          item_id?: string | null
          kind?: never
          link?: never
          org_id?: string | null
          title?: never
        }
        Update: {
          completable?: never
          due_on?: string | null
          item_id?: string | null
          kind?: never
          link?: never
          org_id?: string | null
          title?: never
        }
        Relationships: []
      }
    }
    Functions: {
      _next_recurring_date: {
        Args: { p_anchor: number; p_date: string; p_freq: string }
        Returns: string
      }
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
      readable_org_ids: { Args: never; Returns: string[] }
      skip_recurring_due: { Args: { p_template: string }; Returns: string }
      void_transaction_atomic: {
        Args: { p_audit: Json; p_id: string; p_org: string }
        Returns: boolean
      }
      wf_month_totals: {
        Args: { p_org: string; p_params: Json }
        Returns: Json
      }
      writable_org_ids: { Args: never; Returns: string[] }
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
      _core_migration_marks: {
        Row: {
          done_at: string
          mark: string
        }
        Insert: {
          done_at?: string
          mark: string
        }
        Update: {
          done_at?: string
          mark?: string
        }
        Relationships: []
      }
      app_permission_types: {
        Row: {
          app: string
          description: string
          key: string
          label: string
          sort: number
        }
        Insert: {
          app: string
          description?: string
          key: string
          label: string
          sort?: number
        }
        Update: {
          app?: string
          description?: string
          key?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      app_role_overrides: {
        Row: {
          app: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          set_at: string
          set_by: string | null
          user_id: string
        }
        Insert: {
          app: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          set_at?: string
          set_by?: string | null
          user_id: string
        }
        Update: {
          app?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          set_at?: string
          set_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_role_overrides_org_id_user_id_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      automation_action_types: {
        Row: {
          app: string
          description: string
          kind: string
          label: string
          output_schema: Json
          params_schema: Json
          requires: string[]
          run_fn: string | null
          sort: number
          type: string
        }
        Insert: {
          app: string
          description?: string
          kind?: string
          label: string
          output_schema?: Json
          params_schema?: Json
          requires?: string[]
          run_fn?: string | null
          sort?: number
          type: string
        }
        Update: {
          app?: string
          description?: string
          kind?: string
          label?: string
          output_schema?: Json
          params_schema?: Json
          requires?: string[]
          run_fn?: string | null
          sort?: number
          type?: string
        }
        Relationships: []
      }
      automation_editors: {
        Row: {
          granted_at: string
          granted_by: string | null
          org_id: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          org_id: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_editors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_events: {
        Row: {
          ctx: Json
          id: number
          occurred_at: string
          org_id: string
          processed_at: string | null
          type: string
        }
        Insert: {
          ctx?: Json
          id?: never
          occurred_at?: string
          org_id: string
          processed_at?: string | null
          type: string
        }
        Update: {
          ctx?: Json
          id?: never
          occurred_at?: string
          org_id?: string
          processed_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_jobs: {
        Row: {
          app: string
          attempts: number
          created_at: string
          error: string | null
          id: number
          kind: string
          org_id: string
          payload: Json
          result: Json | null
          run_id: number | null
          status: string
          updated_at: string
        }
        Insert: {
          app: string
          attempts?: number
          created_at?: string
          error?: string | null
          id?: never
          kind: string
          org_id: string
          payload?: Json
          result?: Json | null
          run_id?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          app?: string
          attempts?: number
          created_at?: string
          error?: string | null
          id?: never
          kind?: string
          org_id?: string
          payload?: Json
          result?: Json | null
          run_id?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_kinds: {
        Row: {
          app: string
          category: string
          default_enabled: boolean
          default_params: Json
          description: string
          key: string
          name: string
          params_schema: Json
          sort: number
        }
        Insert: {
          app: string
          category?: string
          default_enabled?: boolean
          default_params?: Json
          description: string
          key: string
          name: string
          params_schema?: Json
          sort?: number
        }
        Update: {
          app?: string
          category?: string
          default_enabled?: boolean
          default_params?: Json
          description?: string
          key?: string
          name?: string
          params_schema?: Json
          sort?: number
        }
        Relationships: []
      }
      automation_log: {
        Row: {
          at: string
          count: number
          id: number
          kind: string
          org_id: string
          summary: string
        }
        Insert: {
          at?: string
          count?: number
          id?: never
          kind: string
          org_id: string
          summary: string
        }
        Update: {
          at?: string
          count?: number
          id?: never
          kind?: string
          org_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_log_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "automation_kinds"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "automation_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_org_settings: {
        Row: {
          chapters_may_build: boolean
          org_id: string
          updated_at: string
        }
        Insert: {
          chapters_may_build?: boolean
          org_id: string
          updated_at?: string
        }
        Update: {
          chapters_may_build?: boolean
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_recipient_types: {
        Row: {
          app: string
          description: string
          label: string
          options_fn: string | null
          params_schema: Json
          resolve_fn: string
          sort: number
          type: string
        }
        Insert: {
          app: string
          description?: string
          label: string
          options_fn?: string | null
          params_schema?: Json
          resolve_fn: string
          sort?: number
          type: string
        }
        Update: {
          app?: string
          description?: string
          label?: string
          options_fn?: string | null
          params_schema?: Json
          resolve_fn?: string
          sort?: number
          type?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          branch: string | null
          ctx: Json
          dedupe_key: string
          error: string | null
          finished_at: string | null
          id: number
          log: Json
          org_id: string
          resume_at: string | null
          started_at: string
          state: Json
          status: string
          trace: Json
          trigger_type: string
          version: number
          wait_job: number | null
          workflow_id: string
        }
        Insert: {
          branch?: string | null
          ctx?: Json
          dedupe_key: string
          error?: string | null
          finished_at?: string | null
          id?: never
          log?: Json
          org_id: string
          resume_at?: string | null
          started_at?: string
          state?: Json
          status?: string
          trace?: Json
          trigger_type: string
          version?: number
          wait_job?: number | null
          workflow_id: string
        }
        Update: {
          branch?: string | null
          ctx?: Json
          dedupe_key?: string
          error?: string | null
          finished_at?: string | null
          id?: never
          log?: Json
          org_id?: string
          resume_at?: string | null
          started_at?: string
          state?: Json
          status?: string
          trace?: Json
          trigger_type?: string
          version?: number
          wait_job?: number | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "automation_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_tasks: {
        Row: {
          assignee_id: string
          created_at: string
          done_at: string | null
          done_by: string | null
          due_on: string | null
          id: string
          link: string | null
          note: string
          org_id: string
          run_id: number | null
          status: string
          title: string
        }
        Insert: {
          assignee_id: string
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          due_on?: string | null
          id?: string
          link?: string | null
          note?: string
          org_id: string
          run_id?: number | null
          status?: string
          title: string
        }
        Update: {
          assignee_id?: string
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          due_on?: string | null
          id?: string
          link?: string | null
          note?: string
          org_id?: string
          run_id?: number | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_tasks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_trigger_types: {
        Row: {
          app: string
          description: string
          fields: Json
          fields_fn: string | null
          kind: string
          label: string
          params_schema: Json
          provides: string[]
          scan_fn: string | null
          sort: number
          type: string
        }
        Insert: {
          app: string
          description?: string
          fields?: Json
          fields_fn?: string | null
          kind: string
          label: string
          params_schema?: Json
          provides?: string[]
          scan_fn?: string | null
          sort?: number
          type: string
        }
        Update: {
          app?: string
          description?: string
          fields?: Json
          fields_fn?: string | null
          kind?: string
          label?: string
          params_schema?: Json
          provides?: string[]
          scan_fn?: string | null
          sort?: number
          type?: string
        }
        Relationships: []
      }
      automation_workflows: {
        Row: {
          adopted_from: string | null
          created_at: string
          created_by: string | null
          definition: Json | null
          description: string
          enabled: boolean
          id: string
          name: string
          org_id: string
          shared: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          adopted_from?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json | null
          description?: string
          enabled?: boolean
          id?: string
          name: string
          org_id: string
          shared?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          adopted_from?: string | null
          created_at?: string
          created_by?: string | null
          definition?: Json | null
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          org_id?: string
          shared?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_workflows_adopted_from_fkey"
            columns: ["adopted_from"]
            isOneToOne: false
            referencedRelation: "automation_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_workflows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          enabled: boolean
          kind: string
          org_id: string
          params: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          kind: string
          org_id: string
          params?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          kind?: string
          org_id?: string
          params?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automations_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "automation_kinds"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_jobs: {
        Row: {
          every: unknown
          fn: string
          last_error: string | null
          last_run_at: string | null
          name: string
        }
        Insert: {
          every?: unknown
          fn: string
          last_error?: string | null
          last_run_at?: string | null
          name: string
        }
        Update: {
          every?: unknown
          fn?: string
          last_error?: string | null
          last_run_at?: string | null
          name?: string
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          app: string
          attempts: number
          category: string
          claimed_at: string | null
          created_at: string
          data: Json
          dedupe_key: string | null
          id: string
          last_error: string | null
          org_id: string | null
          provider_id: string | null
          send_after: string
          sent_at: string | null
          status: string
          template: string
          to_email: string | null
          to_user_id: string | null
        }
        Insert: {
          app: string
          attempts?: number
          category?: string
          claimed_at?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          org_id?: string | null
          provider_id?: string | null
          send_after?: string
          sent_at?: string | null
          status?: string
          template: string
          to_email?: string | null
          to_user_id?: string | null
        }
        Update: {
          app?: string
          attempts?: number
          category?: string
          claimed_at?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          org_id?: string | null
          provider_id?: string | null
          send_after?: string
          sent_at?: string | null
          status?: string
          template?: string
          to_email?: string | null
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_preferences: {
        Row: {
          digest: string
          digest_day: number
          digest_hour: number
          digest_include: string[]
          digest_last_sent_at: string | null
          digest_org_ids: string[] | null
          digest_time_zone: string | null
          reminders: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          digest?: string
          digest_day?: number
          digest_hour?: number
          digest_include?: string[]
          digest_last_sent_at?: string | null
          digest_org_ids?: string[] | null
          digest_time_zone?: string | null
          reminders?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          digest?: string
          digest_day?: number
          digest_hour?: number
          digest_include?: string[]
          digest_last_sent_at?: string | null
          digest_org_ids?: string[] | null
          digest_time_zone?: string | null
          reminders?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      instance_email_settings: {
        Row: {
          from_address: string | null
          from_name: string | null
          id: boolean
          reply_to: string | null
          smtp_host: string | null
          smtp_password_enc: string | null
          smtp_port: number | null
          smtp_security: string
          smtp_username: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          from_address?: string | null
          from_name?: string | null
          id?: boolean
          reply_to?: string | null
          smtp_host?: string | null
          smtp_password_enc?: string | null
          smtp_port?: number | null
          smtp_security?: string
          smtp_username?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          from_address?: string | null
          from_name?: string | null
          id?: boolean
          reply_to?: string | null
          smtp_host?: string | null
          smtp_password_enc?: string | null
          smtp_port?: number | null
          smtp_security?: string
          smtp_username?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      instance_settings: {
        Row: {
          billing_enabled: boolean
          hub_url: string | null
          id: boolean
        }
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
          app_payload: Json
          app_roles: Json
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          named_role_id: string | null
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"] | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          app?: string | null
          app_payload?: Json
          app_roles?: Json
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          invited_by?: string | null
          named_role_id?: string | null
          org_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"] | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          app?: string | null
          app_payload?: Json
          app_roles?: Json
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          named_role_id?: string | null
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"] | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_named_role_id_fkey"
            columns: ["named_role_id"]
            isOneToOne: false
            referencedRelation: "org_named_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          named_role_id: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          named_role_id?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          named_role_id?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_named_role_fk"
            columns: ["org_id", "named_role_id"]
            isOneToOne: false
            referencedRelation: "org_named_roles"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_kinds: {
        Row: {
          app: string
          audience: string
          default_email: boolean
          default_in_app: boolean
          default_roles: Database["public"]["Enums"]["org_role"][]
          description: string
          eligible_roles: Database["public"]["Enums"]["org_role"][]
          email_category: string
          kind: string
          label: string
          sort: number
        }
        Insert: {
          app: string
          audience?: string
          default_email?: boolean
          default_in_app?: boolean
          default_roles?: Database["public"]["Enums"]["org_role"][]
          description?: string
          eligible_roles?: Database["public"]["Enums"]["org_role"][]
          email_category?: string
          kind: string
          label: string
          sort?: number
        }
        Update: {
          app?: string
          audience?: string
          default_email?: boolean
          default_in_app?: boolean
          default_roles?: Database["public"]["Enums"]["org_role"][]
          description?: string
          eligible_roles?: Database["public"]["Enums"]["org_role"][]
          email_category?: string
          kind?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          email: boolean
          in_app: boolean
          kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          email: boolean
          in_app: boolean
          kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          email?: boolean
          in_app?: boolean
          kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "notification_kinds"
            referencedColumns: ["kind"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          dedupe_key: string | null
          id: number
          kind: string
          link: string | null
          link_app: string | null
          org_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          id?: never
          kind: string
          link?: string | null
          link_app?: string | null
          org_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          dedupe_key?: string | null
          id?: never
          kind?: string
          link?: string | null
          link_app?: string | null
          org_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "notification_kinds"
            referencedColumns: ["kind"]
          },
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_named_roles: {
        Row: {
          app_roles: Json
          created_at: string
          description: string
          id: string
          name: string
          org_id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          app_roles?: Json
          created_at?: string
          description?: string
          id?: string
          name: string
          org_id: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          app_roles?: Json
          created_at?: string
          description?: string
          id?: string
          name?: string
          org_id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_named_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
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
          parent_org_id: string | null
          slug: string | null
          source_app: string | null
          source_ref: string | null
          time_zone: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name: string
          parent_org_id?: string | null
          slug?: string | null
          source_app?: string | null
          source_ref?: string | null
          time_zone?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name?: string
          parent_org_id?: string | null
          slug?: string | null
          source_app?: string | null
          source_ref?: string | null
          time_zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          id: string
          updated_at: string
        }
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
      _automation_condition: {
        Args: { p_c: Json; p_ctx: Json }
        Returns: boolean
      }
      _automation_execute: {
        Args: {
          p_ctx: Json
          p_dedupe: string
          p_def: Json
          p_org: string
          p_wf: Database["public"]["Tables"]["automation_workflows"]["Row"]
        }
        Returns: number
      }
      _automation_extra_fields: {
        Args: { p_fn: string; p_org: string }
        Returns: Json
      }
      _automation_fill: {
        Args: { p_ctx: Json; p_text: string }
        Returns: string
      }
      _automation_recipients: {
        Args: { p_ctx: Json; p_org: string; p_to: Json }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      _clean_app_permissions: { Args: { p_value: Json }; Returns: Json }
      _clean_app_roles: { Args: { p_value: Json }; Returns: Json }
      _clean_automation_params: {
        Args: { p_params: Json; p_schema: Json }
        Returns: Json
      }
      _clean_org_name: { Args: { p_name: string }; Returns: string }
      _create_child_organization: {
        Args: {
          p_admins?: string[]
          p_name: string
          p_owner: string
          p_parent: string
          p_source_app: string
          p_source_ref: string
        }
        Returns: string
      }
      _email_opted_out: {
        Args: { p_category: string; p_user: string }
        Returns: boolean
      }
      _is_active_user: { Args: { p_user: string }; Returns: boolean }
      _may_build_workflows: { Args: { p_org: string }; Returns: boolean }
      _member_confirm_text: { Args: { p_user: string }; Returns: string }
      _org_owner: { Args: { p_org: string }; Returns: string }
      _require_people_manager: { Args: { p_org: string }; Returns: undefined }
      _require_uid: { Args: never; Returns: string }
      _token_hash: { Args: { p_token: string }; Returns: string }
      _validate_actions: {
        Args: {
          p_actions: Json
          p_trig: Database["public"]["Tables"]["automation_trigger_types"]["Row"]
          p_where: string
        }
        Returns: Json
      }
      _validate_recipient: { Args: { p: Json; p_where: string }; Returns: Json }
      _validate_workflow: { Args: { p_def: Json }; Returns: Json }
      _validate_workflow_v2: { Args: { p_def: Json }; Returns: Json }
      _wf2_condition: { Args: { p_c: Json; p_ctx: Json }; Returns: boolean }
      _wf2_conditions: {
        Args: { p_conds: Json; p_ctx: Json; p_match: string }
        Returns: boolean
      }
      _wf2_continue: { Args: { p_run: number }; Returns: string }
      _wf2_core_steps: { Args: never; Returns: string[] }
      _wf2_empty_state: { Args: never; Returns: Json }
      _wf2_exec_list: {
        Args: {
          p_ctx: Json
          p_env: Json
          p_iter: string
          p_state: Json
          p_steps: Json
        }
        Returns: Record<string, unknown>
      }
      _wf2_exec_step: {
        Args: {
          p_ctx: Json
          p_env: Json
          p_iter: string
          p_key: string
          p_state: Json
          s: Json
        }
        Returns: Record<string, unknown>
      }
      _wf2_get: { Args: { p_ctx: Json; p_path: string }; Returns: Json }
      _wf2_people: {
        Args: { p_ctx: Json; p_org: string; p_to: Json }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      _wf2_resolve: { Args: { p_ctx: Json; p_val: Json }; Returns: Json }
      _wf2_resume_due: { Args: never; Returns: number }
      _wf2_start: {
        Args: {
          p_ctx: Json
          p_dedupe: string
          p_def: Json
          p_org: string
          p_wf: Database["public"]["Tables"]["automation_workflows"]["Row"]
        }
        Returns: number
      }
      _wf2_text: { Args: { p_v: Json }; Returns: string }
      _wf2_trace: {
        Args: {
          p_detail: string
          p_key: string
          p_output: Json
          p_s: Json
          p_state: Json
          p_status: string
        }
        Returns: Json
      }
      _wf2_validate_list: {
        Args: {
          p_count: number
          p_depth: number
          p_loops: string[]
          p_seen: string[]
          p_steps: Json
          p_vars: string[]
        }
        Returns: Record<string, unknown>
      }
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
      adopt_workflow: {
        Args: { p_org: string; p_source: string }
        Returns: string
      }
      app_role: {
        Args: { p_app: string; p_org: string; p_user?: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      app_role_source: {
        Args: { p_app: string; p_org: string; p_user?: string }
        Returns: string
      }
      automation_settings: {
        Args: { p_kind: string; p_org: string }
        Returns: {
          enabled: boolean
          params: Json
        }[]
      }
      can_edit_automations: { Args: { p_org: string }; Returns: boolean }
      can_write: { Args: { p_app: string; p_org: string }; Returns: boolean }
      claim_automation_jobs: {
        Args: { p_app: string; p_limit?: number }
        Returns: {
          app: string
          attempts: number
          created_at: string
          error: string | null
          id: number
          kind: string
          org_id: string
          payload: Json
          result: Json | null
          run_id: number | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "automation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_emails: {
        Args: { p_apps?: string[]; p_limit?: number }
        Returns: {
          app: string
          attempts: number
          category: string
          data: Json
          id: string
          org_id: string
          org_name: string
          org_time_zone: string
          template: string
          to_email: string
          to_name: string
          to_user_id: string
        }[]
      }
      complete_automation_task: { Args: { p_id: string }; Returns: undefined }
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
      delete_named_role: {
        Args: { p_id: string; p_org: string }
        Returns: undefined
      }
      delete_organization: {
        Args: { p_confirm_name: string; p_org: string }
        Returns: undefined
      }
      delete_workflow: { Args: { p_id: string }; Returns: undefined }
      digest_automation_tasks: {
        Args: { p_org: string; p_user: string }
        Returns: Json
      }
      digest_for: { Args: { p_period?: string; p_user: string }; Returns: Json }
      email_unsubscribe: {
        Args: { p_category: string; p_user: string }
        Returns: undefined
      }
      emit_automation_event: {
        Args: { p_ctx: Json; p_org: string; p_type: string }
        Returns: undefined
      }
      enqueue_email: {
        Args: {
          p_app: string
          p_category?: string
          p_data?: Json
          p_dedupe_key?: string
          p_org?: string
          p_send_after?: string
          p_template: string
          p_to_email?: string
          p_to_user?: string
        }
        Returns: string
      }
      finish_automation_job: {
        Args: { p_error: string; p_id: number; p_ok: boolean; p_result: Json }
        Returns: undefined
      }
      finish_email: {
        Args: {
          p_error?: string
          p_id: string
          p_outcome: string
          p_provider_id?: string
        }
        Returns: undefined
      }
      get_digest_preferences: {
        Args: never
        Returns: {
          digest: string
          digest_day: number
          digest_hour: number
          digest_include: string[]
          digest_org_ids: string[]
          digest_time_zone: string
        }[]
      }
      get_email_preferences: {
        Args: never
        Returns: {
          digest: string
          reminders: boolean
        }[]
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
      grant_automation_editor: {
        Args: { p_grant: boolean; p_org: string; p_user: string }
        Returns: undefined
      }
      has_app_access: {
        Args: { p_app: string; p_org: string }
        Returns: boolean
      }
      has_app_permission: {
        Args: { p_app: string; p_key: string; p_org: string; p_user?: string }
        Returns: boolean
      }
      has_app_role: {
        Args: {
          p_app: string
          p_org: string
          p_roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          p_org: string
          p_roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      is_instance_owner: { Args: never; Returns: boolean }
      is_member: { Args: { p_org: string }; Returns: boolean }
      is_member_of_child: { Args: { p_org: string }; Returns: boolean }
      is_org_editor: {
        Args: { p_org: string; p_user: string }
        Returns: boolean
      }
      list_automations: {
        Args: { p_org: string }
        Returns: {
          app: string
          category: string
          default_enabled: boolean
          default_params: Json
          description: string
          enabled: boolean
          is_default: boolean
          kind: string
          last_run_at: string
          last_summary: string
          name: string
          params: Json
          params_schema: Json
          updated_at: string
        }[]
      }
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
      log_automation: {
        Args: {
          p_count: number
          p_kind: string
          p_org: string
          p_summary: string
        }
        Returns: undefined
      }
      mark_notifications_read: { Args: { p_ids?: number[] }; Returns: number }
      my_app_memberships: {
        Args: { p_app: string }
        Returns: {
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      my_notifications: {
        Args: { p_limit?: number; p_org?: string }
        Returns: {
          body: string
          created_at: string
          id: number
          kind: string
          kind_label: string
          link: string
          link_app: string
          org_id: string
          org_name: string
          read_at: string
          title: string
        }[]
      }
      notification_settings: {
        Args: never
        Returns: {
          app: string
          audience: string
          by_default: boolean
          customized: boolean
          default_email: boolean
          default_in_app: boolean
          description: string
          email: boolean
          email_category: string
          in_app: boolean
          kind: string
          label: string
          may_turn_on: boolean
        }[]
      }
      notify: {
        Args: {
          p_actor?: string
          p_body: string
          p_dedupe?: string
          p_emails?: string[]
          p_kind: string
          p_link: string
          p_link_app: string
          p_org: string
          p_title: string
          p_users: string[]
        }
        Returns: number
      }
      org_app_roles: {
        Args: { p_org: string }
        Returns: {
          app: string
          named_role: string
          named_role_id: string
          role: Database["public"]["Enums"]["org_role"]
          source: string
          user_id: string
        }[]
      }
      org_editor_count: { Args: { p_org: string }; Returns: number }
      org_email_log: {
        Args: { p_limit?: number; p_org: string }
        Returns: {
          app: string
          attempts: number
          category: string
          created_at: string
          id: string
          last_error: string
          sent_at: string
          status: string
          template: string
          to_email: string
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
      prune_automation_log: { Args: never; Returns: number }
      prune_notifications: { Args: never; Returns: number }
      prune_workflow_history: { Args: never; Returns: number }
      queue_digests: { Args: never; Returns: number }
      register_app_permission: {
        Args: {
          p_app: string
          p_description?: string
          p_key: string
          p_label: string
          p_sort?: number
        }
        Returns: undefined
      }
      register_automation_action: {
        Args: {
          p_app: string
          p_description: string
          p_label: string
          p_params_schema: Json
          p_requires: string[]
          p_sort?: number
          p_type: string
        }
        Returns: undefined
      }
      register_automation_kind: {
        Args: {
          p_app: string
          p_category: string
          p_default_enabled: boolean
          p_default_params: Json
          p_description: string
          p_key: string
          p_name: string
          p_params_schema: Json
          p_sort?: number
        }
        Returns: undefined
      }
      register_automation_recipient: {
        Args: {
          p_app: string
          p_description: string
          p_label: string
          p_options_fn?: string
          p_params_schema: Json
          p_resolve_fn: string
          p_sort?: number
          p_type: string
        }
        Returns: undefined
      }
      register_automation_step: {
        Args: {
          p_app: string
          p_description: string
          p_kind: string
          p_label: string
          p_output_schema: Json
          p_params_schema: Json
          p_requires?: string[]
          p_run_fn: string
          p_sort?: number
          p_type: string
        }
        Returns: undefined
      }
      register_automation_trigger: {
        Args: {
          p_app: string
          p_description: string
          p_fields: Json
          p_fields_fn: string
          p_kind: string
          p_label: string
          p_params_schema: Json
          p_provides: string[]
          p_scan_fn: string
          p_sort?: number
          p_type: string
        }
        Returns: undefined
      }
      register_notification_kind: {
        Args: {
          p_app: string
          p_audience: string
          p_default_email: boolean
          p_default_in_app: boolean
          p_default_roles?: Database["public"]["Enums"]["org_role"][]
          p_description: string
          p_eligible: Database["public"]["Enums"]["org_role"][]
          p_email_category: string
          p_kind: string
          p_label: string
          p_sort?: number
        }
        Returns: undefined
      }
      rename_organization: {
        Args: { p_name: string; p_org: string }
        Returns: undefined
      }
      reset_automation: {
        Args: { p_kind: string; p_org: string }
        Returns: undefined
      }
      reset_notification_preference: {
        Args: { p_kind: string }
        Returns: undefined
      }
      revoke_invitation: { Args: { p_id: string }; Returns: undefined }
      run_email_jobs: { Args: never; Returns: number }
      run_workflows: { Args: never; Returns: number }
      sample_trigger_data: {
        Args: { p_org: string; p_type: string }
        Returns: Json
      }
      save_named_role: {
        Args: {
          p_app_roles: Json
          p_description: string
          p_id: string
          p_name: string
          p_org: string
          p_permissions: Json
        }
        Returns: string
      }
      save_workflow: {
        Args: {
          p_definition: Json
          p_description: string
          p_enabled: boolean
          p_id: string
          p_name: string
          p_org: string
          p_shared?: boolean
        }
        Returns: string
      }
      set_app_role: {
        Args: {
          p_app: string
          p_org: string
          p_role: Database["public"]["Enums"]["org_role"]
          p_user: string
        }
        Returns: undefined
      }
      set_automation: {
        Args: {
          p_enabled: boolean
          p_kind: string
          p_org: string
          p_params: Json
        }
        Returns: undefined
      }
      set_chapters_may_build: {
        Args: { p_allowed: boolean; p_org: string }
        Returns: undefined
      }
      set_digest_preferences: {
        Args: {
          p_day: number
          p_digest: string
          p_hour: number
          p_include: string[]
          p_org_ids: string[]
          p_time_zone: string
        }
        Returns: undefined
      }
      set_email_preferences: {
        Args: { p_digest: string; p_reminders: boolean }
        Returns: undefined
      }
      set_invitation_roles: {
        Args: { p_app_roles: Json; p_invitation: string; p_named_role: string }
        Returns: undefined
      }
      set_named_role: {
        Args: { p_org: string; p_role: string; p_user: string }
        Returns: undefined
      }
      set_notification_preference: {
        Args: { p_email: boolean; p_in_app: boolean; p_kind: string }
        Returns: undefined
      }
      set_organization_preferences: {
        Args: { p_currency: string; p_org: string; p_time_zone: string }
        Returns: undefined
      }
      set_workflow_enabled: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: undefined
      }
      shares_org: { Args: { p_user: string }; Returns: boolean }
      test_workflow: {
        Args: { p_definition: Json; p_org: string; p_trigger?: Json }
        Returns: Json
      }
      transfer_ownership:
        | { Args: { p_new_owner: string; p_org: string }; Returns: undefined }
        | {
            Args: { p_confirm: string; p_new_owner: string; p_org: string }
            Returns: undefined
          }
      unread_notification_count: { Args: never; Returns: number }
      workflow_overview: { Args: { p_org: string }; Returns: Json }
      workflow_runs: {
        Args: { p_limit?: number; p_org: string; p_workflow?: string }
        Returns: {
          branch: string
          error: string
          id: number
          log: Json
          started_at: string
          status: string
          summary: string
          trigger_type: string
          workflow_id: string
          workflow_name: string
        }[]
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

