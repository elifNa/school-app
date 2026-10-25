export const subjects = ['Math', 'Physics', 'Chemistry', 'Biology'] as const
export type Subject = (typeof subjects)[number]

export type Question = {
  id: string
  student_id: string
  subject: Subject
  question_text: string
  question_photo_path: string | null
  answer_text: string | null
  answer_photo_path: string | null
  created_at: string
  answered_at: string | null
  answered_by: string | null
  answer_updated_at: string | null
}

export type SolvedQuestion = Omit<Question, 'student_id' | 'answered_at' | 'answered_by' | 'answer_updated_at'> & {
  solved_at: string
}
