<template>
  <article class="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
    <div class="flex items-start gap-3 mb-3">
      <img
        v-if="item.author.avatar"
        :src="item.author.avatar"
        :alt="item.author.name"
        class="w-10 h-10 rounded-full object-cover flex-shrink-0"
      />
      <div v-else class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-lg">
        {{ item.author.name?.[0]?.toUpperCase() || '?' }}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-medium text-sm text-white truncate">{{ item.author.name }}</span>
          <span class="text-gray-500 text-xs truncate">@{{ item.author.username }}</span>
          <span
            class="ml-auto text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
            :style="{ backgroundColor: platformColor + '22', color: platformColor }"
          >
            {{ $t(`platforms.${item.platform}`) }}
          </span>
        </div>
        <p class="text-xs text-gray-500 mt-0.5">{{ timeAgo }}</p>
      </div>
    </div>

    <p class="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words mb-3">{{ item.content }}</p>

    <div v-if="item.media?.length" class="grid gap-2 mb-3" :class="item.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
      <img
        v-for="(m, i) in item.media.slice(0, 4)"
        :key="i"
        :src="m.thumbnail || m.url"
        :alt="m.alt || ''"
        class="rounded-lg w-full h-40 object-cover"
      />
    </div>

    <div v-if="item.platformTags?.length" class="flex flex-wrap gap-1 mb-3">
      <span
        v-for="tag in item.platformTags.slice(0, 5)"
        :key="tag"
        class="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
      >#{{ tag }}</span>
    </div>

    <div class="flex items-center gap-5 text-xs text-gray-500">
      <span v-if="item.metrics.likes">❤️ {{ formatNum(item.metrics.likes) }}</span>
      <span v-if="item.metrics.comments">💬 {{ formatNum(item.metrics.comments) }}</span>
      <span v-if="item.metrics.shares">🔁 {{ formatNum(item.metrics.shares) }}</span>
      <a
        v-if="item.url"
        :href="item.url"
        target="_blank"
        rel="noopener noreferrer"
        class="ml-auto hover:text-gray-300 transition-colors"
      >{{ $t('feed.openOriginal') }}</a>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/tr'
import 'dayjs/locale/en'
import { PLATFORM_META } from '../../stores/platforms'
import type { FeedItem } from '../../stores/feed'

dayjs.extend(relativeTime)

const { locale } = useI18n()
const props = defineProps<{ item: FeedItem }>()

const platformColor = computed(() => PLATFORM_META[props.item.platform]?.color ?? '#6b7280')
const timeAgo = computed(() => dayjs(props.item.createdAt).locale(locale.value).fromNow())

function formatNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}
</script>
