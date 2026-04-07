<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-2">{{ $t('settings.title') }}</h1>
      <p class="text-sm text-gray-500 mb-8">
        {{ $t('settings.subtitle', { env: '.env' }) }}
      </p>

      <div class="space-y-4">
        <div
          v-for="(meta, key) in PLATFORM_META"
          :key="key"
          class="bg-gray-900 border rounded-xl p-4 transition-colors"
          :class="isConnected(key) ? 'border-gray-700' : 'border-gray-800'"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span
                class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                :style="{ backgroundColor: meta.color }"
              >
                {{ meta.label[0] }}
              </span>
              <div>
                <p class="font-medium text-sm">{{ $t(`platforms.${key}`) }}</p>
                <p v-if="getStatus(key)?.username" class="text-xs text-gray-400">
                  @{{ getStatus(key)?.username }}
                </p>
                <p v-else-if="getStatus(key)?.error" class="text-xs text-red-400">
                  {{ getStatus(key)?.error }}
                </p>
                <p v-else class="text-xs text-gray-600">{{ $t('settings.notConnected') }}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" :class="isConnected(key) ? 'bg-green-400' : 'bg-gray-600'"></span>
              <span class="text-xs" :class="isConnected(key) ? 'text-green-400' : 'text-gray-600'">
                {{ isConnected(key) ? $t('settings.connected') : $t('settings.notConnected') }}
              </span>
            </div>
          </div>

          <div v-if="!isConnected(key)" class="mt-3 bg-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono">
            <span v-if="key === 'twitter'">TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET</span>
            <span v-else-if="key === 'mastodon'">MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN</span>
            <span v-else-if="key === 'bluesky'">BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD</span>
            <span v-else-if="key === 'linkedin'">LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET</span>
            <span v-else-if="key === 'instagram'">INSTAGRAM_ACCESS_TOKEN</span>
            <span v-else-if="key === 'reddit'">REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD</span>
            <span v-else>— {{ $t('settings.envHint') }} —</span>
          </div>
        </div>
      </div>

      <button
        @click="platformsStore.fetchStatuses()"
        class="mt-6 w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors"
      >
        {{ $t('settings.refreshStatus') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'

const platformsStore = usePlatformsStore()

function isConnected(platform: string) {
  return platformsStore.isConnected(platform)
}

function getStatus(platform: string) {
  return platformsStore.getStatus(platform)
}

onMounted(() => platformsStore.fetchStatuses())
</script>
