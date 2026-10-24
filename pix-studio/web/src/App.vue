<script setup lang="ts">
// One app, two places in the admin (noqta.app.toml):
// - admin.app.home: the app's own page under Apps in the side menu → HomeView
// - product actions (one product, or a selection) → ActionView
import ActionView from './views/ActionView.vue'
import HomeView from './views/HomeView.vue'

const isHome = noqta.data.target === 'admin.app.home'
</script>

<template>
  <HomeView v-if="isHome" />
  <ActionView v-else />
</template>
