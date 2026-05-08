<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">{{ $t('compose.title') }}</h1>
        <router-link to="/dashboard" class="text-sm text-gray-500 hover:text-gray-300 transition-colors">
          {{ $t('compose.cancel') }}
        </router-link>
      </div>

      <!-- Content editor -->
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <textarea
          v-model="composeStore.content"
          :placeholder="$t('compose.placeholder')"
          rows="5"
          class="w-full bg-transparent text-gray-100 placeholder-gray-600 resize-none focus:outline-none text-sm leading-relaxed"
        ></textarea>
      </div>

      <!-- Destinations -->
      <div class="bg-gray-900 border border-gray-800 rounded-xl mb-4 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-800">
          <p class="text-sm font-medium text-gray-300">{{ $t('compose.destinationsLabel') }}</p>
        </div>

        <!-- Standard platforms -->
        <div v-if="standardDestinations.length" class="divide-y divide-gray-800/60">
          <div
            v-for="dest in standardDestinations"
            :key="dest.key"
            class="px-4 py-3"
          >
            <div class="flex items-center gap-3">
              <!-- Toggle -->
              <button
                @click="composeStore.toggleDestination(dest.key)"
                class="w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                :style="dest.selected
                  ? { backgroundColor: dest.color, borderColor: dest.color }
                  : { borderColor: '#4b5563' }"
              >
                <svg v-if="dest.selected" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>

              <!-- Label + char count -->
              <span
                class="flex-1 text-sm font-medium"
                :style="dest.selected ? { color: dest.color } : { color: '#9ca3af' }"
              >{{ dest.label }}</span>
              <span
                v-if="dest.selected && composeStore.charLimit(dest.platform) < 9999"
                class="text-xs flex-shrink-0"
                :class="composeStore.isOverLimit(dest.platform) ? 'text-red-400' : 'text-gray-600'"
              >
                {{ composeStore.charCount() }}/{{ composeStore.charLimit(dest.platform) }}
              </span>

              <!-- Per-destination schedule -->
              <input
                v-if="dest.selected"
                v-model="dest.scheduledAt"
                type="datetime-local"
                class="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500 flex-shrink-0"
                :title="$t('compose.scheduleTitle')"
              />
            </div>
          </div>
        </div>

        <!-- Facebook Pages section -->
        <template v-if="facebookDestinations.length">
          <div class="px-4 py-2 bg-gray-800/40 border-t border-gray-800/60">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">{{ $t('compose.facebookPages') }}</p>
          </div>
          <div class="divide-y divide-gray-800/60">
            <div
              v-for="dest in facebookDestinations"
              :key="dest.key"
              class="px-4 py-3"
            >
              <div class="flex items-center gap-3">
                <button
                  @click="composeStore.toggleDestination(dest.key)"
                  class="w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                  :style="dest.selected
                    ? { backgroundColor: dest.color, borderColor: dest.color }
                    : { borderColor: '#4b5563' }"
                >
                  <svg v-if="dest.selected" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>

                <img v-if="dest.picture" :src="dest.picture" class="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
                <span v-else class="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold" style="background:#1877F2">f</span>

                <span class="flex-1 text-sm" :class="dest.selected ? 'text-white' : 'text-gray-400'">{{ dest.label }}</span>

                <input
                  v-if="dest.selected"
                  v-model="dest.scheduledAt"
                  type="datetime-local"
                  class="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500 flex-shrink-0"
                  :title="$t('compose.scheduleTitle')"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Instagram Accounts section -->
        <template v-if="instagramDestinations.length">
          <div class="px-4 py-2 bg-gray-800/40 border-t border-gray-800/60">
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">{{ $t('compose.instagramAccounts') }}</p>
          </div>
          <div class="divide-y divide-gray-800/60">
            <div
              v-for="dest in instagramDestinations"
              :key="dest.key"
              class="px-4 py-3"
            >
              <div class="flex items-center gap-3">
                <button
                  @click="composeStore.toggleDestination(dest.key)"
                  class="w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors"
                  :style="dest.selected
                    ? { backgroundColor: dest.color, borderColor: dest.color }
                    : { borderColor: '#4b5563' }"
                >
                  <svg v-if="dest.selected" class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>

                <img v-if="dest.picture" :src="dest.picture" class="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
                <span v-else class="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold" style="background:#E1306C">I</span>

                <span class="flex-1 text-sm" :class="dest.selected ? 'text-white' : 'text-gray-400'">{{ dest.label }}</span>

                <input
                  v-if="dest.selected"
                  v-model="dest.scheduledAt"
                  type="datetime-local"
                  class="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500 flex-shrink-0"
                  :title="$t('compose.scheduleTitle')"
                />
              </div>

              <!-- Instagram image URL (required) -->
              <div v-if="dest.selected" class="mt-2 ml-8">
                <input
                  v-model="dest.imageUrl"
                  type="url"
                  :placeholder="$t('compose.igImagePlaceholder')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Empty state: no destinations configured -->
        <div
          v-if="!standardDestinations.length && !facebookDestinations.length && !instagramDestinations.length"
          class="px-4 py-6 text-center text-gray-600 text-sm"
        >
          {{ $t('compose.noDestinations') }}
          <router-link to="/settings" class="text-blue-400 hover:text-blue-300 ml-1">{{ $t('compose.goToSettings') }}</router-link>
        </div>
      </div>

      <!-- Instagram warning: image required -->
      <div
        v-if="igWithoutImage.length"
        class="mb-4 bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-3 text-xs text-amber-300"
      >
        {{ $t('compose.igImageRequired', { accounts: igWithoutImage.map((d) => d.label).join(', ') }) }}
      </div>

      <!-- Action button -->
      <div class="flex justify-end">
        <button
          @click="handlePost"
          :disabled="composeStore.sending || !canPost"
          class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
        >
          {{ composeStore.sending ? $t('compose.sending') : postButtonLabel }}
        </button>
      </div>

      <!-- Success -->
      <div v-if="composeStore.lastResult" class="mt-4 bg-green-900/30 border border-green-700 rounded-xl p-4 text-sm text-green-300">
        {{ $t('compose.successMessage') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useComposeStore } from '../stores/compose'
import { usePlatformsStore } from '../stores/platforms'

const { t } = useI18n()
const composeStore = useComposeStore()
const platformsStore = usePlatformsStore()
const router = useRouter()

onMounted(async () => {
  await Promise.all([
    platformsStore.fetchStatuses(),
    platformsStore.fetchMetaConnections(),
  ])
  composeStore.initDestinations()
})

const standardDestinations = computed(() =>
  composeStore.destinations.filter((d) => !d.accountId)
)
const facebookDestinations = computed(() =>
  composeStore.destinations.filter((d) => d.platform === 'facebook' && d.accountId)
)
const instagramDestinations = computed(() =>
  composeStore.destinations.filter((d) => d.platform === 'instagram' && d.accountId)
)

// Instagram accounts that are selected but missing an imageUrl
const igWithoutImage = computed(() =>
  instagramDestinations.value.filter((d) => d.selected && !d.imageUrl?.trim())
)

const canPost = computed(() =>
  !!composeStore.content.trim() &&
  composeStore.selectedDestinations.length > 0 &&
  igWithoutImage.value.length === 0
)

const postButtonLabel = computed(() => {
  const { hasImmediateDestinations, hasScheduledDestinations } = composeStore
  if (hasImmediateDestinations && hasScheduledDestinations) return t('compose.postAndSchedule')
  if (hasScheduledDestinations) return `⏰ ${t('compose.schedule')}`
  return t('compose.send')
})

async function handlePost() {
  await composeStore.post()
  if (composeStore.lastResult) setTimeout(() => router.push('/dashboard'), 1500)
}
</script>
