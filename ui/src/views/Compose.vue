<template>
  <div class="flex h-screen overflow-hidden bg-gray-950 text-gray-100">

    <!-- ── Left panel: editor ── -->
    <div class="flex-1 flex flex-col min-w-0 overflow-y-auto p-6">

      <div class="max-w-2xl w-full mx-auto flex flex-col gap-4">

        <!-- Header -->
        <div class="flex items-center justify-between">
          <h1 class="text-xl font-bold">{{ $t('compose.title') }}</h1>
          <router-link to="/dashboard" class="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            {{ $t('compose.cancel') }}
          </router-link>
        </div>

        <!-- Account selector -->
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">{{ $t('compose.destinationsLabel') }}</p>

          <div v-if="composeStore.destinations.length" class="flex flex-wrap gap-3">
            <button
              v-for="dest in composeStore.destinations"
              :key="dest.key"
              @click="toggle(dest.key)"
              :title="dest.label"
              class="relative focus:outline-none transition-all duration-150"
              :class="dest.selected ? 'opacity-100' : 'opacity-40 hover:opacity-70 grayscale hover:grayscale-0'"
            >
              <!-- Avatar circle -->
              <div
                class="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-white font-bold text-base ring-2 ring-offset-2 ring-offset-gray-950 transition-all"
                :style="dest.selected ? { ringColor: dest.color } : {}"
                :class="dest.selected ? 'ring-white' : 'ring-transparent'"
              >
                <img v-if="dest.picture" :src="dest.picture" class="w-full h-full object-cover" />
                <span v-else class="w-full h-full flex items-center justify-center font-bold text-sm" :style="{ backgroundColor: dest.color }">
                  {{ dest.label[0] }}
                </span>
              </div>

              <!-- Platform badge (only for page/account destinations) -->
              <span
                v-if="dest.accountId"
                class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white font-bold border-2 border-gray-900"
                style="font-size:8px"
                :style="{ backgroundColor: dest.color }"
              >
                {{ dest.platform === 'facebook' ? 'f' : 'I' }}
              </span>
            </button>
          </div>

          <p v-else class="text-sm text-gray-600">
            {{ $t('compose.noDestinations') }}
            <router-link to="/settings" class="text-blue-400 hover:text-blue-300 ml-1">{{ $t('compose.goToSettings') }}</router-link>
          </p>
        </div>

        <!-- Textarea -->
        <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden" :class="{ 'border-red-700': overLimit }">
          <textarea
            v-model="composeStore.content"
            :placeholder="$t('compose.placeholder')"
            rows="7"
            class="w-full bg-transparent text-gray-100 placeholder-gray-600 resize-none focus:outline-none text-sm leading-relaxed p-4"
          ></textarea>

          <!-- Media: attached file preview -->
          <div v-if="composeStore.mediaUrl.trim()" class="px-4 pb-3">
            <div class="relative inline-block group">
              <!-- Image preview -->
              <img
                v-if="isImage(composeStore.mediaUrl)"
                :src="composeStore.mediaUrl"
                class="rounded-lg max-h-48 max-w-full object-cover border border-gray-700"
                @error="mediaLoadError = true"
              />
              <!-- Video preview -->
              <div
                v-else
                class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5"
              >
                <svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.882v6.236a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span class="text-xs text-gray-300 truncate max-w-xs">{{ mediaFilename }}</span>
              </div>
              <button
                @click="removeMedia"
                class="absolute -top-2 -right-2 w-5 h-5 bg-gray-700 hover:bg-red-600 rounded-full flex items-center justify-center text-xs transition-colors"
                title="Remove"
              >✕</button>
            </div>
            <p v-if="mediaLoadError" class="text-xs text-red-400 mt-1">{{ $t('compose.mediaLoadError') }}</p>
          </div>

          <!-- Upload progress -->
          <div v-if="uploading" class="px-4 pb-3 flex items-center gap-2 text-sm text-gray-400">
            <svg class="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            {{ $t('compose.uploading') }}
          </div>

          <!-- Upload error -->
          <div v-if="uploadError" class="px-4 pb-3 text-xs text-red-400">{{ uploadError }}</div>

          <!-- Paste-URL fallback input -->
          <div v-if="showUrlInput && !composeStore.mediaUrl.trim() && !uploading" class="px-4 pb-3">
            <input
              v-model="pasteUrlValue"
              @keydown.enter="applyPastedUrl"
              @blur="applyPastedUrl"
              type="url"
              :placeholder="$t('compose.mediaUrlPlaceholder')"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              ref="urlInputRef"
            />
          </div>

          <!-- Hidden file input -->
          <input
            ref="fileInputRef"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo"
            class="hidden"
            @change="handleFileChange"
          />

          <!-- Toolbar -->
          <div class="flex items-center gap-2 px-4 py-2.5 border-t border-gray-800">
            <!-- Upload file button -->
            <button
              @click="fileInputRef?.click()"
              :disabled="uploading"
              class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40 px-2 py-1 rounded hover:bg-gray-800"
              :class="composeStore.mediaUrl ? 'text-blue-400' : ''"
              :title="$t('compose.uploadFile')"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {{ $t('compose.addMedia') }}
            </button>

            <!-- Paste URL toggle -->
            <button
              v-if="!composeStore.mediaUrl && !uploading"
              @click="toggleUrlInput"
              class="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              :class="showUrlInput ? 'text-blue-400' : ''"
            >
              {{ showUrlInput ? $t('compose.cancelUrl') : $t('compose.pasteUrl') }}
            </button>

            <!-- AI Generate toggle -->
            <button
              @click="toggleAiPanel"
              class="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
              :class="aiPanelOpen ? 'text-violet-400 bg-violet-900/30' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'"
            >
              <span>✨</span>
              <span>{{ $t('compose.aiButton') }}</span>
            </button>

            <span class="ml-auto text-xs font-mono" :class="overLimit ? 'text-red-400' : charNearLimit ? 'text-amber-400' : 'text-gray-600'">
              {{ composeStore.content.length }}<template v-if="composeStore.activeCharLimit">/{{ composeStore.activeCharLimit }}</template>
            </span>
          </div>

          <!-- AI Panel -->
          <div v-if="aiPanelOpen" class="border-t border-violet-900/40 bg-violet-950/20 px-4 py-3 space-y-3">

            <!-- Not configured warning -->
            <p v-if="!aiConfigured" class="text-xs text-amber-400 flex items-center gap-1.5">
              <span>⚠</span>{{ $t('compose.aiNotConfigured') }}
            </p>

            <template v-else>
              <!-- Context badge -->
              <p class="text-xs text-gray-500">
                <span v-if="aiContextAccount">✨ {{ $t('compose.aiContextFrom', { account: aiContextAccount }) }}</span>
                <span v-else>{{ $t('compose.aiNoContext') }}</span>
              </p>

              <!-- Topic input -->
              <input
                v-model="aiTopic"
                type="text"
                :placeholder="$t('compose.aiTopicPlaceholder')"
                :disabled="generating"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500 disabled:opacity-50"
              />

              <!-- Goal + Tone + Generate -->
              <div class="flex items-center gap-2 flex-wrap">
                <select
                  v-model="aiGoal"
                  :disabled="generating"
                  class="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                >
                  <option value="">{{ $t('compose.aiGoal') }}</option>
                  <option value="promote">{{ $t('compose.aiGoals.promote') }}</option>
                  <option value="engage">{{ $t('compose.aiGoals.engage') }}</option>
                  <option value="inform">{{ $t('compose.aiGoals.inform') }}</option>
                  <option value="entertain">{{ $t('compose.aiGoals.entertain') }}</option>
                  <option value="announce">{{ $t('compose.aiGoals.announce') }}</option>
                </select>

                <select
                  v-model="aiToneOverride"
                  :disabled="generating"
                  class="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                >
                  <option value="">{{ $t('compose.aiToneDefault') }}</option>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="friendly">Friendly</option>
                  <option value="formal">Formal</option>
                  <option value="humorous">Humorous</option>
                  <option value="inspiring">Inspiring</option>
                  <option value="educational">Educational</option>
                </select>

                <div class="ml-auto flex items-center gap-2">
                  <p v-if="aiError" class="text-xs text-red-400">{{ $t('compose.aiError') }}</p>

                  <!-- Stop button (during generation) -->
                  <button
                    v-if="generating"
                    @click="stopGeneration"
                    class="px-3 py-1.5 text-xs font-medium bg-red-700 hover:bg-red-600 rounded-lg transition-colors"
                  >
                    {{ $t('compose.aiStop') }}
                  </button>

                  <!-- Generate button -->
                  <button
                    v-else
                    @click="generatePost"
                    :disabled="!aiTopic.trim()"
                    class="px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1"
                  >
                    <span v-if="generating">{{ $t('compose.aiGenerating') }}</span>
                    <span v-else>✨ {{ $t('compose.aiGenerate') }}</span>
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Instagram warning -->
        <div v-if="igSelectedWithoutMedia" class="flex items-center gap-2 bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2.5 text-xs text-amber-300">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          {{ $t('compose.igImageRequired') }}
        </div>

        <!-- Schedule + Post -->
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <svg class="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <input
              v-model="composeStore.scheduledAt"
              type="datetime-local"
              class="flex-1 bg-transparent text-sm text-gray-300 focus:outline-none min-w-0"
              :title="$t('compose.scheduleTitle')"
            />
            <button
              v-if="composeStore.scheduledAt"
              @click="composeStore.scheduledAt = ''"
              class="text-gray-600 hover:text-gray-400 text-xs flex-shrink-0"
            >✕</button>
          </div>
          <button
            @click="handleSaveDraft"
            :disabled="composeStore.savingDraft || !composeStore.content.trim()"
            class="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex-shrink-0 bg-gray-700 hover:bg-gray-600 text-gray-200"
          >
            {{ composeStore.savingDraft ? $t('compose.savingDraft') : (composeStore.draftId ? $t('compose.updateDraft') : $t('compose.saveDraft')) }}
          </button>
          <button
            @click="handlePost"
            :disabled="composeStore.sending || !canPost"
            class="px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex-shrink-0"
            :class="composeStore.scheduledAt ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'"
          >
            {{ composeStore.sending ? $t('compose.sending') : postButtonLabel }}
          </button>
        </div>

        <!-- Success message -->
        <div v-if="composeStore.lastResult" class="bg-green-900/30 border border-green-700/60 rounded-xl px-4 py-3 text-sm text-green-300">
          {{ $t('compose.successMessage') }}
        </div>

        <!-- Draft saved message -->
        <div v-if="draftSavedBanner" class="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300">
          {{ $t('compose.draftSaved') }}
        </div>

      </div>
    </div>

    <!-- ── Right panel: preview ── -->
    <div class="w-80 flex-shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-widest">{{ $t('compose.preview') }}</p>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <PostPreview
          :selectedDestinations="composeStore.selectedDestinations"
          :activeKey="activePreviewKey"
          :content="composeStore.content"
          :mediaUrl="composeStore.mediaUrl"
          @update:activeKey="activePreviewKey = $event"
        />
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { useComposeStore } from '../stores/compose'
import { usePlatformsStore } from '../stores/platforms'
import { useAiStore } from '../stores/ai'
import PostPreview from '../components/compose/PostPreview.vue'

