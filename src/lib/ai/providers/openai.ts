import { AiError, type ProviderResult } from '../types'
import { normalizeUsage, providerHttpError, toNetworkError, type ProviderArgs } from './shared'

// Mantenemos tu modelo exacto que dio éxito total en la prueba anterior
const OPENAI_URL = 'https://googleapis.com'

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

/**
 * Call Google Gemini using the native API format.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, systemPrompt, messages, timeoutMs } = args

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
                text: `${systemPrompt}\n\n${messages
                  .map((m) => `${m.role}: ${m.content}`)
                  .join('\n')}`,
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

  // Corregimos los nombres de los tokens para adaptarlos al formato real de Google AI Studio
  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount ?? 0,
    completion: data?.usageMetadata?.candidatesTokenCount ?? 0,
    total: data?.usageMetadata?.totalTokenCount ?? 0,
  })

  return { text: text.trim(), usage }
}
