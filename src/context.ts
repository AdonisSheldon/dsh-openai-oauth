/** Harness-to-Codex request conversion. */
import { CallId, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  CodexContext,
  ImageContent,
  CodexMessage,
  TextContent,
  CodexTool,
} from './models.js'
import { toCodexAssistant } from './replay.js'

function unsupported(type: string, role: string): never {
  throw new LlmError(`OpenAI Codex cannot represent ${type} content in a ${role} message`, 'UNSUPPORTED_CONTENT')
}

async function userContent(
  blocks: readonly ContentBlock[],
  attachments: AttachmentStore | undefined,
  signal: AbortSignal | undefined,
): Promise<string | (TextContent | ImageContent)[]> {
  const content: (TextContent | ImageContent)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        if (attachments === undefined) {
          throw new LlmError('OpenAI Codex image input requires the Harness attachment service', 'UNSUPPORTED_CONTENT')
        }
        const stored = await attachments.readImage(block.attachment, signal)
        content.push({
          type: 'image',
          data: Buffer.from(stored.data).toString('base64'),
          mimeType: stored.ref.mediaType,
        })
        break
      }
      case 'tool-result': {
        const nested = await userContent(block.content, attachments, signal)
        if (typeof nested === 'string') {
          if (nested.length > 0) content.push({ type: 'text', text: nested })
        } else {
          content.push(...nested)
        }
        break
      }
      default: unsupported(block.type, 'user')
    }
  }
  return content.every(block => block.type === 'text')
    ? content.map(block => block.text).join('')
    : content
}

function toolsOf(options: GenerateOptions): CodexTool[] | undefined {
  return options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

/** Convert the complete Harness request into one fresh Codex context. */
export async function toCodexContext(
  options: GenerateOptions,
  attachments?: AttachmentStore,
): Promise<CodexContext> {
  const toolNames = new Map<CallId, string>()
  const messages: CodexMessage[] = []
  for (const message of options.messages) {
    if (message.role === 'system') {
      if (message.content.some(block => block.type !== 'text')) unsupported('non-text', 'system')
      messages.push({
        role: 'user',
        content: message.content.map(block => block.type === 'text' ? block.text : '').join(''),
        timestamp: 0,
      })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = toCodexAssistant(message)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const content = await userContent(regular, attachments, options.signal)
    const results = message.content.filter(block => block.type === 'tool-result')
    if ((typeof content === 'string' ? content.length > 0 : content.length > 0) || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    for (const result of results) {
      const resultContent = await userContent(result.content, attachments, options.signal)
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: typeof resultContent === 'string'
          ? [{ type: 'text', text: resultContent || '(no output)' }]
          : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  const tools = toolsOf(options)
  return {
    ...options.system === undefined ? {} : { systemPrompt: options.system },
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}