const { t } = useI18n()
const composeStore = useComposeStore()
const platformsStore = usePlatformsStore()
const aiStore = useAiStore()
const router = useRouter()
const route = useRoute()

const fileInputRef = ref<HTMLInputElement | null>(null)
const urlInputRef = ref<HTMLInputElement | null>(null)
const pasteUrlValue = ref('')
const showUrlInput = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const mediaLoadError = ref(false)
const activePreviewKey = ref('')
const draftSavedBanner = ref(false)

onMounted(async () => {
  await Promise.all([
    platformsStore.fetchStatuses(),
    platformsStore.fetchMetaConnections(),
    aiStore.fetchConfig(),
  ])
  composeStore.initDestinations()

  // Pre-fill media URL when arriving from the Media Library ("Use in Post")
  if (route.query.media) {
    composeStore.mediaUrl = String(route.query.media)
    mediaLoadError.value = false
  }

  // Load draft when arriving via ?draft=ID
  if (route.query.draft) {
    try {
      const res = await axios.get(`/api/drafts/${route.query.draft}`)
      composeStore.loadDraft(res.data)
      mediaLoadError.value = false
    } catch (err) {
      console.error('Failed to load draft:', err)
    }
  }
})

// Keep activePreviewKey pointed at a selected destination
watch(
  () => composeStore.selectedDestinations,
  (selected) => {
    if (!selected.find((d) => d.key === activePreviewKey.value)) {
      activePreviewKey.value = selected[0]?.key ?? ''
    }
  },
  { deep: true }
)

