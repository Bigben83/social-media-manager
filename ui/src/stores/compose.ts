import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from './platforms'

export interface Destination {
  key: string        // 'twitter', 'facebook:PAGE_ID', 'instagram:ACCOUNT_ID'
  platform: string
  accountId?: string
  label: string
  color: string
  picture?: string
  selected: boolean
}

const CHAR_LIMITS: Record<string, number> = {
  twitter: 280,
  mastodon: 500,
  bluesky: 300,
  linkedin: 3000,
  reddit: 40000,
}

const STANDARD_PLATFORMS = ['twitter', 'mastodon', 'bluesky', 'linkedin', 'reddit', 'youtube']

export const useComposeStore = defineStore('compose', () => {
  const content = ref('')
  const mediaUrl = ref('')
  const scheduledAt = ref('')
  const destinations = ref<Destination[]>([])
  const sending = ref(false)
  const lastResult = ref<Record<string, unknown> | null>(null)

  function charLimit(platform: string): number {
    return CHAR_LIMITS[platform] ?? 9999
  }

  function isOverLimit(platform: string): boolean {
    return content.value.length > charLimit(platform)
  }

  const selectedDestinations = computed(() => destinations.value.filter((d) => d.selected))

  // Most restrictive char limit among selected platforms that have a defined limit
  const activeCharLimit = computed(() => {
    const limits = selectedDestinations.value
      .map((d) => CHAR_LIMITS[d.platform])
      .filter((l): l is number => l !== undefined)
    return limits.length ? Math.min(...limits) : null
  })

  function initDestinations() {
    const platformsStore = usePlatformsStore()
    const next: Destination[] = []

    for (const p of STANDARD_PLATFORMS) {
      const meta = PLATFORM_META[p]
      if (!meta) continue
      next.push({ key: p, platform: p, label: meta.label, color: meta.color, selected: false })
    }

    for (const page of platformsStore.connectedPages) {
      next.push({
        key: `facebook:${page.id}`,
        platform: 'facebook',
        accountId: page.id,
        label: page.name,
        color: PLATFORM_META.facebook.color,
        picture: page.picture,
        selected: false,
      })
    }

    for (const account of platformsStore.connectedIgAccounts) {
      next.push({
        key: `instagram:${account.id}`,
        platform: 'instagram',
        accountId: account.id,
        label: `@${account.username}`,
        color: PLATFORM_META.instagram.color,
        picture: account.avatar,
        selected: false,
      })
    }

    destinations.value = next
  }

  function toggleDestination(key: string) {
    const dest = destinations.value.find((d) => d.key === key)
    if (dest) dest.selected = !dest.selected
  }

  function reset() {
    content.value = ''
    mediaUrl.value = ''
    scheduledAt.value = ''
    destinations.value.forEach((d) => { d.selected = false })
    lastResult.value = null
  }

  async function post() {
    const selected = selectedDestinations.value
    if (!content.value.trim() || !selected.length) return
    sending.value = true
    lastResult.value = null

    try {
      const destPayload = selected.map(({ platform, accountId }) => ({
        platform,
        ...(accountId && { accountId }),
        ...(mediaUrl.value.trim() && { imageUrl: mediaUrl.value.trim() }),
      }))

      if (scheduledAt.value) {
        await axios.post('/scheduler/schedule', {
          content: content.value,
          scheduledAt: scheduledAt.value,
          destinations: destPayload,
        })
      } else {
        await axios.post('/api/post', {
          content: content.value,
          destinations: destPayload,
        })
      }

      lastResult.value = { ok: true }
      reset()
    } catch (err) {
      console.error('Compose post error:', err)
    } finally {
      sending.value = false
    }
  }

  return {
    content, mediaUrl, scheduledAt, destinations, sending, lastResult,
    selectedDestinations, activeCharLimit,
    charLimit, isOverLimit,
    initDestinations, toggleDestination, reset, post,
  }
})
