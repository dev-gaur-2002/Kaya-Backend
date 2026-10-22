// Vercel serverless entry. The repo root is the Vercel root, so this sits at
// api/ rather than under a server/ folder.
import { createApp } from '../src/app.js'

export default createApp()