function toggle(key: string) {
  composeStore.toggleDestination(key)
  const dest = composeStore.destinations.find((d) => d.key === key)
  if (dest?.selected) activePreviewKey.value = key
}

async function handleFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  uploading.value = true
  uploadError.value = ''
  mediaLoadError.value = false

  try {
    const form = new FormData()
    form.append('file', file)
    const res = await axios.post('/api/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    composeStore.mediaUrl = res.data.url
  } catch (err: any) {
    uploadError.value = err.response?.data?.error ?? t('compose.uploadFailed')
  } finally {
    uploading.value = false
    // Reset file input so the same file can be re-selected if needed
    if (fileInputRef.value) fileInputRef.value.value = ''
  }
}

async function toggleUrlInput() {
  showUrlInput.value = !showUrlInput.value
  uploadError.value = ''
  if (showUrlInput.value) {
    await nextTick()
    urlInputRef.value?.focus()
  }
}

function applyPastedUrl() {
  const url = pasteUrlValue.value.trim()
  if (url) {
    composeStore.mediaUrl = url
    pasteUrlValue.value = ''
    showUrlInput.value = false
    mediaLoadError.value = false
  }
}

function removeMedia() {
  composeStore.mediaUrl = ''
  mediaLoadError.value = false
  uploadError.value = ''
  showUrlInput.value = false
}

