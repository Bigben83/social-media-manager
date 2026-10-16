import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { usePlatformsStore, PLATFORM_META } from './platforms'
import { naiveDatetimeToUtc } from '../utils/timezone'

export interface Destination {
  key: string        // 'twitter', 'facebook:PAGE_ID', 'instagram:ACCOUNT_ID'
  platform: string
  accountId?: string
  label: string
  color: string
  picture?: string
  selected: boolean
  imageUrl?: string
  videoUrl?: string
  instagramPlacement?: 'feed' | 'story' | 'reel'
  shareToFeed?: boolean
  coverUrl?: string
}

const CHAR_LIMITS: Record<string, number> = {
  twitter: 280,
  mastodon: 500,
  bluesky: 300,
  linkedin: 3000,
  reddit: 40000,
}

const STANDARD_PLATFORMS = ['twitter', 'mastodon', 'bluesky']

export interface Draft {
  _id: string
  content: string
  mediaUrl: string
  scheduledAt: string
  destinations: Destination[]
  firstComment?: string
  createdAt: string
  updatedAt: string
}

// Older connector drafts stored their shared attachment only on the destinations.
export function draftMediaUrl(draft: Pick<Draft, 'mediaUrl' | 'destinations'>): string {
  if (draft.mediaUrl) return draft.mediaUrl
  const urls = [...new Set((draft.destinations || []).flatMap(d => [d.imageUrl, d.videoUrl]).filter((url): url is string => !!url))]
  return urls.length === 1 ? urls[0] : ''
}

