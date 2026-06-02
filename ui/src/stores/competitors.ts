import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'

export interface AiAnalysis {
  themes: string[]
  tone: string
  positioning: string
  gaps: string[]
  moves: string[]
}

export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'

export interface CompetitorKeyword {
  term: string
  intent: KeywordIntent
  extractedAt?: string
}

export interface RoadmapPost {
  topic: string
  headline: string
  keywords: string[]
  rationale: string
}

export interface Competitor {
  _id: string
  name: string
  websiteUrl: string
  socialUrls: Partial<Record<string, string>>
  scrapedContent: { source: string; url: string; text: string; scrapedAt: string }[]
  aiSummary: string
  aiAnalysis?: AiAnalysis
  keywords: CompetitorKeyword[]
  contentRoadmap?: RoadmapPost[]
  lastScraped: string | null
  createdAt: string
  updatedAt: string
}

export const useCompetitorStore = defineStore('competitors', () => {
  const competitors = ref<Competitor[]>([])
  const loading = ref(false)
  const scraping = ref<Record<string, boolean>>({})
  const summarizing = ref<Record<string, boolean>>({})
  const extractingKeywords = ref<Record<string, boolean>>({})
  const generatingRoadmap = ref<Record<string, boolean>>({})
  const scrapeResults = ref<Record<string, { sources: number; ok: boolean; message: string }>>({})
  const error = ref<string | null>(null)

  async function fetchCompetitors() {
    loading.value = true
    error.value = null
    try {
      const res = await axios.get('/api/competitors')
      competitors.value = res.data
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to load competitors'
    } finally {
      loading.value = false
    }
  }

  async function addCompetitor(data: { name: string; websiteUrl: string; socialUrls?: Record<string, string> }): Promise<boolean> {
    error.value = null
    try {
      const res = await axios.post('/api/competitors', data)
      competitors.value.push(res.data)
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to add competitor'
      return false
    }
  }

  async function updateCompetitor(id: string, data: Partial<Pick<Competitor, 'name' | 'websiteUrl' | 'socialUrls'>>): Promise<boolean> {
    error.value = null
    try {
      const res = await axios.put(`/api/competitors/${id}`, data)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx] = res.data
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to update competitor'
      return false
    }
  }

  async function deleteCompetitor(id: string): Promise<boolean> {
    error.value = null
    try {
      await axios.delete(`/api/competitors/${id}`)
      competitors.value = competitors.value.filter((c) => c._id !== id)
      return true
    } catch (err: any) {
      error.value = err.response?.data?.error || 'Failed to delete competitor'
      return false
    }
  }

  async function scrapeCompetitor(id: string): Promise<void> {
    scraping.value = { ...scraping.value, [id]: true }
    try {
      const res = await axios.post(`/api/competitors/${id}/scrape`)
      scrapeResults.value = {
        ...scrapeResults.value,
        [id]: { sources: res.data.sources ?? 0, ok: res.data.success, message: res.data.message || '' },
      }
      await fetchCompetitors()
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.response?.data?.error || err.message
      scrapeResults.value = { ...scrapeResults.value, [id]: { sources: 0, ok: false, message: msg } }
    } finally {
      scraping.value = { ...scraping.value, [id]: false }
    }
  }

  async function summarizeCompetitor(id: string): Promise<void> {
    summarizing.value = { ...summarizing.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/summarize`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) {
        competitors.value[idx].aiAnalysis = res.data.aiAnalysis
        competitors.value[idx].aiSummary = ''
      }
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Summarization failed'
    } finally {
      summarizing.value = { ...summarizing.value, [id]: false }
    }
  }

  async function extractKeywords(id: string): Promise<void> {
    extractingKeywords.value = { ...extractingKeywords.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/extract-keywords`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx].keywords = res.data.keywords || []
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Keyword extraction failed'
    } finally {
      extractingKeywords.value = { ...extractingKeywords.value, [id]: false }
    }
  }

  async function generateRoadmap(id: string): Promise<void> {
    generatingRoadmap.value = { ...generatingRoadmap.value, [id]: true }
    error.value = null
    try {
      const res = await axios.post(`/api/competitors/${id}/content-roadmap`)
      const idx = competitors.value.findIndex((c) => c._id === id)
      if (idx !== -1) competitors.value[idx].contentRoadmap = res.data.contentRoadmap
    } catch (err: any) {
      error.value = err.response?.data?.detail || err.response?.data?.error || 'Roadmap generation failed'
    } finally {
      generatingRoadmap.value = { ...generatingRoadmap.value, [id]: false }
    }
  }

  return {
    competitors, loading, scraping, summarizing, extractingKeywords, generatingRoadmap, scrapeResults, error,
    fetchCompetitors, addCompetitor, updateCompetitor, deleteCompetitor,
    scrapeCompetitor, summarizeCompetitor, extractKeywords, generateRoadmap,
  }
})
