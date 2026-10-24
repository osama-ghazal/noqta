<script setup lang="ts">
// The app's home page: pick products with the admin's picker and regenerate their images, and
// see the history (stored at Noqta as "regeneration" metaobjects, see server/jobs.ts).
import { onMounted, ref } from 'vue'
import { NotEmbeddedError } from '@noqtaps/app-bridge'
import { getHistory, getProducts, type HistoryEntry, type Product } from '../api'
import Studio from '../components/Studio.vue'

const history = ref<HistoryEntry[]>([])
const state = ref<'loading' | 'ready' | 'not_embedded' | 'error'>('loading')
const error = ref('')
const products = ref<Product[]>([])

async function load() {
  try {
    await noqta.ready
    history.value = await getHistory()
    state.value = 'ready'
  } catch (err) {
    if (err instanceof NotEmbeddedError) state.value = 'not_embedded'
    else {
      state.value = 'error'
      error.value = (err as Error).message
    }
  }
}

async function pick() {
  const picked = await noqta.resourcePicker({ type: 'product', multiple: true })
  if (!picked.length) return
  noqta.loading(true)
  try {
    products.value = await getProducts(picked.map((p) => p.id))
  } catch (err) {
    noqta.toast.show((err as Error).message, { isError: true })
  } finally {
    noqta.loading(false)
  }
}

async function onApplied() {
  history.value = await getHistory().catch(() => history.value)
}

onMounted(load)
</script>

<template>
  <main class="app">
    <p v-if="state === 'loading'" class="muted">جارٍ التحميل…</p>
    <section v-else-if="state === 'not_embedded'" class="notice">
      <h1>افتح التطبيق من لوحة تحكم نقطة</h1>
    </section>
    <p v-else-if="state === 'error'" class="notice error">{{ error }}</p>

    <template v-else>
      <header class="bar">
        <div>
          <h1>تحسين صور المنتجات بالذكاء الاصطناعي</h1>
          <p class="muted">صور نظيفة بخلفية بلونك، أو صور واقعية للمنتج أثناء الاستخدام.</p>
        </div>
        <button v-if="products.length" @click="products = []">رجوع</button>
        <button v-else class="primary" data-test="pick" @click="pick">اختر منتجات</button>
      </header>

      <Studio v-if="products.length" :products="products" @applied="onApplied" @reset="products = []" />

      <template v-else>
        <h2>آخر العمليات</h2>
        <table v-if="history.length" class="history">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المنتجات</th>
              <th>الصور</th>
              <th>النوع</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in history" :key="h.id">
              <td>{{ h.created_at.slice(0, 16).replace('T', ' ') }}</td>
              <td :title="h.fields.product_titles">
                {{ h.fields.products }}
                <span v-if="h.fields.product_titles" class="muted">
                  · {{ h.fields.product_titles.split('\n').slice(0, 2).join('، ') }}
                </span>
              </td>
              <td>{{ h.fields.images }}</td>
              <td>{{ h.fields.mode }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">لا توجد عمليات بعد.</p>
      </template>
    </template>
  </main>
</template>
