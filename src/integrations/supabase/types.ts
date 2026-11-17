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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      capacities: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      carousel_settings: {
        Row: {
          enabled: boolean | null
          id: number
          interval_seconds: number
        }
        Insert: {
          enabled?: boolean | null
          id?: number
          interval_seconds?: number
        }
        Update: {
          enabled?: boolean | null
          id?: number
          interval_seconds?: number
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      colors: {
        Row: {
          created_at: string
          hex_color: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          hex_color?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          hex_color?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      dollar_settings: {
        Row: {
          dollar_type: string
          id: number
          last_updated: string | null
          rate: number
        }
        Insert: {
          dollar_type?: string
          id?: number
          last_updated?: string | null
          rate?: number
        }
        Update: {
          dollar_type?: string
          id?: number
          last_updated?: string | null
          rate?: number
        }
        Relationships: []
      }
      hero_banners: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          image_url: string
          is_active: boolean
          link_url: string | null
          sort_order: number
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          image_url: string
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          image_url?: string
          is_active?: boolean
          link_url?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          channel: string | null
          created_at: string | null
          id: string
          notes: string | null
          product_id: string | null
          quantity: number
          type: string
          unit_price: number | null
          variant_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          quantity: number
          type: string
          unit_price?: number | null
          variant_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          quantity?: number
          type?: string
          unit_price?: number | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          brand_id: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          device_fingerprint: string | null
          email_sent: boolean | null
          id: string
          ip_address: string | null
          items: Json | null
          payer: Json | null
          payment_id: string | null
          payment_method_id: string | null
          status: string
          stock_decremented: boolean | null
          total: number
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          device_fingerprint?: string | null
          email_sent?: boolean | null
          id?: string
          ip_address?: string | null
          items?: Json | null
          payer?: Json | null
          payment_id?: string | null
          payment_method_id?: string | null
          status?: string
          stock_decremented?: boolean | null
          total: number
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          device_fingerprint?: string | null
          email_sent?: boolean | null
          id?: string
          ip_address?: string | null
          items?: Json | null
          payer?: Json | null
          payment_id?: string | null
          payment_method_id?: string | null
          status?: string
          stock_decremented?: boolean | null
          total?: number
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      payment_audit_log: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          new_status: string
          order_id: string | null
          payment_id: string | null
          previous_status: string | null
          raw_data: Json | null
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          new_status: string
          order_id?: string | null
          payment_id?: string | null
          previous_status?: string | null
          raw_data?: Json | null
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          new_status?: string
          order_id?: string | null
          payment_id?: string | null
          previous_status?: string | null
          raw_data?: Json | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_audit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author: string
          category: string
          content: string
          created_at: string
          excerpt: string
          id: string
          image_url: string
          is_published: boolean | null
          read_time: string
          title: string
        }
        Insert: {
          author?: string
          category: string
          content: string
          created_at?: string
          excerpt: string
          id?: string
          image_url: string
          is_published?: boolean | null
          read_time?: string
          title: string
        }
        Update: {
          author?: string
          category?: string
          content?: string
          created_at?: string
          excerpt?: string
          id?: string
          image_url?: string
          is_published?: boolean | null
          read_time?: string
          title?: string
        }
        Relationships: []
      }
      product_clicks: {
        Row: {
          clicked_at: string
          id: string
          product_id: string
        }
        Insert: {
          clicked_at?: string
          id?: string
          product_id: string
        }
        Update: {
          clicked_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_clicks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean | null
          price: number | null
          product_id: string | null
          stock: number
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          price?: number | null
          product_id?: string | null
          stock?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          price?: number | null
          product_id?: string | null
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          additional_images: string[] | null
          brand_id: string | null
          capacity: string | null
          category_id: string | null
          color: string | null
          condition: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          model_id: string | null
          name: string
          original_price: number | null
          price: number
          price_usd: number | null
          sale_expires_at: string | null
          stock: number
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          additional_images?: string[] | null
          brand_id?: string | null
          capacity?: string | null
          category_id?: string | null
          color?: string | null
          condition?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          model_id?: string | null
          name: string
          original_price?: number | null
          price: number
          price_usd?: number | null
          sale_expires_at?: string | null
          stock?: number
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          additional_images?: string[] | null
          brand_id?: string | null
          capacity?: string | null
          category_id?: string | null
          color?: string | null
          condition?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          model_id?: string | null
          name?: string
          original_price?: number | null
          price?: number
          price_usd?: number | null
          sale_expires_at?: string | null
          stock?: number
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_products_model"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_logs: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_public: boolean | null
          repair_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          repair_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          repair_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_logs_repair_id_fkey"
            columns: ["repair_id"]
            isOneToOne: false
            referencedRelation: "repairs"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_statuses: {
        Row: {
          created_at: string
          icon: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      repairs: {
        Row: {
          client_dni: string
          client_name: string | null
          client_phone: string | null
          created_at: string | null
          device_brand: string | null
          device_model: string
          id: string
          is_deleted: boolean | null
          locality: string | null
          notes: string | null
          problem_description: string | null
          quoted_price: number | null
          status: string | null
          tracking_code: string
          updated_at: string | null
        }
        Insert: {
          client_dni: string
          client_name?: string | null
          client_phone?: string | null
          created_at?: string | null
          device_brand?: string | null
          device_model: string
          id?: string
          is_deleted?: boolean | null
          locality?: string | null
          notes?: string | null
          problem_description?: string | null
          quoted_price?: number | null
          status?: string | null
          tracking_code: string
          updated_at?: string | null
        }
        Update: {
          client_dni?: string
          client_name?: string | null
          client_phone?: string | null
          created_at?: string | null
          device_brand?: string | null
          device_model?: string
          id?: string
          is_deleted?: boolean | null
          locality?: string | null
          notes?: string | null
          problem_description?: string | null
          quoted_price?: number | null
          status?: string | null
          tracking_code?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      storefront_promotion_prices: {
        Row: {
          effective_price: number | null
          list_price: number | null
          product_id: string | null
          promotion_ends_at: string | null
          promotion_id: string | null
          variant_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      count_repairs_by_status: {
        Args: { status_name: string }
        Returns: number
      }
      decrement_stock: {
        Args: { qty: number; row_id: string }
        Returns: undefined
      }
      get_admin_cutover_flags: {
        Args: never
        Returns: {
          admin_tab_hidden: boolean
          group_code: string
          legacy_write_mode: string
        }[]
      }
      get_product_click_counts: {
        Args: never
        Returns: {
          click_count: number
          product_id: string
        }[]
      }
      get_repair_by_tracking_code: {
        Args: { search_code: string }
        Returns: {
          client_dni: string
          client_name: string
          created_at: string
          device_brand: string
          device_model: string
          id: string
          locality: string
          notes: string
          problem_description: string
          repair_logs: Json
          status: Database["public"]["Enums"]["repair_status"]
          tracking_code: string
        }[]
      }
      get_repair_by_tracking_code_erp: {
        Args: { search_code: string }
        Returns: {
          client_dni: string
          client_name: string
          created_at: string
          device_brand: string
          device_model: string
          id: string
          locality: string
          notes: string
          problem_description: string
          repair_logs: Json
          status: Database["public"]["Enums"]["repair_status"]
          tracking_code: string
        }[]
      }
      get_repair_tracking: {
        Args: { tracking_token: string }
        Returns: {
          opened_at: string
          order_code: string
          public_message: string
          status_at: string
          status_code: string
          status_name: string
        }[]
      }
      is_legacy_admin: { Args: never; Returns: boolean }
      process_approved_order: {
        Args: {
          p_device_fingerprint?: string
          p_ip_address?: string
          p_items: Json
          p_payer: Json
          p_payment_id: string
          p_payment_method_id?: string
          p_status: string
          p_total: number
          p_user_agent?: string
        }
        Returns: Json
      }
      register_repair_private_media: {
        Args: {
          byte_size: number
          client_filename: string
          file_slot: number
          mime_type: string
          sha256_digest: string
          upload_token: string
        }
        Returns: string
      }
      respond_repair_quote: {
        Args: {
          customer_message?: string
          decision: string
          response_token: string
        }
        Returns: string
      }
      restore_expired_promos: { Args: never; Returns: undefined }
      storefront_web_price: {
        Args: { p_product_id: string; p_variant_id?: string }
        Returns: Json
      }
    }
    Enums: {
      repair_status:
        | "Recibido"
        | "Diagnóstico"
        | "Repuestos"
        | "Reparación"
        | "Finalizado"
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
  public: {
    Enums: {
      repair_status: [
        "Recibido",
        "Diagnóstico",
        "Repuestos",
        "Reparación",
        "Finalizado",
      ],
    },
  },
} as const
