<script setup lang="ts">
// The regeneration flow, shared by the product actions and the home page:
//   1. settings  — clean (a background colour) or realistic (a scene), which images, quality
//   2. previews  — generated on the server, nothing on the store changes yet
//   3. apply     — the merchant keeps some, replacing the originals or adding them
import { computed, onBeforeUnmount, ref } from 'vue'
import { applyJob, getJob, retryImage, startJob, type Job, type JobItem, type Mode, type Product, type Style } from '../api'

const props = defineProps<{ products: Product[] }>()
const emit = defineEmits<{ applied: [productIds: number[]]; reset: [] }>()

// ── settings ──
const style = ref<Style>('clean')
const background = ref('#ffffff')
const mode = ref<Mode>('main')
const quality = ref<'medium' | 'high'>('medium')
const note = ref('')
const SWATCHES = [
  { color: '#ffffff', label: 'أبيض' },
  { color: '#f4f4f5', label: 'رمادي فاتح' },
  { color: '#f5efe6', label: 'بيج' },
  { color: '#e8f0f7', label: 'أزرق فاتح' },
  { color: '#fbe9ec', label: 'وردي فاتح' },
  { color: '#111111', label: 'أسود' }
]

const imageCount = computed(() =>
  props.products.reduce((n, p) => n + (mode.value === 'main' ? Math.min(1, p.images.length) : p.images.length), 0)
)

// ── the job ──
const job = ref<Job | null>(null)
const picked = ref<Set<string>>(new Set())
const replace = ref(true)
let timer: ReturnType<typeof setTimeout> | undefined

const ready = computed(() => job.value?.items.filter((i) => i.status === 'ready') ?? [])
const finished = computed(() => job.value?.items.filter((i) => i.status !== 'pending' && i.status !== 'generating').length ?? 0)
const busy = computed(() => !!job.value && (job.value.status === 'generating' || job.value.status === 'applying'))
const stillGenerating = computed(() => job.value?.items.some((i) => i.status === 'generating' || i.status === 'pending'))

async function generate() {
  noqta.loading(true)
  try {
    job.value = await startJob(
      props.products.map((p) => p.id),
      mode.value,
      { style: style.value, background: background.value, quality: quality.value, note: note.value.trim() || undefined }
    )
    picked.value = new Set()
    poll()
  } catch (err) {
    noqta.toast.show((err as Error).message, { isError: true })
    noqta.loading(false)
  }
}

// The job runs on our server; it keeps going even if the merchant closes this dialog.
function poll() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    if (!job.value) return
    try {
      const before = new Set(ready.value.map((i) => i.key))
      job.value = await getJob(job.value.id)
      // Newly ready images are kept by default.
      for (const item of ready.value) if (!before.has(item.key)) picked.value.add(item.key)
      picked.value = new Set(picked.value)
    } catch (err) {
      noqta.toast.show((err as Error).message, { isError: true })
    }
    onUpdate()
  }, 1500)
}

function onUpdate() {
  const j = job.value!
  if (j.status === 'generating' || j.status === 'applying' || stillGenerating.value) {
    poll()
    return
  }
  noqta.loading(false)
  if (j.status === 'failed') {
    noqta.toast.show(j.items[0]?.error || j.errors[0]?.message || 'تعذّر إنشاء الصور', { isError: true })
  } else if (j.status === 'done') {
    const applied = j.items.filter((i) => i.status === 'applied').length
    if (j.changed.length) noqta.products.changed(j.changed)
    noqta.toast.show(
      j.errors.length ? `تم حفظ ${applied} صورة، وتعذّر حفظ ${j.errors.length}` : `تم حفظ ${applied} صورة في ${j.changed.length} منتج`,
      { isError: j.errors.length > 0 }
    )
    emit('applied', j.changed)
  }
}

function toggle(item: JobItem) {
  const next = new Set(picked.value)
  if (next.has(item.key)) next.delete(item.key)
  else next.add(item.key)
  picked.value = next
}

async function retry(item: JobItem) {
  try {
    picked.value.delete(item.key)
    job.value = await retryImage(job.value!.id, item.key)
    noqta.loading(true)
    poll()
  } catch (err) {
    noqta.toast.show((err as Error).message, { isError: true })
  }
}

const keep = computed(() => ready.value.filter((i) => picked.value.has(i.key)))

async function apply() {
  const n = keep.value.length
  const ok = await noqta.confirm({
    title: replace.value ? `استبدال ${n} صورة؟` : `إضافة ${n} صورة؟`,
    message: replace.value
      ? 'ستحل الصور الجديدة مكان الصور الحالية في نفس الترتيب. الصور القديمة تبقى في مكتبة الوسائط.'
      : 'ستُضاف الصور الجديدة بعد صور المنتج الحالية.',
    confirmLabel: replace.value ? 'استبدال الصور' : 'إضافة الصور'
  })
  if (!ok) return
  noqta.loading(true)
  try {
    job.value = await applyJob(
      job.value!.id,
      keep.value.map((i) => i.key),
      replace.value
    )
    poll()
  } catch (err) {
    noqta.toast.show((err as Error).message, { isError: true })
    noqta.loading(false)
  }
}

