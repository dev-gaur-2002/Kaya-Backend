import OpenAI from 'openai'
import { env } from '../config/env.js'

// Groq implements the OpenAI wire protocol, so the OpenAI client works against it
// unmodified — only the baseURL differs. No AI-SDK abstraction layer needed.
export const groq = new OpenAI({
  apiKey: env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
})
