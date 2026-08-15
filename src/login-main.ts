#!/usr/bin/env node
import { runLogin } from './login.js'

const signal = new AbortController()
process.once('SIGINT', () => { signal.abort() })
process.once('SIGTERM', () => { signal.abort() })

process.exitCode = await runLogin(process.argv.slice(2), { signal: signal.signal })
