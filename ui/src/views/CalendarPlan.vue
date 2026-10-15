<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <div class="max-w-5xl mx-auto px-6 py-8">

      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-white">{{ $t('calendarPlan.title') }}</h1>
        <p class="text-sm text-gray-500 mt-1">{{ $t('calendarPlan.subtitle') }}</p>
      </div>

      <div class="mb-5">
        <label for="saved-content-plan" class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.savedPlans') }}</label>
        <select id="saved-content-plan" v-model="selectedSavedPlan" @change="loadSavedPlan(selectedSavedPlan)" :disabled="loading || briefLoading" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100">
          <option value="">{{ $t('calendarPlan.chooseSavedPlan') }}</option>
          <option v-for="plan in savedPlans" :key="plan.calendarId" :value="plan.calendarId">{{ plan.monthName }} — {{ plan.brief?.theme || plan.calendarId }}</option>
        </select>
      </div>

      <p class="text-xs text-gray-400 mb-4">{{ $t('calendarPlan.chatWorkflowHint') }}</p>

      <!-- Configuration card -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
        <fieldset :disabled="loading || briefLoading" class="min-w-0">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <!-- Month -->
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.month') }}</label>
            <input
              v-model="selectedMonth"
              type="month"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500"
            />
          </div>

          <!-- Account -->
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.account') }}</label>
            <select
              v-model="selectedAccount"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500"
            >
              <option value="">{{ $t('calendarPlan.allAccounts') }}</option>
              <option v-for="acc in connectedAccounts" :key="acc.key" :value="acc.key">{{ acc.label }}</option>
            </select>
          </div>

          <!-- Posts per week -->
          <div>
            <label class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.postsPerWeek') }}</label>
            <div class="flex items-center gap-2">
              <button
                @click="postsPerWeek = Math.max(1, postsPerWeek - 1)"
                class="w-8 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-lg font-medium transition-colors"
              >−</button>
              <span class="flex-1 text-center text-sm font-semibold text-white">{{ postsPerWeek }}</span>
              <button
                @click="postsPerWeek = Math.min(7, postsPerWeek + 1)"
                class="w-8 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-lg font-medium transition-colors"
              >+</button>
            </div>
            <p class="text-[11px] text-gray-600 mt-1 text-center">
              {{ $t('calendarPlan.postsPerWeekHint', { total: postsPerWeek * 4, grand: selectedPlatforms.length * postsPerWeek * 4 }) }}
            </p>
          </div>
        </div>

        <div class="mb-5">
          <label for="campaign-context" class="block text-xs text-gray-400 mb-1.5">{{ $t('calendarPlan.contextLabel') }}</label>
          <textarea
            id="campaign-context"
            v-model="campaignContext"
            rows="6"
            maxlength="20000"
            :disabled="loading || briefLoading"
            :placeholder="$t('calendarPlan.contextPlaceholder')"
            aria-describedby="campaign-context-hint"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500 disabled:opacity-60 resize-y"
          ></textarea>
          <div class="flex justify-between gap-4 mt-1">
            <p id="campaign-context-hint" class="text-xs text-gray-500">{{ $t('calendarPlan.contextHint') }}</p>
            <span class="text-xs text-gray-500 whitespace-nowrap">{{ campaignContext.length.toLocaleString() }} / 20,000</span>
          </div>
        </div>

        <!-- Platform checkboxes + action buttons row -->
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex-1 min-w-0">
            <label class="block text-xs text-gray-400 mb-2">{{ $t('calendarPlan.platforms') }}</label>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="p in PLATFORMS"
                :key="p.key"
                class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors"
                :class="selectedPlatforms.includes(p.key)
                  ? 'text-white border-transparent'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'"
                :style="selectedPlatforms.includes(p.key) ? { background: p.color + '33', borderColor: p.color } : {}"
              >
                <input type="checkbox" class="sr-only" :value="p.key" v-model="selectedPlatforms" />
                <i :class="p.icon" class="text-[11px]"></i>
                {{ p.label }}
              </label>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 shrink-0">
            <button @click="copyChatPrompt('chatgpt')" :disabled="!selectedPlatforms.length" class="px-4 py-2 bg-emerald-800 hover:bg-emerald-700 rounded-lg text-sm font-medium text-white">{{ $t('calendarPlan.copyChatgptPrompt') }}</button>
            <button @click="copyChatPrompt('claude')" :disabled="!selectedPlatforms.length" class="px-4 py-2 bg-amber-800 hover:bg-amber-700 rounded-lg text-sm font-medium text-white">{{ $t('calendarPlan.copyClaudePrompt') }}</button>
            <button
              @click="generateBrief"
              :disabled="briefLoading || loading || !selectedPlatforms.length"
              class="flex items-center justify-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors"
            >
              <i class="fa-solid fa-file-lines text-xs" :class="{ 'animate-pulse': briefLoading }"></i>
              {{ briefLoading ? $t('calendarPlan.generatingBrief') : $t('calendarPlan.generateBrief') }}
            </button>
            <button
              @click="generate"
              :disabled="loading || !selectedPlatforms.length"
              class="flex items-center justify-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors"
            >
              <i class="fa-solid fa-calendar-days text-xs" :class="{ 'animate-pulse': loading }"></i>
              {{ loading ? $t('calendarPlan.generating') : $t('calendarPlan.generate') }}
            </button>
          </div>
        </div>
        </fieldset>
      </div>

      <div v-if="showChatPrompt" class="bg-gray-900 border border-amber-800/50 rounded-2xl p-5 mb-6">
        <p class="text-sm text-amber-200 mb-2">{{ chatPromptCopied ? $t('calendarPlan.chatPromptCopied', { app: chatAppName }) : $t('calendarPlan.chatPromptReady', { app: chatAppName }) }}</p>
        <textarea :value="chatPrompt" readonly rows="8" :aria-label="$t('calendarPlan.chatPromptLabel', { app: chatAppName })" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200"></textarea>
        <p class="text-xs text-gray-400 mt-2">{{ $t('calendarPlan.chatPromptHint', { app: chatAppName }) }}</p>
        <a :href="chatProvider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://claude.ai/new'" target="_blank" rel="noopener" class="inline-block mt-3 text-sm text-amber-300 underline">{{ $t('calendarPlan.openChatApp', { app: chatAppName }) }}</a>
        <a :href="'/global-settings#' + chatProvider + '-connector'" class="ml-4 text-xs text-gray-400 underline">{{ $t('calendarPlan.connectorSetup') }}</a>
      </div>

      <!-- Brief preview (approval step) -->
      <div v-if="pendingBrief && !calendar" class="bg-gray-900 border border-sky-800/50 rounded-2xl p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-file-lines text-sky-400 text-sm"></i>
            <h2 class="font-semibold text-white">{{ $t('calendarPlan.briefPreviewTitle') }}</h2>
            <span class="text-xs text-gray-500">{{ pendingBriefMonthName }}</span>
          </div>
          <div class="flex gap-2">
            <button
              @click="generateBrief"
              :disabled="briefLoading || loading"
              class="flex items-center gap-1.5 text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded-lg text-gray-200 transition-colors"
            >
              <i class="fa-solid fa-rotate-right text-[10px]" :class="{ 'animate-spin': briefLoading }"></i>
              {{ $t('calendarPlan.regenerateBrief') }}
            </button>
            <button
              @click="approveAndGenerate"
              :disabled="loading"
              class="flex items-center gap-1.5 text-sm px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-lg text-white font-medium transition-colors"
            >
              <i class="fa-solid fa-check text-xs" :class="{ 'animate-pulse': loading }"></i>
              {{ loading ? $t('calendarPlan.generating') : $t('calendarPlan.approveBrief') }}
            </button>
          </div>
        </div>

        <div class="p-4 bg-sky-950/40 border border-sky-800/30 rounded-xl mb-4">
          <div class="text-xs text-sky-400 font-medium mb-1">{{ $t('calendarPlan.theme') }}</div>
          <p class="text-sm text-gray-200">{{ pendingBrief.theme }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div v-if="pendingBrief.pillars?.length">
            <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.pillars') }}</div>
            <ul class="space-y-1">
              <li v-for="p in pendingBrief.pillars" :key="p" class="flex gap-1.5 text-xs text-gray-300">
                <span class="text-sky-400">▪</span>{{ p }}
              </li>
            </ul>
          </div>
          <div v-if="pendingBrief.toneGuidance">
            <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.toneGuidance') }}</div>
            <p class="text-xs text-gray-300 italic">{{ pendingBrief.toneGuidance }}</p>
          </div>
        </div>
      </div>

      <!-- Progress (background job) -->
      <div v-if="(loading || briefLoading) && progress" class="mb-6 p-4 bg-gray-900 border border-violet-800/40 rounded-2xl">
        <div class="flex items-center justify-between text-xs text-gray-300 mb-2">
          <span class="flex items-center gap-2">
            <i class="fa-solid fa-circle-notch animate-spin text-violet-400"></i>
            {{ progressLabel() }}
          </span>
          <span class="text-gray-500">{{ $t('calendarPlan.progressHint') }}</span>
        </div>
        <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div class="h-full bg-violet-600 transition-all duration-500" :style="{ width: progress.total ? Math.max(5, Math.round((progress.completed / progress.total) * 100)) + '%' : '5%' }"></div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="mb-6 p-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm">
        {{ error }}
      </div>

      <!-- Calendar results -->
      <div v-if="calendar">
        <!-- Narrative brief -->
        <div class="bg-gray-900 border border-violet-800/40 rounded-2xl p-6 mb-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="font-semibold text-white">{{ $t('calendarPlan.briefTitle') }}</h2>
              <p class="text-xs text-gray-500 mt-0.5">{{ calendar.monthName }}</p>
            </div>
            <div class="flex gap-2">
              <button
                @click="exportCalendarCsv"
                class="flex items-center gap-1.5 text-sm px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 transition-colors"
              >
                <i class="fa-solid fa-file-csv text-xs"></i>
                {{ $t('calendarPlan.exportCsv') }}
              </button>
              <button
                @click="saveAllDrafts"
                :disabled="savingAll"
                class="flex items-center gap-1.5 text-sm px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg text-white transition-colors"
              >
                <i class="fa-solid fa-floppy-disk text-xs"></i>
                {{ savingAll ? $t('calendarPlan.savingAll') : $t('calendarPlan.saveAllDraftsScheduled', { count: calendar.posts.length }) }}
              </button>
            </div>
          </div>

          <div class="p-4 bg-gray-800/50 rounded-xl mb-4">
            <div class="text-xs text-violet-400 font-medium mb-1">{{ $t('calendarPlan.theme') }}</div>
            <p class="text-sm text-gray-200">{{ calendar.brief.theme }}</p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.pillars') }}</div>
              <ul class="space-y-1">
                <li v-for="p in calendar.brief.pillars" :key="p" class="flex gap-1.5 text-xs text-gray-300">
                  <span class="text-violet-400">▪</span>{{ p }}
                </li>
              </ul>
            </div>
            <div v-if="calendar.brief.toneGuidance">
              <div class="text-xs text-gray-400 mb-2">{{ $t('calendarPlan.toneGuidance') }}</div>
              <p class="text-xs text-gray-300 italic">{{ calendar.brief.toneGuidance }}</p>
            </div>
          </div>
        </div>

        <!-- Posts by platform -->
        <div class="space-y-4">
          <div
            v-for="platform in calendar.platforms"
            :key="platform"
            class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden"
          >
            <!-- Platform header -->
            <div class="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
              <i :class="platformIcon(platform)" class="text-sm" :style="{ color: platformColor(platform) }"></i>
              <span class="font-medium text-sm capitalize">{{ platform }}</span>
              <span v-if="calendar.brief.platformNotes?.[platform]" class="text-xs text-gray-500 ml-2 italic">{{ calendar.brief.platformNotes[platform] }}</span>
            </div>

            <!-- Posts for this platform -->
            <div class="divide-y divide-gray-800/60">
              <div
                v-for="post in postsForPlatform(platform)"
                :key="post.week + post.content.slice(0, 20)"
                class="p-4"
              >
                <div class="flex items-start gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="text-xs text-gray-500">{{ $t('calendarPlan.week', { n: post.week }) }}</span>
                      <span v-if="post.suggestedDay" class="text-xs text-gray-500">· {{ post.suggestedDay }}</span>
                      <span v-if="post.suggestedTime" class="text-xs text-gray-500">{{ $t('calendarPlan.at') }} {{ post.suggestedTime }}</span>
                      <span
                        class="text-xs px-1.5 py-0.5 rounded capitalize"
                        :class="{
                          'bg-blue-900/40 text-blue-300': post.postType === 'educational',
                          'bg-violet-900/40 text-violet-300': post.postType === 'promotional',
                          'bg-green-900/40 text-green-300': post.postType === 'engagement',
                          'bg-amber-900/40 text-amber-300': post.postType === 'storytelling',
                        }"
                      >{{ post.postType }}</span>
                    </div>
                    <p class="text-sm text-gray-200 mb-2 whitespace-pre-line leading-relaxed">{{ post.content }}</p>
                    <div v-if="post.hashtags?.length" class="flex flex-wrap gap-1">
                      <span v-for="tag in post.hashtags" :key="tag" class="text-xs text-emerald-400 font-mono">{{ tag }}</span>
                    </div>
                  </div>
                  <button
                    @click="draftPost(post)"
                    class="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded-lg"
                  >
                    <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                    {{ $t('calendarPlan.draft') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWorkspaceStore } from '../stores/workspace'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'
import { useComposeStore } from '../stores/compose'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()
const platformsStore = usePlatformsStore()
const composeStore = useComposeStore()

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram',  color: '#E1306C', icon: 'fa-brands fa-instagram' },
  { key: 'facebook',  label: 'Facebook',   color: '#1877F2', icon: 'fa-brands fa-facebook' },
  { key: 'twitter',   label: 'Twitter/X',  color: '#000000', icon: 'fa-brands fa-x-twitter' },
  { key: 'tiktok',    label: 'TikTok',     color: '#EE1D52', icon: 'fa-brands fa-tiktok' },
  { key: 'pinterest', label: 'Pinterest',  color: '#E60023', icon: 'fa-brands fa-pinterest' },
  { key: 'mastodon',  label: 'Mastodon',   color: '#6364FF', icon: 'fa-brands fa-mastodon' },
  { key: 'bluesky',   label: 'Bluesky',    color: '#0085FF', icon: 'fa-brands fa-bluesky' },
]