function isImage(url: string) {
  return /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(url)
}

const mediaFilename = computed(() => {
  try { return decodeURIComponent(composeStore.mediaUrl.split('/').pop() ?? '') } catch { return composeStore.mediaUrl }
})

const igSelectedWithoutMedia = computed(() =>
  composeStore.selectedDestinations.some((d) => d.platform === 'instagram') &&
  !composeStore.mediaUrl.trim()
)

const overLimit = computed(() =>
  !!composeStore.activeCharLimit && composeStore.content.length > composeStore.activeCharLimit
)

const charNearLimit = computed(() =>
  !!composeStore.activeCharLimit && composeStore.content.length > composeStore.activeCharLimit * 0.9
)

const canPost = computed(() =>
  !!composeStore.content.trim() &&
  composeStore.selectedDestinations.length > 0 &&
  !overLimit.value &&
  !igSelectedWithoutMedia.value
)

const postButtonLabel = computed(() =>
  composeStore.scheduledAt ? `⏰ ${t('compose.schedule')}` : t('compose.send')
)

// ─── AI Generation ────────────────────────────────────────────────────────────

const aiPanelOpen = ref(false)
const aiTopic = ref('')
const aiGoal = ref('')
const aiToneOverride = ref('')
const generating = ref(false)
const aiError = ref(false)
const aiContextAccount = ref('')
const abortController = ref<AbortController | null>(null)

