import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface AiConfig {
  provider: string
  endpoint: string
  model: string
  enabled: boolean
}

export const useAiStore = defineStore('ai', () => {
  const config = ref<AiConfig>({
    provider: 'ollama',
    endpoint: 'http://ollama:11434',
    model: 'llama3.2',
    enabled: true,
  })
  const models = ref<string[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const modelsLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchConfig() {
    try {
      const res = await axios.get('/api/ai/config')
      config.value = res.data
    } catch (err) {
      console.error('AI config fetch error:', err)
    }
  }

  async function saveConfig(updates: Partial<AiConfig>): Promise<boolean> {
    saving.value = true
    error.value = null
    try {
      const merged = { ...config.value, ...updates }
      await axios.put('/api/ai/config', merged)
      config.value = merged
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to save config'
      return false
    } finally {
      saving.value = false
    }
  }

  async function fetchModels(overrideEndpoint?: string): Promise<boolean> {
    modelsLoading.value = true
    error.value = null
    try {
      const params = overrideEndpoint ? { endpoint: overrideEndpoint } : {}
      const res = await axios.get('/api/ai/models', { params })
      models.value = res.data.models || []
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Could not connect to Ollama'
      models.value = []
      return false
    } finally {
      modelsLoading.value = false
    }
  }

  async function generate(prompt: string, system?: string, model?: string): Promise<string> {
    loading.value = true
    error.value = null
    try {
      const res = await axios.post('/api/ai/generate', { prompt, system, model })
      return res.data.text as string
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Generation failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function* streamGenerate(
    prompt: string,
    system?: string,
    model?: string,
  ): AsyncGenerator<string> {
    const response = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system, model }),
    })

    if (!response.ok || !response.body) {
      throw new Error(`Stream request failed: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6)
        try {
          const parsed = JSON.parse(payload) as { token?: string; done?: boolean; error?: string }
          if (parsed.error) throw new Error(parsed.error)
          if (parsed.token) yield parsed.token
          if (parsed.done) return
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  }

  return {
    config, models, loading, saving, modelsLoading, error,
    fetchConfig, saveConfig, fetchModels, generate, streamGenerate,
  }
})
