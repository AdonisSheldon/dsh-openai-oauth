/** Harness-to-Codex request conversion. */
import { ToolCallId, LlmError, offloadedImageText } from '@deepseek-ai/dsh-llm'
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
        if (block.offloaded) {
          content.push({ type: 'text', text: offloadedImageText(block.attachment) })
          break
        }
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
  const toolNames = new Map<ToolCallId, string>()
  const messages: CodexMessage[] = []
  let systemPrompt = options.system
  for (const message of options.messages) {
    if (message.role === 'system') {
      if (message.content.some(block => block.type !== 'text')) unsupported('non-text', 'system')
      const text = message.content.map(block => block.type === 'text' ? block.text : '').join('')
      systemPrompt = options.system === undefined ? text : `${options.system}\n\n${text}`
      continue
    }
    if (message.role === 'developer') unsupported('developer', message.role)
    if (message.role === 'assistant') {
      const assistant = toCodexAssistant(message)
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(ToolCallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    const content = await userContent(message.content, attachments, options.signal)
    if (message.role === 'tool') {
      messages.push({
        role: 'toolResult',
        toolCallId: message.toolCallId,
        toolName: toolNames.get(message.toolCallId) ?? 'unknown',
        content: typeof content === 'string'
          ? [{ type: 'text', text: content || '(no output)' }]
          : content,
        isError: message.isError ?? false,
        timestamp: 0,
      })
    } else {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
  }
  const tools = toolsOf(options)
  return {
    ...systemPrompt === undefined ? {} : { systemPrompt },
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}
