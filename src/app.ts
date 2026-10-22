import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { router } from './routes/index.js'
import { notFound, errorHandler } from './middleware/error.js'

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'kaya-backend' }))
  app.use('/api', router)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
