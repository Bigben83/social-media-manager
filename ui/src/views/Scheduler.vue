<template>
  <div class="h-screen flex flex-col overflow-hidden bg-gray-950 text-gray-100">

    <!-- Header + tabs — always constrained, never scrolls -->
    <div class="flex-shrink-0 max-w-3xl mx-auto w-full px-6 pt-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">{{ $t('scheduler.title') }}</h1>
        <router-link
          to="/compose"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
        >
          {{ $t('scheduler.newSchedule') }}
        </router-link>
      </div>

      <div class="flex gap-1 mb-5 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        <button
          v-for="tab in modeTabs"
          :key="tab.value"
          @click="mode = tab.value"
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
          :class="mode === tab.value ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'"
        >
          {{ tab.label }}
          <span v-if="tab.badge" class="text-xs bg-gray-600 px-1.5 py-0.5 rounded-full">{{ tab.badge }}</span>
        </button>
      </div>
    </div>

    <!-- ── Scheduled panel — scrollable, constrained width ── -->
    <template v-if="mode === 'scheduled'">
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <div class="max-w-3xl mx-auto">
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

    <!-- ── Calendar panel — full width, full remaining height ── -->
    <template v-else-if="mode === 'calendar'">
      <div class="flex-1 min-h-0 flex flex-col px-6 pb-6">

        <!-- Month navigation -->
        <div class="flex-shrink-0 flex items-center gap-3 mb-4">
          <button
            @click="prevMonth"
            class="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-300"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span class="text-lg font-semibold flex-1 text-center">{{ calMonthLabel }}</span>
          <button
            @click="goToToday"
            class="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 transition-colors"
          >
            {{ $t('scheduler.goToToday') }}
          </button>
          <button
            @click="nextMonth"
            class="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-300"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <!-- Week day headers -->
        <div class="flex-shrink-0 grid grid-cols-7 gap-1 mb-1">
          <div
            v-for="d in weekDays"
            :key="d"
            class="text-center text-xs font-medium text-gray-600 py-1.5"
          >
            {{ d }}
          </div>
        </div>

        <!-- Scrollable area: grid + optional day panel -->
        <div class="flex-1 min-h-0 overflow-y-auto">

          <!-- Loading skeleton -->
          <div v-if="calendarLoading" class="grid grid-cols-7 gap-1 h-full">
            <div v-for="i in 35" :key="i" class="rounded-xl bg-gray-900 animate-pulse" />
          </div>

          <template v-else>
            <!-- Calendar grid — fills full height when no day selected -->
            <div
              class="grid grid-cols-7 gap-1"
              :style="calendarGridStyle"
            >
              <div
                v-for="(day, i) in calendarDays"
                :key="i"
                @click="selectDay(day)"
                class="rounded-xl p-1.5 transition-colors border"
                :class="[
                  day.day ? 'cursor-pointer hover:bg-gray-800 hover:border-gray-700' : 'cursor-default',
                  day.isToday ? 'border-blue-600/50 bg-blue-950/20' : 'border-transparent bg-gray-900',
                  selectedDate === day.date ? 'ring-1 ring-gray-500 bg-gray-800 border-gray-700' : '',
                ]"
              >
                <template v-if="day.day">
                  <span
                    class="text-xs font-medium block mb-0.5"
                    :class="day.isToday ? 'text-blue-400' : 'text-gray-400'"
                  >
                    {{ day.day }}
                  </span>
                  <div>
                    <div
                      v-for="job in day.jobs.slice(0, 3)"
                      :key="job._id"
                      class="text-xs truncate rounded px-1 py-0.5 mt-0.5 leading-tight"
                      :style="{ backgroundColor: firstPlatformColor(job) + '2a', color: firstPlatformColor(job) }"
                    >
                      {{ formatTime(job.scheduledAt) }}
                    </div>
                    <div v-if="day.jobs.length > 3" class="text-xs text-gray-600 mt-0.5 px-1">
                      +{{ day.jobs.length - 3 }}
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Selected day detail panel -->
            <transition
              enter-active-class="transition-all duration-200 ease-out"
              enter-from-class="opacity-0 translate-y-2"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition-all duration-150 ease-in"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div v-if="selectedDayData" class="mt-4 bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <p class="text-sm font-semibold text-gray-200">{{ selectedDayLabel }}</p>
                  <button
                    @click="selectedDate = null"
                    class="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-xs"
                  >
                    ✕
                  </button>
                </div>

                <div v-if="!selectedDayData.jobs.length" class="px-4 py-6 text-center text-sm text-gray-600">
                  {{ $t('scheduler.noJobsDay') }}
                </div>

                <div v-else class="divide-y divide-gray-800">
                  <div
                    v-for="job in selectedDayData.jobs"
                    :key="job._id"
                    class="px-4 py-3 flex items-start justify-between gap-4"
                  >
                    <div class="flex-1 min-w-0">
                      <p class="text-xs text-gray-500 mb-1 font-mono">{{ formatTime(job.scheduledAt) }}</p>
                      <p class="text-sm text-gray-200 line-clamp-2 mb-2">{{ job.postId }}</p>
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="p in job.platforms"
                          :key="p"
                          class="text-xs px-2 py-0.5 rounded-full"
                          :style="{ backgroundColor: platformColor(p) + '22', color: platformColor(p) }"
                        >
                          {{ $t(`platforms.${p}`) }}
                        </span>
                      </div>
                    </div>
                    <button
                      v-if="job.status === 'pending'"
                      @click="cancelCalendarJob(job.bullJobId)"
                      class="text-xs text-red-400 hover:text-red-300 flex-shrink-0 px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                    >
                      {{ $t('scheduler.cancel') }}
                    </button>
                  </div>
                </div>
              </div>
            </transition>
          </template>
        </div>

      </div>
    </template>

    <!-- ── Drafts panel — scrollable, constrained width ── -->
    <template v-else>
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        <div class="max-w-3xl mx-auto">
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
                  <p class="text-sm text-gray-200 line-clamp-2 mb-2">
                    {{ draft.content || '(no content)' }}
                  </p>
                  <p v-if="draft.mediaUrl" class="text-xs text-blue-400 mb-2 truncate">
                    <svg class="w-3 h-3 inline-block mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01" />
                    </svg>
                    {{ mediaName(draft.mediaUrl) }}
                  </p>
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
                  <p class="text-xs text-gray-600">{{ formatDate(draft.updatedAt) }}</p>
                </div>
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
                  >
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import dayjs from 'dayjs'
import { PLATFORM_META } from '../stores/platforms'

