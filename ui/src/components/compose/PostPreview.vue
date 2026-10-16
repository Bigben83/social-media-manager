<template>
  <div class="h-full flex flex-col">
    <!-- Preview tab strip -->
    <div v-if="selectedDestinations.length > 1" class="flex gap-1 mb-3 flex-wrap">
      <button
        v-for="dest in selectedDestinations"
        :key="dest.key"
        @click="$emit('update:activeKey', dest.key)"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
        :class="activeKey === dest.key ? 'text-white' : 'text-gray-500 hover:text-gray-300 bg-transparent'"
        :style="activeKey === dest.key ? { backgroundColor: dest.color } : {}"
      >
        <img v-if="dest.picture" :src="dest.picture" class="w-4 h-4 rounded-full object-cover" />
        <span v-else class="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold" style="font-size:9px" :style="{ backgroundColor: dest.color }">
          {{ dest.label[0] }}
        </span>
        {{ dest.label }}
      </button>
    </div>

    <!-- No destination selected -->
    <div v-if="!activeDest" class="flex-1 flex flex-col items-center justify-center text-gray-600 text-sm gap-2">
      <span class="text-3xl">👁</span>
      <p>Select an account to see a preview</p>
    </div>

    <!-- Facebook preview -->
    <div v-else-if="activeDest.platform === 'facebook'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900">
      <div class="flex items-center gap-2 p-3">
        <img v-if="activeDest.picture" :src="activeDest.picture" class="w-9 h-9 rounded-full object-cover flex-shrink-0" />
        <div v-else class="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm" style="background:#1877F2">f</div>
        <div>
          <p class="font-semibold text-sm leading-tight">{{ activeDest.label }}</p>
          <p class="text-xs text-gray-400 leading-tight">Just now · <span class="text-gray-400">🌐</span></p>
        </div>
      </div>
      <p v-if="content" class="px-3 pb-3 text-sm whitespace-pre-wrap">{{ content }}</p>
      <p v-else class="px-3 pb-3 text-sm text-gray-300 italic">Start writing to see preview…</p>
      <img v-if="mediaUrl" :src="mediaUrl" class="w-full object-cover max-h-72" @error="imgError = true" />
      <div class="border-t border-gray-100 mx-3"></div>
      <div class="flex px-3 py-2 gap-1 text-gray-500 text-xs">
        <button class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded hover:bg-gray-50 font-medium">👍 Like</button>
        <button class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded hover:bg-gray-50 font-medium">💬 Comment</button>
        <button class="flex-1 flex items-center justify-center gap-1 py-1.5 rounded hover:bg-gray-50 font-medium">↗ Share</button>
      </div>
    </div>

    <!-- Instagram preview -->
    <div v-else-if="activeDest.platform === 'instagram'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900 max-w-sm mx-auto w-full">
      <div class="flex items-center gap-2 p-2.5">
        <img v-if="activeDest.picture" :src="activeDest.picture" class="w-8 h-8 rounded-full object-cover" />
        <span class="font-semibold text-sm">{{ activeDest.label }}</span>
        <span class="ml-auto text-xs">{{ $t('instagramPublishing.' + instagramPlacement) }}</span>
      </div>
      <div class="relative w-full bg-gray-950 overflow-hidden" :style="{ aspectRatio: instagramPlacement === 'feed' ? '3 / 4' : '9 / 16' }">
        <video v-if="isVideo" :src="mediaUrl" :poster="activeDest.coverUrl" controls class="w-full h-full object-contain" />
        <img v-else-if="mediaUrl" :src="mediaUrl" class="w-full h-full object-contain" />
        <div v-if="instagramPlacement !== 'feed'" class="absolute pointer-events-none border border-dashed border-white/60 rounded-lg" style="top:14%;bottom:22%;left:7%;right:14%" />
      </div>
      <p v-if="instagramPlacement !== 'feed'" class="text-xs text-gray-500 px-3 py-2">{{ $t('instagramPublishing.safeArea') }}</p>
      <p v-if="instagramPlacement !== 'story'" class="px-3 pb-3 text-sm whitespace-pre-wrap">{{ content }}</p>
    </div>

    <!-- Twitter/X preview -->
    <div v-else-if="activeDest.platform === 'twitter'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900 p-4">
      <div class="flex gap-3">
        <div class="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white font-bold flex-shrink-0">X</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1 flex-wrap">
            <span class="font-bold text-sm">Twitter / X</span>
            <svg class="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span class="text-gray-400 text-sm">· Just now</span>
          </div>
          <p class="text-sm mt-1 whitespace-pre-wrap">{{ content || 'Start writing…' }}</p>
          <img v-if="mediaUrl" :src="mediaUrl" class="mt-2 rounded-2xl w-full object-cover max-h-52 border border-gray-100" />
          <div class="flex gap-6 text-gray-500 text-sm mt-3">
            <span>💬</span><span>↺</span><span>❤</span><span>↗</span>
          </div>
        </div>
      </div>
    </div>

    <!-- LinkedIn preview -->
    <div v-else-if="activeDest.platform === 'linkedin'" class="bg-white rounded-xl shadow overflow-hidden text-gray-900 p-4">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">in</div>
        <div>
          <p class="font-semibold text-sm leading-tight">Your Name</p>
          <p class="text-xs text-gray-400">Just now · 🌐</p>
        </div>
      </div>
      <p class="text-sm whitespace-pre-wrap mb-3">{{ content || 'Start writing…' }}</p>
      <img v-if="mediaUrl" :src="mediaUrl" class="w-full object-cover rounded max-h-64 mb-3" />
      <div class="border-t border-gray-100 pt-2 flex gap-4 text-gray-500 text-xs">
        <span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span>
      </div>
    </div>

    <!-- Generic preview -->
    <div v-else class="bg-gray-900 rounded-xl shadow overflow-hidden border border-gray-800 p-4">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" :style="{ backgroundColor: activeDest.color }">
          {{ activeDest.label[0] }}
        </div>
        <div>
          <p class="font-semibold text-sm text-white leading-tight">{{ activeDest.label }}</p>
          <p class="text-xs text-gray-500">Just now</p>
        </div>
      </div>
      <p class="text-sm text-gray-300 whitespace-pre-wrap">{{ content || 'Start writing…' }}</p>
      <img v-if="mediaUrl" :src="mediaUrl" class="w-full object-cover rounded-lg mt-3 max-h-52" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Destination } from '../../stores/compose'

const props = defineProps<{
  selectedDestinations: Destination[]
  activeKey: string
  content: string
  mediaUrl: string
}>()

defineEmits<{ (e: 'update:activeKey', key: string): void }>()

const imgError = ref(false)
const isVideo = computed(() => /\.(mp4|mov|avi|webm)(?:[?#]|$)/i.test(props.mediaUrl))
const instagramPlacement = computed(() => activeDest.value?.instagramPlacement || (isVideo.value ? 'reel' : 'feed'))

const activeDest = computed(() =>
  props.selectedDestinations.find((d) => d.key === props.activeKey) ?? props.selectedDestinations[0] ?? null
)
</script>
