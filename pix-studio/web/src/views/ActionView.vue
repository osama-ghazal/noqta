<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NotEmbeddedError } from '@noqtaps/app-bridge'
import { getProducts, type Product } from '../api'
import Studio from '../components/Studio.vue'

// The same page serves both admin actions (see noqta.app.toml): one product from the product
// page, or up to 100 selected products from the product list.

const products = ref<Product[]>([])
const state = ref<'loading' | 'ready' | 'not_embedded' | 'error'>('loading')
const error = ref('')
// Re-mounts the studio (back to its settings) when the selection changes.
const run = ref(0)

async function load() {
  state.value = 'loading'
  try {
    await noqta.ready
    noqta.resize('large')
    const ids = noqta.data.selected.map((s) => s.id)
    products.value = await getProducts(ids)
    run.value++
    state.value = 'ready'
  } catch (err) {
    if (err instanceof NotEmbeddedError) state.value = 'not_embedded'
    else {
      state.value = 'error'
      error.value = (err as Error).message
    }
  }
}

async function refresh() {
  products.value = await getProducts(products.value.map((p) => p.id)).catch(() => products.value)
}

onMounted(() => {
  load()
  noqta.onContextChange(() => load())
})
</script>

<template>
  <main class="app">
    <p v-if="state === 'loading'" class="muted">جارٍ التحميل…</p>

    <section v-else-if="state === 'not_embedded'" class="notice">
      <h1>افتح التطبيق من لوحة تحكم نقطة</h1>
      <p class="muted">
        This page only works inside the Noqta admin. Run <code>nqs app dev</code> and open a product
        there.
      </p>
    </section>

    <p v-else-if="state === 'error'" class="notice error">{{ error }}</p>

    <template v-else>
      <header class="bar">
        <div>
          <h1>تحسين صور المنتجات</h1>
          <p class="muted">
            {{ products.length === 1 ? products[0].title : `${products.length} منتج` }}
          </p>
        </div>
      </header>
      <Studio :key="run" :products="products" @applied="refresh" @reset="refresh" />
    </template>
  </main>
</template>