const aiConfigured = computed(() => aiStore.config.enabled && !!aiStore.config.endpoint)

function toggleAiPanel() {
  aiPanelOpen.value = !aiPanelOpen.value
  if (aiPanelOpen.value) loadAiContext()
}

// Profile cache keyed by destination key
const profileCache: Record<string, Record<string, string>> = {}

async function loadAiContext() {
  const firstDest = composeStore.selectedDestinations[0]
  if (!firstDest) { aiContextAccount.value = ''; return }

  aiContextAccount.value = firstDest.label

  if (!profileCache[firstDest.key]) {
    try {
      const res = await axios.get(`/api/profiles/${encodeURIComponent(firstDest.key)}`)
      profileCache[firstDest.key] = res.data
    } catch {
      profileCache[firstDest.key] = {}
    }
  }
}

function buildSystemPrompt(profile: Record<string, string>): string {
  const platforms = composeStore.selectedDestinations.map((d) => d.platform).join(', ')
  const charLimit = composeStore.activeCharLimit ? `${composeStore.activeCharLimit} characters` : 'no strict limit'
  const tone = aiToneOverride.value || profile.toneOfVoice || 'professional'

  const lines = [
    'You are a social media content writer. Write engaging, on-brand post content.',
    '',
    'BRAND CONTEXT:',
  ]
  if (profile.businessName)     lines.push(`Business: ${profile.businessName}`)
  if (profile.description)      lines.push(`Description: ${profile.description}`)
  if (profile.industry)         lines.push(`Industry: ${profile.industry}`)
  if (profile.targetAudience)   lines.push(`Target audience: ${profile.targetAudience}`)
  if (profile.keywords)         lines.push(`Keywords: ${profile.keywords}`)
  if (profile.hashtags)         lines.push(`Preferred hashtags: ${profile.hashtags}`)
  if (profile.postingGuidelines) lines.push(`Guidelines: ${profile.postingGuidelines}`)

  lines.push('', 'PLATFORM RULES:')
  lines.push(`Platform(s): ${platforms || 'general'}`)
  lines.push(`Character limit: ${charLimit}`)
  lines.push(`Tone of voice: ${tone}`)
  if (aiGoal.value) lines.push(`Goal: ${aiGoal.value}`)

  lines.push('', 'OUTPUT RULES:')
  lines.push('- Write ONLY the post content, nothing else.')
  lines.push('- No preamble, no explanation, no quotation marks around the post.')
  lines.push('- Include relevant hashtags if appropriate.')
  lines.push('- Stay within the character limit.')

  return lines.join('\n')
}

async function generatePost() {
  aiError.value = false
  const firstDest = composeStore.selectedDestinations[0]
  const profile = firstDest ? (profileCache[firstDest.key] || {}) : {}
  const system = buildSystemPrompt(profile)
  const prompt = aiTopic.value.trim()

  abortController.value = new AbortController()
  generating.value = true
  composeStore.content = ''

  try {
    const gen = aiStore.streamGenerate(prompt, system, undefined, abortController.value.signal)
    for await (const token of gen) {
      composeStore.content += token
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      aiError.value = true
      console.error('AI generation error:', err)
    }
  } finally {
    generating.value = false
    abortController.value = null
  }
}

function stopGeneration() {
  abortController.value?.abort()
}

async function handleSaveDraft() {
  const ok = await composeStore.saveDraft()
  if (ok) {
    draftSavedBanner.value = true
    setTimeout(() => { draftSavedBanner.value = false }, 2500)
  }
}

async function handlePost() {
  await composeStore.post()
  if (composeStore.lastResult) setTimeout(() => router.push('/dashboard'), 1500)
}
</script>
