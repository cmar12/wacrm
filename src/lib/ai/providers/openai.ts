import { AiError, type ProviderResult } from '../types'
import { normalizeUsage, providerHttpError, toNetworkError, type ProviderArgs } from './shared'

// Tu modelo exacto ganador y vigente
const OPENAI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

/**
 * Call Google Gemini using the native API format with clean message mapping.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, systemPrompt, messages, timeoutMs } = args

  // Filtramos y limpiamos los mensajes para asegurarnos de que Google no reciba campos rotos o vacíos
  const cleanHistory = (messages || [])
    .map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user'
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
      return `${role}: ${content}`
    })
    .join('\n')

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\nHistorial de conversación:\n${cleanHistory}`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Google Gemini', res)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json().catch(() => null)) as GeminiResponse | any
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Google Gemini returned an empty response.', {
      code: 'empty_response',
    })
  }

  // Conteo seguro de tokens para que el Inbox nunca se quede colgado
  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount ?? 0,
    completion: data?.usageMetadata?.candidatesTokenCount ?? 0,
    total: data?.usageMetadata?.totalTokenCount ?? 0,
  })

  return { text: text.trim(), usage }
}
