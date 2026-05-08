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
  scheduledAt: string  // empty string = post immediately
  imageUrl?: string    // instagram only
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
  const destinations = ref<Destination[]>([])
  const sending = ref(false)
  const lastResult = ref<Record<string, unknown> | null>(null)

  function charLimit(platform: string): number {
    return CHAR_LIMITS[platform] ?? 9999
  }

  function charCount(): number {
    return content.value.length
  }

  function isOverLimit(platform: string): boolean {
    return content.value.length > charLimit(platform)
  }

  const selectedDestinations = computed(() => destinations.value.filter((d) => d.selected))

  const hasImmediateDestinations = computed(() =>
    selectedDestinations.value.some((d) => !d.scheduledAt)
  )

  const hasScheduledDestinations = computed(() =>
    selectedDestinations.value.some((d) => !!d.scheduledAt)
  )

  function initDestinations() {
    const platformsStore = usePlatformsStore()
    const next: Destination[] = []

    // Standard platforms (one toggle per platform)
    for (const p of STANDARD_PLATFORMS) {
      const meta = PLATFORM_META[p]
      if (!meta) continue
      next.push({
        key: p,
        platform: p,
        label: meta.label,
        color: meta.color,
        selected: false,
        scheduledAt: '',
      })
    }

    // Facebook pages
    for (const page of platformsStore.connectedPages) {
      next.push({
        key: `facebook:${page.id}`,
        platform: 'facebook',
        accountId: page.id,
        label: page.name,
        color: PLATFORM_META.facebook.color,
        picture: page.picture,
        selected: false,
        scheduledAt: '',
      })
    }

    // Instagram accounts
    for (const account of platformsStore.connectedIgAccounts) {
      next.push({
        key: `instagram:${account.id}`,
        platform: 'instagram',
        accountId: account.id,
        label: `@${account.username}`,
        color: PLATFORM_META.instagram.color,
        picture: account.avatar,
        selected: false,
        scheduledAt: '',
        imageUrl: '',
      })
    }

    destinations.value = next
  }

  function toggleDestination(key: string) {
    const dest = destinations.value.find((d) => d.key === key)
    if (dest) dest.selected = !dest.selected
  }

  async function post() {
    if (!content.value.trim() || !selectedDestinations.value.length) return
    sending.value = true
    lastResult.value = null

    try {
      const immediate = selectedDestinations.value.filter((d) => !d.scheduledAt)
      const scheduled = selectedDestinations.value.filter((d) => !!d.scheduledAt)

      const calls: Promise<unknown>[] = []

      if (immediate.length) {
        calls.push(
          axios.post('/api/post', {
            content: content.value,
            destinations: immediate.map(({ platform, accountId, imageUrl }) => ({
              platform,
              ...(accountId && { accountId }),
              ...(imageUrl && { imageUrl }),
            })),
          })
        )
      }

      // Each unique scheduledAt time gets its own scheduler call
      const byTime = new Map<string, Destination[]>()
      for (const dest of scheduled) {
        const existing = byTime.get(dest.scheduledAt) || []
        existing.push(dest)
        byTime.set(dest.scheduledAt, existing)
      }

      for (const [scheduledAt, dests] of byTime) {
        calls.push(
          axios.post('/scheduler/schedule', {
            content: content.value,
            scheduledAt,
            destinations: dests.map(({ platform, accountId, imageUrl }) => ({
              platform,
              ...(accountId && { accountId }),
              ...(imageUrl && { imageUrl }),
            })),
          })
        )
      }

      const results = await Promise.allSettled(calls)
      lastResult.value = { ok: results.every((r) => r.status === 'fulfilled') }
      content.value = ''
      destinations.value.forEach((d) => {
        d.selected = false
        d.scheduledAt = ''
        if (d.imageUrl !== undefined) d.imageUrl = ''
      })
    } catch (err) {
      console.error('Compose post error:', err)
    } finally {
      sending.value = false
    }
  }

  return {
    content, destinations, sending, lastResult,
    selectedDestinations, hasImmediateDestinations, hasScheduledDestinations,
    charLimit, charCount, isOverLimit,
    initDestinations, toggleDestination, post,
  }
})
