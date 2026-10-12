import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import lockfile from 'proper-lockfile'
import { validateModelDraft, validateModelId } from './catalog.js'
import type { ModelValidationCode, StoredModel } from './catalog.js'

const ENVELOPE_VERSION = 1
const STATE_DIRECTORY_NAME = 'dsh-openai-oauth'
const MODEL_FILE_NAME = 'models.json'
/** Keys a persisted built-in override carries. */
const OVERRIDE_KEYS = ['id', 'contextWindow', 'maxTokens'] as const
/** Keys a persisted custom model carries. */
const CUSTOM_KEYS = ['id', 'name', 'contextWindow', 'maxTokens'] as const

/** Every code this store reports. */
export type ModelStoreErrorCode =
  | ModelValidationCode
  | 'UNKNOWN_MODEL'
  | 'INVALID_MODEL_FILE'
  | 'UNSAFE_MODEL_PATH'
  | 'MODEL_WRITE_FAILED'

/** Stable model overlay failure with no file contents in its message. */
export class ModelStoreError extends Error {
  /**
   * @param code - stable diagnostic code safe to expose after route mapping.
   * @param message - fixed, redacted diagnostic text.
   */
  constructor(readonly code: ModelStoreErrorCode, message: string) {
    super(message)
    this.name = 'ModelStoreError'
  }
}

/** One observer of a committed overlay snapshot. */
export type ModelChangeListener = (models: readonly StoredModel[]) => void

interface Snapshot {
  models: StoredModel[]
  error?: ModelStoreErrorCode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT'
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function unsafePath(): ModelStoreError {
  return new ModelStoreError(
    'UNSAFE_MODEL_PATH',
    'OpenAI Codex model storage uses an unsafe path or permissions; replace links with owner-only files and directories and retry.',
  )
}

function invalidModelFile(): ModelStoreError {
  return new ModelStoreError(
    'INVALID_MODEL_FILE',
    'OpenAI Codex model file is invalid; save a model again to replace it.',
  )
}

function parseEnvelope(text: string): StoredModel[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw invalidModelFile()
  }
  if (!isRecord(value) || !exactKeys(value, ['version', 'models']) || value['version'] !== ENVELOPE_VERSION) {
    throw invalidModelFile()
  }
  const entries = value['models']
  if (!Array.isArray(entries)) throw invalidModelFile()
  const stored: StoredModel[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || (!exactKeys(entry, OVERRIDE_KEYS) && !exactKeys(entry, CUSTOM_KEYS))) {
      throw invalidModelFile()
    }
    const validated = validateModelDraft(entry, stored)
    if (!validated.ok || stored.some(model => model.id === validated.value.id)) throw invalidModelFile()
    stored.push(validated.value)
  }
  return stored
}

function readSnapshotSync(stateDirectory: string, modelFile: string): Snapshot {
  try {
    const directory = lstatSync(stateDirectory, { throwIfNoEntry: false })
    if (directory === undefined) return { models: [] }
    if (directory.isSymbolicLink() || !directory.isDirectory()) return { models: [], error: 'UNSAFE_MODEL_PATH' }
    const file = lstatSync(modelFile, { throwIfNoEntry: false })
    if (file === undefined) return { models: [] }
    if (file.isSymbolicLink() || !file.isFile()) return { models: [], error: 'UNSAFE_MODEL_PATH' }
    if ((file.mode & 0o077) !== 0) return { models: [], error: 'UNSAFE_MODEL_PATH' }
    return { models: parseEnvelope(readFileSync(modelFile, 'utf8')) }
  } catch (error) {
    if (isMissing(error)) return { models: [] }
    return { models: [], error: error instanceof ModelStoreError ? error.code : 'INVALID_MODEL_FILE' }
  }
}

/**
 * Owner-only, versioned model overlay rooted below one Harness home. The
 * constructor reads the file synchronously so the model collection stays
 * synchronous; every mutation is lock-serialized and replaces the file
 * atomically. A malformed or unsafe file never throws at load: it is reported
 * as loadError and the next successful save overwrites it.
 */
export class CustomModelStore {
  /** Plugin-owned state directory shared with the credential store. */
  readonly stateDirectory: string
  /** Versioned model overlay path. */
  readonly modelFile: string
  private models: StoredModel[]
  private loadErrorCode: ModelStoreErrorCode | undefined
  private readonly listeners = new Set<ModelChangeListener>()

  /**
   * @param dshHome - resolved Harness home directory.
   */
  constructor(private readonly dshHome: string) {
    this.stateDirectory = resolve(dshHome, 'plugins', STATE_DIRECTORY_NAME)
    this.modelFile = join(this.stateDirectory, MODEL_FILE_NAME)
    const snapshot = readSnapshotSync(this.stateDirectory, this.modelFile)
    this.models = snapshot.models
    this.loadErrorCode = snapshot.error
  }

