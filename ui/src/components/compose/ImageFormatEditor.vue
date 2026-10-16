<template>
  <details class="mt-3 text-xs border border-gray-700 rounded-lg p-3">
    <summary class="cursor-pointer text-emerald-300">{{ $t('imageFormats.prepare') }}</summary>
    <div class="flex flex-wrap gap-2 my-3">
      <select v-model="ratio" :aria-label="$t('imageFormats.ratio')" class="bg-gray-800 rounded p-2">
        <option value="3:4">3:4 · 1080 × 1440</option>
        <option value="9:16">9:16 · 1080 × 1920</option>
        <option value="4:5">4:5 · 1080 × 1350</option>
      </select>
      <select v-model="fit" :aria-label="$t('imageFormats.fit')" class="bg-gray-800 rounded p-2">
        <option value="contain">{{ $t('imageFormats.contain') }}</option>
        <option value="cover">{{ $t('imageFormats.cover') }}</option>
      </select>
      <button :disabled="busy" @click="prepare" class="bg-emerald-800 rounded px-3 disabled:opacity-50">{{ $t('imageFormats.preview') }}</button>
    </div>
    <p class="text-gray-400">{{ $t('imageFormats.originalKept') }}</p>
    <p v-if="error" class="text-red-400">{{ error }}</p>
    <div v-if="preview" class="mt-3 space-y-2">
      <img :src="preview.mediaUrl" class="max-h-80 max-w-full object-contain rounded" />
      <p>{{ preview.width }} × {{ preview.height }} · {{ preview.aspect }}</p>
      <button @click="emit('apply', preview.mediaUrl); preview = null" class="bg-emerald-700 rounded px-3 py-2">{{ $t('imageFormats.apply') }}</button>
    </div>
  </details>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import axios from 'axios'
const props = defineProps<{ mediaUrl: string; aspect?: string }>()
const emit = defineEmits<{ (event: 'apply', url: string): void }>()
const ratio = ref(props.aspect || '3:4')
const fit = ref('contain')
const busy = ref(false)
const error = ref('')
const preview = ref<{ mediaUrl: string; width: number; height: number; aspect: string } | null>(null)
watch(() => props.aspect, value => { if (value) ratio.value = value })
watch([ratio, fit, () => props.mediaUrl], () => { preview.value = null })
async function prepare() {
  busy.value = true; error.value = ''
  const source = props.mediaUrl, requested = ratio.value, method = fit.value
  try {
    const response = await axios.post('/api/media/prepare-image', { mediaUrl: source, aspect: requested, fit: method })
    if (props.mediaUrl === source && ratio.value === requested && fit.value === method) preview.value = response.data
  } catch (err: any) { error.value = err.response?.data?.detail || err.message }
  finally { busy.value = false }
}
</script>
