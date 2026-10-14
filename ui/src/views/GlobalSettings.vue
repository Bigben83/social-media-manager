<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 p-6">
    <div class="max-w-2xl mx-auto space-y-8">

      <div>
        <h1 class="text-2xl font-bold mb-1">{{ $t('globalSettings.title') }}</h1>
        <p class="text-sm text-gray-400">{{ $t('globalSettings.subtitle') }}</p>
      </div>

      <!-- ═══ FACEBOOK & INSTAGRAM APP CREDENTIALS ═════════════════════════════ -->
      <div id="meta-app" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="flex gap-1.5">
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#1877F2">f</span>
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E1306C">I</span>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.meta.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('globalSettings.appCredentialsNote') }}</p>
          </div>
        </div>

        <div class="p-5">
          <div v-if="metaAppConfigured && !editingMetaApp" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.meta.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.metaCredentials.appId }})</span>
            </div>
            <button @click="editingMetaApp = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">
              Edit
            </button>
          </div>

          <div v-else class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.meta.appIdLabel') }}</label>
              <input v-model="metaAppId" type="text" :placeholder="$t('settings.meta.appIdPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.meta.appSecretLabel') }}</label>
              <input v-model="metaAppSecret" type="password"
                :placeholder="metaAppConfigured ? platformsStore.metaCredentials.appSecretHint : $t('settings.meta.appSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                {{ $t('settings.meta.getAppHelp') }}
                <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener" class="text-blue-400 hover:text-blue-300 underline">{{ $t('settings.meta.devPortal') }}</a>
              </p>
              <button @click="saveMetaApp" :disabled="!metaAppId || !metaAppSecret || platformsStore.metaLoading"
                class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                {{ platformsStore.metaLoading ? $t('settings.meta.saving') : $t('settings.meta.saveApp') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ PINTEREST APP CREDENTIALS ════════════════════════════════════════ -->
      <div id="pinterest-app" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#E60023">P</span>
          <div>
            <p class="font-semibold">{{ $t('settings.pinterest.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('globalSettings.appCredentialsNote') }}</p>
          </div>
        </div>

        <div class="p-5">
          <div v-if="pinterestAppConfigured && !editingPinterestApp" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.pinterest.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.pinterestCredentials.clientId }})</span>
            </div>
            <button @click="editingPinterestApp = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">Edit</button>
          </div>

          <div v-else class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.pinterest.clientIdLabel') }}</label>
              <input v-model="pinterestClientId" type="text" :placeholder="$t('settings.pinterest.clientIdPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-red-500" />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.pinterest.clientSecretLabel') }}</label>
              <input v-model="pinterestClientSecret" type="password"
                :placeholder="pinterestAppConfigured ? platformsStore.pinterestCredentials.clientSecretHint : $t('settings.pinterest.clientSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-red-500" />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                <a href="https://developers.pinterest.com/apps/" target="_blank" rel="noopener" class="text-red-400 hover:text-red-300 underline">{{ $t('settings.pinterest.devPortal') }}</a>
              </p>
              <button @click="savePinterestApp" :disabled="!pinterestClientId || !pinterestClientSecret || platformsStore.pinterestLoading"
                class="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                {{ platformsStore.pinterestLoading ? $t('settings.pinterest.saving') : $t('settings.pinterest.saveApp') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ TIKTOK APP CREDENTIALS ════════════════════════════════════════════ -->
      <div id="tiktok-app" class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <span class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold" style="background:#EE1D52">T</span>
          <div>
            <p class="font-semibold">{{ $t('settings.tiktok.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('globalSettings.appCredentialsNote') }}</p>
          </div>
        </div>

        <div class="p-5">
          <div v-if="tiktokAppConfigured && !editingTikTokApp" class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-sm text-green-400">
              <span>✓</span>
              <span>{{ $t('settings.tiktok.appConfigured') }}</span>
              <span class="text-gray-600 font-mono text-xs">({{ platformsStore.tiktokCredentials.clientKey }})</span>
            </div>
            <button @click="editingTikTokApp = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">Edit</button>
          </div>

          <div v-else class="space-y-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.tiktok.clientKeyLabel') }}</label>
              <input v-model="tiktokClientKey" type="text" :placeholder="$t('settings.tiktok.clientKeyPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-pink-500" />
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">{{ $t('settings.tiktok.clientSecretLabel') }}</label>
              <input v-model="tiktokClientSecret" type="password"
                :placeholder="tiktokAppConfigured ? platformsStore.tiktokCredentials.clientSecretHint : $t('settings.tiktok.clientSecretPlaceholder')"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-pink-500" />
            </div>
            <div class="flex items-center justify-between">
              <p class="text-xs text-gray-600">
                <a href="https://developers.tiktok.com/" target="_blank" rel="noopener" class="text-pink-400 hover:text-pink-300 underline">{{ $t('settings.tiktok.devPortal') }}</a>
              </p>
              <button @click="saveTikTokApp" :disabled="!tiktokClientKey || !tiktokClientSecret || platformsStore.tiktokLoading"
                class="px-4 py-1.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                {{ platformsStore.tiktokLoading ? $t('settings.tiktok.saving') : $t('settings.tiktok.saveApp') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ AI INTEGRATION — Ollama ══════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-violet-700 flex items-center justify-center text-white text-sm font-bold shrink-0">AI</div>
          <div>
            <p class="font-semibold">{{ $t('ai.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('ai.sectionSubtitle') }}</p>
          </div>
          <div class="ml-auto flex items-center gap-2 shrink-0">
            <span v-if="aiStore.config.provider === 'ollama'" class="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-900/50 text-violet-300 border border-violet-700">{{ $t('ai.active') }}</span>
            <span v-if="aiConnected !== null" class="text-xs px-2 py-0.5 rounded-full font-medium" :class="aiConnected ? 'bg-green-900/50 text-green-400 border border-green-700' : 'bg-red-900/40 text-red-400 border border-red-800'">
              {{ aiConnected ? $t('ai.connected') : $t('ai.connectionFailed') }}
            </span>
          </div>
        </div>
        <div class="p-5 space-y-4">
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.endpointLabel') }}</label>
            <div class="flex gap-2">
              <input v-model="aiEndpoint" type="text" :placeholder="$t('ai.endpointPlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
              <button @click="testAiConnection" :disabled="aiStore.modelsLoading || !aiEndpoint"
                class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded-lg text-xs font-medium transition-colors whitespace-nowrap">
                {{ aiStore.modelsLoading ? $t('ai.testing') : $t('ai.testConnection') }}
              </button>
            </div>
            <p class="text-xs text-gray-600 mt-1">{{ $t('ai.endpointHint') }}</p>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
            <select v-model="aiModel" :disabled="!aiModels.length"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500 disabled:opacity-40">
              <option value="">{{ $t('ai.modelPlaceholder') }}</option>
              <option v-for="m in aiModels" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.visionModelLabel') }}</label>
            <input v-model="aiVisionModel" type="text" :placeholder="$t('ai.visionModelPlaceholder')"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
            <p class="text-xs text-gray-600 mt-1">{{ $t('ai.visionModelHint') }}</p>
          </div>
          <div class="flex items-center justify-end gap-3">
            <span v-if="aiSaved" class="text-xs text-green-400">{{ $t('ai.saved') }}</span>
            <button @click="saveAiConfig" :disabled="aiStore.saving || !aiEndpoint"
              class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
              {{ aiStore.saving ? $t('ai.saving') : $t('ai.saveConfig') }}
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ AI PROVIDERS — Anthropic, OpenAI, Groq, Gemini, OpenAI-compatible ══ -->
      <template v-for="providerName in CLOUD_PROVIDER_NAMES" :key="providerName">
        <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div class="p-5 border-b border-gray-800 flex items-center gap-3">
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
              :class="PROVIDER_BADGE[providerName].cls">
              {{ PROVIDER_BADGE[providerName].abbr }}
            </div>
            <div>
              <p class="font-semibold">{{ $t(`ai.${providerName}.sectionTitle`) }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ $t(`ai.${providerName}.sectionSubtitle`) }}</p>
            </div>
            <div class="ml-auto flex items-center gap-2 shrink-0">
              <span v-if="aiStore.config.provider === providerName" class="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-900/50 text-violet-300 border border-violet-700">{{ $t('ai.active') }}</span>
              <span v-else-if="getProvider(providerName)?.configured" class="text-xs px-2 py-0.5 rounded-full font-medium bg-green-900/50 text-green-400 border border-green-700">✓ {{ $t('ai.apiKeyConfigured') }}</span>
            </div>
          </div>
          <div class="p-5 space-y-4">
            <p v-if="getProvider(providerName)?.available === false" role="alert" class="text-sm text-red-400">{{ $t('ai.providerUnavailable') }}</p>
            <div v-if="getProvider(providerName)?.configured && !providerForms[providerName].editing">
              <div class="flex items-center justify-between text-sm">
                <div class="space-y-1">
                  <p v-if="providerName === 'custom'" class="text-xs text-gray-400">{{ $t('ai.baseUrlLabel') }}: <span class="font-mono text-gray-300">{{ getProvider(providerName)?.baseUrl }}</span></p>
                  <p class="text-xs text-gray-400">{{ $t('ai.apiKeyLabel') }}: <span class="font-mono text-gray-300">{{ getProvider(providerName)?.apiKeyHint || '—' }}</span></p>
                  <p v-if="providerForms[providerName].saved" class="text-xs text-green-400">{{ $t('ai.providerSaved') }}</p>
                </div>
                <div class="flex gap-2">
                  <button @click="providerForms[providerName].editing = true" class="text-xs px-2.5 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-gray-400 hover:text-gray-200 transition-colors">Edit</button>
                  <button v-if="aiStore.config.provider !== providerName" @click="setActiveProvider(providerName)" :disabled="aiStore.saving || getProvider(providerName)?.available === false"
                    class="text-xs px-2.5 py-1 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-md text-white transition-colors">
                    {{ $t('ai.setActive') }}
                  </button>
                  <button @click="disconnectCloudProvider(providerName)" class="text-xs px-2.5 py-1 bg-red-900/40 hover:bg-red-900/60 border border-red-800 rounded-md text-red-400 hover:text-red-300 transition-colors">{{ $t('ai.disconnect') }}</button>
                </div>
              </div>
              <div class="flex items-center gap-3 mt-3">
                <button @click="testCloudProvider(providerName)" :disabled="providerTests[providerName]?.loading" class="text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-40">{{ providerTests[providerName]?.loading ? $t('ai.testing') : $t('ai.testConnection') }}</button>
                <span v-if="providerTests[providerName]?.message" class="text-xs" :class="providerTests[providerName]?.ok ? 'text-green-400' : 'text-red-400'">{{ providerTests[providerName]?.message }}</span>
              </div>
              <div class="mt-3">
                <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
                <select v-if="modelOptions(providerName).length" v-model="providerForms[providerName].model" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500">
                  <option v-if="providerForms[providerName].model && !modelOptions(providerName).includes(providerForms[providerName].model)" :value="providerForms[providerName].model">{{ providerForms[providerName].model }}</option>
                  <option v-for="m in modelOptions(providerName)" :key="m" :value="m">{{ m }}</option>
                </select>
                <input v-else v-model="providerForms[providerName].model" type="text" :placeholder="$t('ai.modelInputPlaceholder')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                <p class="text-xs text-gray-600 mt-1">{{ liveModels[providerName] ? $t('ai.modelsLive') : $t('ai.modelsStatic') }}</p>
              </div>
              <div class="flex justify-end mt-3">
                <button @click="saveCloudProvider(providerName, aiStore.config.provider === providerName)" :disabled="providerForms[providerName].saving"
                  class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                  {{ providerForms[providerName].saving ? $t('ai.saving') : $t('ai.saveProvider') }}
                </button>
              </div>
            </div>
            <div v-else class="space-y-3">
              <div v-if="providerName === 'custom'">
                <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.baseUrlLabel') }}</label>
                <input v-model="providerForms[providerName].baseUrl" type="text" :placeholder="$t('ai.baseUrlPlaceholder')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ providerName === 'custom' ? $t('ai.apiKeyOptional') : $t('ai.apiKeyLabel') }}</label>
                <input v-model="providerForms[providerName].apiKey" type="password" :placeholder="$t('ai.apiKeyPlaceholder')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                <p class="text-xs text-gray-600 mt-1">{{ $t(`ai.${providerName}.getKeyHint`) }}</p>
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-1">{{ $t('ai.modelLabel') }}</label>
                <select v-if="modelOptions(providerName).length" v-model="providerForms[providerName].model" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-500">
                  <option v-if="providerForms[providerName].model && !modelOptions(providerName).includes(providerForms[providerName].model)" :value="providerForms[providerName].model">{{ providerForms[providerName].model }}</option>
                  <option v-for="m in modelOptions(providerName)" :key="m" :value="m">{{ m }}</option>
                </select>
                <input v-else v-model="providerForms[providerName].model" type="text" :placeholder="$t('ai.modelInputPlaceholder')"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                <p class="text-xs text-gray-600 mt-1">{{ liveModels[providerName] ? $t('ai.modelsLive') : $t('ai.modelsStatic') }}</p>
              </div>
              <div class="flex items-center justify-end gap-2">
                <button v-if="providerForms[providerName].editing" @click="providerForms[providerName].editing = false" class="text-xs px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 transition-colors">Cancel</button>
                <button @click="saveCloudProvider(providerName, false)" :disabled="providerForms[providerName].saving || !canSave(providerName)"
                  class="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded-lg text-xs font-medium transition-colors">
                  {{ providerForms[providerName].saving ? $t('ai.saving') : $t('ai.saveProvider') }}
                </button>
                <button @click="saveCloudProvider(providerName, true)" :disabled="providerForms[providerName].saving || !canSave(providerName)"
                  class="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-lg text-sm font-medium transition-colors">
                  {{ providerForms[providerName].saving ? $t('ai.saving') : $t('ai.connectAndActivate') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ═══ GOOGLE PLACES ═════════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-green-700 flex items-center justify-center shrink-0">
            <i class="fa-solid fa-location-dot text-white text-sm"></i>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.googlePlaces.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.googlePlaces.sectionSubtitle') }}</p>
          </div>
        </div>
        <div class="p-5 space-y-4">
          <div v-if="placesConfigured" class="flex items-center justify-between">
            <span class="text-sm text-gray-300">{{ $t('settings.googlePlaces.keyConfigured', { hint: placesKeyHint }) }}</span>
            <button @click="removePlacesKey" class="text-xs px-3 py-1.5 border border-red-800/60 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">{{ $t('settings.googlePlaces.disconnect') }}</button>
          </div>
          <div v-else class="space-y-3">
            <p class="text-xs text-gray-500">{{ $t('settings.googlePlaces.getKeyHint') }}</p>
            <div class="flex gap-2">
              <input v-model="placesApiKey" type="password" :placeholder="$t('settings.googlePlaces.keyPlaceholder')"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-500" />
              <button @click="savePlacesKey" :disabled="!placesApiKey.trim() || placesSaving"
                class="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors">
                {{ placesSaving ? $t('settings.googlePlaces.saving') : $t('settings.googlePlaces.save') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ IMAGE GENERATION ══════════════════════════════════════════════════ -->
      <div class="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div class="p-5 border-b border-gray-800 flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-emerald-700 flex items-center justify-center shrink-0">
            <i class="fa-solid fa-image text-white text-sm"></i>
          </div>
          <div>
            <p class="font-semibold">{{ $t('settings.imageGen.sectionTitle') }}</p>
            <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.imageGen.sectionSubtitle') }}</p>
          </div>
        </div>
        <div class="p-5 space-y-6">

          <!-- OpenAI -->
          <div class="flex items-start gap-3">
            <span class="mt-0.5 w-2 h-2 rounded-full shrink-0" :class="imageOpenAiReady ? 'bg-emerald-400' : 'bg-gray-600'"></span>
            <div class="text-sm">
              <p class="text-gray-200 font-medium">{{ $t('settings.imageGen.openaiTitle') }}</p>
              <p class="text-xs text-gray-500 mt-0.5">{{ imageOpenAiReady ? $t('settings.imageGen.openaiReady') : $t('settings.imageGen.openaiMissing') }}</p>
            </div>
          </div>

          <!-- Gemini -->
          <div class="space-y-2">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 w-2 h-2 rounded-full shrink-0" :class="imageGeminiReady ? 'bg-emerald-400' : 'bg-gray-600'"></span>
              <div class="text-sm flex-1">
                <p class="text-gray-200 font-medium">{{ $t('settings.imageGen.geminiTitle') }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ imageGeminiReady ? $t('settings.imageGen.geminiReady') : $t('settings.imageGen.geminiMissing') }}</p>
              </div>
            </div>
            <div v-if="imageGeminiReady" class="pl-5 flex flex-wrap gap-2 items-center">
              <label class="text-xs text-gray-400 w-full sm:w-auto">{{ $t('settings.imageGen.geminiModelLabel') }}</label>
              <input v-model="imageGeminiModel" list="gemini-image-models" :placeholder="$t('settings.imageGen.geminiModelPlaceholder')"
                class="flex-1 min-w-[220px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
              <datalist id="gemini-image-models">
                <option v-for="m in imageGeminiModels" :key="m" :value="m" />
              </datalist>
              <button @click="loadGeminiImageModels" :disabled="imageGeminiModelsLoading"
                class="text-xs px-3 py-2 border border-gray-700 hover:border-gray-500 text-gray-300 rounded-lg transition-colors disabled:opacity-40">
                {{ imageGeminiModelsLoading ? $t('settings.imageGen.loadingModels') : $t('settings.imageGen.loadModels') }}
              </button>
            </div>
          </div>

          <!-- xAI Grok Imagine -->
          <div class="space-y-2">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 w-2 h-2 rounded-full shrink-0" :class="imageXaiConfigured ? 'bg-emerald-400' : 'bg-gray-600'"></span>
              <div class="text-sm flex-1">
                <p class="text-gray-200 font-medium">{{ $t('settings.imageGen.grokTitle') }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.imageGen.grokHint') }}</p>
              </div>
            </div>
            <div class="pl-5 space-y-2">
              <div v-if="imageXaiConfigured" class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-gray-300">{{ $t('settings.imageGen.grokKeyConfigured', { hint: imageXaiKeyHint }) }}</span>
                <button @click="removeXaiKey" class="text-xs px-3 py-1.5 border border-red-800/60 text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">{{ $t('settings.imageGen.grokRemoveKey') }}</button>
              </div>
              <div v-else class="flex flex-wrap gap-2">
                <input v-model="imageXaiApiKey" type="password" :placeholder="$t('settings.imageGen.grokKeyPlaceholder')"
                  class="flex-1 min-w-[220px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
              </div>
              <div class="flex flex-wrap gap-2 items-center">
                <label class="text-xs text-gray-400">{{ $t('settings.imageGen.grokModelLabel') }}</label>
                <input v-model="imageGrokModel" :placeholder="$t('settings.imageGen.grokModelPlaceholder')"
                  class="flex-1 min-w-[220px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
              </div>
            </div>
          </div>

          <!-- Local Stable Diffusion -->
          <div class="space-y-2">
            <div class="flex items-start gap-3">
              <span class="mt-0.5 w-2 h-2 rounded-full shrink-0" :class="imageLocalEndpoint.trim() ? 'bg-emerald-400' : 'bg-gray-600'"></span>
              <div class="text-sm flex-1">
                <p class="text-gray-200 font-medium">{{ $t('settings.imageGen.localTitle') }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ $t('settings.imageGen.localHint') }}</p>
              </div>
            </div>
            <div class="pl-5 space-y-2">
              <div class="flex flex-wrap gap-2">
                <input v-model="imageLocalEndpoint" type="url" :placeholder="$t('settings.imageGen.localEndpointPlaceholder')"
                  class="flex-1 min-w-[220px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500" />
                <button @click="testLocalImageServer" :disabled="!imageLocalEndpoint.trim() || imageLocalTesting"
                  class="text-xs px-3 py-2 border border-gray-700 hover:border-gray-500 text-gray-300 rounded-lg transition-colors disabled:opacity-40">
                  {{ imageLocalTesting ? $t('settings.imageGen.testing') : $t('settings.imageGen.test') }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <label class="text-xs text-gray-400">{{ $t('settings.imageGen.localStepsLabel') }}</label>
                <input v-model.number="imageLocalSteps" type="number" min="1" max="150"
                  class="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-emerald-500" />
              </div>
              <p v-if="imageLocalTestResult" class="text-xs" :class="imageLocalTestResult.ok ? 'text-emerald-400' : 'text-red-400'">
                <template v-if="imageLocalTestResult.ok">
                  {{ $t('settings.imageGen.testOk', { count: imageLocalTestResult.models.length, active: imageLocalTestResult.activeModel || '—' }) }}
                </template>
                <template v-else>{{ imageLocalTestResult.error }}</template>
              </p>
            </div>
          </div>

          <!-- Save -->
          <div class="flex items-center gap-3">
            <button @click="saveImageConfig" :disabled="imageConfigSaving"
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded-lg text-sm font-medium text-white transition-colors">
              {{ imageConfigSaving ? $t('settings.imageGen.saving') : $t('settings.imageGen.save') }}
            </button>
            <span v-if="imageConfigSaved" class="text-xs text-emerald-400">{{ $t('settings.imageGen.saved') }}</span>
            <span v-if="imageConfigError" class="text-xs text-red-400">{{ imageConfigError }}</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { usePlatformsStore } from '../stores/platforms'
import { useAiStore, PROVIDER_MODELS, CLOUD_PROVIDER_NAMES } from '../stores/ai'

const { t } = useI18n()
const platformsStore = usePlatformsStore()
const aiStore = useAiStore()

// ─── Meta app credentials ─────────────────────────────────────────────────────
const metaAppId = ref('')
const metaAppSecret = ref('')
const editingMetaApp = ref(false)
const metaAppConfigured = computed(() => platformsStore.metaCredentials.configured)

async function saveMetaApp() {
  await platformsStore.saveMetaApp(metaAppId.value, metaAppSecret.value)
  if (!platformsStore.metaError) {
    editingMetaApp.value = false
    metaAppSecret.value = ''
  }
}

// ─── Pinterest app credentials ────────────────────────────────────────────────
const pinterestClientId = ref('')
const pinterestClientSecret = ref('')
const editingPinterestApp = ref(false)
const pinterestAppConfigured = computed(() => platformsStore.pinterestCredentials.configured)

async function savePinterestApp() {
  await platformsStore.savePinterestApp(pinterestClientId.value, pinterestClientSecret.value)
  if (!platformsStore.pinterestError) {
    editingPinterestApp.value = false
    pinterestClientSecret.value = ''
  }
}

// ─── TikTok app credentials ───────────────────────────────────────────────────
const tiktokClientKey = ref('')
const tiktokClientSecret = ref('')
const editingTikTokApp = ref(false)
const tiktokAppConfigured = computed(() => platformsStore.tiktokCredentials.configured)

async function saveTikTokApp() {
  await platformsStore.saveTikTokApp(tiktokClientKey.value, tiktokClientSecret.value)
  if (!platformsStore.tiktokError) {
    editingTikTokApp.value = false
    tiktokClientSecret.value = ''
  }
}

// ─── Google Places ────────────────────────────────────────────────────────────
const placesApiKey = ref('')
const placesConfigured = ref(false)
const placesKeyHint = ref<string | null>(null)
const placesSaving = ref(false)

async function loadPlacesConfig() {
  try {
    const res = await axios.get('/api/credentials/google-places')
    placesConfigured.value = res.data.configured
    placesKeyHint.value = res.data.keyHint
  } catch { /* not configured */ }
}

async function savePlacesKey() {
  if (!placesApiKey.value.trim()) return
  placesSaving.value = true
  try {
    await axios.post('/api/credentials/google-places', { apiKey: placesApiKey.value.trim() })
    placesConfigured.value = true
    placesKeyHint.value = `****${placesApiKey.value.trim().slice(-4)}`
    placesApiKey.value = ''
  } finally {
    placesSaving.value = false
  }
}

async function removePlacesKey() {
  if (!confirm(t('settings.googlePlaces.disconnectConfirm'))) return
  await axios.delete('/api/credentials/google-places')
  placesConfigured.value = false
  placesKeyHint.value = null
}

// ─── Image Generation ─────────────────────────────────────────────────────────
const imageGeminiModel = ref('')
const imageGeminiModels = ref<string[]>([])
const imageGeminiModelsLoading = ref(false)
const imageGrokModel = ref('')
const imageXaiApiKey = ref('')
const imageXaiConfigured = ref(false)
const imageXaiKeyHint = ref<string | null>(null)
const imageLocalEndpoint = ref('')
const imageLocalSteps = ref(25)
const imageLocalTesting = ref(false)
const imageLocalTestResult = ref<{ ok: boolean; models: string[]; activeModel: string | null; error?: string } | null>(null)
const imageConfigSaving = ref(false)
const imageConfigSaved = ref(false)
const imageConfigError = ref('')

const imageOpenAiReady = computed(() => aiStore.providers.some((p) => p.name === 'openai' && p.configured))
const imageGeminiReady = computed(() => aiStore.providers.some((p) => p.name === 'gemini' && p.configured))

async function loadImageConfig() {
  try {
    const res = await axios.get('/api/ai/image-config')
    applyImageConfig(res.data)
  } catch { /* defaults */ }
}

function applyImageConfig(data: any) {
  imageGeminiModel.value = data.geminiModel || ''
  imageLocalEndpoint.value = data.localEndpoint || ''
  imageLocalSteps.value = data.localSteps || 25
  imageGrokModel.value = data.grokModel || ''
  imageXaiConfigured.value = !!data.xaiConfigured
  imageXaiKeyHint.value = data.xaiKeyHint || null
}

async function removeXaiKey() {
  if (!confirm(t('settings.imageGen.grokRemoveConfirm'))) return
  await axios.delete('/api/ai/image-config/xai-key')
  imageXaiConfigured.value = false
  imageXaiKeyHint.value = null
}

async function loadGeminiImageModels() {
  imageGeminiModelsLoading.value = true
  try {
    const res = await axios.post('/api/ai/image-config/gemini-models')
    imageGeminiModels.value = res.data.models || []
    if (!imageGeminiModel.value && imageGeminiModels.value.length) imageGeminiModel.value = imageGeminiModels.value[0]
  } catch (err: any) {
    imageConfigError.value = err.response?.data?.error || t('settings.imageGen.loadModelsFailed')
  } finally {
    imageGeminiModelsLoading.value = false
  }
}

async function testLocalImageServer() {
  imageLocalTesting.value = true
  imageLocalTestResult.value = null
  try {
    const res = await axios.post('/api/ai/image-config/test-local', { endpoint: imageLocalEndpoint.value.trim() })
    imageLocalTestResult.value = res.data
  } catch (err: any) {
    imageLocalTestResult.value = { ok: false, models: [], activeModel: null, error: err.response?.data?.error || err.message }
  } finally {
    imageLocalTesting.value = false
  }
}

async function saveImageConfig() {
  imageConfigSaving.value = true
  imageConfigSaved.value = false
  imageConfigError.value = ''
  try {
    const res = await axios.put('/api/ai/image-config', {
      geminiModel: imageGeminiModel.value.trim(),
      localEndpoint: imageLocalEndpoint.value.trim(),
      localSteps: imageLocalSteps.value,
      grokModel: imageGrokModel.value.trim(),
      xaiApiKey: imageXaiApiKey.value.trim() || undefined,
    })
    applyImageConfig(res.data)
    imageXaiApiKey.value = ''
    imageConfigSaved.value = true
    setTimeout(() => { imageConfigSaved.value = false }, 3000)
  } catch (err: any) {
    imageConfigError.value = err.response?.data?.error || t('settings.imageGen.saveFailed')
  } finally {
    imageConfigSaving.value = false
  }
}

// ─── AI Configuration — Ollama ────────────────────────────────────────────────
const aiEndpoint = ref('')
const aiModel = ref('')
const aiVisionModel = ref('')
const aiModels = computed(() => aiStore.models)
const aiConnected = ref<boolean | null>(null)
const aiSaved = ref(false)

async function testAiConnection() {
  const ok = await aiStore.fetchModels(aiEndpoint.value)
  aiConnected.value = ok
  if (ok && !aiModel.value && aiStore.models.length) aiModel.value = aiStore.models[0]
}

async function saveAiConfig() {
  const ok = await aiStore.saveProvider('ollama', { endpoint: aiEndpoint.value, model: aiModel.value, visionModel: aiVisionModel.value, setActive: true })
  if (ok) {
    aiSaved.value = true
    setTimeout(() => { aiSaved.value = false }, 2500)
  }
}

// ─── Cloud AI providers ───────────────────────────────────────────────────────
interface ProviderFormState {
  apiKey: string; baseUrl: string; model: string; editing: boolean; saving: boolean; saved: boolean
}

const PROVIDER_BADGE: Record<string, { cls: string; abbr: string }> = {
  anthropic: { cls: 'bg-amber-700',   abbr: 'CLD' },
  openai:    { cls: 'bg-emerald-700', abbr: 'OAI' },
  groq:      { cls: 'bg-orange-700',  abbr: 'GRQ' },
  gemini:    { cls: 'bg-blue-700',    abbr: 'GEM' },
  custom:    { cls: 'bg-gray-600',    abbr: 'API' },
}

const emptyForm = (): ProviderFormState => ({ apiKey: '', baseUrl: '', model: '', editing: false, saving: false, saved: false })
const providerForms = ref<Record<string, ProviderFormState>>(
  Object.fromEntries(CLOUD_PROVIDER_NAMES.map((n) => [n, emptyForm()])),
)

// Live model lists fetched from each provider (falls back to PROVIDER_MODELS)
const liveModels = ref<Record<string, string[] | null>>({})

function getProvider(name: string) {
  return aiStore.providers.find((p) => p.name === name)
}

function modelOptions(name: string): string[] {
  return liveModels.value[name] ?? PROVIDER_MODELS[name] ?? []
}

function canSave(name: string): boolean {
  const form = providerForms.value[name]
  if (name === 'custom') return !!form.baseUrl.trim() && !!form.model.trim()
  return !!form.apiKey
}

const providerTests = ref<Record<string, { loading: boolean; ok: boolean; message: string }>>({})
async function testCloudProvider(name: string) {
  providerTests.value[name] = { loading: true, ok: false, message: '' }
  try {
    const form = providerForms.value[name]
    const res = await axios.post('/api/ai/provider/' + name + '/test', { apiKey: form.apiKey || undefined, baseUrl: form.baseUrl || undefined })
    liveModels.value[name] = res.data.models
    providerTests.value[name] = { loading: false, ok: true, message: t('ai.connected') }
  } catch (err: any) {
    providerTests.value[name] = { loading: false, ok: false, message: err.response?.data?.error || err.message }
  }
}

async function refreshProviderModels(name: string) {
  const form = providerForms.value[name]
  const models = await aiStore.fetchProviderModels(name, {
    apiKey: form?.apiKey || undefined,
    baseUrl: name === 'custom' ? (form?.baseUrl || undefined) : undefined,
  })
  liveModels.value[name] = models.length ? models : null
  if (form && !form.model && models.length) form.model = models[0]
}

async function saveCloudProvider(name: string, setActive = false) {
  const form = providerForms.value[name]
  form.saving = true
  const ok = await aiStore.saveProvider(name, {
    apiKey: form.apiKey || undefined,
    baseUrl: name === 'custom' ? (form.baseUrl.trim() || undefined) : undefined,
    model: form.model || undefined,
    setActive,
  })
  form.saving = false
  if (ok) {
    form.saved = true
    form.editing = false
    form.apiKey = ''
    setTimeout(() => { form.saved = false }, 2500)
    refreshProviderModels(name)
  }
}

async function setActiveProvider(name: string) {
  if (!getProvider(name)?.configured) return
  await aiStore.saveProvider(name, { setActive: true })
}

async function disconnectCloudProvider(name: string) {
  if (!confirm(t('ai.disconnectConfirm'))) return
  await aiStore.deleteProvider(name)
}

// ─── On mount ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await Promise.all([
    platformsStore.fetchMetaCredentials(),
    platformsStore.fetchPinterestCredentials(),
    platformsStore.fetchTikTokCredentials(),
    aiStore.fetchConfig(),
    aiStore.fetchProviders(),
    loadPlacesConfig(),
    loadImageConfig(),
  ])
  aiEndpoint.value = aiStore.config.endpoint
  aiModel.value = aiStore.config.model
  aiVisionModel.value = aiStore.config.visionModel
  for (const p of aiStore.providers) {
    if (p.name === 'ollama') continue
    const form = providerForms.value[p.name]
    if (!form) continue
    form.model = p.model || ''
    form.baseUrl = p.baseUrl || ''
    if (p.configured) refreshProviderModels(p.name)
  }
})
</script>
