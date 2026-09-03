<template>
  <view v-if="items.length" class="moments-ticker">
    <text v-if="currentItem.type === 'tip'" class="moments-ticker__badge">
      小贴士
    </text>
    <text
      class="moments-ticker__text"
      :class="{ 'moments-ticker__text--fading': isFading }"
    >
      {{ currentItem.text }}
    </text>
  </view>
</template>

<script lang="ts">
export default {
  name: 'MomentsTicker',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface TickerItem {
  type: 'tip' | 'healing'
  text: string
}

const TIP_ITEMS: TickerItem[] = [
  { type: 'tip', text: '想说话就过来，TA 都在' },
  { type: 'tip', text: '每天聊几句，就很暖' },
  { type: 'tip', text: '说说今天，TA 会记得' },
  { type: 'tip', text: '安静一会儿，TA 也在' },
  { type: 'tip', text: '「＋」导入聊天记录，更像从前' },
  { type: 'tip', text: '资料越全，聊起来越像' },
  { type: 'tip', text: '写下共同回忆，TA 会记得' },
  { type: 'tip', text: '长按消息，可删记忆' },
  { type: 'tip', text: '动态里 @TA，TA 会看见' },
  { type: 'tip', text: '点「共鸣」，是无声的拥抱' },
  { type: 'tip', text: '聊天只你可见，放心说' },
  { type: 'tip', text: '你的思念，这里替你保管' },
]

const HEALING_ITEMS: TickerItem[] = [
  { type: 'healing', text: '思念不是软弱，是爱还在继续' },
  { type: 'healing', text: '每一次想起，都是一次重逢' },
  { type: 'healing', text: '他们离开了日子，却没有离开你的生活' },
  { type: 'healing', text: '慢慢来，今天比昨天好一点就够了' },
  { type: 'healing', text: '记忆不会消失，它只是换了一种陪伴的方式' },
  { type: 'healing', text: '难过的时候就停一会儿，没人催你' },
  { type: 'healing', text: '爱是唯一不会因告别而减少的东西' },
  { type: 'healing', text: '那些一起走过的路，都成了你的一部分' },
  { type: 'healing', text: '不必急着好起来，想念也可以很平静' },
  { type: 'healing', text: '把想念说出来，心就不会那么满' },
  { type: 'healing', text: '他们没有走远，只是换了个地方住在心里' },
  { type: 'healing', text: '好好吃饭，好好睡觉，就是他们最想看到的' },
  { type: 'healing', text: '日子会疼，但也会暖' },
  { type: 'healing', text: '你记得，他们就没有真正离开' },
  { type: 'healing', text: '有些爱，时间带不走' },
  { type: 'healing', text: '哭也没关系，笑也没关系，想他们就好' },
  { type: 'healing', text: '风吹过的时候，就当是他们回来看你了' },
  { type: 'healing', text: '留在心里的人，永远不会散场' },
  { type: 'healing', text: '把日子过好，是最长的思念' },
  { type: 'healing', text: '想念没有期限，你不需要赶上任何人' },
  { type: 'healing', text: '他们没有说完的话，生活会慢慢告诉你' },
  { type: 'healing', text: '此刻的你平安，就是最好的告慰' },
  { type: 'healing', text: '允许自己想他们，也允许自己好好活' },
  { type: 'healing', text: '温暖没有消失，它沉在心底，等你需要时浮上来' },
  { type: 'healing', text: '深夜的灯还亮着，就像从前一样' },
]

const ROTATE_INTERVAL_MS = 5500
const FADE_DURATION_MS = 350

function seededShuffle<T>(source: T[], seed: number): T[] {
  const result = [...source]
  let state = seed
  for (let i = result.length - 1; i > 0; i--) {
    state = (state * 9301 + 49297) % 233280
    const j = Math.floor((state / 233280) * (i + 1))
    const temp = result[i]
    result[i] = result[j]
    result[j] = temp
  }
  return result
}

function buildDailyItems(): TickerItem[] {
  const now = new Date()
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
  const tips = seededShuffle(TIP_ITEMS, seed)
  const healings = seededShuffle(HEALING_ITEMS, seed + 1)
  const mixed: TickerItem[] = []
  let tipIndex = 0
  let healingIndex = 0

  while (tipIndex < tips.length || healingIndex < healings.length) {
    for (let n = 0; n < 2 && healingIndex < healings.length; n++) {
      mixed.push(healings[healingIndex++])
    }
    if (tipIndex < tips.length) {
      mixed.push(tips[tipIndex++])
    }
  }

  return mixed
}

const items = buildDailyItems()
const currentIndex = ref(0)
const isFading = ref(false)
let rotateTimer: ReturnType<typeof setInterval> | undefined
let fadeTimer: ReturnType<typeof setTimeout> | undefined

const currentItem = computed(
  () => items[currentIndex.value] ?? { type: 'healing' as const, text: '' }
)

onMounted(() => {
  rotateTimer = setInterval(() => {
    isFading.value = true
    fadeTimer = setTimeout(() => {
      currentIndex.value = (currentIndex.value + 1) % items.length
      isFading.value = false
    }, FADE_DURATION_MS)
  }, ROTATE_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (rotateTimer) {
    clearInterval(rotateTimer)
  }
  if (fadeTimer) {
    clearTimeout(fadeTimer)
  }
})
</script>

<style lang="scss">
.moments-ticker {
  position: absolute;
  top: 216px;
  left: 96px;
  right: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
}

.moments-ticker__badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  background: #e9e1f5;
  color: #7b6f9e;
  font-size: 11px;
  line-height: 16px;
}

.moments-ticker__text {
  flex: 1;
  min-width: 0;
  color: #5f5a66;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 1;
  transition: opacity 350ms ease;
}

.moments-ticker__text--fading {
  opacity: 0;
}
</style>
