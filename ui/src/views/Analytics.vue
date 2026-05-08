<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <div class="max-w-6xl mx-auto px-6 py-8">

      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-white">{{ $t('analytics.title') }}</h1>
          <p class="text-sm text-gray-500 mt-1">{{ $t('analytics.subtitle') }}</p>
        </div>
        <button
          @click="load"
          :disabled="loading"
          class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
        >
          <span :class="{ 'animate-spin': loading }">↻</span>
          {{ $t('analytics.refresh') }}
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading && !summary" class="flex items-center justify-center h-64 text-gray-500">
        {{ $t('analytics.loading') }}
      </div>

      <!-- Empty state -->
      <div v-else-if="summary && summary.total === 0" class="flex flex-col items-center justify-center h-64 gap-2 text-gray-500">
        <p class="text-lg">{{ $t('analytics.empty') }}</p>
        <p class="text-sm">{{ $t('analytics.emptyHint') }}</p>
      </div>

      <template v-else-if="summary">

        <!-- ── Summary cards ─────────────────────────────────── -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.totalPosts') }}</p>
            <p class="text-3xl font-bold text-white">{{ summary.total }}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.last7Days') }}</p>
            <p class="text-3xl font-bold text-blue-400">{{ summary.recentCount }}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.platformsReached') }}</p>
            <p class="text-3xl font-bold text-purple-400">{{ platformCount }}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p class="text-xs text-gray-500 mb-1">{{ $t('analytics.successRate') }}</p>
            <p class="text-3xl font-bold" :class="summary.successRate >= 80 ? 'text-green-400' : summary.successRate >= 50 ? 'text-yellow-400' : 'text-red-400'">
              {{ summary.successRate }}%
            </p>
          </div>
        </div>

        <!-- ── Posts per Day chart ────────────────────────────── -->
        <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
          <div class="flex items-baseline justify-between mb-4">
            <h2 class="text-sm font-semibold text-white">{{ $t('analytics.postsPerDay') }}</h2>
            <span class="text-xs text-gray-500">{{ $t('analytics.postsPerDaySubtitle') }}</span>
          </div>

          <div v-if="chartDays.every(d => d.count === 0)" class="h-24 flex items-center justify-center text-sm text-gray-600">
            {{ $t('analytics.noActivity') }}
          </div>

          <template v-else>
            <!-- SVG bar chart -->
            <svg
              :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
              preserveAspectRatio="none"
              class="w-full h-28"
            >
              <g v-for="(day, i) in chartDays" :key="day.date">
                <rect
                  :x="i * barSlot + barPad"
                  :y="CHART_H - barH(day.count)"
                  :width="barSlot - barPad * 2"
                  :height="barH(day.count)"
                  class="fill-blue-500 opacity-80 hover:opacity-100 transition-opacity"
                  rx="2"
                >
                  <title>{{ day.date }}: {{ day.count }}</title>
                </rect>
              </g>
            </svg>
            <!-- X-axis labels: show first, middle, last -->
            <div class="flex justify-between mt-1 text-xs text-gray-600">
              <span>{{ chartDays[0]?.date?.slice(5) }}</span>
              <span>{{ chartDays[14]?.date?.slice(5) }}</span>
              <span>{{ chartDays[29]?.date?.slice(5) }}</span>
            </div>
          </template>
        </div>

        <!-- ── Two-column: Platform breakdown + Status breakdown ── -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          <!-- Platform Breakdown -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.platformBreakdown') }}</h2>
            <div v-if="platformEntries.length === 0" class="text-sm text-gray-600">—</div>
            <div v-else class="space-y-3">
              <div v-for="[platform, count] in platformEntries" :key="platform" class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-2">
                    <span
                      class="w-2 h-2 rounded-full"
                      :style="{ background: platformColor(platform) }"
                    ></span>
                    <span class="capitalize text-gray-300">{{ platformLabel(platform) }}</span>
                  </span>
                  <span class="text-gray-500">{{ count }} {{ $t('analytics.successfulPosts') }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    :style="{ width: platformBarWidth(count) + '%', background: platformColor(platform) }"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Status Breakdown -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.statusBreakdown') }}</h2>
            <div class="space-y-3">
              <div class="space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-green-400">{{ $t('analytics.published') }}</span>
                  <span class="text-gray-500">{{ summary.published }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div class="h-full bg-green-500 rounded-full" :style="{ width: statusWidth(summary.published) + '%' }"></div>
                </div>
              </div>
              <div class="space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-yellow-400">{{ $t('analytics.partial') }}</span>
                  <span class="text-gray-500">{{ summary.partial }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div class="h-full bg-yellow-500 rounded-full" :style="{ width: statusWidth(summary.partial) + '%' }"></div>
                </div>
              </div>
              <div class="space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-red-400">{{ $t('analytics.failed') }}</span>
                  <span class="text-gray-500">{{ summary.failed }}</span>
                </div>
                <div class="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div class="h-full bg-red-500 rounded-full" :style="{ width: statusWidth(summary.failed) + '%' }"></div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- ── Recent Posts ───────────────────────────────────── -->
        <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.recentPosts') }}</h2>

          <div v-if="posts.length === 0" class="text-sm text-gray-600">
            {{ $t('analytics.noRecentPosts') }}
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="post in posts"
              :key="String(post._id)"
              class="flex items-start gap-4 py-3 border-b border-gray-800 last:border-0"
            >
              <!-- Content preview -->
              <p class="flex-1 text-sm text-gray-300 line-clamp-2 min-w-0">{{ post.content }}</p>

              <!-- Platforms chips -->
              <div class="flex flex-wrap gap-1 shrink-0">
                <span
                  v-for="platform in postPlatforms(post)"
                  :key="platform"
                  class="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                  :style="{ background: platformColor(platform) }"
                >
                  {{ platformLabel(platform) }}
                </span>
              </div>

              <!-- Date -->
              <span class="text-xs text-gray-600 shrink-0 w-20 text-right">
                {{ formatDate(post.publishedAt) }}
              </span>

              <!-- Status badge -->
              <span
                class="text-xs font-medium px-2 py-0.5 rounded-full shrink-0"
                :class="{
                  'bg-green-900/40 text-green-400': post.status === 'published',
                  'bg-yellow-900/40 text-yellow-400': post.status === 'partial',
                  'bg-red-900/40 text-red-400': post.status === 'failed',
                }"
              >
                {{ $t(`analytics.status${capitalize(post.status)}`) }}
              </span>
            </div>
          </div>

          <!-- Load more -->
          <button
            v-if="posts.length < postsTotal"
            @click="loadMorePosts"
            :disabled="loadingMore"
            class="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm transition-colors"
          >
            {{ $t('analytics.loadMore') }}
          </button>
        </div>

      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { PLATFORM_META } from '../stores/platforms'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayStat { date: string; count: number }
interface Summary {
  total: number
  published: number
  partial: number
  failed: number
  successRate: number
  byPlatform: Record<string, number>
  byDay: DayStat[]
  recentCount: number
}
interface Post {
  _id: unknown
  content: string
  destinations: Array<{ platform: string; accountId?: string }>
  platformResults: Record<string, { success: boolean; error?: string }>
  status: string
  publishedAt: string
  type: string
}

// ── Chart constants ───────────────────────────────────────────────────────────

const CHART_W = 900
const CHART_H = 80
const DAY_COUNT = 30

// ── State ─────────────────────────────────────────────────────────────────────

const loading    = ref(false)
const loadingMore = ref(false)
const summary    = ref<Summary | null>(null)
const posts      = ref<Post[]>([])
const postsTotal = ref(0)

// ── Data loading ──────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    const [sRes, pRes] = await Promise.all([
      axios.get('/api/analytics/summary'),
      axios.get('/api/analytics/posts', { params: { limit: 20 } }),
    ])
    summary.value = sRes.data
    posts.value = pRes.data.posts
    postsTotal.value = pRes.data.total
  } finally {
    loading.value = false
  }
}