const selectedMonth   = ref(new Date().toISOString().slice(0, 7))
const selectedAccount = ref('')
const selectedPlatforms = ref<string[]>(['facebook', 'instagram'])
const postsPerWeek = ref(3)
const campaignContext = ref('')
const savedPlans = ref<any[]>([])
const selectedSavedPlan = ref('')
const chatProvider = ref<'claude' | 'chatgpt'>('claude')
const chatAppName = computed(() => chatProvider.value === 'chatgpt' ? 'ChatGPT' : 'Claude')
const showChatPrompt = ref(false)
const chatPromptCopied = ref(false)
const chatPrompt = computed(() => [
  'Use the SocialManager MCP connector to create and save a content plan. Write the content in this ' + chatAppName.value + ' conversation; do not invoke a generation API.',
  'Workspace: ' + (workspaceStore.activeWorkspace?.name || '') + ' (' + workspaceStore.activeWorkspaceId + '). Read get_workspace_context for this exact workspace first.',
  'Month: ' + selectedMonth.value + '. Platforms: ' + selectedPlatforms.value.join(', ') + '. Posts per week per platform: ' + postsPerWeek.value + ' for weeks 1–4.',
  selectedAccount.value ? 'Account profile: ' + selectedAccount.value : 'Use the workspace brand context.',
  'Campaign context and source posts: ' + JSON.stringify(campaignContext.value.trim()),
  'Use numbered source posts for the corresponding opening posts in order. Preserve facts and explicit wording requirements and adapt to each platform. Do not invent product claims.',
  'Write a narrative brief and platform-specific posts, then use save_content_plan with a stable requestId, the exact campaignContext, and this workspaceId. Include week, suggestedDay, suggestedTime, hashtags and postType for each post.',
  'Return the saved plan link. Do not publish or schedule anything unless I separately request it and confirm its preview.',
].join('\n\n'))
async function copyChatPrompt(provider: 'claude' | 'chatgpt') {
  chatProvider.value = provider
  showChatPrompt.value = true
  chatPromptCopied.value = false
  try { await navigator.clipboard.writeText(chatPrompt.value); chatPromptCopied.value = true } catch { /* The prompt remains available to copy manually. */ }
}
async function refreshSavedPlans() {
  try { savedPlans.value = (await axios.get('/api/ai/content-calendars')).data.calendars || [] } catch { /* Generation remains available when history cannot load. */ }
}
async function loadSavedPlan(id: string) {
  if (!id) return
  try {
    const saved = (await axios.get('/api/ai/content-calendar/' + encodeURIComponent(id))).data
    calendar.value = saved
    selectedMonth.value = saved.month
    selectedPlatforms.value = saved.platforms || []
    selectedAccount.value = saved.accountKey || ''
    postsPerWeek.value = saved.postsPerWeek || 3
    campaignContext.value = saved.campaignContext || ''
    error.value = ''
  } catch (err: any) { error.value = errorMessage(err, 'Could not load the saved content plan') }
}
const loading    = ref(false)
const savingAll  = ref(false)
const error      = ref('')
const calendar   = ref<any>(null)

