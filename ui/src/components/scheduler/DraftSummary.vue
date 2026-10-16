<template>
  <article class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-w-0 flex flex-col" :data-draft-id="draft._id">
    <label class="px-4 py-2.5 flex items-center gap-2 text-xs text-gray-400 border-b border-gray-800 cursor-pointer">
      <input type="checkbox" :checked="selected" @change="$emit('toggle', draft._id)" class="accent-amber-500" />
      {{ $t('scheduler.bulkSchedule.selectDraft') }}
    </label>
    <div v-if="layout === 'cards'" class="aspect-[4/3] bg-gray-950 flex items-center justify-center overflow-hidden border-b border-gray-800">
      <video v-if="mediaUrl && isVideo && !mediaError" :src="mediaUrl" controls preload="metadata" class="w-full h-full object-contain" :aria-label="$t('scheduler.draftMediaPreview')" @error="mediaError = true" />
      <img v-else-if="mediaUrl && !mediaError" :src="mediaUrl" :alt="$t('scheduler.draftMediaPreview')" loading="lazy" class="w-full h-full object-contain" @error="mediaError = true" />
      <div v-else class="text-gray-500 text-sm p-6 text-center flex flex-col items-center gap-2">
        <svg class="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        <span>{{ $t(mediaUrl ? 'scheduler.draftPreviewUnavailable' : 'scheduler.textOnlyDraft') }}</span>
      </div>
    </div>
    <div class="p-4 flex flex-1 gap-4" :class="layout === 'cards' ? 'flex-col' : 'items-start justify-between'">
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap gap-1.5 mb-3">
          <span v-if="draft.batchId" class="text-xs px-2 py-1 rounded bg-violet-900/50 text-violet-300">✨ AI</span>
          <span v-for="dest in destinations" :key="dest.key" class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full max-w-full" :style="{ backgroundColor: dest.color + '22', color: dest.color }">
            <img v-if="dest.picture" :src="dest.picture" alt="" loading="lazy" class="w-4 h-4 rounded-full object-cover" />
            <span class="truncate">{{ dest.label }}</span>
            <span v-if="dest.instagramPlacement">· {{ $t('instagramPublishing.' + dest.instagramPlacement) }}</span>
            <span class="opacity-75">· {{ platformLabel(dest.platform) }}</span>
          </span>
          <span v-if="!destinations.length" class="text-xs text-gray-500">{{ $t('scheduler.noDraftDestinations') }}</span>
        </div>
        <p class="text-sm text-gray-200 whitespace-pre-wrap break-words mb-3" :class="layout === 'cards' ? 'line-clamp-4' : 'line-clamp-2'">{{ draft.content || $t('scheduler.emptyDraft') }}</p>
        <p v-if="mediaUrl && layout === 'list'" class="text-xs text-blue-400 mb-2 truncate" :title="mediaName">{{ mediaName }}</p>
        <p class="text-xs mb-2" :class="plannedDate ? 'text-amber-300' : 'text-gray-500'">
          <template v-if="plannedDate">{{ $t('scheduler.draftPlannedFor') }} <time :datetime="draft.scheduledAt">{{ plannedDate }}</time></template>
          <span v-else>{{ $t('scheduler.noDraftDate') }}</span>
        </p>
        <p class="text-xs text-gray-500">{{ $t('scheduler.draftUpdated', { date: updatedDate }) }}</p>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0" :class="layout === 'cards' ? 'justify-end border-t border-gray-800 pt-3' : ''">
        <router-link :to="`/compose?draft=${draft._id}`" class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-200 transition-colors">{{ $t('scheduler.editDraft') }}</router-link>
        <button @click="$emit('delete', draft._id)" :aria-label="$t('scheduler.deleteDraft')" :title="$t('scheduler.deleteDraft')" class="text-xs px-2 py-1.5 bg-gray-700 hover:bg-red-700 rounded-lg text-gray-300 hover:text-white transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { draftMediaUrl, type Draft, type Destination } from '../../stores/compose'
import { PLATFORM_META } from '../../stores/platforms'
import { formatDraftDate } from '../../utils/draftDate'

const props = defineProps<{ draft: Draft & { batchId?: string }; destinations: Destination[]; layout: 'list' | 'cards'; selected: boolean }>()
defineEmits<{ (e: 'delete', id: string): void; (e: 'toggle', id: string): void }>()
const { locale } = useI18n()
const mediaUrl = computed(() => draftMediaUrl(props.draft))
const mediaError = ref(false)
watch(mediaUrl, () => { mediaError.value = false })
const isVideo = computed(() => /\.(mp4|mov|avi|webm)(?:[?#]|$)/i.test(mediaUrl.value))
const mediaName = computed(() => { try { return decodeURIComponent(mediaUrl.value.split('/').pop() || '') } catch { return mediaUrl.value } })
const plannedDate = computed(() => formatDraftDate(props.draft.scheduledAt, locale.value))
const updatedDate = computed(() => formatDraftDate(props.draft.updatedAt, locale.value))
const platformLabel = (platform: string) => PLATFORM_META[platform]?.label || platform
</script>