const { t, tm } = useI18n()

// ── Types ──────────────────────────────────────────────────────────────────────

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
  selected: boolean
}

interface Draft {
  _id: string
  content: string
  mediaUrl: string
  scheduledAt: string
  destinations: DraftDestination[]
  updatedAt: string
}

interface CalendarDay {
  day: number | null
  date: string | null
  isToday: boolean
  jobs: ScheduledJob[]
}

// ── Mode ───────────────────────────────────────────────────────────────────────

const mode = ref<'scheduled' | 'calendar' | 'drafts'>('scheduled')

const modeTabs = computed(() => [
  { value: 'scheduled' as const, label: t('scheduler.scheduledTab'), badge: null },
  { value: 'calendar'  as const, label: t('scheduler.calendarTab'),  badge: null },
  { value: 'drafts'    as const, label: t('scheduler.draftsTab'),    badge: drafts.value.length || null },
])

// ── Scheduled jobs ─────────────────────────────────────────────────────────────

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

// ── Calendar ───────────────────────────────────────────────────────────────────

const calMonth = ref(dayjs().startOf('month'))
const selectedDate = ref<string | null>(null)
const calendarJobs = ref<ScheduledJob[]>([])
const calendarLoading = ref(false)

const weekDays = computed(() => tm('scheduler.weekDaysShort') as string[])
const calMonthNames = computed(() => tm('scheduler.months') as string[])

const calMonthLabel = computed(
  () => `${calMonthNames.value[calMonth.value.month()]} ${calMonth.value.year()}`
)

