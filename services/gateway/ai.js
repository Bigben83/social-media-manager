'use strict';

// ─── AI provider abstraction ──────────────────────────────────────────────────
// Single entry point for every LLM call the gateway makes.
//
//   generateText(pconf, { prompt, system, model, timeout, json, images })
//   streamText(pconf, { prompt, system, model, timeout }, { onToken, onDone, onError })
//   listModels(name, { apiKey, endpoint, baseUrl })
//
// `pconf` is the object returned by getActiveProviderConfig() in server.js:
//   { provider, model, endpoint?, apiKey?, baseUrl?, visionModel? }
//
// Supported providers:
//   ollama     — native Ollama API (/api/chat). Thinking models (qwen3, gemma4,
//                deepseek-r1…) are run with think:false so they answer instead of
//                spending minutes reasoning; JSON tasks use format:'json'.
//   openai     — OpenAI Chat Completions
//   groq       — OpenAI-compatible (api.groq.com)
//   custom     — any OpenAI-compatible server (LM Studio, vLLM, OpenRouter,
//                LiteLLM, Ollama's own /v1 endpoint…) with a configurable base URL
//   gemini     — Google Generative Language API
//   anthropic  — Claude via the official @anthropic-ai/sdk

const axios = require('axios');
const { StringDecoder } = require('string_decoder');
const { createLogger } = require('./utils/logger');

const log = createLogger('gateway-ai');

let AnthropicSdk = null;
try {
  AnthropicSdk = require('@anthropic-ai/sdk');
} catch (err) {
  log.error({ action: 'anthropic_sdk_load', code: err.code, err: err.message, outcome: 'failure' });
}

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_TOKENS = 8192;
const OLLAMA_KEEP_ALIVE = '30m';

// Static fallbacks — listModels() tries the live model endpoint first.
const PROVIDER_MODELS = {
  openai:    ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  groq:      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  gemini:    ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  custom:    [],
};

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq:   'https://api.groq.com/openai/v1',
};

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Providers that take an API key + model and are configured through /ai/provider/:name
const CLOUD_PROVIDERS = ['openai', 'groq', 'gemini', 'anthropic', 'custom'];

// Providers that can caption images
const VISION_PROVIDERS = new Set(['ollama', 'openai', 'gemini', 'anthropic', 'custom']);

// Which providers speak the OpenAI Chat Completions dialect
const OPENAI_COMPATIBLE = new Set(['openai', 'groq', 'custom']);

// ─── Errors ───────────────────────────────────────────────────────────────────

class AiError extends Error {
  constructor(provider, message, status) {
    super(`${provider}: ${message}`);
    this.name = 'AiError';
    this.provider = provider;
    this.status = status || 503;
  }
}

function normaliseError(provider, err) {
  if (err instanceof AiError) return err;
  const status = err.status || err.response?.status;
  const body = err.response?.data;
  let detail = err.message;
  if (body) {
    if (typeof body === 'string') detail = body.slice(0, 300);
    else detail = body.error?.message || body.error || body.message || JSON.stringify(body).slice(0, 300);
  }
  if (err.code === 'ECONNABORTED') detail = `timed out after ${err.config?.timeout || '?'} ms`;
  if (err.code === 'ECONNREFUSED') detail = `connection refused (${err.config?.url || ''})`;
  return new AiError(provider, detail, status);
}

function requireKey(pconf) {
  if (!pconf.apiKey) throw new AiError(pconf.provider, 'API key not configured', 503);
}

// ─── Message builders ─────────────────────────────────────────────────────────

function openAiMessages(prompt, system, images = []) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (images.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ],
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }
  return messages;
}

function geminiBody(prompt, system, images = [], json = false) {
  const parts = [{ text: prompt }];
  for (const img of images) parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
  const body = { contents: [{ role: 'user', parts }] };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig = { responseMimeType: 'application/json' };
  return body;
}

function anthropicContent(prompt, images = []) {
  if (!images.length) return prompt;
  return [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })),
    { type: 'text', text: prompt },
  ];
}

function anthropicClient(pconf, timeout) {
  if (!AnthropicSdk) {
    throw new AiError('anthropic', 'Claude SDK unavailable — repair gateway dependencies and restart the gateway', 503);
  }
  requireKey(pconf);
  return new AnthropicSdk({ apiKey: pconf.apiKey, timeout, maxRetries: 1 });
}

// Server-side refusal fallback: on a safety decline the API re-runs the request
// on a fallback model in the same call. If the account/SDK rejects the beta we
// retry once without it.
const ANTHROPIC_FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

function isFallbackRejection(err) {
  const msg = String(err?.message || err?.error?.message || '');
  return (err?.status === 400 || err?.response?.status === 400) && /fallback|beta/i.test(msg);
}

