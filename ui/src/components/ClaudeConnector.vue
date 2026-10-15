<template>
  <section id="claude-connector" class="bg-gray-900 border border-violet-800/50 rounded-2xl overflow-hidden">
    <div class="p-5 border-b border-gray-800">
      <h2 class="font-semibold text-violet-200">{{ $t('claudeConnector.title') }}</h2>
      <p class="text-xs text-gray-400 mt-1">{{ $t('claudeConnector.description') }}</p>
    </div>
    <div class="p-5 space-y-3">
      <label for="claude-mcp-url" class="block text-xs text-gray-400">{{ $t('claudeConnector.urlLabel') }}</label>
      <input id="claude-mcp-url" :value="connectorUrl" readonly class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100" />
      <p class="text-xs text-gray-400">{{ $t('claudeConnector.instructions') }}</p>
      <p v-if="!configured" class="text-xs text-amber-300">{{ $t('claudeConnector.setupRequired') }}</p>
      <a href="/connector" target="_blank" rel="noopener" class="inline-block px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-sm font-medium text-white">{{ $t('claudeConnector.manageAccess') }}</a>
      <p class="text-xs text-gray-500">{{ $t('claudeConnector.apiNote') }}</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import axios from 'axios'
const connectorUrl = ref(new URL('/mcp', window.location.origin).href)
const configured = ref(false)
onMounted(async () => {
  try { const result = await axios.get('/connector/info'); connectorUrl.value = result.data.resourceUrl; configured.value = result.data.configured === true } catch { /* Show setup guidance if unavailable. */ }
})
</script>
