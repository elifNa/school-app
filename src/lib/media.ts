import { decode } from 'base64-arraybuffer'
import { File } from 'expo-file-system'
import { supabase } from './supabase'

export type LocalPhoto = { uri: string; name: string; mimeType: string }

export async function uploadPhoto(photo: LocalPhoto, questionId: string, kind: 'question' | 'answer') {
  const file = new File(photo.uri)
  const base64 = await file.base64()
  const ext = photo.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${questionId}/${kind}.${ext}`
  const { error } = await supabase.storage.from('question-media').upload(path, decode(base64), {
    contentType: photo.mimeType,
    upsert: false,
  })
  if (error) throw error
  return path
}

export async function photoUrl(path: string | null) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('question-media').createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}