function anthropicText(response) {
  if (response.stop_reason === 'refusal') {
    throw new AiError('anthropic', `request declined by safety classifier${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`, 422);
  }
  return (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// ─── Ollama helpers ───────────────────────────────────────────────────────────

function ollamaMessages(prompt, system, images = []) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  const user = { role: 'user', content: prompt };
  if (images.length) user.images = images.map((img) => img.base64);
  messages.push(user);
  return messages;
}

// Ollama ≥0.9 accepts `think:false` to disable reasoning on thinking models.
// Models that cannot think may reject the field with a 400, so retry without it.
async function ollamaPost(pconf, body, axiosOpts) {
  const url = `${pconf.endpoint.replace(/\/$/, '')}/api/chat`;
  try {
    return await axios.post(url, { ...body, think: false }, axiosOpts);
  } catch (err) {
    const status = err.response?.status;
    const msg = JSON.stringify(err.response?.data || '');
    if (status === 400 && /think/i.test(msg)) {
      return axios.post(url, body, axiosOpts);
    }
    throw err;
  }
}

// ─── generateText ─────────────────────────────────────────────────────────────

/**
 * Non-streaming text generation.
 * @param {object} pconf   active provider config
 * @param {object} opts    { prompt, system?, model?, timeout?, json?: true | 'array', images?: [{ base64, mime }] }
 *   json: true   — the prompt asks for a JSON object (enables strict JSON modes everywhere)
 *   json: 'array' — the prompt asks for a bare JSON array (Ollama/Gemini JSON mode only)
 * @returns {Promise<string>}
 */
async function generateText(pconf, opts) {
  const { prompt, system, images = [], json = false } = opts;
  const model = opts.model || pconf.model;
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const provider = pconf.provider;

  try {
    if (provider === 'ollama') {
      const body = {
        model,
        messages: ollamaMessages(prompt, system, images),
        stream: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
      };
      if (json) body.format = 'json';
      const res = await ollamaPost(pconf, body, { timeout });
      return res.data.message?.content || '';
    }

    if (OPENAI_COMPATIBLE.has(provider)) {
      if (provider !== 'custom') requireKey(pconf);
      const body = { model, messages: openAiMessages(prompt, system, images), stream: false };
      // json_object mode only allows a top-level object (json === true, not 'array') and is
      // reliable on OpenAI + Groq; many self-hosted servers reject it.
      if (json === true && provider !== 'custom') body.response_format = { type: 'json_object' };
      const headers = pconf.apiKey ? { Authorization: `Bearer ${pconf.apiKey}` } : {};
      const res = await axios.post(`${pconf.baseUrl.replace(/\/$/, '')}/chat/completions`, body, { headers, timeout });
      return res.data.choices?.[0]?.message?.content || '';
    }

    if (provider === 'gemini') {
      requireKey(pconf);
      const res = await axios.post(
        `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${pconf.apiKey}`,
        geminiBody(prompt, system, images, json),
        { timeout },
      );
      return res.data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    }

    if (provider === 'anthropic') {
      const client = anthropicClient(pconf, timeout);
      const params = {
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: anthropicContent(prompt, images) }],
      };
      if (system) params.system = system;
      let response;
      try {
        response = await client.beta.messages.create({ ...params, ...ANTHROPIC_FALLBACK });
      } catch (err) {
        if (!isFallbackRejection(err)) throw err;
        response = await client.messages.create(params);
      }
      return anthropicText(response);
    }

    throw new AiError(provider || 'none', 'AI provider not configured', 400);
  } catch (err) {
    const e = normaliseError(provider, err);
    log.error({ action: 'ai_generate', provider, model, outcome: 'failure', err: e.message });
    throw e;
  }
}

// ─── streamText ───────────────────────────────────────────────────────────────

/**
 * Streaming text generation. Calls onToken(text) for each chunk, onDone() once,
 * onError(message) on failure. Never throws after handlers are wired.
 */
