<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto">
      <h1 class="text-2xl font-bold mb-6">{{ $t('compose.title') }}</h1>

      <!-- Platform seçimi -->
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <p class="text-sm text-gray-400 mb-3">{{ $t('compose.platformsLabel') }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="(meta, key) in PLATFORM_META"
            :key="key"
            @click="composeStore.togglePlatform(key)"
            class="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all border"
            :class="composeStore.selectedPlatforms.includes(key)
              ? 'text-white border-transparent'
              : 'text-gray-500 border-gray-700 hover:border-gray-500'"
            :style="composeStore.selectedPlatforms.includes(key)
              ? { backgroundColor: meta.color, borderColor: meta.color }
              : {}"
          >
            {{ $t(`platforms.${key}`) }}
            <span v-if="composeStore.selectedPlatforms.includes(key)" class="text-xs opacity-75">
              {{ composeStore.charCount(key) }}/{{ composeStore.charLimit(key) }}
            </span>
          </button>
        </div>
      </div>

      <!-- Editör -->
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <textarea
          v-model="composeStore.content"
          :placeholder="$t('compose.placeholder')"
          rows="6"
          class="w-full bg-transparent text-gray-100 placeholder-gray-600 resize-none focus:outline-none text-sm leading-relaxed"
        ></textarea>

        <div v-if="composeStore.selectedPlatforms.length" class="flex flex-wrap gap-3 pt-3 border-t border-gray-800 mt-2">
          <span
            v-for="p in composeStore.selectedPlatforms"
            :key="p"
            class="text-xs"
            :class="composeStore.isOverLimit(p) ? 'text-red-400' : 'text-gray-500'"
          >
            {{ $t(`platforms.${p}`) }}: {{ composeStore.charCount(p) }}/{{ composeStore.charLimit(p) }}
          </span>
        </div>
      </div>

      <!-- Zamanlama -->
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <p class="text-sm text-gray-400 mb-2">{{ $t('compose.schedulingLabel') }}</p>
        <input
          v-model="composeStore.scheduledAt"
          type="datetime-local"
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        />
      </div>

      <!-- Butonlar -->
      <div class="flex gap-3 justify-end">
        <router-link to="/dashboard" class="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
          {{ $t('compose.cancel') }}
        </router-link>
        <button
          v-if="composeStore.scheduledAt"
          @click="handleSchedule"
          :disabled="composeStore.sending || !composeStore.content.trim()"
          class="px-5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {{ composeStore.sending ? $t('compose.scheduling') : `⏰ ${$t('compose.schedule')}` }}
        </button>
        <button
          @click="handleSend"
          :disabled="composeStore.sending || !composeStore.content.trim() || !composeStore.selectedPlatforms.length"
          class="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {{ composeStore.sending ? $t('compose.sending') : $t('compose.send') }}
        </button>
      </div>

      <div v-if="composeStore.lastResult" class="mt-4 bg-green-900/30 border border-green-700 rounded-xl p-4 text-sm text-green-300">
        {{ $t('compose.successMessage') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useComposeStore } from '../stores/compose'
import { PLATFORM_META } from '../stores/platforms'
import { useRouter } from 'vue-router'

const composeStore = useComposeStore()
const router = useRouter()

async function handleSend() {
  await composeStore.sendNow()
  if (composeStore.lastResult) setTimeout(() => router.push('/dashboard'), 1500)
}

async function handleSchedule() {
  await composeStore.schedulePost()
  if (composeStore.lastResult) setTimeout(() => router.push('/scheduler'), 1500)
}
</script>
