/** Generated from Supabase project pkpdheytmbwvqhpcaigm (generate_typescript_types). */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          name: string
          birth_date: string
          gender: string | null
          interested_in: string[] | null
          city: string | null
          lat: number | null
          lng: number | null
          approx_lat: number | null
          approx_lng: number | null
          intention: string | null
          bio: string | null
          verified: boolean
          is_discoverable: boolean
          show_online_status: boolean
          show_distance: boolean
          who_can_message: string
          onboarding_complete: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          name: string
          birth_date: string
          gender?: string | null
          interested_in?: string[] | null
          city?: string | null
          lat?: number | null
          lng?: number | null
          approx_lat?: number | null
          approx_lng?: number | null
          intention?: string | null
          bio?: string | null
          verified?: boolean
          is_discoverable?: boolean
          show_online_status?: boolean
          show_distance?: boolean
          who_can_message?: string
          onboarding_complete?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>
        Relationships: []
      }
      photos: {
        Row: {
          id: string
          user_id: string
          url: string
          position: number
          is_primary: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          url: string
          position?: number
          is_primary?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["photos"]["Insert"]>
        Relationships: []
      }
      likes: {
        Row: {
          id: string
          liker_id: string
          liked_id: string
          is_super_like: boolean
          created_at: string
        }
        Insert: {
          id?: string
          liker_id: string
          liked_id: string
          is_super_like?: boolean
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["likes"]["Insert"]>
        Relationships: []
      }
      matches: {
        Row: {
          id: string
          user_a: string
          user_b: string
          created_at: string
        }
        Insert: {
          id?: string
          user_a: string
          user_b: string
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["matches"]["Insert"]>
        Relationships: []
      }
      posts: {
        Row: {
          id: string
          user_id: string
          type: string
          content: string | null
          media_url: string | null
          poll_options: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          content?: string | null
          media_url?: string | null
          poll_options?: Json | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["posts"]["Insert"]>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"]
