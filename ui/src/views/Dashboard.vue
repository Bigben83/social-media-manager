<template>
  <div class="flex h-screen overflow-hidden bg-gray-950 text-gray-100">

    <!-- Sidebar -->
    <aside class="w-60 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col p-4 gap-6 overflow-y-auto">
      <div>
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
          {{ $t('dashboard.platforms') }}
        </p>
        <button
          v-for="(meta, key) in PLATFORM_META"
          :key="key"
          @click="feedStore.togglePlatform(key)"
          class="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors mb-1"
          :class="feedStore.activePlatforms.has(key)
            ? 'bg-gray-700 text-white'
            : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'"
        >
          <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: meta.color }"></span>
          <span class="truncate">{{ $t(`platforms.${key}`) }}</span>
          <span v-if="platformsStore.isConnected(key)" class="ml-auto w-1.5 h-1.5 rounded-full bg-green-400"></span>
        </button>
      </div>

      <div>
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
          {{ $t('dashboard.tags') }}
        </p>
        <button
          @click="feedStore.activeTag = null"
          class="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm mb-1 transition-colors"
          :class="!feedStore.activeTag ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-800'"
        >
          {{ $t('dashboard.allTags') }}
        </button>
      </div>
    </aside>

    <!-- Ana içerik -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <header class="flex items-center gap-3 px-6 py-4 border-b border-gray-800 bg-gray-900">
        <input
          v-model="feedStore.searchQuery"
          type="text"
          :placeholder="$t('dashboard.searchPlaceholder')"
          class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          @click="handleRefresh"
          :disabled="feedStore.loading"
          class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {{ feedStore.loading ? $t('dashboard.refreshing') : $t('dashboard.refresh') }}
        </button>
        <router-link
          to="/compose"
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium transition-colors"
        >
          {{ $t('dashboard.newPost') }}
        </router-link>
      </header>

      <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div v-if="feedStore.loading && !feedStore.items.length" class="text-center text-gray-500 mt-20">
          {{ $t('dashboard.loading') }}
        </div>

        <div v-else-if="!feedStore.filteredItems.length" class="text-center text-gray-500 mt-20">
          <p class="text-4xl mb-4">📭</p>
          <p>{{ $t('dashboard.empty') }}</p>
          <p class="text-sm mt-1">{{ $t('dashboard.emptyHint') }}</p>
        </div>

        <FeedItem
          v-for="item in feedStore.filteredItems"
          :key="`${item.platform}-${item.originalId}`"
          :item="item"
        />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { io } from 'socket.io-client'
import { useFeedStore } from '../stores/feed'
import { usePlatformsStore } from '../stores/platforms'
import { PLATFORM_META } from '../stores/platforms'
import FeedItem from '../components/feed/FeedItem.vue'

const feedStore = useFeedStore()
const platformsStore = usePlatformsStore()

async function handleRefresh() {
  await feedStore.refreshFeeds()
}

onMounted(async () => {
  await Promise.all([
    feedStore.fetchFeeds(),
    platformsStore.fetchStatuses(),
  ])

  const socket = io()
  socket.on('feed.items', (data: { platform: string; items: unknown[] }) => {
    if (Array.isArray(data.items)) {
      data.items.forEach((item) => feedStore.addItem(item as any))
    }
  })
})
</script>
