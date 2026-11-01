<template>
  <section :class="[$style.target, { [$style.compact]: compact }]" :aria-busy="working">
    <div :class="$style.row">
      <SourceIcon source="wy" :size="30" />
      <div :class="$style.copy">
        <strong>{{ $t('netease_favorite_title') }}</strong>
        <span>{{ $t(supported ? 'netease_favorite_hint' : 'netease_favorite_supported') }}</span>
      </div>
      <base-btn type="button" :disabled="disabled || working || !supported" @click="submit">
        {{ $t(working ? 'netease_favorite_working' : status == 'added' ? 'netease_favorite_remove' : status == 'login_required' ? 'netease_favorite_login' : 'netease_favorite_add') }}
      </base-btn>
    </div>
    <p v-if="status" role="status" :class="$style.message">{{ $t('netease_favorite_' + status) }}<span v-if="errorCode != null"> {{ $t('netease_favorite_error_code', { code: errorCode }) }}</span></p>
  </section>
</template>

<script>
import { computed, ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { loginMusicAccount, setNeteaseFavoriteSong } from '@renderer/utils/ipc'
import SourceIcon from './SourceIcon.vue'

// 写回网易云账号的「我喜欢的音乐」：先写，再用只读接口核对，核对结果决定提示文案。
export default {
  components: { SourceIcon },
  props: {
    musicInfo: { type: Object, required: true },
    disabled: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
  },
  emits: ['busy'],
  setup(props, { emit }) {
    const status = ref('')
    const errorCode = ref(null)
    const working = ref(false)
    const supported = computed(() => props.musicInfo.source == 'wy' && /^\d+$/.test(String(props.musicInfo.meta?.songId ?? '')))
    let generation = 0
    watch(() => props.musicInfo, () => {
      generation++
      status.value = ''
      errorCode.value = null
    })
    onBeforeUnmount(() => { generation++ })
    const submit = async() => {
      if (props.disabled || working.value || !supported.value) return
      const current = generation
      const needsLogin = status.value == 'login_required'
      const songId = String(props.musicInfo.meta.songId)
      working.value = true
      errorCode.value = null
      emit('busy', true)
      try {
        if (needsLogin) {
          const result = await loginMusicAccount('wy')
          if (generation == current) status.value = result.status == 'connected' ? 'ready' : 'login_required'
        } else {
          const result = await setNeteaseFavoriteSong(songId, status.value == 'added' ? 'remove' : 'add')
          if (generation == current) {
            status.value = result.status
            errorCode.value = result.code ?? null
          }
        }
      } catch {
        if (generation == current) status.value = 'unavailable'
      } finally {
        working.value = false
        emit('busy', false)
      }
    }
    return { status, errorCode, working, supported, submit }
  },
}
</script>

<style lang="less" module>
.target { flex: none; margin: 0 16px 16px; padding: 14px; border: 1px solid var(--color-primary-alpha-700); border-radius: 12px; }
.row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.copy { display: flex; flex: 1; min-width: 160px; flex-direction: column; gap: 6px; line-height: 1.5; }
.copy strong { font-size: 14px; color: var(--color-font); }
.copy span, .message { font-size: 12px; line-height: 1.6; color: var(--color-font-label); }
.message { margin: 10px 0 0; }
.compact { margin: 0; padding: 12px; background: rgb(from currentColor r g b / .035); border-color: rgb(from currentColor r g b / .1); }
.compact .row { gap: 10px; }
.compact .copy { min-width: 150px; }
.compact .copy strong { color: inherit; font-size: 13px; }
.compact .copy span, .compact .message { color: inherit; opacity: .65; font-size: 11px; }
.compact .row > button { width: 100%; min-height: 34px; }
</style>
