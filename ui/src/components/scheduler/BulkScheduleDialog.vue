<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" @click.self="!scheduling && $emit('close')" @keydown.esc="!scheduling && $emit('close')">
      <section ref="dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bulk-schedule-title" @keydown.tab="trapFocus" class="bg-gray-900 border border-gray-700 rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col text-gray-100">
        <header class="p-5 border-b border-gray-800">
          <h2 id="bulk-schedule-title" class="text-lg font-semibold">{{ $t('scheduler.bulkSchedule.title') }}</h2>
          <p class="text-sm text-gray-400 mt-1">{{ $t('scheduler.bulkSchedule.explanation') }}</p>
          <label class="block text-xs text-gray-400 mt-4" for="bulk-schedule-timezone">{{ $t('scheduler.bulkSchedule.timezone') }}</label>
          <select id="bulk-schedule-timezone" v-model="timezone" :disabled="scheduling" class="mt-1 max-w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm">
            <option v-for="zone in timezoneOptions" :key="zone.value" :value="zone.value">{{ zone.label }}</option>
          </select>
          <p v-if="!loading" class="text-sm mt-3" role="status">{{ $t('scheduler.bulkSchedule.summary', { ready: readyItems.length, blocked: blockedCount, scheduled: successfulIds.size }) }}</p>
          <p v-if="error" class="text-sm text-red-300 mt-2" role="alert">{{ error }}</p>
        </header>
        <div class="p-5 space-y-3 overflow-y-auto flex-1 min-h-0">
          <p v-if="loading" class="text-sm text-gray-400">{{ $t('scheduler.bulkSchedule.checking') }}</p>
          <article v-for="item in items" v-else :key="item.draftId" class="border border-gray-800 rounded-xl p-3" :data-schedule-draft="item.draftId">
            <p class="text-sm text-gray-200 line-clamp-3 whitespace-pre-wrap break-words">{{ item.content || snapshots.get(item.draftId)?.content || $t('scheduler.emptyDraft') }}</p>
            <template v-if="item.ready">
              <p class="text-xs text-gray-400 mt-2">{{ item.accounts?.map(account => account.name).join(' · ') }}</p>
              <p class="text-xs text-amber-300 mt-1">{{ $t('scheduler.draftPlannedFor') }} {{ formatDraftDate(item.scheduledAt || '', locale, timezone) }}</p>
              <p v-if="item.destinations?.some(destination => destination.imageUrl || destination.videoUrl)" class="text-xs text-blue-300 mt-1">{{ $t('scheduler.bulkSchedule.mediaIncluded') }}</p>
              <p v-if="item.firstComment" class="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{{ $t('scheduler.bulkSchedule.firstComment') }} {{ item.firstComment }}</p>
            </template>
            <p v-if="successfulIds.has(item.draftId)" class="text-xs text-green-300 mt-2">{{ $t(resultFor(item.draftId)?.draftRetained ? 'scheduler.bulkSchedule.scheduledRetained' : 'scheduler.bulkSchedule.scheduled') }}</p>
            <div v-else-if="!item.ready || resultFor(item.draftId)?.success === false" class="mt-2 text-xs text-red-300">
              <p>{{ reasonText(resultFor(item.draftId)?.reason || item.reason) }}</p>
              <router-link :to="`/compose?draft=${item.draftId}`" @click="scheduling ? $event.preventDefault() : $emit('close')" class="inline-block underline mt-1">{{ $t('scheduler.editDraft') }}</router-link>
            </div>
          </article>
        </div>
        <footer class="p-4 border-t border-gray-800 flex flex-wrap justify-end gap-2">
          <button @click="$emit('close')" :disabled="scheduling" class="px-3 py-2 rounded-lg bg-gray-800 text-sm disabled:opacity-50">{{ $t('scheduler.bulkSchedule.close') }}</button>
          <button @click="refreshPreview" :disabled="loading || scheduling" class="px-3 py-2 rounded-lg bg-gray-800 text-sm disabled:opacity-50">{{ $t('scheduler.bulkSchedule.refresh') }}</button>
          <button v-if="successfulIds.size" @click="$emit('viewScheduled')" :disabled="scheduling" class="px-3 py-2 rounded-lg bg-gray-700 text-sm disabled:opacity-50">{{ $t('scheduler.bulkSchedule.viewScheduled') }}</button>
          <button @click="schedule" :disabled="loading || scheduling || !readyItems.length" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-50">{{ scheduling ? $t('scheduler.bulkSchedule.scheduling') : $t('scheduler.bulkSchedule.confirm', { count: readyItems.length }) }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import type { Draft } from '../../stores/compose'