async function streamText(pconf, opts, handlers) {
  const { prompt, system, signal } = opts;
  const model = opts.model || pconf.model;
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const provider = pconf.provider;
  const { onToken, onDone, onError } = handlers;

  let finished = false;
  const finish = () => { if (!finished) { finished = true; onDone(); } };
  const fail = (err) => { if (!finished) { finished = true; onError(normaliseError(provider, err).message); } };

  // Pipe an axios stream through a line parser.
  const pipeLines = (stream, parseLine) => {
    let buffer = ''; const decoder = new StringDecoder('utf8');
    const abort = () => { stream.destroy(); finish(); };
    signal?.addEventListener('abort', abort, { once: true });
    const parse = line => { if (line.trim() && !finished) { try { parseLine(line); } catch (err) { fail(err); stream.destroy(); } } };
    stream.on('data', chunk => {
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) parse(line);
    });
    stream.on('end', () => { buffer += decoder.end(); parse(buffer); signal?.removeEventListener('abort',abort); finish(); });
    stream.on('error', err => { signal?.removeEventListener('abort',abort); fail(err); });
  };

  try {
    if (provider === 'ollama') {
      const res = await ollamaPost(pconf, {
        model, messages: ollamaMessages(prompt, system), stream: true, keep_alive: OLLAMA_KEEP_ALIVE,
      }, { responseType: 'stream', timeout, signal });
      pipeLines(res.data, (line) => {
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        const token = data.message?.content || '';
        if (token) onToken(token);
        if (data.done) finish();
      });
      return;
    }

    if (OPENAI_COMPATIBLE.has(provider)) {
      if (provider !== 'custom') requireKey(pconf);
      const headers = pconf.apiKey ? { Authorization: `Bearer ${pconf.apiKey}` } : {};
      const res = await axios.post(`${pconf.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        model, messages: openAiMessages(prompt, system), stream: true,
      }, { headers, responseType: 'stream', timeout, signal });
      pipeLines(res.data, (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { finish(); return; }
        const data = JSON.parse(payload);
        if (data.error) throw new Error(data.error.message || String(data.error));
        const token = data.choices?.[0]?.delta?.content || '';
        if (token) onToken(token);
      });
      return;
    }

    if (provider === 'gemini') {
      requireKey(pconf);
      const res = await axios.post(
        `${GEMINI_BASE_URL}/models/${model}:streamGenerateContent?alt=sse&key=${pconf.apiKey}`,
        geminiBody(prompt, system),
        { responseType: 'stream', timeout, signal },
      );
      pipeLines(res.data, (line) => {
        if (!line.startsWith('data:')) return;
        const data = JSON.parse(line.slice(5).trim());
        if (data.error) throw new Error(data.error.message || String(data.error));
        const token = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (token) onToken(token);
      });
      return;
    }

    if (provider === 'anthropic') {
      const client = anthropicClient(pconf, timeout);
      const params = {
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      };
      if (system) params.system = system;

      let emitted = false;
      const run = async (withFallback) => {
        const stream = withFallback
          ? client.beta.messages.stream({ ...params, ...ANTHROPIC_FALLBACK }, { signal })
          : client.messages.stream(params, { signal });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            emitted = true;
            onToken(event.delta.text);
          }
        }
        return stream.finalMessage();
      };

      let final;
      try {
        final = await run(true);
      } catch (err) {
        // Beta rejected by the account/SDK — retry once on the stable endpoint
        if (emitted || !isFallbackRejection(err)) throw err;
        final = await run(false);
      }
      if (final.stop_reason === 'refusal') throw new AiError('anthropic', 'request declined by safety classifier', 422);
      finish();
      return;
    }

    throw new AiError(provider || 'none', 'AI provider not configured', 400);
  } catch (err) {
    log.error({ action: 'ai_stream', provider, model, outcome: 'failure', err: err.message });
    fail(err);
  }
}

// ─── listModels ───────────────────────────────────────────────────────────────

/**
 * Live model listing with static fallback.
 * @returns {Promise<{ models: string[], live: boolean }>}
 */
async function listModels(name, creds = {}) {
  const fallback = { models: PROVIDER_MODELS[name] || [], live: false };
  try {
    if (name === 'ollama') {
      const res = await axios.get(`${creds.endpoint.replace(/\/$/, '')}/api/tags`, { timeout: 5000 });
      return { models: (res.data.models || []).map((m) => m.name), live: true };
    }
    if (name === 'openai' || name === 'groq' || name === 'custom') {
      const baseUrl = (creds.baseUrl || PROVIDER_BASE_URLS[name] || '').replace(/\/$/, '');
      if (!baseUrl) return fallback;
      const headers = creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {};
      const res = await axios.get(`${baseUrl}/models`, { headers, timeout: 8000 });
      let ids = (res.data.data || res.data.models || []).map((m) => m.id || m.name).filter(Boolean);
      if (name === 'openai') ids = ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/realtime|audio|tts|transcribe|image|embedding|moderation|search|instruct|codex/.test(id));
      ids.sort();
      return ids.length ? { models: ids, live: true } : fallback;
    }
    if (name === 'gemini') {
      if (!creds.apiKey) return fallback;
      const res = await axios.get(`${GEMINI_BASE_URL}/models?key=${creds.apiKey}&pageSize=200`, { timeout: 8000 });
      const ids = (res.data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((id) => /^gemini-/.test(id) && !/embedding|image|tts|audio|live/.test(id))
        .sort();
      return ids.length ? { models: ids, live: true } : fallback;
    }
    if (name === 'anthropic') {
      if (!creds.apiKey || !AnthropicSdk) return fallback;
      const client = new AnthropicSdk({ apiKey: creds.apiKey, timeout: 8000 });
      const ids = [];
      for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
      return ids.length ? { models: ids, live: true } : fallback;
    }
  } catch (err) {
    log.warn({ action: 'ai_list_models', provider: name, outcome: 'fallback', err: err.message });
  }
  return fallback;
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

/** Strip code fences / <think> blocks and parse the first JSON object or array. */
function extractJson(text, { array = false } = {}) {
  if (!text) throw new Error('Empty AI response');
  let cleaned = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const open = array ? '[' : '{';
  const close = array ? ']' : '}';
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON found in AI response');
  cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

module.exports = {
  AiError,
  PROVIDER_MODELS,
  PROVIDER_BASE_URLS,
  GEMINI_BASE_URL,
  CLOUD_PROVIDERS,
  VISION_PROVIDERS,
  generateText,
  streamText,
  listModels,
  extractJson,
  anthropicSdkAvailable: () => !!AnthropicSdk,
};
