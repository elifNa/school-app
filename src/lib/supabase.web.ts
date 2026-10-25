import 'react-native-url-polyfill/auto'

import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey) {
  console.warn('Add the Supabase URL and publishable key to the Vercel project environment variables.')
}

export const supabase = createClient(url ?? 'https://example.supabase.co', publishableKey ?? 'missing-key', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

export const isSupabaseConfigured = Boolean(url && publishableKey)
