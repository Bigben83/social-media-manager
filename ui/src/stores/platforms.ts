import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface PlatformStatus {
  platform: string
  connected: boolean
  username?: string
  displayName?: string
  avatar?: string
  error?: string
}

export const PLATFORM_META: Record<string, { label: string; color: string; icon: string }> = {
  twitter:  { label: 'Twitter/X',  color: '#000000', icon: 'fa-brands fa-x-twitter' },
  linkedin: { label: 'LinkedIn',   color: '#0077B5', icon: 'fa-brands fa-linkedin' },
  mastodon: { label: 'Mastodon',   color: '#6364FF', icon: 'fa-brands fa-mastodon' },
  bluesky:  { label: 'Bluesky',    color: '#0085FF', icon: 'fa-solid fa-cloud' },
  instagram:{ label: 'Instagram',  color: '#E1306C', icon: 'fa-brands fa-instagram' },
  reddit:   { label: 'Reddit',     color: '#FF4500', icon: 'fa-brands fa-reddit' },
  youtube:  { label: 'YouTube',    color: '#FF0000', icon: 'fa-brands fa-youtube' },
}

export const usePlatformsStore = defineStore('platforms', () => {
  const statuses = ref<PlatformStatus[]>([])
  const loading = ref(false)

  async function fetchStatuses() {
    loading.value = true
    try {
      const res = await axios.get('/feeds/platform-status')
      statuses.value = res.data
    } catch (err) {
      console.error('Platform status error:', err)
    } finally {
      loading.value = false
    }
  }

  function getStatus(platform: string): PlatformStatus | undefined {
    return statuses.value.find((s) => s.platform === platform)
  }

  function isConnected(platform: string): boolean {
    return getStatus(platform)?.connected ?? false
  }

  return { statuses, loading, fetchStatuses, getStatus, isConnected }
})
