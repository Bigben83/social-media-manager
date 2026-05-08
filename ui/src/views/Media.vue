<template>
  <div class="flex flex-col h-screen overflow-hidden bg-gray-950 text-gray-100">

    <!-- Header toolbar -->
    <header class="flex items-center gap-4 px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
      <h1 class="text-base font-bold flex-1">{{ $t('media.title') }}</h1>

      <span class="text-xs text-gray-500">{{ $t('media.fileCount', { count: files.length }) }}</span>

      <!-- Upload button -->
      <button
        @click="fileInputRef?.click()"
        :disabled="uploading"
        class="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        {{ uploading ? $t('media.uploading') : $t('media.upload') }}
      </button>

      <!-- Hidden multi-file input -->
      <input
        ref="fileInputRef"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo"
        multiple
        class="hidden"
        @change="handleFiles"
      />
    </header>

    <!-- Upload progress bar -->
    <div v-if="uploading" class="flex-shrink-0 bg-blue-900/30 border-b border-blue-800/40 px-6 py-2 text-xs text-blue-300 flex items-center gap-3">
      <svg class="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      {{ uploadStatus }}
    </div>

    <!-- Upload error -->
    <div v-if="uploadError" class="flex-shrink-0 bg-red-900/30 border-b border-red-800/40 px-6 py-2 text-xs text-red-300 flex items-center justify-between">
      <span>{{ uploadError }}</span>
      <button @click="uploadError = ''" class="text-red-400 hover:text-red-200">✕</button>
    </div>

    <!-- Drag-and-drop zone (shown when no files or as overlay) -->
    <div
      v-if="!files.length && !loading"
      class="flex-1 flex flex-col items-center justify-center gap-4 border-2 border-dashed border-gray-800 m-6 rounded-2xl cursor-pointer hover:border-blue-700 hover:bg-blue-950/10 transition-colors"
      @click="fileInputRef?.click()"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <svg class="w-12 h-12 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <div class="text-center">
        <p class="text-gray-400 font-medium">{{ $t('media.dropZoneTitle') }}</p>
        <p class="text-gray-600 text-sm mt-1">{{ $t('media.dropZoneHint') }}</p>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-else-if="loading" class="flex-1 overflow-y-auto p-6">
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2">
        <div v-for="i in 12" :key="i" class="aspect-square rounded-xl bg-gray-800 animate-pulse" />
      </div>
    </div>

    <!-- Media grid -->
    <div
      v-else
      class="flex-1 overflow-y-auto p-6"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2">
        <div
          v-for="file in files"
          :key="file._id"
          class="group relative aspect-square rounded-xl overflow-hidden bg-gray-900 border border-gray-800 hover:border-gray-600 transition-colors"
        >
          <!-- Image thumbnail -->
          <img
            v-if="isImage(file.mimetype)"
            :src="file.url"
            :alt="file.originalName"
            class="w-full h-full object-cover"
            loading="lazy"
          />

          <!-- Video placeholder -->
          <div v-else class="w-full h-full flex flex-col items-center justify-center gap-2 bg-gray-800">
            <svg class="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.882v6.236a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span class="text-xs text-gray-500 px-2 text-center truncate w-full">{{ file.originalName }}</span>
          </div>

          <!-- Hover overlay with actions -->
          <div class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
            <!-- File info -->
            <div class="truncate">
              <p class="text-xs text-white font-medium truncate">{{ file.originalName }}</p>
              <p class="text-xs text-gray-400">{{ formatSize(file.size) }}</p>
            </div>

            <!-- Action buttons -->
            <div class="flex flex-col gap-1.5">
              <button
                @click="useInPost(file.url)"
                class="w-full py-1 bg-blue-600 hover:bg-blue-500 rounded-md text-xs font-medium text-white transition-colors"
              >
                {{ $t('media.useInPost') }}
              </button>
              <div class="flex gap-1">
                <button
                  @click="copyUrl(file.url)"
                  class="flex-1 py-1 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-200 transition-colors"
                  :class="copied === file.url ? 'bg-green-700 hover:bg-green-700' : ''"
                >
                  {{ copied === file.url ? '✓ ' + $t('media.copied') : $t('media.copyUrl') }}
                </button>
                <button
                  @click="confirmDelete(file)"
                  class="px-2 py-1 bg-gray-700 hover:bg-red-700 rounded-md text-xs text-gray-300 hover:text-white transition-colors"
                  title="Delete"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <div v-if="deleteTarget" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <h2 class="font-semibold text-white mb-2">{{ $t('media.deleteConfirmTitle') }}</h2>
        <p class="text-sm text-gray-400 mb-1 truncate">{{ deleteTarget.originalName }}</p>
        <p class="text-xs text-gray-600 mb-5">{{ $t('media.deleteConfirmHint') }}</p>
        <div class="flex gap-3 justify-end">
          <button
            @click="deleteTarget = null"
            class="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >{{ $t('media.cancel') }}</button>
          <button
            @click="doDelete"
            :disabled="deleting"
            class="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >{{ deleting ? $t('media.deleting') : $t('media.delete') }}</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

interface MediaFile {
  _id: string
  filename: string
  originalName: string
  url: string
  mimetype: string
  size: number
  uploadedAt: string
}

const router = useRouter()

const files = ref<MediaFile[]>([])
const loading = ref(true)
const uploading = ref(false)
const uploadStatus = ref('')
const uploadError = ref('')
const deleting = ref(false)
const deleteTarget = ref<MediaFile | null>(null)
const copied = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

onMounted(fetchLibrary)

async function fetchLibrary() {
  loading.value = true
  try {
    const res = await axios.get('/api/media-library')
    files.value = res.data.files
  } catch {
    // silently fail — empty grid shown
  } finally {
    loading.value = false
  }
}

async function handleFiles(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files ?? [])
  if (selected.length) await uploadFiles(selected)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

function handleDrop(event: DragEvent) {
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (dropped.length) uploadFiles(dropped)
}

async function uploadFiles(fileList: File[]) {
  uploading.value = true
  uploadError.value = ''
  const total = fileList.length

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]
    uploadStatus.value = total > 1
      ? `Uploading ${i + 1} of ${total}: ${file.name}`
      : `Uploading ${file.name}…`

    try {
      const form = new FormData()
      form.append('file', file)
      const res = await axios.post('/api/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      files.value.unshift({ ...res.data, _id: Date.now().toString(), originalName: file.name, uploadedAt: new Date().toISOString() })
    } catch (err: any) {
      uploadError.value = `${file.name}: ${err.response?.data?.error ?? 'Upload failed'}`
    }
  }

  uploading.value = false
  uploadStatus.value = ''
  // Refresh to get server-side records (with real _ids)
  await fetchLibrary()
}

function confirmDelete(file: MediaFile) {
  deleteTarget.value = file
}

async function doDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await axios.delete(`/api/media/${deleteTarget.value.filename}`)
    files.value = files.value.filter((f) => f.filename !== deleteTarget.value!.filename)
    deleteTarget.value = null
  } catch (err: any) {
    uploadError.value = err.response?.data?.error ?? 'Delete failed'
    deleteTarget.value = null
  } finally {
    deleting.value = false
  }
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${url}`)
    copied.value = url
    setTimeout(() => { copied.value = '' }, 2000)
  } catch {
    // fallback: select the text
  }
}

function useInPost(url: string) {
  router.push({ path: '/compose', query: { media: url } })
}

function isImage(mimetype: string) {
  return mimetype.startsWith('image/')
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}
</script>
