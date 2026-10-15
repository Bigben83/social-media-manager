<template>
  <main class="min-h-screen bg-gray-950 text-gray-100 p-4 sm:p-6">
    <div class="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 class="text-2xl font-bold">{{ $t('localAssistant.title') }}</h1>
        <p class="mt-2 text-sm text-gray-400">{{ $t('localAssistant.description') }}</p>
        <p class="mt-2 text-sm text-violet-300">{{ workspaceStore.activeWorkspace?.name }} <span v-if="model">· {{ model }}</span></p>
      </div>
      <p v-if="error" role="alert" class="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">{{ error }}</p>
      <section v-if="!authenticated && !loading" class="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-3">
        <p class="text-sm text-gray-300">{{ $t('localAssistant.signInHint') }}</p>
        <a href="/connector/login?returnTo=/local-assistant" class="inline-block bg-violet-700 rounded-lg px-4 py-2">{{ $t('localAssistant.signIn') }}</a>
      </section>
      <section v-else-if="authenticated && !session" class="rounded-2xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <h2 class="font-semibold">{{ $t('localAssistant.permissions') }}</h2>
        <p class="text-sm text-gray-400">{{ $t('localAssistant.permissionsHint') }}</p>
        <label v-for="permission in permissions" :key="permission.scope" class="flex gap-3 items-start text-sm">
          <input v-model="scopes" :value="permission.scope" type="checkbox" :disabled="permission.scope === 'social:read'" class="mt-1" />
          <span>{{ $t('localAssistant.' + permission.key) }}</span>
        </label>
        <button @click="begin" :disabled="loading || !model" class="bg-violet-700 rounded-lg px-4 py-2 disabled:opacity-40">{{ loading ? $t('localAssistant.checking') : $t('localAssistant.start') }}</button>
        <a href="/global-settings#settings-local" class="ml-3 text-sm text-violet-300 underline">{{ $t('localAssistant.settings') }}</a>
      </section>
      <template v-if="session">
        <div class="flex flex-wrap gap-3 text-sm">
          <button @click="newSession" :disabled="busy || acting" class="rounded-lg border border-gray-700 px-3 py-2 disabled:opacity-40">{{ $t('localAssistant.newSession') }}</button>
          <a href="/calendar-plan" class="px-3 py-2 text-violet-300 underline">{{ $t('localAssistant.plans') }}</a>
          <a href="/scheduler" class="px-3 py-2 text-violet-300 underline">{{ $t('localAssistant.drafts') }}</a>
          <a href="/connector" class="px-3 py-2 text-gray-400 underline">{{ $t('localAssistant.manage') }}</a>
        </div>
        <div v-if="session.error" role="alert" class="rounded-xl border border-amber-800 p-4 text-sm text-amber-200">{{ session.error }}</div>
        <div aria-live="polite" class="space-y-3">
          <article v-for="(message, index) in session.messages" :key="index" class="rounded-xl border border-gray-800 p-4" :class="message.role === 'user' ? 'bg-gray-800/70' : 'bg-gray-900'">
            <p class="mb-2 text-xs font-semibold text-violet-300">{{ message.role === 'user' ? $t('localAssistant.you') : $t('localAssistant.assistant') }}</p>
            <p class="whitespace-pre-wrap break-words text-sm">{{ message.content }}</p>
          </article>
        </div>
        <details v-if="session.events?.length" class="rounded-xl border border-gray-800 p-4">
          <summary class="text-sm cursor-pointer">{{ $t('localAssistant.toolActivity') }}</summary>
          <ul class="mt-3 space-y-1 text-xs text-gray-400"><li v-for="(event, index) in session.events" :key="index">{{ event.success ? '✓' : '×' }} {{ event.tool }}</li></ul>
        </details>
        <section v-if="session.status === 'awaiting_confirmation' && session.pendingPreview" class="rounded-2xl border border-amber-700 bg-amber-950/20 p-5 space-y-4">
          <h2 class="font-semibold text-amber-200">{{ $t('localAssistant.review') }}</h2>
          <p class="text-sm text-gray-400">{{ $t('localAssistant.reviewHint') }}</p>
          <p class="whitespace-pre-wrap text-sm">{{ session.pendingPreview.content }}</p>
          <p v-if="session.pendingPreview.firstComment" class="whitespace-pre-wrap text-sm">{{ $t('localAssistant.firstComment') }}: {{ session.pendingPreview.firstComment }}</p>
          <ul class="text-sm space-y-2">
            <li v-for="(destination, index) in session.pendingPreview.destinations" :key="index">
              <strong>{{ session.pendingPreview.accounts?.[index]?.name || destination.accountId || destination.platform }}</strong> · {{ destination.platform }}
              <a v-for="field in (['imageUrl','videoUrl','link'] as const)" :key="field" v-show="destination[field]" :href="destination[field]" target="_blank" rel="noopener noreferrer" class="block text-xs text-violet-300 underline break-all">{{ destination[field] }}</a>
            </li>
          </ul>
          <p class="text-sm">{{ session.pendingPreview.scheduledAt ? $t('localAssistant.scheduledTime') + ': ' + session.pendingPreview.scheduledAt + ' (' + new Date(session.pendingPreview.scheduledAt).toLocaleString() + ')' : $t('localAssistant.immediate') }}</p>
          <p class="text-xs text-gray-400">{{ $t('localAssistant.expires') }}: {{ new Date(session.pendingPreview.expiresAt).toLocaleString() }}</p>
          <div class="flex flex-wrap gap-3">
            <button @click="decide('confirm')" :disabled="acting" class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold disabled:opacity-40">{{ session.pendingPreview.mode === 'schedule' ? $t('localAssistant.confirmSchedule') : $t('localAssistant.confirmPublish') }}</button>
            <button @click="decide('cancel')" :disabled="acting" class="rounded-lg border border-gray-700 px-4 py-2 text-sm disabled:opacity-40">{{ $t('localAssistant.cancel') }}</button>
          </div>
        </section>
        <section v-if="session.deliveryResult" class="rounded-xl border border-gray-700 p-4">
          <h2 class="font-semibold">{{ $t('localAssistant.deliveryResult') }}</h2>
          <pre class="mt-2 whitespace-pre-wrap break-words text-xs text-gray-300">{{ JSON.stringify(session.deliveryResult, null, 2) }}</pre>
        </section>
        <p v-if="busy" role="status" class="text-sm text-violet-300">{{ $t('localAssistant.working') }}</p>
        <form @submit.prevent="send" class="space-y-3">
          <label for="local-message" class="text-sm">{{ $t('localAssistant.message') }}</label>
          <textarea id="local-message" v-model="message" rows="5" maxlength="20000" :placeholder="$t('localAssistant.placeholder')" :disabled="busy || session.status === 'awaiting_confirmation'" class="w-full rounded-xl border border-gray-700 bg-gray-900 p-3 text-sm disabled:opacity-50"></textarea>
          <button :disabled="busy || acting || !message.trim() || session.status === 'awaiting_confirmation'" class="rounded-lg bg-violet-700 px-5 py-2 disabled:opacity-40">{{ $t('localAssistant.send') }}</button>
        </form>
      </template>
    </div>
  </main>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import { useWorkspaceStore } from '../stores/workspace'