const briefLoading       = ref(false)
const pendingBrief       = ref<any>(null)
const pendingBriefMonthName = ref('')

// A reviewed brief belongs to these exact campaign inputs.
watch([campaignContext, selectedMonth, selectedAccount, () => selectedPlatforms.value.join(',')], () => {
  pendingBrief.value = null
  pendingBriefMonthName.value = ''
  chatPromptCopied.value = false
})

interface ProfileAccount { key: string; label: string }
const connectedAccounts = computed((): ProfileAccount[] => {
  const list: ProfileAccount[] = []
  for (const [platform] of Object.entries(PLATFORM_META)) {
    if (['facebook', 'instagram', 'pinterest', 'tiktok'].includes(platform)) continue
    if (platformsStore.isConnected(platform)) {
      list.push({ key: platform, label: platform.charAt(0).toUpperCase() + platform.slice(1) })
    }
  }
  for (const page of platformsStore.connectedPages) {
    list.push({ key: `facebook:${page.id}`, label: page.name })
  }
  for (const acc of platformsStore.connectedIgAccounts) {
    list.push({ key: `instagram:${acc.id}`, label: `@${acc.username}` })
  }
  return list
})

function platformColor(p: string): string {
  return PLATFORMS.find((x) => x.key === p)?.color ?? '#6b7280'
}
function platformIcon(p: string): string {
  return PLATFORMS.find((x) => x.key === p)?.icon ?? 'fa-solid fa-globe'
}

