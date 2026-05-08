<template>
  <nav class="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
    <router-link to="/dashboard" class="text-white font-bold text-lg tracking-tight">
      📡 SocialManager
    </router-link>

    <div class="flex items-center gap-1">
      <router-link
        v-for="link in navLinks"
        :key="link.to"
        :to="link.to"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        :class="$route.path === link.to
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-800'"
      >
        {{ $t(link.label) }}
      </router-link>
    </div>

    <!-- Dil seçici -->
    <div class="relative">
      <button
        @click="showLangMenu = !showLangMenu"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
      >
        <span>{{ currentLocale.flag }}</span>
        <span>{{ currentLocale.code.toUpperCase() }}</span>
        <span class="text-xs opacity-50">▾</span>
      </button>

      <div
        v-if="showLangMenu"
        class="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl z-50 min-w-[140px]"
      >
        <button
          v-for="loc in SUPPORTED_LOCALES"
          :key="loc.code"
          @click="setLocale(loc.code)"
          class="flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-colors hover:bg-gray-700"
          :class="locale === loc.code ? 'text-white font-medium' : 'text-gray-400'"
        >
          <span>{{ loc.flag }}</span>
          <span>{{ loc.label }}</span>
          <span v-if="locale === loc.code" class="ml-auto text-blue-400 text-xs">✓</span>
        </button>
      </div>
    </div>
  </nav>

  <!-- Overlay to close menu -->
  <div v-if="showLangMenu" class="fixed inset-0 z-40" @click="showLangMenu = false" />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES } from '../locales'

const { locale } = useI18n()
const showLangMenu = ref(false)

const navLinks = [
  { to: '/dashboard', label: 'nav.feed' },
  { to: '/compose',   label: 'nav.compose' },
  { to: '/media',     label: 'nav.media' },
  { to: '/scheduler', label: 'nav.scheduler' },
  { to: '/analytics', label: 'nav.analytics' },
  { to: '/settings',  label: 'nav.settings' },
]

const currentLocale = computed(
  () => SUPPORTED_LOCALES.find((l) => l.code === locale.value) ?? SUPPORTED_LOCALES[0]
)

function setLocale(code: string) {
  locale.value = code
  localStorage.setItem('locale', code)
  showLangMenu.value = false
}
</script>