import { COMMON_TIMEZONES, getBrowserTimezone } from '../../utils/timezone'
import { formatDraftDate } from '../../utils/draftDate'

interface PreviewItem {
  draftId: string; ready: boolean; revision?: string; content?: string; firstComment?: string; scheduledAt?: string; reason?: string
  destinations?: { imageUrl?: string; videoUrl?: string }[]
  accounts?: { name: string }[]
}
export interface ScheduleResult { draftId: string; success: boolean; reason?: string; draftRetained?: boolean }
const props = defineProps<{ drafts: Draft[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'scheduled', results: ScheduleResult[]): void; (e: 'viewScheduled'): void }>()
const { t, locale } = useI18n()
const dialog = ref<HTMLElement | null>(null)
const snapshots = new Map(props.drafts.map(draft => [draft._id, draft]))
const timezone = ref(getBrowserTimezone())
const timezoneOptions = COMMON_TIMEZONES.some(zone => zone.value === timezone.value) ? COMMON_TIMEZONES : [{ value: timezone.value, label: timezone.value }, ...COMMON_TIMEZONES]
const items = ref<PreviewItem[]>([]), results = ref<ScheduleResult[]>([])
const loading = ref(false), scheduling = ref(false), error = ref('')
let previewRequest = 0
const resultFor = (id: string) => results.value.find(result => result.draftId === id)
const successfulIds = computed(() => new Set(results.value.filter(result => result.success).map(result => result.draftId)))
const readyItems = computed(() => items.value.filter(item => item.ready && !successfulIds.value.has(item.draftId) && (!resultFor(item.draftId)?.reason || resultFor(item.draftId)?.reason === 'queue_error')))
const blockedCount = computed(() => items.value.length - readyItems.value.length - successfulIds.value.size)
const reasons = ['missing_date','past_date','invalid_date','missing_content','no_destinations','disconnected_account','invalid_media','invalid_post','changed','already_scheduled','not_found','queue_error']
const reasonText = (reason?: string) => t('scheduler.bulkSchedule.reasons.' + (reasons.includes(reason || '') ? reason : 'queue_error'))
function trapFocus(event: KeyboardEvent) {
  const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href]') || [])]
  const first = elements[0], last = elements[elements.length - 1]
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus() }
}
async function refreshPreview() {
  const requestId = ++previewRequest
  loading.value = true; error.value = ''
  try {
    const remaining = [...snapshots.keys()].filter(id => !successfulIds.value.has(id))
    if (!remaining.length) return
    const response = await axios.post('/scheduler/drafts/preview', { draftIds: remaining, timezone: timezone.value })
    if (requestId === previewRequest) {
      items.value = [...items.value.filter(item => successfulIds.value.has(item.draftId)), ...response.data.items]
      results.value = results.value.filter(result => result.success)
    }
  } catch (err: any) { if (requestId === previewRequest) { items.value = items.value.filter(item => successfulIds.value.has(item.draftId)); error.value = err.response?.data?.error || t('scheduler.bulkSchedule.checkFailed') } }
  finally { if (requestId === previewRequest) loading.value = false }
}
async function schedule() {
  if (scheduling.value || loading.value || !readyItems.value.length) return
  scheduling.value = true; error.value = ''
  try {
    const response = await axios.post('/scheduler/drafts/schedule', { timezone: timezone.value, confirmation: 'SCHEDULE', items: readyItems.value.map(item => ({ draftId: item.draftId, revision: item.revision })) })
    const next = response.data.results as ScheduleResult[]
    results.value = [...results.value.filter(result => result.success), ...next]
    emit('scheduled', next)
  } catch { error.value = t('scheduler.bulkSchedule.requestFailed') }
  finally { scheduling.value = false }
}
watch(timezone, refreshPreview)
onMounted(async () => { await nextTick(); dialog.value?.focus(); refreshPreview() })
</script>
