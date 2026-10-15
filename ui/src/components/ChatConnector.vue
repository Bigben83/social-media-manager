<template>
  <section :id="provider + '-connector'" class="bg-gray-900 border border-violet-800/50 rounded-2xl overflow-hidden">
    <div class="p-5 border-b border-gray-800">
      <h2 class="font-semibold text-violet-200">{{ $t(localePrefix + '.title') }}</h2>
      <p class="text-xs text-gray-400 mt-1">{{ $t(localePrefix + '.description') }}</p>
    </div>
    <div class="p-5 space-y-3">
      <label :for="provider + '-mcp-url'" class="block text-xs text-gray-400">{{ $t(localePrefix + '.urlLabel') }}</label>
      <input :id="provider + '-mcp-url'" :value="connectorUrl" readonly class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100" />
      <p class="text-xs text-gray-400">{{ $t(localePrefix + '.instructions') }}</p>
      <template v-if="provider === 'chatgpt'">
        <a href="/connector/chatgpt-plugin.zip" download="socialmanager-chatgpt-plugin.zip" class="inline-block rounded-lg bg-emerald-800 px-4 py-2 text-sm text-white">{{ $t('chatgptConnector.downloadPlugin') }}</a>
        <p class="text-xs text-gray-400">{{ $t('chatgptConnector.uploadHint') }}</p>
      </template>
      <p v-if="!configured" class="text-xs text-amber-300">{{ $t(localePrefix + '.setupRequired') }}</p>
      <a href="/connector" target="_blank" rel="noopener" class="inline-block px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-sm font-medium text-white">{{ $t(localePrefix + '.manageAccess') }}</a>
      <a v-if="provider === 'local'" href="/local-assistant" class="ml-3 inline-block text-sm text-violet-200 underline">{{ $t('localConnector.openAssistant') }}</a>
      <p class="text-xs text-gray-500">{{ $t(localePrefix + '.apiNote') }}</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import axios from 'axios'
const props = defineProps<{ provider: 'claude' | 'chatgpt' | 'local' }>()
const localePrefix = computed(() => props.provider === 'local' ? 'localConnector' : props.provider === 'chatgpt' ? 'chatgptConnector' : 'claudeConnector')
const connectorUrl = ref(new URL('/mcp', window.location.origin).href)
const configured = ref(false)
onMounted(async () => {
  try { const result = await axios.get('/connector/info'); connectorUrl.value = result.data.resourceUrl; configured.value = result.data.configured === true } catch { /* Show setup guidance if unavailable. */ }
})
</script>
