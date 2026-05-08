<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-3xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">{{ $t('scheduler.title') }}</h1>
        <router-link
          to="/compose"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
        >
          {{ $t('scheduler.newSchedule') }}
        </router-link>
      </div>

      <!-- Top-level mode tabs -->
      <div class="flex gap-1 mb-5 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        <button
          @click="mode = 'scheduled'"
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          :class="mode === 'scheduled' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
        >
          {{ $t('scheduler.scheduledTab') }}
        </button>
        <button
          @click="mode = 'drafts'"
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          :class="mode === 'drafts' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
        >
          {{ $t('scheduler.draftsTab') }}
          <span v-if="drafts.length" class="ml-1.5 text-xs bg-gray-600 px-1.5 py-0.5 rounded-full">{{ drafts.length }}</span>
        </button>
      </div>

      <!-- ── Scheduled jobs panel ── -->
      <template v-if="mode === 'scheduled'">
        <div class="flex gap-2 mb-6">
          <button
            v-for="s in statusOptions"
            :key="s.value"
            @click="activeStatus = s.value"
            class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors border"
            :class="activeStatus === s.value
              ? 'bg-gray-700 border-gray-600 text-white'
              : 'border-gray-800 text-gray-500 hover:border-gray-600'"
          >
            {{ s.label }}
          </button>
        </div>

        <div v-if="loading" class="text-center text-gray-500 mt-20">
          {{ $t('dashboard.loading') }}
        </div>

        <div v-else-if="!jobs.length" class="text-center text-gray-500 mt-20">
          <p class="text-4xl mb-4">📅</p>
          <p>{{ $t('scheduler.noJobs') }}</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="job in jobs"
            :key="job._id"
            class="bg-gray-900 border border-gray-800 rounded-xl p-4"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <p class="text-sm text-gray-200 line-clamp-2 mb-2">{{ job.postId }}</p>
                <div class="flex flex-wrap gap-1 mb-2">
                  <span
                    v-for="p in job.platforms"
                    :key="p"
                    class="text-xs px-2 py-0.5 rounded-full"
                    :style="{ backgroundColor: platformColor(p) + '22', color: platformColor(p) }"
                  >
                    {{ $t(`platforms.${p}`) }}
                  </span>
                </div>
                <p class="text-xs text-gray-500">{{ formatDate(job.scheduledAt) }}</p>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <span class="text-xs px-2 py-1 rounded-full font-medium" :class="statusClass(job.status)">
                  {{ $t(`scheduler.statuses.${job.status}`) }}
                </span>
                <button
                  v-if="job.status === 'pending'"
                  @click="cancelJob(job.bullJobId)"
                  class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors"
                >
                  {{ $t('scheduler.cancel') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Drafts panel ── -->
      <template v-else>
        <div v-if="draftsLoading" class="text-center text-gray-500 mt-20">
          {{ $t('dashboard.loading') }}
        </div>

        <div v-else-if="!drafts.length" class="text-center text-gray-500 mt-20">
          <p class="text-4xl mb-4">📝</p>
          <p>{{ $t('scheduler.noDrafts') }}</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="draft in drafts"
            :key="draft._id"
            class="bg-gray-900 border border-gray-800 rounded-xl p-4"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <!-- Content preview -->
                <p class="text-sm text-gray-200 line-clamp-2 mb-2">
                  {{ draft.content || '(no content)' }}
                </p>

                <!-- Media indicator -->
                <p v-if="draft.mediaUrl" class="text-xs text-blue-400 mb-2 truncate">
                  <svg class="w-3 h-3 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01" />
                  </svg>
                  {{ mediaName(draft.mediaUrl) }}
                </p>

                <!-- Destination tags -->
                <div class="flex flex-wrap gap-1 mb-2">
                  <span
                    v-for="dest in selectedDests(draft)"
                    :key="dest.key"
                    class="text-xs px-2 py-0.5 rounded-full"
                    :style="{ backgroundColor: dest.color + '22', color: dest.color }"
                  >
                    {{ dest.label }}
                  </span>
                </div>

                <!-- Saved at -->
                <p class="text-xs text-gray-600">{{ formatDate(draft.updatedAt) }}</p>
              </div>

              <!-- Actions -->
              <div class="flex items-center gap-2 flex-shrink-0">
                <router-link
                  :to="`/compose?draft=${draft._id}`"
                  class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 transition-colors"
                >
                  {{ $t('scheduler.editDraft') }}
                </router-link>
                <button
                  @click="deleteDraft(draft._id)"
                  class="text-xs px-2 py-1.5 bg-gray-700 hover:bg-red-700 rounded-lg text-gray-400 hover:text-white transition-colors"
                  :title="$t('scheduler.deleteDraft')"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { PLATFORM_META } from '../stores/platforms'

const { t } = useI18n()

interface ScheduledJob {
  _id: string
  postId: string
  platforms: string[]
  scheduledAt: string
  status: string
  bullJobId: string
}

interface DraftDestination {
  key: string
  platform: string
  accountId?: string
  label: string
  color: string
  picture?: string
  selected: boolean
}

interface Draft {
  _id: string
  content: string
  mediaUrl: string
  scheduledAt: string
  destinations: DraftDestination[]
  createdAt: string
  updatedAt: string
}

const mode = ref<'scheduled' | 'drafts'>('scheduled')

// ── Scheduled jobs ──
const jobs = ref<ScheduledJob[]>([])
const loading = ref(false)
const activeStatus = ref('pending')

const statusOptions = computed(() => [
  { value: 'pending',   label: t('scheduler.statuses.pending') },
  { value: 'completed', label: t('scheduler.statuses.completed') },
  { value: 'failed',    label: t('scheduler.statuses.failed') },
  { value: 'cancelled', label: t('scheduler.statuses.cancelled') },
])

async function fetchJobs() {
  loading.value = true
  try {
    const res = await axios.get(`/scheduler/jobs?status=${activeStatus.value}`)
    jobs.value = res.data.jobs || []
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function cancelJob(bullJobId: string) {
  try {
    await axios.delete(`/scheduler/jobs/${bullJobId}`)
    jobs.value = jobs.value.filter((j) => j.bullJobId !== bullJobId)
  } catch (err) {
    console.error(err)
  }
}

// ── Drafts ──
const drafts = ref<Draft[]>([])
const draftsLoading = ref(false)

async function fetchDrafts() {
  draftsLoading.value = true
  try {
    const res = await axios.get('/api/drafts')
    drafts.value = res.data.drafts || []
  } catch (err) {
    console.error(err)
  } finally {
    draftsLoading.value = false
  }
}

async function deleteDraft(id: string) {
  try {
    await axios.delete(`/api/drafts/${id}`)
    drafts.value = drafts.value.filter((d) => d._id !== id)
  } catch (err) {
    console.error(err)
  }
}

function selectedDests(draft: Draft) {
  return (draft.destinations || []).filter((d) => d.selected)
}

function mediaName(url: string) {
  try { return decodeURIComponent(url.split('/').pop() ?? url) } catch { return url }
}

// ── Shared helpers ──
function formatDate(d: string) {
  return dayjs(d).format('D MMM YYYY, HH:mm')
}

function platformColor(p: string) {
  return PLATFORM_META[p]?.color ?? '#6b7280'
}

function statusClass(status: string) {
  return {
    pending:   'bg-yellow-900/40 text-yellow-400',
    running:   'bg-blue-900/40 text-blue-400',
    completed: 'bg-green-900/40 text-green-400',
    failed:    'bg-red-900/40 text-red-400',
    cancelled: 'bg-gray-800 text-gray-500',
  }[status] ?? 'bg-gray-800 text-gray-400'
}

watch(activeStatus, fetchJobs)
watch(mode, (m) => {
  if (m === 'drafts') fetchDrafts()
})
onMounted(() => {
  fetchJobs()
  fetchDrafts()
})
</script>