async function loadMorePosts() {
  loadingMore.value = true
  try {
    const res = await axios.get('/api/analytics/posts', { params: { limit: 20, skip: posts.value.length } })
    posts.value.push(...res.data.posts)
  } finally {
    loadingMore.value = false
  }
}

onMounted(load)

// ── Chart helpers ─────────────────────────────────────────────────────────────

const chartDays = computed<DayStat[]>(() => {
  const byDate = Object.fromEntries((summary.value?.byDay ?? []).map((d) => [d.date, d.count]))
  return Array.from({ length: DAY_COUNT }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (DAY_COUNT - 1 - i))
    const dateStr = d.toISOString().split('T')[0]
    return { date: dateStr, count: byDate[dateStr] ?? 0 }
  })
})

const maxCount = computed(() => Math.max(...chartDays.value.map((d) => d.count), 1))
const barSlot  = computed(() => CHART_W / DAY_COUNT)
const barPad   = 2

function barH(count: number): number {
  if (count === 0) return 0
  return Math.max(4, (count / maxCount.value) * CHART_H * 0.95)
}

// ── Platform helpers ──────────────────────────────────────────────────────────

const platformEntries = computed(() =>
  Object.entries(summary.value?.byPlatform ?? {}).sort((a, b) => b[1] - a[1])
)

const platformCount = computed(() => Object.keys(summary.value?.byPlatform ?? {}).length)

const maxPlatformCount = computed(() => Math.max(...Object.values(summary.value?.byPlatform ?? {}), 1))

function platformBarWidth(count: number): number {
  return (count / maxPlatformCount.value) * 100
}

function statusWidth(count: number): number {
  return summary.value?.total ? (count / summary.value.total) * 100 : 0
}

function platformColor(platform: string): string {
  return (PLATFORM_META as Record<string, { color: string }>)[platform]?.color ?? '#6b7280'
}

function platformLabel(platform: string): string {
  return (PLATFORM_META as Record<string, { label: string }>)[platform]?.label ?? platform
}

// ── Post helpers ──────────────────────────────────────────────────────────────

function postPlatforms(post: Post): string[] {
  if (post.platformResults) {
    return [...new Set(
      Object.keys(post.platformResults).map((k) => k.split(':')[0])
    )]
  }
  return [...new Set((post.destinations ?? []).map((d) => d.platform))]
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}
</script>
