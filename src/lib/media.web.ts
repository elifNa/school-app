import { supabase } from './supabase'
import type { LocalPhoto } from './media'

export async function uploadPhoto(photo: LocalPhoto, questionId: string, kind: 'question' | 'answer') {
  if (!photo.file) throw new Error('The selected image is unavailable. Please choose it again.')
  const ext = photo.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${questionId}/${kind}.${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('question-media').upload(path, photo.file, {
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
