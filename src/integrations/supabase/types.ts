export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_connections: {
        Row: {
          created_at: string
          credentials: Json
          environment: string
          id: string
          last_test_at: string | null
          last_test_success: boolean | null
          name: string
          provider_id: string
          status: Database["public"]["Enums"]["sync_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          credentials?: Json
          environment?: string
          id?: string
          last_test_at?: string | null
          last_test_success?: boolean | null
          name: string
          provider_id: string
          status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          credentials?: Json
          environment?: string
          id?: string
          last_test_at?: string | null
          last_test_success?: boolean | null
          name?: string
          provider_id?: string
          status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_connections_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "api_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      api_endpoints: {
        Row: {
          created_at: string
          default_page_size: number | null
          description: string | null
          id: string
          is_active: boolean
          method: string
          name: string
          page_size_param: string | null
          pagination_param: string | null
          pagination_type: string | null
          path: string
          provider_id: string
          response_data_path: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          default_page_size?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          method?: string
          name: string
          page_size_param?: string | null
          pagination_param?: string | null
          pagination_type?: string | null
          path: string
          provider_id: string
          response_data_path?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          default_page_size?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          method?: string
          name?: string
          page_size_param?: string | null
          pagination_param?: string | null
          pagination_type?: string | null
          path?: string
          provider_id?: string
          response_data_path?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_endpoints_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "api_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      api_providers: {
        Row: {
          auth_type: Database["public"]["Enums"]["auth_type"]
          base_url: string
          base_url_dev: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          auth_type?: Database["public"]["Enums"]["auth_type"]
          base_url: string
          base_url_dev?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          auth_type?: Database["public"]["Enums"]["auth_type"]
          base_url?: string
          base_url_dev?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      eskolare_cancellations: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_cancellations_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_categories: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_categories_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_grades: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_grades_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_order_details: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          details_synced_at: string | null
          external_id: string
          id: string
          order_status: string | null
          order_uid: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data?: Json
          details_synced_at?: string | null
          external_id: string
          id?: string
          order_status?: string | null
          order_uid?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          details_synced_at?: string | null
          external_id?: string
          id?: string
          order_status?: string | null
          order_uid?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      eskolare_orders: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_orders_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_partnerships: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_partnerships_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_payments: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_payments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_showcases: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_showcases_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_summaries: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          id: string
          period_end: string | null
          period_start: string | null
          report_type: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          id?: string
          period_end?: string | null
          period_start?: string | null
          report_type: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          id?: string
          period_end?: string | null
          period_start?: string | null
          report_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_summaries_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_transactions: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_transactions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      eskolare_withdrawals: {
        Row: {
          connection_id: string
          created_at: string
          data: Json
          external_id: string
          id: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          data: Json
          external_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          data?: Json
          external_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eskolare_withdrawals_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_configs: {
        Row: {
          connection_id: string
          created_at: string
          endpoint_id: string
          extra_params: Json | null
          id: string
          is_complete: boolean | null
          is_enabled: boolean
          last_offset: number | null
          last_sync_at: string | null
          next_sync_at: string | null
          sync_frequency_minutes: number
          total_records: number | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          endpoint_id: string
          extra_params?: Json | null
          id?: string
          is_complete?: boolean | null
          is_enabled?: boolean
          last_offset?: number | null
          last_sync_at?: string | null
          next_sync_at?: string | null
          sync_frequency_minutes?: number
          total_records?: number | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          endpoint_id?: string
          extra_params?: Json | null
          id?: string
          is_complete?: boolean | null
          is_enabled?: boolean
          last_offset?: number | null
          last_sync_at?: string | null
          next_sync_at?: string | null
          sync_frequency_minutes?: number
          total_records?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_configs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_configs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "api_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_logs: {
        Row: {
          connection_id: string
          duration_ms: number | null
          endpoint_id: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          records_created: number | null
          records_processed: number | null
          records_updated: number | null
          started_at: string
          status: Database["public"]["Enums"]["execution_status"]
        }
        Insert: {
          connection_id: string
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["execution_status"]
        }
        Update: {
          connection_id?: string
          duration_ms?: number | null
          endpoint_id?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_created?: number | null
          records_processed?: number | null
          records_updated?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["execution_status"]
        }
        Relationships: [
          {
            foreignKeyName: "extraction_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "api_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_logs_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "api_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      auth_type: "bearer_token" | "api_key" | "basic_auth" | "oauth2"
      execution_status: "pending" | "running" | "success" | "error"
      sync_status: "active" | "paused" | "error"
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
    Enums: {
      auth_type: ["bearer_token", "api_key", "basic_auth", "oauth2"],
      execution_status: ["pending", "running", "success", "error"],
      sync_status: ["active", "paused", "error"],
    },
  },
} as const
