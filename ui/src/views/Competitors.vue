<template>
  <div class="p-6 mx-auto" :class="competitorStore.competitors.length === 2 ? 'max-w-6xl' : 'max-w-3xl'">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-white">{{ t('competitors.sectionTitle') }}</h1>
      <p class="text-gray-400 mt-1">{{ t('competitors.sectionSubtitle') }}</p>
    </div>

    <div v-if="competitorStore.error" class="mb-4 p-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
      {{ competitorStore.error }}
    </div>

    <!-- Side-by-side label -->
    <div v-if="competitorStore.competitors.length === 2" class="mb-3 flex items-center gap-2 text-xs text-gray-500">
      <i class="fa-solid fa-table-columns"></i>
      {{ t('competitors.sideBySideMode') }}
    </div>

    <!-- Competitor cards — stacked for 1, side-by-side grid for 2 -->
    <div
      v-if="competitorStore.competitors.length"
      :class="competitorStore.competitors.length === 2 ? 'grid grid-cols-2 gap-4 mb-6 items-start' : 'space-y-4 mb-6'"
    >
      <div
        v-for="competitor in competitorStore.competitors"
        :key="competitor._id"
        class="bg-gray-800 border border-gray-700 rounded-lg p-5"
      >
        <!-- Header row -->
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex-1 min-w-0">
            <template v-if="editingId === competitor._id">
              <input
                v-model="editForm.name"
                class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm mb-2 focus:outline-none focus:border-violet-500"
                :placeholder="t('competitors.namePlaceholder')"
              />
              <input
                v-model="editForm.websiteUrl"
                class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-violet-500"
                :placeholder="t('competitors.websitePlaceholder')"
              />
            </template>
            <template v-else>
              <div class="font-semibold text-white">{{ competitor.name }}</div>
              <a :href="competitor.websiteUrl" target="_blank" rel="noopener" class="text-violet-400 text-sm hover:underline truncate block">{{ competitor.websiteUrl }}</a>
            </template>
          </div>
          <div class="flex gap-2 shrink-0">
            <template v-if="editingId === competitor._id">
              <button @click="saveEdit(competitor._id)" class="text-xs px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded">{{ t('competitors.save') }}</button>
              <button @click="cancelEdit" class="text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">{{ t('competitors.cancel') }}</button>
            </template>
            <template v-else>
              <button @click="startEdit(competitor)" class="text-xs px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">{{ t('competitors.edit') }}</button>
              <button @click="confirmDelete(competitor._id)" class="text-xs px-3 py-1 bg-red-800 hover:bg-red-700 text-white rounded">{{ t('competitors.delete') }}</button>
            </template>
          </div>
        </div>

        <!-- Social URLs collapsible -->
        <details class="mb-3">
          <summary class="text-sm text-gray-400 cursor-pointer hover:text-gray-200 select-none">{{ t('competitors.socialUrls') }}</summary>
          <div class="mt-2 space-y-1.5">
            <div v-for="platform in socialPlatforms" :key="platform.key" class="flex items-center gap-2">
              <i :class="platform.icon" class="w-4 text-center text-gray-400 text-sm"></i>
              <input
                :value="getEditSocialUrl(competitor, platform.key)"
                @change="setSocialUrl(competitor, platform.key, ($event.target as HTMLInputElement).value)"
                @blur="saveSocialUrl(competitor)"
                class="flex-1 bg-gray-700 border border-gray-600 rounded px-2.5 py-1 text-white text-xs focus:outline-none focus:border-violet-500"
                :placeholder="platform.placeholder"
              />
            </div>
          </div>
        </details>

        <!-- Action buttons -->
        <div class="flex flex-wrap gap-2 mb-3">
          <button
            @click="competitorStore.scrapeCompetitor(competitor._id)"
            :disabled="competitorStore.scraping[competitor._id]"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-rotate" :class="{ 'animate-spin': competitorStore.scraping[competitor._id] }"></i>
            {{ competitorStore.scraping[competitor._id] ? t('competitors.scraping') : t('competitors.scrapeNow') }}
          </button>
          <button
            @click="competitorStore.summarizeCompetitor(competitor._id)"
            :disabled="competitorStore.summarizing[competitor._id] || !competitor.scrapedContent.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-wand-magic-sparkles" :class="{ 'animate-pulse': competitorStore.summarizing[competitor._id] }"></i>
            {{ competitorStore.summarizing[competitor._id] ? t('competitors.summarizing') : t('competitors.summarizeAi') }}
          </button>
          <button
            @click="competitorStore.extractKeywords(competitor._id)"
            :disabled="competitorStore.extractingKeywords[competitor._id] || !competitor.scrapedContent.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-tags" :class="{ 'animate-pulse': competitorStore.extractingKeywords[competitor._id] }"></i>
            {{ competitorStore.extractingKeywords[competitor._id] ? t('competitors.extractingKeywords') : t('competitors.extractKeywords') }}
          </button>
          <button
            @click="competitorStore.analyzeGaps(competitor._id)"
            :disabled="competitorStore.analyzingGaps[competitor._id] || !competitor.keywords?.length"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-code-compare" :class="{ 'animate-pulse': competitorStore.analyzingGaps[competitor._id] }"></i>
            {{ competitorStore.analyzingGaps[competitor._id] ? t('competitors.analyzingGaps') : t('competitors.analyzeGaps') }}
          </button>
          <button
            @click="competitorStore.generateRoadmap(competitor._id)"
            :disabled="competitorStore.generatingRoadmap[competitor._id] || (!competitor.keywords?.length && !competitor.scrapedContent.length)"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i class="fa-solid fa-map" :class="{ 'animate-pulse': competitorStore.generatingRoadmap[competitor._id] }"></i>
            {{ competitorStore.generatingRoadmap[competitor._id] ? t('competitors.generatingRoadmap') : t('competitors.generateRoadmap') }}
          </button>
        </div>

        <!-- Scrape result message -->
        <div v-if="competitorStore.scrapeResults[competitor._id]" class="mb-3 text-xs px-3 py-1.5 rounded" :class="competitorStore.scrapeResults[competitor._id].ok ? 'bg-green-900/40 text-green-300' : 'bg-amber-900/40 text-amber-300'">
          {{ competitorStore.scrapeResults[competitor._id].ok
            ? (competitorStore.scrapeResults[competitor._id].sources > 0
                ? t('competitors.scrapeSuccess', { count: competitorStore.scrapeResults[competitor._id].sources })
                : t('competitors.scrapeNoContent'))
            : competitorStore.scrapeResults[competitor._id].message }}
        </div>

        <!-- Last scraped -->
        <div v-if="competitor.lastScraped" class="text-xs text-gray-500 mb-3">
          {{ t('competitors.lastScraped') }}: {{ new Date(competitor.lastScraped).toLocaleString() }}
        </div>

        <!-- Structured AI Analysis -->
        <div v-if="competitor.aiAnalysis" class="mt-3 space-y-3">
          <!-- Tone & Positioning -->
          <div class="p-3 bg-gray-700/50 rounded border border-gray-600 space-y-2">
            <div class="text-xs text-violet-400 font-medium">{{ t('competitors.aiAnalysisLabel') }}</div>
            <div v-if="competitor.aiAnalysis.tone" class="text-sm">
              <span class="text-xs text-gray-400">{{ t('competitors.analysisTone') }}: </span>
              <span class="text-gray-200 italic">{{ competitor.aiAnalysis.tone }}</span>
            </div>
            <div v-if="competitor.aiAnalysis.positioning" class="text-sm">
              <span class="text-xs text-gray-400">{{ t('competitors.analysisPositioning') }}: </span>
              <span class="text-gray-200">{{ competitor.aiAnalysis.positioning }}</span>
            </div>
          </div>

          <!-- Content Themes -->
          <div v-if="competitor.aiAnalysis.themes?.length">
            <div class="text-xs text-gray-400 mb-1.5">{{ t('competitors.analysisThemes') }}</div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="theme in competitor.aiAnalysis.themes"
                :key="theme"
                class="text-xs px-2 py-0.5 bg-gray-700 border border-gray-600 text-gray-300 rounded-full"
              >{{ theme }}</span>
            </div>
          </div>

          <!-- Gaps & Opportunities -->
          <div v-if="competitor.aiAnalysis.gaps?.length">
            <div class="text-xs text-amber-400 font-medium mb-1.5">{{ t('competitors.analysisGaps') }}</div>
            <ul class="space-y-1">
              <li
                v-for="gap in competitor.aiAnalysis.gaps"
                :key="gap"
                class="flex gap-1.5 items-start text-xs text-amber-200"
              >
                <span class="text-amber-400 mt-0.5 shrink-0">→</span>{{ gap }}
              </li>
            </ul>
          </div>

          <!-- Differentiation Moves -->
          <div v-if="competitor.aiAnalysis.moves?.length">
            <div class="text-xs text-green-400 font-medium mb-1.5">{{ t('competitors.analysisMoves') }}</div>
            <ul class="space-y-1">
              <li
                v-for="move in competitor.aiAnalysis.moves"
                :key="move"
                class="flex gap-1.5 items-start text-xs text-green-200"
              >
                <span class="text-green-400 mt-0.5 shrink-0">✓</span>{{ move }}
              </li>
            </ul>
          </div>
        </div>

        <!-- Legacy plain-text summary (for competitors analysed before this update) -->
        <div v-else-if="competitor.aiSummary" class="mb-3 p-3 bg-gray-700/50 rounded border border-gray-600 text-sm text-gray-200">
          <div class="text-xs text-violet-400 font-medium mb-1">{{ t('competitors.aiSummaryLabel') }}</div>
          {{ competitor.aiSummary }}
        </div>

        <!-- Keywords -->
        <div v-if="competitor.keywords && competitor.keywords.length" class="mt-3">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-blue-400 font-medium">{{ t('competitors.keywordsLabel') }}</div>
            <div class="flex items-center gap-2.5">
              <span v-for="intent in KEYWORD_INTENTS" :key="intent.key" class="flex items-center gap-1 text-xs text-gray-400">
                <span :class="intent.dot" class="w-1.5 h-1.5 rounded-full shrink-0"></span>{{ t(`competitors.intent_${intent.key}`) }}
              </span>
            </div>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="kw in competitor.keywords"
              :key="typeof kw === 'string' ? kw : kw.term"
              :class="typeof kw === 'string' ? 'bg-blue-900/40 border-blue-700/50 text-blue-300' : intentChipClass(kw.intent)"
              :title="typeof kw === 'string' ? '' : t(`competitors.intent_${kw.intent}`)"
              class="inline-block text-xs px-2 py-0.5 border rounded-full cursor-default"
            >{{ typeof kw === 'string' ? kw : kw.term }}</span>
          </div>
        </div>

        <!-- Gap Analysis -->
        <div v-if="competitor.gapAnalysis" class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-orange-400 font-medium">{{ t('competitors.gapAnalysisLabel') }}</div>
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span class="text-orange-300">{{ competitor.gapAnalysis.gaps.length }} {{ t('competitors.gapCount') }}</span>
              <span>·</span>
              <span class="text-green-400">{{ competitor.gapAnalysis.covered.length }} {{ t('competitors.coveredCount') }}</span>
              <span>·</span>
              <span>{{ new Date(competitor.gapAnalysis.lastAnalyzed).toLocaleDateString() }}</span>
            </div>
          </div>

          <!-- Warning when no hashtag data exists -->
          <div v-if="competitor.gapAnalysis.hashtagStatsEmpty" class="mb-2 p-2.5 bg-amber-900/30 border border-amber-700/50 rounded text-xs text-amber-300">
            {{ t('competitors.gapNoHashtagStats') }}
          </div>

          <!-- Gap keywords (missing from your content) -->
          <div v-if="competitor.gapAnalysis.gaps.length" class="mb-3">
            <div class="text-xs text-gray-400 mb-1.5">{{ t('competitors.gapMissing') }}</div>
            <!-- Double-danger note: keywords both competitors target -->
            <div
              v-if="sharedGapTerms.size > 0 && competitor.gapAnalysis.gaps.some(g => sharedGapTerms.has(g.term))"
              class="mb-2 flex items-center gap-1.5 text-xs text-rose-400"
            >
              <i class="fa-solid fa-triangle-exclamation"></i>
              {{ t('competitors.sharedGapsNote', { name: otherCompetitorName(competitor._id) }) }}
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="gap in competitor.gapAnalysis.gaps"
                :key="gap.term"
                :class="sharedGapTerms.has(gap.term)
                  ? 'bg-rose-900/40 border-rose-600/70 text-rose-300'
                  : intentChipClass(gap.intent)"
                :title="sharedGapTerms.has(gap.term)
                  ? t('competitors.sharedGapTitle', { name: otherCompetitorName(competitor._id) })
                  : t(`competitors.intent_${gap.intent}`)"
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 border rounded-full"
              >
                <i v-if="sharedGapTerms.has(gap.term)" class="fa-solid fa-triangle-exclamation text-[9px]"></i>
                <span v-else class="opacity-60 text-[10px]">{{ gap.intent[0].toUpperCase() }}</span>
                {{ gap.term }}
              </span>
            </div>
          </div>
          <div v-else class="mb-3 text-xs text-green-400">{{ t('competitors.gapNoneFound') }}</div>

          <!-- Covered keywords (you already have these) -->
          <details v-if="competitor.gapAnalysis.covered.length" class="group">
            <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-200 select-none">
              {{ t('competitors.gapCoveredToggle', { count: competitor.gapAnalysis.covered.length }) }}
            </summary>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="item in competitor.gapAnalysis.covered"
                :key="item.term"
                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-900/30 border border-green-700/40 text-green-300 rounded-full"
                :title="item.matchedHashtags.join(', ')"
              >
                <i class="fa-solid fa-check text-[9px]"></i>{{ item.term }}
              </span>
            </div>
          </details>
        </div>

        <!-- Content Roadmap -->
        <div v-if="competitor.contentRoadmap?.length" class="mt-4">
          <div class="text-xs text-emerald-400 font-medium mb-2">{{ t('competitors.roadmapLabel') }}</div>
          <div class="space-y-2">
            <div
              v-for="(post, idx) in competitor.contentRoadmap"
              :key="idx"
              class="p-3 bg-gray-700/50 rounded border border-gray-600"
            >
              <div class="flex items-start justify-between gap-3 mb-1.5">
                <div class="text-xs font-semibold text-emerald-300">{{ post.topic }}</div>
                <button
                  @click="draftPost(post.headline)"
                  class="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 bg-violet-700 hover:bg-violet-600 text-white rounded"
                >
                  <i class="fa-solid fa-pen-to-square"></i>
                  {{ t('competitors.roadmapDraft') }}
                </button>
              </div>
              <p class="text-sm text-gray-200 mb-2">{{ post.headline }}</p>
              <div v-if="post.rationale" class="text-xs text-gray-400 italic mb-2">{{ post.rationale }}</div>
              <div v-if="post.keywords?.length" class="flex flex-wrap gap-1">
                <span
                  v-for="kw in post.keywords"
                  :key="kw"
                  class="text-xs px-1.5 py-0.5 bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 rounded"
                >{{ kw }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!competitorStore.loading" class="mb-6 p-8 text-center bg-gray-800 border border-gray-700 rounded-lg text-gray-400">
      {{ t('competitors.emptyState') }}
    </div>

    <!-- Add competitor form -->
    <div v-if="competitorStore.competitors.length < 2" class="bg-gray-800 border border-gray-700 rounded-lg p-5">
      <h2 class="text-sm font-semibold text-white mb-3">{{ t('competitors.addCompetitor') }}</h2>
      <div class="space-y-2">
        <input
          v-model="newForm.name"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          :placeholder="t('competitors.namePlaceholder')"
        />
        <input
          v-model="newForm.websiteUrl"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          :placeholder="t('competitors.websitePlaceholder')"
        />
      </div>
      <button
        @click="createCompetitor"
        :disabled="!newForm.name.trim() || !newForm.websiteUrl.trim()"
        class="mt-3 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {{ t('competitors.addButton') }}
      </button>
    </div>
    <p v-else class="text-xs text-gray-500 text-center">{{ t('competitors.maxReached') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCompetitorStore, type Competitor, type KeywordIntent } from '../stores/competitors'
import { useComposeStore } from '../stores/compose'

const { t } = useI18n()
const router = useRouter()
const competitorStore = useCompetitorStore()
const composeStore = useComposeStore()

function draftPost(headline: string) {
  composeStore.content = headline
  router.push('/compose')
}

// Set of gap terms that appear in BOTH competitors' gap analyses — "double danger"
const sharedGapTerms = computed<Set<string>>(() => {
  const cs = competitorStore.competitors
  if (cs.length < 2) return new Set()
  const gaps0 = new Set(cs[0].gapAnalysis?.gaps.map((g) => g.term) ?? [])
  const gaps1 = new Set(cs[1].gapAnalysis?.gaps.map((g) => g.term) ?? [])
  return new Set([...gaps0].filter((t) => gaps1.has(t)))
})

function otherCompetitorName(currentId: string): string {
  return competitorStore.competitors.find((c) => c._id !== currentId)?.name ?? ''
}

const KEYWORD_INTENTS = [
  { key: 'informational', dot: 'bg-blue-400' },
  { key: 'commercial',    dot: 'bg-violet-400' },
  { key: 'transactional', dot: 'bg-green-400' },
  { key: 'navigational',  dot: 'bg-gray-400' },
]

const INTENT_CHIP_CLASSES: Record<KeywordIntent, string> = {
  informational: 'bg-blue-900/40 border-blue-700/50 text-blue-300',
  commercial:    'bg-violet-900/40 border-violet-700/50 text-violet-300',
  transactional: 'bg-green-900/40 border-green-700/50 text-green-300',
  navigational:  'bg-gray-700 border-gray-600 text-gray-300',
}

function intentChipClass(intent: string): string {
  return INTENT_CHIP_CLASSES[intent as KeywordIntent] ?? INTENT_CHIP_CLASSES.informational
}

const socialPlatforms = [
  { key: 'twitter',   icon: 'fa-brands fa-x-twitter',  placeholder: 'https://twitter.com/username' },
  { key: 'facebook',  icon: 'fa-brands fa-facebook',   placeholder: 'https://facebook.com/page' },
  { key: 'instagram', icon: 'fa-brands fa-instagram',  placeholder: 'https://instagram.com/username' },
  { key: 'linkedin',  icon: 'fa-brands fa-linkedin',   placeholder: 'https://linkedin.com/company/name' },
  { key: 'bluesky',   icon: 'fa-brands fa-bluesky',    placeholder: 'https://bsky.app/profile/handle.bsky.social' },
  { key: 'mastodon',  icon: 'fa-brands fa-mastodon',   placeholder: 'https://mastodon.social/@username' },
  { key: 'tiktok',    icon: 'fa-brands fa-tiktok',     placeholder: 'https://tiktok.com/@username' },
  { key: 'youtube',   icon: 'fa-brands fa-youtube',    placeholder: 'https://youtube.com/@channel' },
  { key: 'pinterest', icon: 'fa-brands fa-pinterest',  placeholder: 'https://pinterest.com/username' },
]

const newForm = reactive({ name: '', websiteUrl: '' })
const editingId = ref<string | null>(null)
const editForm = reactive({ name: '', websiteUrl: '' })
const pendingSocialUrls = reactive<Record<string, Record<string, string>>>({})

function getEditSocialUrl(competitor: Competitor, platform: string): string {
  return pendingSocialUrls[competitor._id]?.[platform] ?? competitor.socialUrls?.[platform] ?? ''
}

function setSocialUrl(competitor: Competitor, platform: string, value: string) {
  if (!pendingSocialUrls[competitor._id]) pendingSocialUrls[competitor._id] = {}
  pendingSocialUrls[competitor._id][platform] = value
}

async function saveSocialUrl(competitor: Competitor) {
  if (!pendingSocialUrls[competitor._id]) return
  const merged = { ...competitor.socialUrls }
  for (const [k, v] of Object.entries(pendingSocialUrls[competitor._id])) {
    if (v) merged[k] = v
    else delete merged[k]
  }
  await competitorStore.updateCompetitor(competitor._id, { socialUrls: merged })
}

async function createCompetitor() {
  if (!newForm.name.trim() || !newForm.websiteUrl.trim()) return
  const ok = await competitorStore.addCompetitor({ name: newForm.name.trim(), websiteUrl: newForm.websiteUrl.trim() })
  if (ok) {
    newForm.name = ''
    newForm.websiteUrl = ''
  }
}

function startEdit(competitor: Competitor) {
  editingId.value = competitor._id
  editForm.name = competitor.name
  editForm.websiteUrl = competitor.websiteUrl
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  await competitorStore.updateCompetitor(id, { name: editForm.name.trim(), websiteUrl: editForm.websiteUrl.trim() })
  editingId.value = null
}

async function confirmDelete(id: string) {
  if (confirm(t('competitors.confirmDelete'))) {
    await competitorStore.deleteCompetitor(id)
  }
}

onMounted(() => {
  competitorStore.fetchCompetitors()
})
</script>
