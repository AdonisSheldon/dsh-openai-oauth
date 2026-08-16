/** Reasoning levels accepted by OpenAI Codex models. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The single wire API implemented by this plugin. */
export type Api = 'openai-codex-responses' | 'dsh-foreign'

/** Plugin-owned model metadata used for routing and capability validation. */
export interface Model<TApi extends Api = Api> {
  id: string
  name: string
  api: TApi
  provider: string
  baseUrl: string
  reasoning: boolean
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>
  input: ('text' | 'image')[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
}

export interface TextContent {
  type: 'text'
  text: string
  textSignature?: string
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface ThinkingContent {
  type: 'thinking'
  thinking: string
  thinkingSignature?: string
  redacted?: boolean
}

export interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
  thoughtSignature?: string
}

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  totalTokens: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
}

export interface AssistantMessage {
  role: 'assistant'
  content: (TextContent | ThinkingContent | ToolCallContent)[]
  api: Api
  provider: string
  model: string
  responseModel?: string
  responseId?: string
  usage: Usage
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  errorMessage?: string
  timestamp: number
}

export type UserMessage = {
  role: 'user'
  content: string | (TextContent | ImageContent)[]
  timestamp: number
}

export type ToolResultMessage = {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  isError: boolean
  timestamp: number
}

export type CodexMessage = UserMessage | ToolResultMessage | AssistantMessage

export interface CodexTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface CodexContext {
  systemPrompt?: string
  messages: CodexMessage[]
  tools?: CodexTool[]
}

export interface ModelsSimpleStreamOptions {
  reasoning?: ThinkingLevel
  temperature?: number
  sessionId?: string
  signal?: AbortSignal
  maxRetries?: number
  transformHeaders?: (headers: Readonly<Record<string, string | null>>) => Record<string, string | null>
}

export type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCallContent; partial: AssistantMessage }
  | { type: 'done'; reason: AssistantMessage['stopReason']; message: AssistantMessage }
  | { type: 'error'; reason: AssistantMessage['stopReason']; error: AssistantMessage }

/** Return the selectable reasoning levels declared by one model. */
export function getSupportedThinkingLevels(model: Model): ThinkingLevel[] {
  const order: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return order.filter(level => model.thinkingLevelMap?.[level] !== null
    && model.thinkingLevelMap?.[level] !== undefined)
}

const BASE_MODEL = {
  api: 'openai-codex-responses' as const,
  provider: 'openai-codex',
  baseUrl: 'https://chatgpt.com/backend-api',
  reasoning: true,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  maxTokens: 128_000,
}

/** Versioned model catalog shipped with this plugin release. */
export const OPENAI_CODEX_MODELS: readonly Model<'openai-codex-responses'>[] = [
  {
    ...BASE_MODEL, id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark',
    input: ['text'], contextWindow: 128_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  },
  {
    ...BASE_MODEL, id: 'gpt-5.4', name: 'GPT-5.4', input: ['text', 'image'], contextWindow: 272_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  },
  {
    ...BASE_MODEL, id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', input: ['text', 'image'], contextWindow: 272_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  },
  {
    ...BASE_MODEL, id: 'gpt-5.5', name: 'GPT-5.5', input: ['text', 'image'], contextWindow: 272_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  },
  {
    ...BASE_MODEL, id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', input: ['text', 'image'], contextWindow: 272_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  {
    ...BASE_MODEL, id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', input: ['text', 'image'], contextWindow: 272_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  {
    ...BASE_MODEL, id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', input: ['text', 'image'], contextWindow: 272_000,
    thinkingLevelMap: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
]
