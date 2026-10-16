<template>
  <details class="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm">
    <summary class="cursor-pointer text-pink-300">{{ $t('reelBuilder.title') }}</summary>
    <div class="mt-3 space-y-3">
      <p class="text-xs text-gray-400">{{ $t('reelBuilder.description') }}</p>
      <div class="flex gap-2">
        <select v-model="selectedImage" :aria-label="$t('reelBuilder.image')" class="bg-gray-800 rounded p-2 flex-1 min-w-0">
          <option value="">{{ $t('reelBuilder.image') }}</option>
          <option v-for="asset in images" :key="asset.url" :value="asset.url">{{ asset.originalName }}</option>
        </select>
        <button @click="addScene" :disabled="!selectedImage || scenes.length >= 12 || running" class="bg-gray-700 rounded px-3 disabled:opacity-40">{{ $t('reelBuilder.add') }}</button>
        <button @click="loadAssets" class="text-blue-400">{{ $t('reelBuilder.refresh') }}</button>
      </div>
      <article v-for="(scene, index) in scenes" :key="scene.id" class="flex gap-3 border border-gray-700 rounded-lg p-3">
        <div class="relative w-24 shrink-0 bg-white overflow-hidden" style="aspect-ratio:9/16">
          <img :src="scene.mediaUrl" class="w-full h-full" :class="scene.fit === 'cover' ? 'object-cover' : 'object-contain'" />
          <p class="absolute text-white bg-black/70 whitespace-pre-wrap break-words" style="left:7%;right:16%;top:55%;font-size:5px;line-height:1.2;padding:3px">{{ scene.text }}</p>
        </div>
        <div class="flex-1 min-w-0 space-y-2">
          <div class="flex gap-2 items-center text-xs">
            <span>{{ $t('reelBuilder.scene', { number: index + 1 }) }}</span>
            <button @click="move(index, -1)" :disabled="index === 0 || running" :aria-label="$t('reelBuilder.up')">↑</button>
            <button @click="move(index, 1)" :disabled="index === scenes.length - 1 || running" :aria-label="$t('reelBuilder.down')">↓</button>
            <button @click="scenes.splice(index, 1)" :disabled="running" class="ml-auto text-red-400">{{ $t('reelBuilder.remove') }}</button>
          </div>
          <textarea v-model="scene.text" :disabled="running" maxlength="168" rows="3" :placeholder="$t('reelBuilder.text')" :aria-label="$t('reelBuilder.text')" class="bg-gray-800 rounded p-2 w-full text-xs" />
          <div class="flex flex-wrap gap-2 text-xs">
            <label>{{ $t('reelBuilder.seconds') }} <input v-model.number="scene.duration" :disabled="running" type="number" min="3" max="10" class="bg-gray-800 rounded p-1 w-14" /></label>
            <select v-model="scene.fit" :disabled="running" :aria-label="$t('imageFormats.fit')" class="bg-gray-800 rounded p-1 max-w-full">
              <option value="contain">{{ $t('imageFormats.contain') }}</option><option value="cover">{{ $t('imageFormats.cover') }}</option>
            </select>
          </div>
        </div>
      </article>
      <label class="block text-xs">{{ $t('reelBuilder.transition') }}
        <select v-model="transition" :disabled="running" class="bg-gray-800 rounded p-2 ml-2"><option value="cut">{{ $t('reelBuilder.cut') }}</option><option value="fade">{{ $t('reelBuilder.fade') }}</option></select>
      </label>
      <label class="block text-xs">{{ $t('reelBuilder.audio') }}
        <select v-model="audioUrl" :disabled="running" class="bg-gray-800 rounded p-2 block mt-1 w-full"><option value="">{{ $t('reelBuilder.noAudio') }}</option><option v-for="asset in soundtracks" :key="asset.url" :value="asset.url">{{ asset.originalName }}</option></select>
      </label>
      <label v-if="audioUrl" class="flex gap-2 text-xs"><input v-model="audioRightsConfirmed" :disabled="running" type="checkbox" />{{ $t('reelBuilder.audioRights') }}</label>
      <p class="text-xs text-gray-400">{{ $t('reelBuilder.total', { seconds: total }) }} · 1080 × 1920 · 9:16</p>
      <div class="flex flex-wrap gap-2">
        <button @click="render" :disabled="running || !scenes.length || (!!audioUrl && !audioRightsConfirmed)" class="bg-pink-800 rounded px-3 py-2 disabled:opacity-40">{{ $t('reelBuilder.render') }}</button>
        <button v-if="running" @click="cancel" class="text-red-400">{{ $t('reelBuilder.cancel') }}</button>
        <button v-if="status === 'failed'" @click="retry" class="text-blue-400">{{ $t('reelBuilder.retry') }}</button>
      </div>
      <p v-if="running" role="status" class="text-xs text-blue-300">{{ $t('reelBuilder.progress', { completed: progress.completed || 0, total: progress.total || scenes.length + 1 }) }}</p>
      <p v-if="error" role="alert" class="text-xs text-red-400">{{ error }}</p>
      <div v-if="result" class="space-y-2">
        <video :src="result.mediaUrl" controls class="max-h-96 max-w-full rounded-lg" />
        <button @click="emit('apply', result.mediaUrl)" class="bg-emerald-700 rounded px-3 py-2">{{ $t('reelBuilder.use') }}</button>
      </div>
    </div>
  </details>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import { useWorkspaceStore } from '../../stores/workspace'
