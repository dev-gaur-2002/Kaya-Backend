import { extractText, getDocumentProxy } from 'unpdf'
import { db } from '../lib/supabase.js'
import { groq } from '../lib/groq.js'
import { getConfig, type LlmSettings } from './config.js'
import { normalize } from './units.js'

// Below this, the PDF almost certainly has no text layer (a scan or photo).
const MIN_TEXT_CHARS = 200

export function looksLikePdf(buf: Buffer): boolean {
  // Trust the bytes, not the client-supplied MIME type.
  return buf.subarray(0, 5).toString('latin1') === '%PDF-'
}

export async function ingest(userId: string, file: { buffer: Buffer; originalname: string }) {
  const path = `${userId}/${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`

  const { error: upErr } = await db.storage
    .from('documents')
    .upload(path, file.buffer, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw new Error(`upload: ${upErr.message}`)

  const { data: doc, error } = await db
    .from('documents')
    .insert({
      user_id: userId,
      storage_path: path,
      filename: file.originalname,
      bytes: file.buffer.length,
    })
    .select('id')
    .single()
  if (error) throw new Error(`document: ${error.message}`)

  const pdf = await getDocumentProxy(new Uint8Array(file.buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  const hasText = text.trim().length >= MIN_TEXT_CHARS

  if (!hasText) {
    // A scan with no text layer. Say so; never invent values to fill the gap.
    await db
      .from('documents')
      .update({ status: 'no_text', has_text_layer: false, extracted_text: text })
      .eq('id', doc.id)
    return { documentId: doc.id, status: 'no_text' as const, values: [] }
  }

  const [system, llm] = await Promise.all([
    getConfig<string>('prompt.document_extraction'),
    getConfig<LlmSettings>('llm.settings'),
  ])

  const res = await groq.chat.completions.create({
    model: llm.model,
    temperature: 0,
    max_tokens: llm.max_tokens,
    reasoning_effort: 'low', // copying numbers off a page, not reasoning about them
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      // Fenced and labelled as data. An uploaded document is untrusted input and
      // is a real prompt-injection path.
      { role: 'user', content: `<document>\n${text.slice(0, 40_000)}\n</document>` },
    ],
  })

  let extracted: { values?: { kind: string; value: number; unit: string; measured_at?: string }[] }
  try {
    extracted = JSON.parse(res.choices[0]?.message?.content ?? '{}')
  } catch {
    await db.from('documents').update({ status: 'failed', error: 'invalid JSON' }).eq('id', doc.id)
    throw new Error('extraction returned invalid JSON')
  }

  const rows = []
  for (const v of extracted.values ?? []) {
    // Never trust a model-read lab value. Convert against the unit printed on
    // the page, and drop anything implausible rather than storing a guess.
    const norm = normalize(v.kind, Number(v.value), v.unit)
    if (!norm) continue
    rows.push({
      user_id: userId,
      kind: v.kind,
      value: norm.value,
      unit: norm.unit,
      raw_value: Number(v.value),
      raw_unit: v.unit,
      measured_at: v.measured_at ? new Date(v.measured_at).toISOString() : new Date().toISOString(),
      source: 'document' as const,
      document_id: doc.id,
      confirmed: false, // the user confirms before these count
    })
  }

  if (rows.length) await db.from('vitals').insert(rows)
  await db
    .from('documents')
    .update({ status: 'extracted', has_text_layer: true, extracted_text: text })
    .eq('id', doc.id)

  return { documentId: doc.id, status: 'extracted' as const, values: rows }
}
