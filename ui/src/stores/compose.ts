import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export const useComposeStore = defineStore('compose', () => {
  const content = ref('')
  const selectedPlatforms = ref<string[]>(['twitter', 'mastodon', 'bluesky'])
  const scheduledAt = ref<string>('')
  const sending = ref(false)
  const lastResult = ref<Record<string, unknown> | null>(null)

  const CHAR_LIMITS: Record<string, number> = {
    twitter: 280,
    mastodon: 500,
    bluesky: 300,
    linkedin: 3000,
    reddit: 40000,
  }

  function charLimit(platform: string): number {
    return CHAR_LIMITS[platform] ?? 9999
  }

  function charCount(platform: string): number {
    return content.value.length
  }

  function isOverLimit(platform: string): boolean {
    return content.value.length > charLimit(platform)
  }

  function togglePlatform(platform: string) {
    const idx = selectedPlatforms.value.indexOf(platform)
    if (idx >= 0) {
      selectedPlatforms.value.splice(idx, 1)
    } else {
      selectedPlatforms.value.push(platform)
    }
  }

  async function sendNow() {
    if (!content.value.trim() || !selectedPlatforms.value.length) return
    sending.value = true
    try {
      const res = await axios.post('/api/', {
        message: content.value,
        platforms: selectedPlatforms.value,
      })
      lastResult.value = res.data
      content.value = ''
    } catch (err) {
      console.error('Send error:', err)
    } finally {
      sending.value = false
    }
  }

  async function schedulePost() {
    if (!content.value.trim() || !selectedPlatforms.value.length || !scheduledAt.value) return
    sending.value = true
    try {
      const res = await axios.post('/scheduler/schedule', {
        content: content.value,
        platforms: selectedPlatforms.value,
        scheduledAt: scheduledAt.value,
      })
      lastResult.value = res.data
      content.value = ''
      scheduledAt.value = ''
    } catch (err) {
      console.error('Schedule error:', err)
    } finally {
      sending.value = false
    }
  }

  return {
    content, selectedPlatforms, scheduledAt, sending, lastResult,
    charLimit, charCount, isOverLimit, togglePlatform, sendNow, schedulePost,
  }
})
