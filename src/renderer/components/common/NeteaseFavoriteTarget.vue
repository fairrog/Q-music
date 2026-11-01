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
    <p v-if="status" role="status" :class="$style.message">
      {{ $t('netease_favorite_' + status) }}<span v-if="errorCode != null"> {{ $t('netease_favorite_error_code', { code: errorCode }) }}</span>
      <span v-if="detail" :class="$style.detail">{{ detail }}</span>
    </p>

    <template v-if="supported">
      <button type="button" :class="$style.more" :disabled="disabled || working || playlistsBusy" @click="togglePlaylists">
        {{ $t(playlistsOpen ? 'netease_playlist_hide' : 'netease_playlist_open') }}
        <span aria-hidden="true">{{ playlistsOpen ? '⌃' : '⌄' }}</span>
      </button>
      <div v-if="playlistsOpen" :class="$style.playlists">
        <p v-if="playlistsBusy" :class="$style.message">{{ $t('netease_playlist_loading') }}</p>
        <p v-else-if="playlistError" :class="$style.message">
          {{ $t('netease_playlist_failed') }}
          <button type="button" :class="$style.retry" @click="loadPlaylists">{{ $t('netease_playlist_retry') }}</button>
        </p>
        <p v-else-if="!playlists.length" :class="$style.message">{{ $t('netease_playlist_empty') }}</p>
        <ul v-else>
          <li v-for="item in playlists" :key="item.id">
            <button type="button" :class="$style.item" :disabled="playlistsBusy || addingId == item.id" @click="addTo(item)">
              <span :class="$style.name">{{ item.name }}</span>
              <span :class="$style.count">{{ item.trackCount }}</span>
            </button>
          </li>
        </ul>
        <p v-if="notice" role="status" :class="$style.message">{{ $t(notice.key, notice.params) }}</p>
      </div>
    </template>
  </section>
</template>

<script>
import { computed, ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { addNeteasePlaylistTracks, getMusicAccountPlaylists, loginMusicAccount, setNeteaseFavoriteSong } from '@renderer/utils/ipc'
import SourceIcon from './SourceIcon.vue'

// 写回网易云账号：单曲收藏进「我喜欢的音乐」，或加进账号里的任意歌单。两种都先写再回读核对。
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
    const detail = ref('')
    const working = ref(false)
    const playlistsOpen = ref(false)
    const playlistsBusy = ref(false)
    const playlists = ref([])
    const playlistError = ref(false)
    const addingId = ref('')
    const notice = ref(null)
    const supported = computed(() => props.musicInfo.source == 'wy' && /^\d+$/.test(String(props.musicInfo.meta?.songId ?? '')))
    let generation = 0
    watch(() => props.musicInfo, () => {
      generation++
      status.value = ''
      errorCode.value = null
      detail.value = ''
      notice.value = null
      addingId.value = ''
      playlistsOpen.value = false
    })
    onBeforeUnmount(() => { generation++ })

    const loadPlaylists = async() => {
      if (playlistsBusy.value) return
      playlistsBusy.value = true
      playlistError.value = false
      try {
        const result = await getMusicAccountPlaylists('wy')
        if (result.status == 'login_required') {
          status.value = 'login_required'
          playlistError.value = true
          return
        }
        if (result.status != 'available') {
          playlistError.value = true
          return
        }
        playlists.value = result.playlists.map(item => ({ id: item.id, name: item.name, trackCount: item.trackCount }))
      } catch {
        playlistError.value = true
      } finally {
        playlistsBusy.value = false
      }
    }

    const togglePlaylists = () => {
      playlistsOpen.value = !playlistsOpen.value
      notice.value = null
      if (playlistsOpen.value && !playlists.value.length) void loadPlaylists()
    }

    const addTo = async(item) => {
      if (playlistsBusy.value || addingId.value) return
      const current = generation
      const songId = String(props.musicInfo.meta.songId)
      addingId.value = item.id
      notice.value = null
      emit('busy', true)
      try {
        const result = await addNeteasePlaylistTracks(item.id, [songId])
        if (generation != current) return
        if (result.status == 'added') notice.value = { key: 'netease_playlist_added', params: { name: item.name } }
        else if (result.status == 'unconfirmed') notice.value = { key: 'netease_playlist_unconfirmed', params: {} }
        else if (result.status == 'login_required') {
          status.value = 'login_required'
          notice.value = { key: 'netease_playlist_login_required', params: {} }
        } else if (result.status == 'rejected') notice.value = { key: 'netease_playlist_rejected', params: { code: result.code ?? '' } }
        else notice.value = { key: 'netease_playlist_unavailable', params: {} }
        if (result.detail) detail.value = result.detail
      } catch {
        if (generation == current) notice.value = { key: 'netease_playlist_unavailable', params: {} }
      } finally {
        addingId.value = ''
        emit('busy', false)
      }
    }

    const submit = async() => {
      if (props.disabled || working.value || !supported.value) return
      const current = generation
      const needsLogin = status.value == 'login_required'
      const songId = String(props.musicInfo.meta.songId)
      working.value = true
      errorCode.value = null
      detail.value = ''
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
            detail.value = result.detail ?? ''
          }
        }
      } catch {
        if (generation == current) status.value = 'unavailable'
      } finally {
        working.value = false
        emit('busy', false)
      }
    }
    return {
      status, errorCode, detail, working, supported, submit,
      playlistsOpen, playlistsBusy, playlists, playlistError, addingId, notice,
      togglePlaylists, loadPlaylists, addTo,
    }
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
.detail { opacity: .7; word-break: break-all; }
.more { display: flex; align-items: center; justify-content: space-between; width: 100%; margin-top: 10px; padding: 8px 10px; font-size: 12px; color: var(--color-font-label); background: rgb(from currentColor r g b / .05); border: 1px solid rgb(from currentColor r g b / .1); border-radius: 8px; cursor: pointer; }
.more:disabled { opacity: .5; cursor: default; }
.playlists { max-height: 210px; margin-top: 8px; overflow-y: auto; }
.playlists ul { margin: 0; padding: 0; list-style: none; }
.item { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 7px 10px; font-size: 12px; color: inherit; background: none; border: 0; border-radius: 8px; cursor: pointer; text-align: left; }
.item:hover { background: rgb(from currentColor r g b / .08); }
.item:disabled { opacity: .5; cursor: default; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { flex: none; opacity: .6; font-variant-numeric: tabular-nums; }
.retry { margin-left: 6px; padding: 2px 8px; font-size: 11px; color: inherit; background: rgb(from currentColor r g b / .1); border: 0; border-radius: 6px; cursor: pointer; }
.compact { margin: 0; padding: 12px; background: rgb(from currentColor r g b / .035); border-color: rgb(from currentColor r g b / .1); }
.compact .row { gap: 10px; }
.compact .copy { min-width: 150px; }
.compact .copy strong { color: inherit; font-size: 13px; }
.compact .copy span, .compact .message { color: inherit; opacity: .65; font-size: 11px; }
.compact .row > button { width: 100%; min-height: 34px; }
</style>