function postsForPlatform(platform: string) {
  return (calendar.value?.posts ?? []).filter((p: any) => p.platform === platform)
}

// ─── Background job polling ───────────────────────────────────────────────────
// Brief and calendar generation run as background jobs on the gateway
// (POST returns 202 + jobId). Local models can take several minutes, which is
// longer than most reverse proxies allow a single request to stay open.
const progress = ref<{ step: string; completed: number; total: number } | null>(null)
const POLL_INTERVAL_MS = 2000
const JOB_TIMEOUT_MS = 20 * 60 * 1000

function progressLabel(): string {
  const p = progress.value
  if (!p || !p.total) return ''
  const stepLabel = p.step === 'brief'
    ? t('calendarPlan.progressBrief')
    : (PLATFORMS.find((x) => x.key === p.step)?.label ?? p.step)
  return t('calendarPlan.progress', { step: stepLabel, completed: p.completed, total: p.total })
}

async function runAiJob(url: string, body: Record<string, unknown>): Promise<any> {
  const start = await axios.post(url, body)
  const jobId: string = start.data.jobId
  if (!jobId) return start.data // synchronous fallback
  const deadline = Date.now() + JOB_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await axios.get(`/api/ai/jobs/${jobId}`)
    progress.value = res.data.progress ?? null
    if (res.data.status === 'done') return res.data.result
    if (res.data.status === 'failed') throw new Error(res.data.error || 'AI job failed')
  }
  throw new Error(t('calendarPlan.jobTimedOut'))
}