function startOver() {
  clearTimeout(timer)
  noqta.loading(false)
  job.value = null
  emit('reset')
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <!-- 1. settings -->
  <section v-if="!job" class="studio">
    <h2>نوع الصورة</h2>
    <div class="styles" role="radiogroup">
      <button
        type="button"
        role="radio"
        :aria-checked="style === 'clean'"
        :class="['style', { on: style === 'clean' }]"
        @click="style = 'clean'"
      >
        <span class="sample clean" :style="{ background }"><span class="product" /></span>
        <span class="name">خلفية نظيفة</span>
        <span class="muted">المنتج معزول في الوسط على خلفية بلون واحد، كصور المتاجر الاحترافية.</span>
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="style === 'realistic'"
        :class="['style', { on: style === 'realistic' }]"
        @click="style = 'realistic'"
      >
        <span class="sample real"><span class="product" /></span>
        <span class="name">صورة واقعية</span>
        <span class="muted">المنتج أثناء الاستخدام في مكان حقيقي، بتصوير احترافي وبدون أشخاص.</span>
      </button>
    </div>

    <template v-if="style === 'clean'">
      <h2>لون الخلفية</h2>
      <div class="swatches">
        <button
          v-for="s in SWATCHES"
          :key="s.color"
          type="button"
          :class="['swatch', { on: background === s.color }]"
          :style="{ background: s.color }"
          :title="s.label"
          :aria-label="s.label"
          @click="background = s.color"
        />
        <label class="swatch custom" :class="{ on: !SWATCHES.some((s) => s.color === background) }" title="لون آخر">
          <input v-model="background" type="color" aria-label="لون آخر" />
          <span :style="{ background }" />
        </label>
        <code class="hex">{{ background.toUpperCase() }}</code>
      </div>
    </template>

    <div class="fields">
      <label>
        <span>الصور</span>
        <select v-model="mode">
          <option value="main">الصورة الرئيسية فقط</option>
          <option value="all">كل الصور</option>
        </select>
      </label>
      <label>
        <span>الجودة</span>
        <select v-model="quality">
          <option value="medium">عادية (أسرع)</option>
          <option value="high">عالية (2K)</option>
        </select>
      </label>
    </div>

    <label class="note">
      <span>{{ style === 'clean' ? 'تفاصيل يجب الحفاظ عليها (اختياري)' : 'وصف المشهد (اختياري)' }}</span>
      <textarea
        v-model="note"
        rows="2"
        maxlength="500"
        :placeholder="style === 'clean' ? 'مثال: الشعار المحفور على الغطاء، عدد الأزرار' : 'مثال: على طاولة مطبخ رخامية في ضوء الصباح'"
      />
    </label>

    <div class="actions">
      <p class="muted">{{ products.length }} منتج · {{ imageCount }} صورة · لن يتغير شيء قبل موافقتك</p>
      <button class="primary" :disabled="!imageCount" @click="generate">إنشاء المعاينة</button>
    </div>
  </section>

  <!-- 2–3. previews, then apply -->
  <section v-else class="studio">
    <div class="bar">
      <div>
        <h2 class="flush">
          <template v-if="job.status === 'generating'">جارٍ الإنشاء {{ finished }}/{{ job.items.length || '…' }}</template>
          <template v-else-if="job.status === 'applying'">جارٍ الحفظ في المتجر…</template>
          <template v-else-if="job.status === 'done'">تم الحفظ</template>
          <template v-else-if="job.status === 'failed'">تعذّر إنشاء الصور</template>
          <template v-else>اختر الصور التي تريد حفظها</template>
        </h2>
        <p class="muted">
          {{ job.options.style === 'realistic' ? 'صورة واقعية' : 'خلفية نظيفة' }}
          <span v-if="job.options.style === 'clean'" class="dot" :style="{ background: job.options.background }" />
          <template v-if="job.status === 'generating'"> · قد يستغرق ذلك دقيقة لكل صورة، يمكنك إغلاق النافذة.</template>
        </p>
      </div>
      <button :disabled="busy" @click="startOver">البدء من جديد</button>
    </div>

    <ul class="results">
      <li
        v-for="item in job.items"
        :key="item.key"
        :class="['result', item.status, { kept: picked.has(item.key) && item.status === 'ready' }]"
      >
        <div class="pair">
          <figure>
            <img :src="item.original" :alt="item.title" loading="lazy" />
            <figcaption>قبل</figcaption>
          </figure>
          <figure>
            <img v-if="item.preview && item.status !== 'generating'" :src="item.preview" :alt="item.title" />
            <div v-else-if="item.status === 'failed'" class="placeholder error" :title="item.error">تعذّر الإنشاء</div>
            <div v-else class="placeholder"><span class="spinner" /></div>
            <figcaption>بعد</figcaption>
          </figure>
        </div>
        <div class="row">
          <label v-if="item.status === 'ready' && job.status === 'review'" class="check">
            <input type="checkbox" :checked="picked.has(item.key)" @change="toggle(item)" />
            <span class="title">{{ item.title }}</span>
          </label>
          <span v-else class="title">
            <span v-if="item.status === 'applied'" class="badge">✓ محفوظة</span>
            {{ item.title }}
          </span>
          <button
            v-if="job.status === 'review' && (item.status === 'ready' || item.status === 'failed')"
            class="small"
            @click="retry(item)"
          >
            إعادة
          </button>
        </div>
      </li>
    </ul>

    <div v-if="job.status === 'review'" class="actions sticky">
      <div class="choice" role="radiogroup">
        <label><input v-model="replace" type="radio" :value="true" /> استبدال الصور الحالية</label>
        <label><input v-model="replace" type="radio" :value="false" /> إضافتها كصور جديدة</label>
      </div>
      <button class="primary" :disabled="!keep.length || stillGenerating" @click="apply">
        حفظ {{ keep.length }} صورة
      </button>
    </div>
  </section>
</template>

<style scoped>
.studio h2:first-child {
  margin-top: 0;
}
h2.flush {
  margin: 0 0 4px;
}
.styles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.style {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  text-align: start;
  padding: 12px;
  min-height: 0;
  border-radius: var(--nq-radius);
  font-weight: 400;
}
.style.on {
  border-color: var(--nq-primary);
  box-shadow: 0 0 0 1px var(--nq-primary);
}
.style .name {
  font-weight: 600;
  font-size: 14px;
}
.sample {
  width: 100%;
  height: 96px;
  border-radius: 10px;
  border: 1px solid var(--nq-border);
  display: grid;
  place-items: center;
}
.sample.real {
  background:
    radial-gradient(circle at 75% 20%, #fff7e0 0, transparent 45%),
    linear-gradient(180deg, #d9c7a7 0 62%, #a88c64 62% 100%);
}
.product {
  width: 34px;
  height: 52px;
  border-radius: 8px 8px 4px 4px;
  background: linear-gradient(90deg, #555, #222 60%, #444);
  box-shadow: 0 6px 10px -6px rgba(0, 0, 0, 0.5);
}
.sample.real .product {
  transform: translateY(8px);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.swatch {
  width: 36px;
  height: 36px;
  min-height: 0;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--nq-border);
  position: relative;
}
.swatch.on {
  box-shadow:
    0 0 0 2px var(--nq-surface),
    0 0 0 4px var(--nq-primary);
}
.swatch.custom {
  cursor: pointer;
  overflow: hidden;
  background: conic-gradient(#f66, #fd6, #6d8, #6cf, #a7f, #f6c, #f66);
}
.swatch.custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.swatch.custom span {
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  border: 1px solid var(--nq-border);
  pointer-events: none;
}
.hex {
  font-size: 12px;
  color: var(--nq-muted);
  direction: ltr;
}

.fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
.fields label,
.note {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}
.fields label {
  flex: 1 1 180px;
}
.note {
  margin-top: 16px;
}
textarea {
  resize: vertical;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
}
.actions.sticky {
  position: sticky;
  bottom: 0;
  background: var(--nq-surface);
  padding: 12px 0;
  border-top: 1px solid var(--nq-border);
}
.choice {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
}
.choice label {
  display: flex;
  gap: 6px;
  align-items: center;
  cursor: pointer;
}
.choice input,
.check input {
  min-height: 0;
  padding: 0;
  accent-color: var(--nq-primary);
}
.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid var(--nq-border);
  vertical-align: middle;
}

.results {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.result {
  border: 1px solid var(--nq-border);
  border-radius: var(--nq-radius);
  padding: 8px;
}
.result.kept {
  border-color: var(--nq-primary);
  box-shadow: 0 0 0 1px var(--nq-primary);
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
figure {
  margin: 0;
}
figure img,
.placeholder {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 8px;
  background: var(--nq-subtle);
  display: block;
}
.placeholder {
  display: grid;
  place-items: center;
  font-size: 12px;
}
.placeholder.error {
  color: var(--nq-error);
}
figcaption {
  font-size: 11px;
  color: var(--nq-muted);
  text-align: center;
  margin-top: 2px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  min-height: 32px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  cursor: pointer;
}
.title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  color: var(--nq-success);
  font-weight: 600;
}
button.small {
  min-height: 28px;
  padding: 2px 12px;
  font-size: 12px;
}
.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--nq-border);
  border-top-color: var(--nq-primary);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
