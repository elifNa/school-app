import 'react-native-url-polyfill/auto'

import AsyncStorage from '@react-native-async-storage/async-storage'
import { decode, encode } from 'base64-arraybuffer'
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey) {
  console.warn('Add the Supabase URL and publishable key to your local .env file.')
}

const keyName = 'school-support-auth-key'
async function loadEncryptionKey() {
  let keyHex = await SecureStore.getItemAsync(keyName)
  if (!keyHex) {
    const key = await AESEncryptionKey.generate(256)
    keyHex = await key.encoded('hex')
    await SecureStore.setItemAsync(keyName, keyHex)
  }
  return AESEncryptionKey.import(keyHex, 'hex')
}

const secureStorage = {
  async getItem(key: string) {
    const saved = await AsyncStorage.getItem(key)
    if (!saved) return null
    const secret = await SecureStore.getItemAsync(keyName)
    if (!secret) return null
    const encryptionKey = await AESEncryptionKey.import(secret, 'hex')
    const sealed = AESSealedData.fromCombined(decode(saved))
    const bytes = await aesDecryptAsync(sealed, encryptionKey, { output: 'bytes' })
    return new TextDecoder().decode(bytes)
  },
  async setItem(key: string, value: string) {
    const encryptionKey = await loadEncryptionKey()
    const sealed = await aesEncryptAsync(new TextEncoder().encode(value), encryptionKey)
    const encrypted = await sealed.combined()
    await AsyncStorage.setItem(key, encode(encrypted.buffer as ArrayBuffer))
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key)
  },
}

export const supabase = createClient(url ?? 'https://example.supabase.co', publishableKey ?? 'missing-key', {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

export const isSupabaseConfigured = Boolean(url && publishableKey)