function errorMessage(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback
}

async function generateBrief() {
  if (!selectedPlatforms.value.length) return
  briefLoading.value = true
  error.value = ''
  calendar.value = null
  progress.value = null
  try {
    const result = await runAiJob('/api/ai/content-brief', {
      accountKey: selectedAccount.value || undefined,
      platforms: selectedPlatforms.value,
      month: selectedMonth.value,
      campaignContext: campaignContext.value.trim(),
    })
    pendingBrief.value = result.brief
    pendingBriefMonthName.value = result.monthName
  } catch (err: any) {
    error.value = errorMessage(err, 'Brief generation failed')
  } finally {
    briefLoading.value = false
    progress.value = null
  }
}

async function approveAndGenerate() {
  if (!pendingBrief.value) return
  loading.value = true
  error.value = ''
  progress.value = null
  try {
    calendar.value = await runAiJob('/api/ai/content-calendar', {
      accountKey: selectedAccount.value || undefined,
      platforms: selectedPlatforms.value,
      month: selectedMonth.value,
      campaignContext: campaignContext.value.trim(),
      approvedBrief: pendingBrief.value,
      postsPerWeek: postsPerWeek.value,
    })
    pendingBrief.value = null
  } catch (err: any) {
    error.value = errorMessage(err, 'Calendar generation failed')
  } finally {
    loading.value = false
    progress.value = null
  }
}

