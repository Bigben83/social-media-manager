<template>
  <span class="inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden text-white" :style="{ backgroundColor: meta?.color }">
    <img v-if="src && !failed" :src="src" alt="" class="w-full h-full object-cover" @error="failed = true" />
    <font-awesome-icon v-else-if="meta" :icon="meta.icon" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PLATFORM_META } from '../stores/platforms'

const props = defineProps<{ src?: string | null; platform: string }>()
const failed = ref(false)
const meta = computed(() => PLATFORM_META[props.platform])
watch(() => props.src, () => { failed.value = false })
</script>
