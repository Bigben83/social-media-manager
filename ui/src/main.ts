import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { useWorkspaceStore } from './stores/workspace'
import router from './router'
import i18n from './locales'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faGithub, faXTwitter, faLinkedin, faMastodon, faInstagram, faReddit, faYoutube } from '@fortawesome/free-brands-svg-icons'
import { faCloud } from '@fortawesome/free-solid-svg-icons'

library.add(faGithub, faXTwitter, faLinkedin, faMastodon, faInstagram, faReddit, faYoutube, faCloud)

const pinia = createPinia()
const app = createApp(App)
  .use(pinia)
  .use(router)
  .use(i18n)
  .component('font-awesome-icon', FontAwesomeIcon)

async function bootstrap() {
  const workspace = useWorkspaceStore(pinia)
  await workspace.init()
  const callbackWorkspace = new URLSearchParams(window.location.search).get('workspace')
  if (callbackWorkspace && workspace.workspaces.some(w => w._id === callbackWorkspace)) await workspace.setActive(callbackWorkspace)
  app.mount('#app')
}
bootstrap()
