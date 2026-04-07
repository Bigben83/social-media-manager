<template>
  <div class="min-h-screen bg-gray-950 flex flex-col">
    <NavBar />
    <div class="flex-1">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import NavBar from './components/NavBar.vue'
</script>