const workspaceStore = useWorkspaceStore()
const authenticated = ref(false), loading = ref(true), acting = ref(false)
const csrf = ref(''), model = ref(''), error = ref(''), message = ref(''), session = ref<any>(null)
const scopes = ref(['social:read', 'social:drafts'])
const permissions = [{ scope:'social:read',key:'read' },{ scope:'social:drafts',key:'write' },{ scope:'social:publish',key:'publish' },{ scope:'social:schedule',key:'schedule' }]
const busy = computed(() => session.value?.status === 'running')
const storageKey = () => 'local-assistant:' + workspaceStore.activeWorkspaceId
const describe = (err: any) => err.response?.data?.error || err.message
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
async function refresh() {
  const id = session.value?.id || localStorage.getItem(storageKey())
  if (!id || disposed) return
  try { session.value = (await axios.get('/connector/local/sessions/' + id)).data; error.value = '' }
  catch (err: any) {
    error.value = describe(err)
    if ([401,403,404].includes(err.response?.status)) { session.value = null; localStorage.removeItem(storageKey()); if (err.response?.status === 401) authenticated.value = false }
  }
  if (session.value?.status === 'running' && !disposed) timer = setTimeout(refresh, 2000)
}
async function begin() {
  loading.value = true; error.value = ''
  try {
    session.value = (await axios.post('/connector/local/sessions', { csrf:csrf.value,workspaceId:workspaceStore.activeWorkspaceId,scopes:scopes.value })).data
    localStorage.setItem(storageKey(), session.value.id)
  } catch (err) { error.value = describe(err) } finally { loading.value = false }
}
async function send() {
  if (!session.value || busy.value || acting.value) return
  acting.value = true; error.value = ''
  try { await axios.post('/connector/local/sessions/' + session.value.id + '/turn', { csrf:csrf.value,workspaceId:workspaceStore.activeWorkspaceId,message:message.value }); message.value = ''; await refresh() }
  catch (err) { await refresh(); error.value = describe(err) } finally { acting.value = false }
}
async function decide(decision: 'confirm' | 'cancel') {
  acting.value = true; error.value = ''
  try { await axios.post('/connector/local/sessions/' + session.value.id + '/confirm', { csrf:csrf.value,workspaceId:workspaceStore.activeWorkspaceId,previewId:session.value.pendingPreview.previewId,decision }); await refresh() }
  catch (err) { await refresh(); error.value = describe(err) } finally { acting.value = false }
}
function newSession() { if (!busy.value && !acting.value) { session.value = null; localStorage.removeItem(storageKey()); error.value = '' } }
onMounted(async () => {
  try { const result = (await axios.get('/connector/local/status')).data; authenticated.value = true; csrf.value = result.csrf; model.value = result.model || ''; error.value = result.error || ''; await refresh() }
  catch (err: any) { if (err.response?.status !== 401) error.value = describe(err) }
  finally { loading.value = false }
})
onUnmounted(() => { disposed = true; if (timer) clearTimeout(timer) })
</script>
