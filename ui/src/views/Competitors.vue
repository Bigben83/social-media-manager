<template>
  <div class="p-6 max-w-3xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-white">{{ t('competitors.sectionTitle') }}</h1>
      <p class="text-gray-400 mt-1">{{ t('competitors.sectionSubtitle') }}</p>
    </div>

    <div v-if="competitorStore.error" class="mb-4 p-3 bg-red-900/40 border border-red-700 rounded text-red-300 text-sm">
      {{ competitorStore.error }}
    </div>

    <!-- Competitor cards -->
    <div v-if="competitorStore.competitors.length" class="space-y-4 mb-6">
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

        <!-- AI Summary -->
        <div v-if="competitor.aiSummary" class="mb-3 p-3 bg-gray-700/50 rounded border border-gray-600 text-sm text-gray-200">
          <div class="text-xs text-violet-400 font-medium mb-1">{{ t('competitors.aiSummaryLabel') }}</div>
          {{ competitor.aiSummary }}
        </div>

        <!-- Keywords -->
        <div v-if="competitor.keywords && competitor.keywords.length" class="mt-3">
          <div class="text-xs text-blue-400 font-medium mb-2">{{ t('competitors.keywordsLabel') }}</div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="kw in competitor.keywords"
              :key="kw"
              class="inline-block text-xs px-2 py-0.5 bg-blue-900/40 border border-blue-700/50 text-blue-300 rounded-full"
            >{{ kw }}</span>
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
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCompetitorStore, type Competitor } from '../stores/competitors'

const { t } = useI18n()
const competitorStore = useCompetitorStore()

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