async function generate() {
  if (!selectedPlatforms.value.length) return
  loading.value = true
  error.value = ''
  pendingBrief.value = null
  progress.value = null
  try {
    calendar.value = await runAiJob('/api/ai/content-calendar', {
      accountKey: selectedAccount.value || undefined,
      platforms: selectedPlatforms.value,
      month: selectedMonth.value,
      campaignContext: campaignContext.value.trim(),
      postsPerWeek: postsPerWeek.value,
    })
  } catch (err: any) {
    error.value = errorMessage(err, 'Calendar generation failed')
  } finally {
    loading.value = false
    progress.value = null
  }
}

function computeScheduledDate(month: string, week: number, suggestedDay: string, suggestedTime: string): string {
  const DAY_MAP: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
  const firstDay = new Date(month + '-01')
  const targetDow = DAY_MAP[suggestedDay] ?? 1
  const firstDow = firstDay.getDay()
  const offset = (targetDow - firstDow + 7) % 7
  const d = new Date(firstDay)
  d.setDate(1 + offset + (week - 1) * 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${suggestedTime || '09:00'}`
}

function exportCalendarCsv() {
  if (!calendar.value?.posts?.length) return
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const header = ['Platform', 'Week', 'Suggested Day', 'Suggested Time', 'Post Type', 'Content', 'Hashtags']
  const rows = calendar.value.posts.map((p: any) => [
    p.platform, p.week, p.suggestedDay || '', p.suggestedTime || '', p.postType || '', escape(p.content), (p.hashtags || []).join(' '),
  ].join(','))
  const csv = '﻿' + [header.join(','), ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `content-plan-${calendar.value.month}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function draftPost(post: any) {
  composeStore.content = post.content
  if (post.week && post.suggestedDay) {
    composeStore.scheduledAt = computeScheduledDate(selectedMonth.value, post.week, post.suggestedDay, post.suggestedTime || '09:00')
  }
  router.push('/compose')
}

async function saveAllDrafts() {
  if (!calendar.value?.posts?.length) return
  savingAll.value = true
  try {
    for (const post of calendar.value.posts) {
      const scheduledAt = post.week && post.suggestedDay
        ? computeScheduledDate(calendar.value.month, post.week, post.suggestedDay, post.suggestedTime || '09:00')
        : ''
      await axios.post('/api/drafts', {
        content: post.content,
        mediaUrl: '',
        scheduledAt,
        destinations: [],
      })
    }
    alert(`Saved ${calendar.value.posts.length} drafts — find them in Scheduler → Drafts.`)
  } catch {
    error.value = 'Failed to save some drafts'
  } finally {
    savingAll.value = false
  }
}

watch(calendar, () => { refreshSavedPlans() })
onMounted(async () => {
  await Promise.all([platformsStore.fetchMetaConnections(), refreshSavedPlans()])
  if (typeof route.query.calendar === 'string') { selectedSavedPlan.value = route.query.calendar; await loadSavedPlan(route.query.calendar) }
})
</script>
