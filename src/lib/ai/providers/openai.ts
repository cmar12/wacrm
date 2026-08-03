import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

// Desvío formal y gratuito a los servidores de OpenRouter
const OPENAI_URL = 'https://openrouter.ai'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Call OpenAI's Chat Completions endpoint redirected to OpenRouter.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  // Si el usuario no especificó un modelo o viene el de fábrica,
  // forzamos un modelo potente y 100% gratuito de OpenRouter (Llama 3 de Meta)
    const targetModel = model.includes('gpt') 
      ? 'openrouter/free'
      : model


    let res: Response
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vercel.app', // Tu sitio web real
          'X-Title': 'WACRM Universidad', // Nombre de tu app universitaria
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            ...mergeConsecutive(messages),
          ],
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {

    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI/OpenRouter', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | any

  // OpenRouter/OpenAI-compatible responses can vary in shape. Try a
  // series of fallbacks to extract assistant text robustly:
  //  - choices[0].message.content (OpenAI chat)
  //  - choices[0].text (legacy OpenAI)
  //  - output (string) or output array
  //  - result.output[0].content (some routers)
  //  - output_text
  let text: string | null = null

  if (data) {
    // choices -> message.content
    text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? null

    // top-level output string
    if (!text && typeof data.output === 'string') text = data.output

    // output as array of blocks
    if (!text && Array.isArray(data.output)) {
      text = data.output
        .map((b: any) => (typeof b === 'string' ? b : b?.content ?? ''))
        .join('')
        .trim()
    }

    // some routers nest under result.output
    if (!text && Array.isArray(data?.result?.output)) {
      text = data.result.output
        .map((b: any) => (typeof b === 'string' ? b : b?.content ?? ''))
        .join('')
        .trim()
    }

    // older compatibility field
    if (!text && typeof data.output_text === 'string') text = data.output_text

    if (typeof text === 'string') text = text.trim()
  }

  if (!text) {
    throw new AiError('OpenRouter returned an empty response.', {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