  /** The code of the last failed load, cleared by the next successful save. */
  get loadError(): string | undefined {
    return this.loadErrorCode
  }

  /** Stored entries in overlay order. */
  list(): readonly StoredModel[] {
    return [...this.models]
  }

  /** Observe every committed snapshot; the returned disposer unsubscribes. */
  onChange(listener: ModelChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Store one overlay entry: an override when the id is shipped, else a custom model.
   * @param draft - untrusted entry carrying id, contextWindow, maxTokens and an optional name.
   * @returns the committed snapshot.
   */
  async save(draft: unknown): Promise<readonly StoredModel[]> {
    const next = await this.withLock(async () => {
      const current = await this.current()
      const validated = validateModelDraft(draft, current)
      if (!validated.ok) throw new ModelStoreError(validated.code, validated.message)
      const entries = [...current]
      const index = entries.findIndex(entry => entry.id === validated.value.id)
      if (index === -1) entries.push(validated.value)
      else entries[index] = validated.value
      await this.commit(entries)
      return entries
    })
    this.emit(next)
    return next
  }

  /**
   * Delete the stored entry for one id: a custom model, or a built-in override.
   * @param id - untrusted model id.
   * @returns the committed snapshot.
   */
  async remove(id: unknown): Promise<readonly StoredModel[]> {
    const validated = validateModelId(id)
    if (!validated.ok) throw new ModelStoreError(validated.code, validated.message)
    const next = await this.withLock(async () => {
      const current = await this.current()
      const entries = current.filter(entry => entry.id !== validated.value)
      if (entries.length === current.length) {
        throw new ModelStoreError('UNKNOWN_MODEL', `No stored OpenAI Codex model matches "${validated.value}".`)
      }
      await this.commit(entries)
      return entries
    })
    this.emit(next)
    return next
  }

  /** Read the on-disk overlay, falling back to memory so a damaged file recovers on save. */
  private async current(): Promise<readonly StoredModel[]> {
    try {
      return await this.readStored()
    } catch (error) {
      if (error instanceof ModelStoreError) return [...this.models]
      throw error
    }
  }

  private async readStored(): Promise<StoredModel[]> {
    let info
    try {
      info = await lstat(this.modelFile)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    if (info.isSymbolicLink() || !info.isFile()) throw unsafePath()
    if ((info.mode & 0o077) !== 0) throw unsafePath()
    return parseEnvelope(await readFile(this.modelFile, 'utf8'))
  }

  private async assertDirectory(path: string, create: boolean): Promise<void> {
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      if (!isMissing(error) || !create) throw error
      await mkdir(path, { recursive: true, mode: 0o700 })
      info = await lstat(path)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafePath()
    await chmod(path, 0o700)
  }

  private async ensureStateDirectory(): Promise<void> {
    await mkdir(this.dshHome, { recursive: true, mode: 0o700 })
    await this.assertDirectory(resolve(this.dshHome, 'plugins'), true)
    await this.assertDirectory(this.stateDirectory, true)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureStateDirectory()
    const release = await lockfile.lock(this.stateDirectory, {
      realpath: false,
      stale: 30_000,
      update: 10_000,
      retries: { retries: 80, factor: 1.15, minTimeout: 10, maxTimeout: 150 },
    })
    try {
      return await operation()
    } finally {
      await release()
    }
  }

  /** Replace the file atomically, then publish the snapshot in memory. */
  private async commit(models: readonly StoredModel[]): Promise<void> {
    const frozen: StoredModel[] = models.map(entry => entry.name === undefined
      ? { id: entry.id, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens }
      : { id: entry.id, name: entry.name, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens })
    try {
      await this.writeEnvelope(frozen)
    } catch (error) {
      if (error instanceof ModelStoreError) throw error
      throw new ModelStoreError('MODEL_WRITE_FAILED', 'OpenAI Codex model file could not be written.')
    }
    this.models = frozen
    this.loadErrorCode = undefined
  }

  private async writeEnvelope(models: readonly StoredModel[]): Promise<void> {
    const envelope = { version: ENVELOPE_VERSION, models }
    const temporary = join(this.stateDirectory, `.${MODEL_FILE_NAME}.${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, this.modelFile)
      await chmod(this.modelFile, 0o600)
      if (process.platform !== 'win32') {
        const directory = await open(this.stateDirectory, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } finally {
      await handle?.close()
      try {
        await unlink(temporary)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
  }

  private emit(models: readonly StoredModel[]): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(models)
      } catch {
        // A listener must never fail a committed save.
      }
    }
  }
}
