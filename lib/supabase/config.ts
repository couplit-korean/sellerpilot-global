export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export function requireSupabaseBrowserConfig() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
  }
  return { supabaseUrl, supabasePublishableKey };
}

