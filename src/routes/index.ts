import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../lib/supabase.js'
import { getConfig } from '../services/config.js'
import { getProfile, synthesize, loadContext, renderUP } from '../services/profile.js'
import { sendMessage } from '../services/chat.js'
import { ingest, looksLikePdf } from '../services/documents.js'
import { dueFollowUp, markDelivered, queueNext } from '../services/followups.js'
import { normalize } from '../services/units.js'
import type { Question, GoalTemplate } from '../services/config.schemas.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
})

export const router = Router()

// ---------------------------------------------------------------- config (public)
router.get('/config/onboarding', async (_req, res) => {
  res.json({ questions: await getConfig<Question[]>('onboarding.questions') })
})

router.get('/config/goals', async (_req, res) => {
  res.json({ goals: await getConfig<GoalTemplate[]>('goals.catalogue') })
})

// ---------------------------------------------------------------- authed below
router.use(requireAuth)

router.get('/profile', async (req, res) => {
  const ctx = await loadContext(req.userId!)
  res.json({
    profile: ctx.profile,
    vitals: ctx.vitals,
    adherence: ctx.adherence,
    rendered: renderUP(ctx.profile, ctx.vitals, ctx.adherence, ctx.staleDays),
  })
})

router.post('/onboarding/answers', async (req, res) => {
  const body = z.object({ answers: z.record(z.string(), z.unknown()) }).parse(req.body)
  res.json({ profile: await synthesize(req.userId!, body.answers) })
})

const chatBody = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  vitals: z.array(z.object({ kind: z.string(), value: z.number() })).default([]),
})

router.post('/chat', async (req, res) => {
  const body = chatBody.parse(req.body)
  res.json(await sendMessage(req.userId!, body.message, body.vitals, body.conversationId))
})

router.get('/conversations/:id/messages', async (req, res) => {
  // Ownership first — the service-role client would happily return anyone's chat.
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.userId!)
    .maybeSingle()
  if (!conv) return res.status(404).json({ error: 'not found' })

  const { data } = await db
    .from('messages')
    .select('id,role,content,safety_rule_key,created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at')
  res.json({ messages: data ?? [] })
})

// ---------------------------------------------------------------- vitals
const vitalBody = z.object({
  kind: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  measured_at: z.string().optional(),
})

router.post('/vitals', async (req, res) => {
  const b = vitalBody.parse(req.body)
  const norm = normalize(b.kind, b.value, b.unit)
  if (!norm) {
    return res.status(400).json({
      error: `${b.value} ${b.unit} is not a plausible ${b.kind}. Check the units on your meter.`,
    })
  }
  const { data, error } = await db
    .from('vitals')
    .insert({
      user_id: req.userId!,
      kind: b.kind,
      value: norm.value,
      unit: norm.unit,
      raw_value: b.value,
      raw_unit: b.unit,
      measured_at: b.measured_at ?? new Date().toISOString(),
      source: 'self_report',
      confirmed: true,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  res.json({ vital: data })
})

router.get('/vitals', async (req, res) => {
  const q = db.from('vitals').select('*').eq('user_id', req.userId!)
  if (typeof req.query.kind === 'string') q.eq('kind', req.query.kind)
  const { data } = await q.order('measured_at', { ascending: false }).limit(200)
  res.json({ vitals: data ?? [] })
})

router.post('/vitals/:id/confirm', async (req, res) => {
  const { data, error } = await db
    .from('vitals')
    .update({ confirmed: true })
    .eq('id', req.params.id)
    .eq('user_id', req.userId!)
    .select()
    .single()
  if (error) return res.status(404).json({ error: 'not found' })
  res.json({ vital: data })
})

// ---------------------------------------------------------------- documents
router.post('/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' })
  if (!looksLikePdf(req.file.buffer)) {
    return res.status(400).json({ error: 'that does not look like a PDF' })
  }
  res.json(await ingest(req.userId!, req.file))
})

router.get('/documents', async (req, res) => {
  const { data } = await db
    .from('documents')
    .select('id,filename,status,uploaded_at')
    .eq('user_id', req.userId!)
    .order('uploaded_at', { ascending: false })
  res.json({ documents: data ?? [] })
})

// ---------------------------------------------------------------- goals
router.post('/goals/:code/log', async (req, res) => {
  const b = z.object({ value: z.number().optional(), completed: z.boolean().default(true) }).parse(req.body)
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db
    .from('goal_logs')
    .upsert(
      { user_id: req.userId!, goal_code: req.params.code, log_date: today, ...b },
      { onConflict: 'user_id,goal_code,log_date' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  res.json({ log: data })
})

// ---------------------------------------------------------------- follow-ups
router.get('/followups/due', async (req, res) => {
  const due = await dueFollowUp(req.userId!)
  if (due) await markDelivered(req.userId!, due.id)
  res.json({ followUp: due })
})

router.post('/followups/queue', async (req, res) => {
  res.json({ followUp: await queueNext(req.userId!) })
})
