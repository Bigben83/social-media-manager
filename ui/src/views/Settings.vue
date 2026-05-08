<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto space-y-8">

      <div>
        <h1 class="text-2xl font-bold mb-1">{{ $t('settings.title') }}</h1>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           FACEBOOK & INSTAGRAM — OAuth connection card
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="flex gap-1.5">
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#1877F2">f</span>
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E1306C">I</span>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.meta.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.meta.sectionSubtitle') }}</p>
          </div>
        </div>

        <!-- OAuth error banner -->
        <div v-if="oauthError" class="mx-5 mt-4 bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
          <span class="shrink-0">⚠</span>
          <span><strong>{{ $t('settings.meta.errorTitle') }}:</strong> {{ oauthError }}</span>
        </div>

        <!-- Step 1: App credentials -->
        <div class="p-5 border-b border-gray-800/60">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 1 — Facebook Developer App</p>

          <div v-if="metaAppConfigured" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.meta.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.metaCredentials.appId }})</span>
            </div>
            <button @click="editingApp = !editingApp" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">
              Edit
            </button>
          </div>

          <div v-if="!metaAppConfigured || editingApp" class="space-y-3 mt-2">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.meta.appIdLabel') }}</label>
              <input
                v-model="appId"
                type="text"
                :placeholder="$t('settings.meta.appIdPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.meta.appSecretLabel') }}</label>
              <input
                v-model="appSecret"
                type="password"
                :placeholder="metaAppConfigured ? platformsStore.metaCredentials.appSecretHint : $t('settings.meta.appSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                {{ $t('settings.meta.getAppHelp') }}
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener" class="text-blue-400 hover:text-blue-300 underline">
                  {{ $t('settings.meta.devPortal') }}
                </a>
              </p>
              <button
                @click="saveApp"
                :disabled="!appId || !appSecret || platformsStore.metaLoading"
                class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
              >
                {{ platformsStore.metaLoading ? $t('settings.meta.saving') : $t('settings.meta.saveApp') }}
              </button>
            </div>
          </div>
        </div>

        <!-- Step 2: OAuth connect -->
        <div class="p-5" :class="{ 'opacity-40 pointer-events-none': !metaAppConfigured }">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step 2 — Connect Accounts</p>

          <!-- Already connected — show summary + manage -->
          <div v-if="fbConnected || igConnected" class="space-y-3">
            <div v-if="fbPages.length" class="space-y-1.5">
              <p class="text-xs text-gray-500">{{ $t('settings.meta.connectedPages') }}</p>
              <div v-for="page in fbPages" :key="page.id" class="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                <img v-if="page.picture" :src="page.picture" class="w-6 h-6 rounded-full" />
                <span v-else class="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold">f</span>
                <span class="text-sm">{{ page.name }}</span>
                <span class="ml-auto w-2 h-2 rounded-full bg-green-400"></span>
              </div>
            </div>
            <div v-if="igAccounts.length" class="space-y-1.5">
              <p class="text-xs text-gray-500">{{ $t('settings.meta.connectedAccounts') }}</p>
              <div v-for="account in igAccounts" :key="account.id" class="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                <img v-if="account.avatar" :src="account.avatar" class="w-6 h-6 rounded-full" />
                <span v-else class="w-6 h-6 rounded-full bg-pink-700 flex items-center justify-center text-xs font-bold">I</span>
                <span class="text-sm">@{{ account.username }}</span>
                <span class="ml-auto w-2 h-2 rounded-full bg-green-400"></span>
              </div>
            </div>
            <div class="flex gap-2 pt-2">
              <button
                @click="platformsStore.startMetaOAuth()"
                :disabled="platformsStore.metaLoading"
                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >
                {{ $t('settings.meta.reconnect') }}
              </button>
              <button
                @click="confirmDisconnect"
                :disabled="platformsStore.metaLoading"
                class="px-4 py-2 text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 disabled:opacity-40 rounded-lg text-xs font-medium transition-colors"
              >
                {{ $t('settings.meta.disconnect') }}
              </button>
            </div>
          </div>

          <!-- Not yet connected -->
          <div v-else>
            <button
              @click="platformsStore.startMetaOAuth()"
              :disabled="!metaAppConfigured || platformsStore.metaLoading"
              class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              <span v-if="platformsStore.metaLoading">{{ $t('settings.meta.connecting') }}</span>
              <span v-else>{{ $t('settings.meta.connectButton') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           PAGE/ACCOUNT PICKER — shown after OAuth callback
      ════════════════════════════════════════════════════════════════════ -->
      <div
        v-if="showDiscovery"
        class="bg-gray-900 border border-blue-700 rounded-2xl overflow-hidden"
      >
        <div class="p-5 border-b border-gray-800">
          <p class="font-semibold">{{ $t('settings.meta.discoveryTitle') }}</p>
          <p class="text-xs text-gray-500 mt-1">{{ $t('settings.meta.discoverySubtitle') }}</p>
        </div>

        <div class="p-5 space-y-5">

          <!-- Facebook Pages -->
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{{ $t('settings.meta.pagesHeading') }}</p>
            <div v-if="discovery.pages.length === 0" class="text-sm text-gray-600">{{ $t('settings.meta.noPages') }}</div>
            <div v-else class="space-y-2">
              <label
                v-for="page in discovery.pages"
                :key="page.id"
                class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-750 transition-colors"
              >
                <input type="checkbox" :value="page.id" v-model="selectedPageIds" class="w-4 h-4 accent-blue-500" />
                <img v-if="page.picture" :src="page.picture" class="w-8 h-8 rounded-full" />
                <span v-else class="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold shrink-0">f</span>
                <span class="text-sm font-medium">{{ page.name }}</span>
                <span class="ml-auto text-xs text-gray-600 font-mono">{{ page.id }}</span>
              </label>
            </div>
          </div>

          <!-- Instagram Business Accounts -->
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{{ $t('settings.meta.igHeading') }}</p>
            <div v-if="discovery.igAccounts.length === 0" class="text-sm text-gray-600">{{ $t('settings.meta.noIgAccounts') }}</div>
            <div v-else class="space-y-2">
              <label
                v-for="account in discovery.igAccounts"
                :key="account.id"
                class="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-750 transition-colors"
              >
                <input type="checkbox" :value="account.id" v-model="selectedIgAccountIds" class="w-4 h-4 accent-pink-500" />
                <img v-if="account.avatar" :src="account.avatar" class="w-8 h-8 rounded-full" />
                <span v-else class="w-8 h-8 rounded-full bg-pink-700 flex items-center justify-center text-xs font-bold shrink-0">I</span>
                <div>
                  <p class="text-sm font-medium">@{{ account.username }}</p>
                  <p class="text-xs text-gray-600">{{ $t('settings.meta.igLinkedTo') }} {{ pageNameForId(account.pageId) }}</p>
                </div>
                <span class="ml-auto text-xs text-gray-600 font-mono">{{ account.id }}</span>
              </label>
            </div>
          </div>

          <!-- Confirm -->
          <div class="flex items-center justify-between pt-2">
            <p v-if="selectionError" class="text-xs text-red-400">{{ selectionError }}</p>
            <span v-else />
            <button
              @click="confirmSelection"
              :disabled="platformsStore.metaLoading"
              class="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-xl text-sm font-semibold transition-colors"
            >
              {{ platformsStore.metaLoading ? $t('settings.meta.confirmingSelection') : $t('settings.meta.confirmSelection') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           OTHER PLATFORMS — env-file based
      ════════════════════════════════════════════════════════════════════ -->
      <div>
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Other Platforms</p>
        <div class="space-y-3">
          <div
            v-for="(meta, key) in otherPlatforms"
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
              <span v-else-if="key === 'reddit'">REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD</span>
              <span v-else>— {{ $t('settings.envHint') }} —</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           ACCOUNT PROFILES
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800">
          <p class="font-semibold">{{ $t('settings.profiles.sectionTitle') }}</p>
          <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.profiles.sectionSubtitle') }}</p>
        </div>

        <!-- No accounts -->
        <div v-if="!allConnectedAccounts.length" class="px-5 py-6 text-sm text-gray-600 text-center">
          {{ $t('settings.profiles.noAccounts') }}
        </div>

        <!-- Account rows -->
        <div v-else class="divide-y divide-gray-800">
          <div v-for="account in allConnectedAccounts" :key="account.key">

            <!-- Account header row -->
            <button
              @click="toggleProfile(account.key)"
              class="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-800/50 transition-colors text-left"
            >
              <!-- Avatar -->
              <div class="flex-shrink-0">
                <img
                  v-if="account.avatar"
                  :src="account.avatar"
                  class="w-8 h-8 rounded-full object-cover"
                />
                <span
                  v-else
                  class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  :style="{ backgroundColor: account.color }"
                >
                  {{ account.label[0] }}
                </span>
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">{{ account.label }}</p>
                <p class="text-xs text-gray-600">{{ $t(`platforms.${account.platform}`) }}</p>
              </div>

              <!-- Filled indicator -->
              <span
                v-if="profileFilled(account.key)"
                class="text-xs text-green-400 flex-shrink-0"
              >✓</span>

              <!-- Chevron -->
              <svg
                class="w-4 h-4 text-gray-500 flex-shrink-0 transition-transform"
                :class="expandedProfileKey === account.key ? 'rotate-180' : ''"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <!-- Expanded profile form -->
            <div v-if="expandedProfileKey === account.key" class="px-5 pb-5 pt-1 space-y-4 bg-gray-950/40">

              <!-- Row 1: Business Name + Website -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.businessName') }}</label>
                  <input
                    v-model="editingProfiles[account.key].businessName"
                    type="text"
                    :placeholder="$t('settings.profiles.businessNameHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.websiteUrl') }}</label>
                  <input
                    v-model="editingProfiles[account.key].websiteUrl"
                    type="url"
                    placeholder="https://"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <!-- Description -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.description') }}</label>
                <textarea
                  v-model="editingProfiles[account.key].description"
                  :placeholder="$t('settings.profiles.descriptionHint')"
                  rows="2"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <!-- Row 2: Industry + Tone -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.industry') }}</label>
                  <input
                    v-model="editingProfiles[account.key].industry"
                    type="text"
                    :placeholder="$t('settings.profiles.industryHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.toneOfVoice') }}</label>
                  <select
                    v-model="editingProfiles[account.key].toneOfVoice"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">{{ $t('settings.profiles.toneSelect') }}</option>
                    <option v-for="tone in TONE_OPTIONS" :key="tone.value" :value="tone.value">{{ tone.label }}</option>
                  </select>
                </div>
              </div>

              <!-- Target Audience -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.targetAudience') }}</label>
                <input
                  v-model="editingProfiles[account.key].targetAudience"
                  type="text"
                  :placeholder="$t('settings.profiles.targetAudienceHint')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <!-- Row 3: Keywords + Hashtags -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.keywords') }}</label>
                  <input
                    v-model="editingProfiles[account.key].keywords"
                    type="text"
                    :placeholder="$t('settings.profiles.keywordsHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.hashtags') }}</label>
                  <input
                    v-model="editingProfiles[account.key].hashtags"
                    type="text"
                    :placeholder="$t('settings.profiles.hashtagsHint')"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <!-- Posting Guidelines -->
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('settings.profiles.postingGuidelines') }}</label>
                <textarea
                  v-model="editingProfiles[account.key].postingGuidelines"
                  :placeholder="$t('settings.profiles.postingGuidelinesHint')"
                  rows="3"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <!-- Save button -->
              <div class="flex items-center justify-end gap-3">
                <span v-if="profileSavedKey === account.key" class="text-xs text-green-400">
                  {{ $t('settings.profiles.saved') }}
                </span>
                <button
                  @click="saveProfile(account.key)"
                  :disabled="profileSaving === account.key"
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
                >
                  {{ profileSaving === account.key ? $t('settings.profiles.saving') : $t('settings.profiles.save') }}
                </button>
              </div>

            </div>
          </div>
        </div>

      </div>

      <!-- ═══════════════════════════════════════════════════════════════════
           AI INTEGRATION — Ollama configuration card
      ════════════════════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">

        <!-- Header -->
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-white text-sm font-bold shrink-0">AI</div>
          <div>
            <p class="font-semibold">{{ $t('ai.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('ai.sectionSubtitle') }}</p>
          </div>
          <!-- Connection status pill -->
          <div v-if="aiConnected !== null" class="ml-auto shrink-0">
            <span
              class="text-xs px-2 py-0.5 rounded-full font-medium"
              :class="aiConnected ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-red-900/40 text-red-400 border border-red-800'"
            >
              {{ aiConnected ? $t('ai.connected') : $t('ai.connectionFailed') }}
            </span>
          </div>
        </div>

        <div class="p-5 space-y-4">

          <!-- Endpoint -->
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.endpointLabel') }}</label>
            <div class="flex gap-2">
              <input
                v-model="aiEndpoint"
                type="text"
                :placeholder="$t('ai.endpointPlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500"
              />
              <button
                @click="testAiConnection"
                :disabled="aiStore.modelsLoading || !aiEndpoint"
                class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
              >
                {{ aiStore.modelsLoading ? $t('ai.testing') : $t('ai.testConnection') }}
              </button>
            </div>
            <p class="text-xs text-gray-600 mt-1">{{ $t('ai.endpointHint') }}</p>
          </div>

          <!-- Model selector -->
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
            <select
              v-model="aiModel"
              :disabled="!aiModels.length"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500 disabled:opacity-40"
            >
              <option value="">{{ $t('ai.modelPlaceholder') }}</option>
              <option v-for="m in aiModels" :key="m" :value="m">{{ m }}</option>
            </select>
            <p v-if="aiConnected === false" class="text-xs text-red-400 mt-1">{{ $t('ai.noModels') }}</p>
            <p v-else-if="aiModels.length" class="text-xs text-gray-600 mt-1">
              {{ $t('ai.modelsAvailable', aiModels.length) }}
            </p>
          </div>

          <!-- Save -->
          <div class="flex items-center justify-end gap-3">
            <span v-if="aiSaved" class="text-xs text-green-400">{{ $t('ai.saved') }}</span>
            <button
              @click="saveAiConfig"
              :disabled="aiStore.saving || !aiEndpoint"
              class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors"
            >
              {{ aiStore.saving ? $t('ai.saving') : $t('ai.saveConfig') }}
            </button>
          </div>

        </div>
      </div>

      <!-- Refresh button -->
      <button
        @click="platformsStore.fetchStatuses()"
        class="w-full py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors"
      >
        {{ $t('settings.refreshStatus') }}
      </button>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from '../stores/platforms'
import { useAiStore } from '../stores/ai'

const { t } = useI18n()

const route = useRoute()
const platformsStore = usePlatformsStore()
const aiStore = useAiStore()

// ─── App credential form state ──────────────────────────────────────────────

const appId = ref('')
const appSecret = ref('')
const editingApp = ref(false)

const metaAppConfigured = computed(() => platformsStore.metaCredentials.configured)

async function saveApp() {
  await platformsStore.saveMetaApp(appId.value, appSecret.value)
  if (!platformsStore.metaError) {
    editingApp.value = false
    appSecret.value = ''
  }
}

// ─── Connected platforms derived from statuses ───────────────────────────────

const fbStatus = computed(() => platformsStore.getStatus('facebook'))
const igStatus = computed(() => platformsStore.getStatus('instagram'))
const fbConnected = computed(() => fbStatus.value?.connected ?? false)
const igConnected = computed(() => igStatus.value?.connected ?? false)

// Pull connected pages/accounts from the shared store
const fbPages = computed(() => platformsStore.connectedPages)
const igAccounts = computed(() => platformsStore.connectedIgAccounts)

async function loadMetaConnections() {
  await platformsStore.fetchMetaConnections()
}

// ─── OAuth discovery ─────────────────────────────────────────────────────────

const discovery = computed(() => platformsStore.metaDiscovery || { pages: [], igAccounts: [] })
const showDiscovery = computed(() => !!(platformsStore.metaDiscovery && (discovery.value.pages.length > 0 || discovery.value.igAccounts.length > 0)))

const selectedPageIds = ref<string[]>([])
const selectedIgAccountIds = ref<string[]>([])
const selectionError = ref('')

function pageNameForId(pageId: string): string {
  return discovery.value.pages.find((p) => p.id === pageId)?.name || pageId
}

async function confirmSelection() {
  selectionError.value = ''
  if (!selectedPageIds.value.length && !selectedIgAccountIds.value.length) {
    selectionError.value = platformsStore.metaError || 'Select at least one Page or Instagram account.'
    return
  }
  await platformsStore.saveMetaSelection(selectedPageIds.value, selectedIgAccountIds.value)
  await loadMetaConnections()
  selectedPageIds.value = []
  selectedIgAccountIds.value = []
}

// ─── OAuth error from callback redirect ──────────────────────────────────────

const oauthError = ref<string | null>(null)

// ─── Other platforms (not Meta) ──────────────────────────────────────────────

const otherPlatforms = computed(() => {
  const skip = new Set(['instagram', 'facebook'])
  return Object.fromEntries(Object.entries(PLATFORM_META).filter(([k]) => !skip.has(k)))
})

function isConnected(platform: string) {
  return platformsStore.isConnected(platform)
}

function getStatus(platform: string) {
  return platformsStore.getStatus(platform)
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

function confirmDisconnect() {
  if (window.confirm(platformsStore.metaCredentials?.appId ? 'This will disconnect all Facebook Pages and Instagram accounts. Continue?' : '')) {
    platformsStore.disconnectMeta().then(loadMetaConnections)
  }
}

// ─── Account Profiles ────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual',       label: 'Casual' },
  { value: 'friendly',     label: 'Friendly' },
  { value: 'formal',       label: 'Formal' },
  { value: 'humorous',     label: 'Humorous' },
  { value: 'inspiring',    label: 'Inspiring' },
  { value: 'educational',  label: 'Educational' },
]

interface AccountProfile {
  businessName: string
  description: string
  websiteUrl: string
  industry: string
  targetAudience: string
  toneOfVoice: string
  keywords: string
  hashtags: string
  postingGuidelines: string
}

interface ProfileAccount {
  key: string
  label: string
  platform: string
  color: string
  avatar: string | null
}

function emptyProfile(): AccountProfile {
  return { businessName: '', description: '', websiteUrl: '', industry: '', targetAudience: '', toneOfVoice: '', keywords: '', hashtags: '', postingGuidelines: '' }
}

const expandedProfileKey = ref<string | null>(null)
const editingProfiles = ref<Record<string, AccountProfile>>({})
const profileSaving = ref<string | null>(null)
const profileSavedKey = ref<string | null>(null)

const allConnectedAccounts = computed((): ProfileAccount[] => {
  const accounts: ProfileAccount[] = []

  for (const [platform, meta] of Object.entries(PLATFORM_META)) {
    if (platform === 'facebook' || platform === 'instagram') continue
    if (platformsStore.isConnected(platform)) {
      accounts.push({ key: platform, label: t(`platforms.${platform}`), platform, color: meta.color, avatar: null })
    }
  }

  for (const page of platformsStore.connectedPages) {
    accounts.push({ key: `facebook:${page.id}`, label: page.name, platform: 'facebook', color: PLATFORM_META.facebook.color, avatar: page.picture || null })
  }

  for (const account of platformsStore.connectedIgAccounts) {
    accounts.push({ key: `instagram:${account.id}`, label: `@${account.username}`, platform: 'instagram', color: PLATFORM_META.instagram.color, avatar: account.avatar || null })
  }

  return accounts
})

function profileFilled(key: string): boolean {
  const p = editingProfiles.value[key]
  return !!p && !!(p.businessName || p.description || p.industry)
}

async function toggleProfile(key: string) {
  if (expandedProfileKey.value === key) {
    expandedProfileKey.value = null
    return
  }
  expandedProfileKey.value = key
  if (!editingProfiles.value[key]) {
    try {
      const res = await axios.get(`/api/profiles/${encodeURIComponent(key)}`)
      const { _id, updatedAt, ...data } = res.data
      editingProfiles.value[key] = { ...emptyProfile(), ...data }
    } catch {
      editingProfiles.value[key] = emptyProfile()
    }
  }
}

async function saveProfile(key: string) {
  profileSaving.value = key
  try {
    await axios.put(`/api/profiles/${encodeURIComponent(key)}`, editingProfiles.value[key])
    profileSavedKey.value = key
    setTimeout(() => { if (profileSavedKey.value === key) profileSavedKey.value = null }, 2500)
  } catch (err) {
    console.error('Save profile error:', err)
  } finally {
    profileSaving.value = null
  }
}

// ─── AI Configuration ─────────────────────────────────────────────────────────

const aiEndpoint = ref('')
const aiModel = ref('')
const aiModels = computed(() => aiStore.models)
const aiConnected = ref<boolean | null>(null)
const aiSaved = ref(false)

async function testAiConnection() {
  const ok = await aiStore.fetchModels(aiEndpoint.value)
  aiConnected.value = ok
  if (ok && !aiModel.value && aiStore.models.length) {
    aiModel.value = aiStore.models[0]
  }
}

async function saveAiConfig() {
  const ok = await aiStore.saveConfig({ endpoint: aiEndpoint.value, model: aiModel.value })
  if (ok) {
    aiSaved.value = true
    setTimeout(() => { aiSaved.value = false }, 2500)
  }
}

// ─── On mount ────────────────────────────────────────────────────────────────

onMounted(async () => {
  // Check for OAuth callback query params
  if (route.query.meta_discovery) {
    await platformsStore.fetchMetaDiscovery()
    // Clear query param from URL without navigation
    window.history.replaceState({}, '', '/settings')
  }
  if (route.query.meta_error) {
    oauthError.value = decodeURIComponent(String(route.query.meta_error))
    window.history.replaceState({}, '', '/settings')
  }

  await Promise.all([
    platformsStore.fetchStatuses(),
    platformsStore.fetchMetaCredentials(),
    loadMetaConnections(),
    aiStore.fetchConfig(),
  ])

  // Seed local form from fetched config
  aiEndpoint.value = aiStore.config.endpoint
  aiModel.value = aiStore.config.model
})
</script>
