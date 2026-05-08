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

    meta: {
      sectionTitle: 'Facebook & Instagram',
      sectionSubtitle: 'Both platforms share a single Facebook Developer App. Connect once to manage all your Pages and Instagram accounts.',
      appIdLabel: 'App ID',
      appSecretLabel: 'App Secret',
      appIdPlaceholder: 'Your Facebook App ID',
      appSecretPlaceholder: 'Your Facebook App Secret',
      saveApp: 'Save App Credentials',
      saving: 'Saving...',
      appConfigured: 'App credentials saved',
      connectButton: 'Connect with Facebook & Instagram',
      connecting: 'Redirecting to Facebook...',
      reconnect: 'Reconnect',
      disconnect: 'Disconnect all',
      disconnectConfirm: 'This will disconnect all Facebook Pages and Instagram accounts. Continue?',

      discoveryTitle: 'Choose Pages & Accounts to Connect',
      discoverySubtitle: 'Select any combination of Facebook Pages and Instagram accounts below.',
      pagesHeading: 'Facebook Pages',
      igHeading: 'Instagram Accounts',
      noPages: 'No Facebook Pages found for this account.',
      noIgAccounts: 'No Instagram Business accounts found.',
      igLinkedTo: 'Linked to',
      confirmSelection: 'Connect Selected',
      confirmingSelection: 'Connecting...',
      nothingSelected: 'Select at least one Page or Instagram account.',

      connectedPages: 'Connected Pages',
      connectedAccounts: 'Connected Accounts',

      errorTitle: 'OAuth Error',
      getAppHelp: 'Get your App ID and Secret from',
      devPortal: 'developers.facebook.com',
    },
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
    facebook: 'Facebook',
    reddit: 'Reddit',
    youtube: 'YouTube',
  },
}