const emit = defineEmits<{ (event: 'apply', url: string): void }>()
const workspaceId = useWorkspaceStore().activeWorkspaceId
const storageKey = 'reel.render.' + workspaceId
type Asset = { url: string; originalName: string; mimetype: string }
type Scene = { id: number; mediaUrl: string; text: string; duration: number; fit: string }
const assets = ref<Asset[]>([]), selectedImage = ref(''), scenes = ref<Scene[]>([])
const transition = ref('cut'), audioUrl = ref(''), audioRightsConfirmed = ref(false)
const jobId = ref(''), status = ref(''), error = ref('')
const progress = ref<{ completed?: number; total?: number }>({})
const result = ref<{ mediaUrl: string } | null>(null)
const images = computed(() => assets.value.filter(a => a.mimetype.startsWith('image/')))
const soundtracks = computed(() => assets.value.filter(a => /^(audio|video)\//.test(a.mimetype)))
const total = computed(() => scenes.value.reduce((sum, scene) => sum + Number(scene.duration), 0))
const running = computed(() => ['submitting', 'queued', 'running'].includes(status.value))
let nextId = 0, polling = false
async function loadAssets() { try { assets.value = (await axios.get('/api/media-library')).data.files || [] } catch (err: any) { error.value = err.message } }
function addScene() { scenes.value.push({ id: ++nextId, mediaUrl: selectedImage.value, text: '', duration: 3, fit: 'contain' }) }
function move(index: number, offset: number) { const scene = scenes.value.splice(index, 1)[0]; if (scene) scenes.value.splice(index + offset, 0, scene) }
async function poll() {
  if (!jobId.value || polling) return
  polling = true
  try {
    const response = await axios.get('/api/ai/jobs/' + jobId.value)
    status.value = response.data.status; progress.value = response.data.progress || {}
    result.value = response.data.result || null; error.value = response.data.error || ''
  } catch (err: any) { error.value = err.response?.data?.error || err.message }
  finally { polling = false }
}
async function render() {
  status.value = 'submitting'; error.value = ''; result.value = null
  try {
    const response = await axios.post('/api/reels/render', { scenes: scenes.value.map(({ id, ...scene }) => scene), transition: transition.value, audioUrl: audioUrl.value || undefined, audioRightsConfirmed: audioRightsConfirmed.value })
    jobId.value = response.data.jobId; status.value = 'queued'
    localStorage.setItem(storageKey, jobId.value)
    await poll()
  } catch (err: any) { status.value = 'failed'; error.value = err.response?.data?.error || err.message }
}
async function cancel() { try { await axios.delete('/api/reels/jobs/' + jobId.value); await poll() } catch (err: any) { error.value = err.message } }
async function retry() { try { await axios.post('/api/reels/jobs/' + jobId.value + '/retry'); await poll() } catch (err: any) { error.value = err.response?.data?.error || err.message } }
const timer = setInterval(() => { if (running.value) void poll() }, 2000)
onMounted(async () => { await loadAssets(); jobId.value = localStorage.getItem(storageKey) || ''; if (jobId.value) await poll() })
onUnmounted(() => clearInterval(timer))
</script>
