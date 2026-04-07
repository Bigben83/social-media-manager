export default {
  nav: {
    feed: 'Feed',
    compose: 'New Post',
    scheduler: 'Scheduler',
    settings: 'Settings',
  },

  dashboard: {
    platforms: 'Platforms',
    tags: 'Tags',
    allTags: 'All',
    searchPlaceholder: 'Search content or user...',
    refresh: 'Refresh',
    refreshing: 'Refreshing...',
    newPost: '+ New Post',
    loading: 'Loading feed...',
    empty: 'No content to show.',
    emptyHint: 'Check platform connections or refresh the feed.',
  },

  compose: {
    title: 'New Post',
    platformsLabel: 'Share to platforms',
    placeholder: "What's on your mind?",
    schedulingLabel: 'Schedule (optional)',
    cancel: 'Cancel',
    schedule: 'Schedule',
    scheduling: 'Scheduling...',
    send: 'Post →',
    sending: 'Posting...',
    successMessage: 'Post sent successfully.',
  },

  scheduler: {
    title: 'Scheduler',
    newSchedule: '+ New Schedule',
    noJobs: 'No scheduled posts.',
    statuses: {
      pending: 'Pending',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    cancel: 'Cancel',
  },

  settings: {
    title: 'Platform Connections',
    subtitle: 'Edit the {env} file to connect platforms, then restart the relevant service.',
    connected: 'Connected',
    notConnected: 'Not connected',
    refreshStatus: '↻ Refresh Status',
    envHint: 'Configuration required',
  },

  feed: {
    openOriginal: '↗ Open',
  },

  platforms: {
    twitter: 'Twitter/X',
    linkedin: 'LinkedIn',
    mastodon: 'Mastodon',
    bluesky: 'Bluesky',
    instagram: 'Instagram',
    reddit: 'Reddit',
    youtube: 'YouTube',
  },
}