export const useComposeStore = defineStore('compose', () => {
  const content = ref('')
  const mediaUrl = ref('')
  const scheduledAt = ref('')
  const firstComment = ref('')
  const destinations = ref<Destination[]>([])
  const sending = ref(false)
  const savingDraft = ref(false)
  const draftId = ref<string | null>(null)
  let submissionFingerprint = ''
  let submissionId = ''
  const lastResult = ref<{ ok: boolean; error?: string; scheduled?: boolean; results?: { platform: string; accountId?: string; success: boolean; error?: string; uncertain?: boolean }[] } | null>(null)

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
      if (!meta || !platformsStore.publishingPlatforms.includes(p)) continue
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

    for (const board of platformsStore.connectedPinterestBoards) {
      next.push({
        key: `pinterest:${board.id}`,
        platform: 'pinterest',
        accountId: board.id,
        label: board.name,
        color: PLATFORM_META.pinterest.color,
        selected: false,
      })
    }

    if (platformsStore.tiktokConnected) next.push({ key: 'tiktok', platform: 'tiktok', label: platformsStore.tiktokUsername || 'TikTok', color: PLATFORM_META.tiktok.color, selected: false })
    destinations.value = next
  }

  function toggleDestination(key: string) {
    const dest = destinations.value.find((d) => d.key === key)
    if (dest) dest.selected = !dest.selected
  }

  function reset(keepResult = false) {
    content.value = ''
    mediaUrl.value = ''
    scheduledAt.value = ''
    firstComment.value = ''
    draftId.value = null
    destinations.value.forEach((d) => { d.selected = false; d.instagramPlacement = undefined; d.shareToFeed = undefined; d.coverUrl = undefined })
    if (!keepResult) lastResult.value = null
  }

  function loadDraft(draft: Draft) {
    draftId.value = String(draft._id)
    content.value = draft.content || ''
    mediaUrl.value = draftMediaUrl(draft)
    scheduledAt.value = draft.scheduledAt || ''
    firstComment.value = draft.firstComment || ''
    destinations.value.forEach((d) => {
      const saved = draft.destinations?.find((s) => s.key === d.key || (s.platform === d.platform && s.accountId === d.accountId))
      d.selected = saved?.selected ?? false
      d.instagramPlacement = saved?.instagramPlacement
      d.shareToFeed = saved?.shareToFeed
      d.coverUrl = saved?.coverUrl
    })
  }

  async function saveDraft() {
    savingDraft.value = true
    try {
      const payload = {
        content: content.value,
        mediaUrl: mediaUrl.value,
        scheduledAt: scheduledAt.value,
        firstComment: firstComment.value || undefined,
        destinations: destinations.value.map(({ key, platform, accountId, label, color, picture, selected, instagramPlacement, shareToFeed, coverUrl }) => ({
          key, platform, accountId, label, color, picture, selected, instagramPlacement, shareToFeed, coverUrl,
        })),
      }
      if (draftId.value) {
        await axios.put(`/api/drafts/${draftId.value}`, payload)
      } else {
        const res = await axios.post('/api/drafts', payload)
        draftId.value = String(res.data._id)
      }
      return true
    } catch (err) {
      console.error('Save draft error:', err)
      return false
    } finally {
      savingDraft.value = false
    }
  }

  async function post(timezone?: string) {
    const selected = selectedDestinations.value
    if ((!content.value.trim() && !selected.every(d => d.platform === 'instagram' && d.instagramPlacement === 'story')) || !selected.length || sending.value) return false
    sending.value = true
    lastResult.value = null

    try {
      const isVideo = /\.(mp4|mov|avi|webm)(?:[?#]|$)/i.test(mediaUrl.value.trim())
      const destPayload = selected.map(({ key, platform, accountId, instagramPlacement, shareToFeed, coverUrl }) => ({
        key, platform,
        ...(platform === 'instagram' && { instagramPlacement: instagramPlacement || (isVideo ? 'reel' : 'feed'), ...(shareToFeed !== undefined && { shareToFeed }), ...(coverUrl && { coverUrl }) }),
        ...(accountId && { accountId }),
        ...(mediaUrl.value.trim() && { [isVideo ? 'videoUrl' : 'imageUrl']: mediaUrl.value.trim() }),
      }))

      const firstCommentValue = firstComment.value.trim() || undefined

      if (scheduledAt.value) {
        const utcScheduledAt = timezone
          ? naiveDatetimeToUtc(scheduledAt.value, timezone)
          : new Date(scheduledAt.value).toISOString()
        const response = await axios.post('/scheduler/schedule', {
          content: content.value,
          scheduledAt: utcScheduledAt,
          destinations: destPayload,
          ...(firstCommentValue && { firstComment: firstCommentValue }),
        })
        if (response.data.success !== true) throw new Error(response.data.error || 'Scheduling failed')
        lastResult.value = { ok: true, scheduled: true }
      } else {
        const payload = { content: content.value, destinations: destPayload, ...(firstCommentValue && { firstComment: firstCommentValue }) }
        const fingerprint = JSON.stringify(payload)
        if (submissionFingerprint !== fingerprint) {
          submissionId = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
          submissionFingerprint = fingerprint
        }
        const response = await axios.post('/api/post', payload, { headers: { 'Idempotency-Key': submissionId } })
        const results = response.data.results || []
        const ok = results.length > 0 && results.every((result: { success: boolean }) => result.success)
        lastResult.value = { ok, results }
        if (!ok) {
          // Retain content; deselect confirmed and uncertain deliveries to avoid duplicates.
          destinations.value.forEach(dest => {
            const result = results.find((r: { platform: string; accountId?: string }) => r.platform === dest.platform && r.accountId === dest.accountId)
            if (result?.success || result?.uncertain) dest.selected = false
          })
          return false
        }
      }
      reset(true)
      return true
    } catch (err: any) {
      if (err.response?.data?.uncertain) destinations.value.forEach(dest => { dest.selected = false })
      lastResult.value = { ok: false, error: err.response?.data?.error || err.message || 'Publishing failed' }
      return false
    } finally {
      sending.value = false
    }
  }

  return {
    content, mediaUrl, scheduledAt, firstComment, destinations, sending, savingDraft, draftId, lastResult,
    selectedDestinations, activeCharLimit,
    charLimit, isOverLimit,
    initDestinations, toggleDestination, reset, loadDraft, saveDraft, post,
  }
})
