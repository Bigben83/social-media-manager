<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <div class="max-w-6xl mx-auto px-6 py-8">

      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-white">{{ $t('analytics.title') }}</h1>
          <p class="text-sm text-gray-500 mt-1">{{ $t('analytics.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="crawlMetrics"
            :disabled="crawling"
            class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
          >
            <span :class="{ 'animate-spin': crawling }">⟳</span>
            {{ crawling ? $t('analytics.crawling') : (crawlResult !== null ? $t('analytics.crawlDone', { count: crawlResult }) : $t('analytics.crawlMetrics')) }}
          </button>
          <button
            @click="load"
            :disabled="loading"
            class="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
          >
            <span :class="{ 'animate-spin': loading }">↻</span>
            {{ $t('analytics.refresh') }}
          </button>
        </div>
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
              <p class="flex-1 text-sm line-clamp-2 min-w-0" :class="post.content ? 'text-gray-300' : 'text-gray-600 italic'">
                {{ post.content || $t('analytics.noContent') }}
              </p>

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

      <!-- ── Advanced Insights ─────────────────────────────────── -->
      <div v-if="!loading || summary" class="mt-8 space-y-6">
        <div>
          <h2 class="text-lg font-semibold text-white">{{ $t('analytics.insightsTitle') }}</h2>
          <p class="text-sm text-gray-500 mt-0.5">{{ $t('analytics.insightsSubtitle') }}</p>
        </div>

        <div v-if="insightsLoading" class="flex items-center justify-center h-24 text-gray-500 text-sm">
          {{ $t('analytics.loading') }}
        </div>

        <div v-else-if="!insights || insights.empty" class="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p class="text-gray-400 font-medium">{{ $t('analytics.insightsEmpty') }}</p>
          <p class="text-sm text-gray-600 mt-1">{{ $t('analytics.insightsEmptyHint') }}</p>
        </div>

        <template v-else>

          <!-- Platform Comparison -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 overflow-x-auto">
            <h3 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.platformCompTitle') }}</h3>
            <table class="w-full text-sm min-w-[540px]">
              <thead>
                <tr class="text-xs text-gray-500 border-b border-gray-800">
                  <th class="text-left pb-2 font-normal">Platform</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgEngagement') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgLikes') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgComments') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colAvgShares') }}</th>
                  <th class="text-right pb-2 font-normal">{{ $t('analytics.colTracked') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in insights.platformComparison" :key="row.platform" class="border-b border-gray-800/40 last:border-0">
                  <td class="py-2.5">
                    <span class="flex items-center gap-2">
                      <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: platformColor(row.platform) }"></span>
                      <span class="capitalize text-gray-300">{{ platformLabel(row.platform) }}</span>
                    </span>
                  </td>
                  <td class="py-2.5 text-right font-semibold text-blue-400">{{ row.avgEngagement }}</td>
                  <td class="py-2.5 text-right text-gray-400">{{ row.avgLikes }}</td>
                  <td class="py-2.5 text-right text-gray-400">{{ row.avgComments }}</td>
                  <td class="py-2.5 text-right text-gray-400">{{ row.avgShares }}</td>
                  <td class="py-2.5 text-right text-gray-500">{{ row.totalPosts }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Best Time: By Hour + By Day -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <!-- By Hour -->
            <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div class="flex items-baseline justify-between mb-4">
                <h3 class="text-sm font-semibold text-white">{{ $t('analytics.byHourTitle') }}</h3>
                <span class="text-xs text-gray-500">{{ $t('analytics.bestTimeSubtitle') }}</span>
              </div>
              <svg viewBox="0 0 480 60" preserveAspectRatio="none" class="w-full h-20">
                <g v-for="bar in insights.byHour" :key="bar.hour">
                  <rect
                    :x="bar.hour * 20 + 2"
                    :y="60 - byHourBarH(bar.avgEngagement)"
                    :width="16"
                    :height="byHourBarH(bar.avgEngagement) || 1"
                    :class="bar.avgEngagement === maxByHourAvg && bar.avgEngagement > 0 ? 'fill-green-400' : 'fill-blue-500 opacity-70'"
                    rx="1"
                  >
                    <title>{{ bar.hour }}:00 — avg {{ bar.avgEngagement }}</title>
                  </rect>
                </g>
              </svg>
              <div class="flex justify-between mt-1 text-xs text-gray-600 px-0.5">
                <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
            </div>

            <!-- By Day -->
            <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div class="flex items-baseline justify-between mb-4">
                <h3 class="text-sm font-semibold text-white">{{ $t('analytics.byDayTitle') }}</h3>
                <span class="text-xs text-gray-500">{{ $t('analytics.bestTimeSubtitle') }}</span>
              </div>
              <svg viewBox="0 0 280 60" preserveAspectRatio="none" class="w-full h-20">
                <g v-for="bar in insights.byDay" :key="bar.day">
                  <rect
                    :x="bar.day * 40 + 4"
                    :y="60 - byDayBarH(bar.avgEngagement)"
                    :width="32"
                    :height="byDayBarH(bar.avgEngagement) || 1"
                    :class="bar.avgEngagement === maxByDayAvg && bar.avgEngagement > 0 ? 'fill-green-400' : 'fill-blue-500 opacity-70'"
                    rx="2"
                  >
                    <title>{{ ($t('analytics.dayNamesShort') as string[])[bar.day] }} — avg {{ bar.avgEngagement }}</title>
                  </rect>
                </g>
              </svg>
              <div class="flex justify-between mt-1 text-xs text-gray-600 px-1">
                <span v-for="name in ($t('analytics.dayNamesShort') as string[])" :key="name">{{ name }}</span>
              </div>
            </div>

          </div>

          <!-- Engagement Heatmap -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div class="flex items-baseline justify-between mb-4">
              <h3 class="text-sm font-semibold text-white">{{ $t('analytics.heatmapTitle') }}</h3>
              <span class="text-xs text-gray-500">{{ $t('analytics.heatmapSubtitle') }}</span>
            </div>
            <div class="overflow-x-auto">
              <div class="inline-block min-w-full">
                <!-- Hour axis labels -->
                <div class="flex items-center mb-1" style="padding-left: 28px">
                  <div
                    v-for="h in 24"
                    :key="h"
                    class="shrink-0 text-center text-xs text-gray-600"
                    style="width: 18px"
                  >{{ (h - 1) % 6 === 0 ? String(h - 1) : '' }}</div>
                </div>
                <!-- Day rows -->
                <div v-for="(row, d) in heatmapGrid" :key="d" class="flex items-center gap-px mb-px">
                  <span class="text-xs text-gray-600 shrink-0 text-right pr-1" style="width: 28px">
                    {{ ($t('analytics.dayNamesShort') as string[])[d] }}
                  </span>
                  <div
                    v-for="cell in row"
                    :key="cell.hour"
                    class="shrink-0 rounded-sm"
                    :style="{ width: '18px', height: '14px', background: heatmapCellBg(cell.avg) }"
                    :title="`${($t('analytics.dayNamesShort') as string[])[d]} ${cell.hour}:00 — avg ${cell.avg}`"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Top Performing Posts -->
          <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h3 class="text-sm font-semibold text-white mb-4">{{ $t('analytics.topPostsTitle') }}</h3>
            <div v-if="insights.topPosts.length === 0" class="text-sm text-gray-600">{{ $t('analytics.noTopPosts') }}</div>
            <div v-else class="space-y-0">
              <div
                v-for="post in insights.topPosts"
                :key="post.postId"
                class="flex items-start gap-3 py-3 border-b border-gray-800 last:border-0"
              >
                <span class="shrink-0 w-2 h-2 rounded-full mt-1.5" :style="{ background: platformColor(post.platform) }"></span>
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-gray-500 mb-0.5">{{ platformLabel(post.platform) }} · {{ formatDate(post.publishedAt) }}</p>
                  <p class="text-sm line-clamp-2" :class="post.content ? 'text-gray-300' : 'text-gray-600 italic'">
                    {{ post.content || $t('analytics.noContent') }}
                  </p>
                </div>
                <div class="shrink-0 text-right space-y-0.5">
                  <p class="text-sm font-semibold text-blue-400">{{ post.metrics.engagementTotal }}</p>
                  <p class="text-xs text-gray-600">
                    ❤ {{ post.metrics.likes }} · 💬 {{ post.metrics.comments }}<template v-if="post.metrics.shares"> · ↗ {{ post.metrics.shares }}</template>
                  </p>
                </div>
              </div>
            </div>
          </div>

        </template>
      </div>

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
interface HourStat  { hour: number; avgEngagement: number; count: number }
interface DayEngStat { day: number; avgEngagement: number; count: number }
interface HeatCell  { day: number; hour: number; avg: number; count: number }
interface TopPost {
  platform: string; accountName: string; postId: string
  content: string | null; publishedAt: string
  metrics: { likes: number; comments: number; shares: number; views: number; saves: number; engagementTotal: number }
}
interface PlatformComp {
  platform: string; avgEngagement: number; avgLikes: number; avgComments: number; avgShares: number; totalPosts: number
}
interface Insights {
  empty: boolean
  total?: number
  byHour?: HourStat[]
  byDay?: DayEngStat[]
  heatmap?: HeatCell[]
  topPosts?: TopPost[]
  platformComparison?: PlatformComp[]
}

// ── Chart constants ───────────────────────────────────────────────────────────

const CHART_W = 900
const CHART_H = 80
const DAY_COUNT = 30

// ── State ─────────────────────────────────────────────────────────────────────

const loading     = ref(false)
const loadingMore = ref(false)
const summary     = ref<Summary | null>(null)
const posts       = ref<Post[]>([])
const postsTotal  = ref(0)

const insightsLoading = ref(false)
const insights        = ref<Insights | null>(null)
const crawling        = ref(false)
const crawlResult     = ref<number | null>(null)

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

async function loadInsights() {
  insightsLoading.value = true
  try {
    const res = await axios.get('/api/analytics/insights')
    insights.value = res.data
  } finally {
    insightsLoading.value = false
  }
}

async function crawlMetrics() {
  crawling.value = true
  crawlResult.value = null
  try {
    const res = await axios.post('/api/analytics/crawl')
    crawlResult.value = res.data.total
    await loadInsights()
  } finally {
    crawling.value = false
  }
}

onMounted(() => { load(); loadInsights() })

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

// ── Insights helpers ──────────────────────────────────────────────────────────

const INSIGHT_CHART_H = 57 // SVG height for by-hour / by-day charts

const maxByHourAvg = computed(() =>
  Math.max(...(insights.value?.byHour ?? []).map((b) => b.avgEngagement), 1)
)
const maxByDayAvg = computed(() =>
  Math.max(...(insights.value?.byDay ?? []).map((b) => b.avgEngagement), 1)
)

function byHourBarH(avg: number): number {
  if (!avg) return 0
  return Math.max(3, (avg / maxByHourAvg.value) * INSIGHT_CHART_H * 0.95)
}
function byDayBarH(avg: number): number {
  if (!avg) return 0
  return Math.max(3, (avg / maxByDayAvg.value) * INSIGHT_CHART_H * 0.95)
}

const maxHeatmapAvg = computed(() =>
  Math.max(...(insights.value?.heatmap ?? []).map((c) => c.avg), 1)
)

function heatmapCellBg(avg: number): string {
  if (!avg) return 'rgba(59,130,246,0.05)'
  const intensity = avg / maxHeatmapAvg.value
  return `rgba(59,130,246,${(0.1 + intensity * 0.9).toFixed(2)})`
}

const heatmapGrid = computed<HeatCell[][]>(() => {
  const cells = insights.value?.heatmap ?? []
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => cells[d * 24 + h] ?? { day: d, hour: h, avg: 0, count: 0 })
  )
})

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
