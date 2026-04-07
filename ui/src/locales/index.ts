import { createI18n } from 'vue-i18n'
import en from './en'
import tr from './tr'

// Yeni dil eklemek için:
// 1. src/locales/xx.ts dosyası oluştur (en.ts'yi kopyala ve çevir)
// 2. Aşağıya import et ve messages'a ekle
// 3. SUPPORTED_LOCALES listesine ekle

export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
]

const savedLocale = localStorage.getItem('locale') || 'en'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, tr },
})

export default i18n
