import { env } from './config/env.js'
import { createApp } from './app.js'

createApp().listen(env.PORT, () => {
  console.log(`[kaya] listening on :${env.PORT} (${env.NODE_ENV})`)
  console.log(`[kaya] health: http://localhost:${env.PORT}/health`)
})
