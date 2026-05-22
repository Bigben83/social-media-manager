import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/Dashboard.vue'),
    },
    {
      path: '/compose',
      name: 'compose',
      component: () => import('../views/Compose.vue'),
    },
    {
      path: '/scheduler',
      name: 'scheduler',
      component: () => import('../views/Scheduler.vue'),
    },
    {
      path: '/media',
      name: 'media',
      component: () => import('../views/Media.vue'),
    },
    {
      path: '/analytics',
      name: 'analytics',
      component: () => import('../views/Analytics.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
    },
  ],
})

export default router
