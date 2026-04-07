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
onMounted(fetchJobs)
</script>