const calendarDays = computed((): CalendarDay[] => {
  const days: CalendarDay[] = []
  const daysInMonth = calMonth.value.daysInMonth()
  const firstDow = calMonth.value.day()
  const offset = (firstDow + 6) % 7   // Monday-first

  for (let i = 0; i < offset; i++) {
    days.push({ day: null, date: null, isToday: false, jobs: [] })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = calMonth.value.date(d)
    const dateStr = date.format('YYYY-MM-DD')
    days.push({
      day: d,
      date: dateStr,
      isToday: date.isSame(dayjs(), 'day'),
      jobs: calendarJobs.value.filter(
        (j) => dayjs(j.scheduledAt).format('YYYY-MM-DD') === dateStr
      ),
    })
  }
  while (days.length % 7 !== 0) {
    days.push({ day: null, date: null, isToday: false, jobs: [] })
  }
  return days
})

// Grid style: fill 100% height when no day is selected; auto otherwise (so day panel scrolls in)
const calendarGridStyle = computed(() => ({
  gridTemplateRows: `repeat(${calendarDays.value.length / 7}, 1fr)`,
  height: selectedDate.value ? 'auto' : '100%',
  minHeight: selectedDate.value ? undefined : '100%',
}))

const selectedDayData = computed(() => {
  if (!selectedDate.value) return null
  return calendarDays.value.find((d) => d.date === selectedDate.value) ?? null
})

const selectedDayLabel = computed(() => {
  if (!selectedDate.value) return ''
  const d = dayjs(selectedDate.value)
  return `${d.date()} ${calMonthNames.value[d.month()]} ${d.year()}`
})

function selectDay(day: CalendarDay) {
  if (!day.day || !day.date) return
  selectedDate.value = selectedDate.value === day.date ? null : day.date
}

function prevMonth() {
  calMonth.value = calMonth.value.subtract(1, 'month')
  selectedDate.value = null
}

function nextMonth() {
  calMonth.value = calMonth.value.add(1, 'month')
  selectedDate.value = null
}

function goToToday() {
  calMonth.value = dayjs().startOf('month')
  selectedDate.value = null
}

async function fetchCalendarJobs() {
  calendarLoading.value = true
  try {
    const res = await axios.get('/scheduler/jobs?status=pending')
    calendarJobs.value = res.data.jobs || []
  } catch (err) {
    console.error(err)
  } finally {
    calendarLoading.value = false
  }
}

async function cancelCalendarJob(bullJobId: string) {
  try {
    await axios.delete(`/scheduler/jobs/${bullJobId}`)
    calendarJobs.value = calendarJobs.value.filter((j) => j.bullJobId !== bullJobId)
  } catch (err) {
    console.error(err)
  }
}

// ── Drafts ─────────────────────────────────────────────────────────────────────

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

// ── Shared helpers ─────────────────────────────────────────────────────────────

function formatDate(d: string) {
  return dayjs(d).format('D MMM YYYY, HH:mm')
}

function formatTime(d: string) {
  return dayjs(d).format('HH:mm')
}

function platformColor(p: string) {
  return PLATFORM_META[p]?.color ?? '#6b7280'
}

function firstPlatformColor(job: ScheduledJob) {
  return platformColor(job.platforms?.[0] ?? '')
}

function statusClass(status: string) {
  return ({
    pending:   'bg-yellow-900/40 text-yellow-400',
    running:   'bg-blue-900/40 text-blue-400',
    completed: 'bg-green-900/40 text-green-400',
    failed:    'bg-red-900/40 text-red-400',
    cancelled: 'bg-gray-800 text-gray-500',
  } as Record<string, string>)[status] ?? 'bg-gray-800 text-gray-400'
}

// ── Watchers & lifecycle ───────────────────────────────────────────────────────

watch(activeStatus, fetchJobs)
watch(mode, (m) => {
  if (m === 'drafts') fetchDrafts()
  if (m === 'calendar') fetchCalendarJobs()
})

onMounted(() => {
  fetchJobs()
  fetchDrafts()
  fetchCalendarJobs()
})
</script>
