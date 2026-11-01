import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  buildNeteaseCookieHeader,
  buildNeteaseEapiForm,
  buildNeteaseEapiHeader,
  buildNeteaseLikeData,
  buildNeteasePlaylistAddData,
  decryptNeteaseEapi,
  neteaseEapiBase,
  neteaseLikePath,
  neteaseLikedIdsPath,
  neteasePlaylistTracksPath,
} from '../src/common/utils/neteaseEapi.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/neteaseEapi.json', import.meta.url), 'utf8')) as Record<string, string>

// 收藏写回依赖这三个常量拼出 eapi 地址，路径变化必须在这里先失败。
test('网易云收藏接口路径保持 /api 前缀与 eapi 域名', () => {
  assert.equal(neteaseEapiBase, 'https://interface.music.163.com')
  assert.equal(neteaseLikePath, '/api/song/like')
  assert.equal(neteaseLikedIdsPath, '/api/song/like/get')
  assert.equal(neteasePlaylistTracksPath, '/api/playlist/manipulate/tracks')
  assert.equal(`${neteaseEapiBase}/eapi${neteaseLikePath.slice(4)}`, 'https://interface.music.163.com/eapi/song/like')
})

test('eapi 请求体对同一输入稳定，并与固定基准一致', () => {
  const data = { trackId: 123456, userid: 789, like: true }
  const first = buildNeteaseEapiForm(neteaseLikePath, data).get('params')
  assert.equal(first, buildNeteaseEapiForm(neteaseLikePath, { ...data }).get('params'))
  assert.match(String(first), /^[0-9A-F]+$/)
  assert.equal(String(first).length % 32, 0)

  // 固定基准来自 test/fixtures/neteaseEapi.json：算法、密钥或字段顺序被改动时这条会失败。
  assert.equal(first, fixture.like)
  assert.equal(buildNeteaseEapiForm(neteaseLikePath, { ...data, like: false }).get('params'), fixture.unlike)
  assert.equal(buildNeteaseEapiForm(neteaseLikedIdsPath, { uid: 789 }).get('params'), fixture.likedIds)
})

test('eapi header 同时作为 Cookie，字段顺序与编码保持稳定', () => {
  const header = buildNeteaseEapiHeader({ musicU: 'MUSIC_U-test', deviceId: 'abc123', csrfToken: 'tok', nmtid: 'nm' }, '1700000000000')
  assert.deepEqual(header, {
    os: 'pc',
    appver: '3.1.10.5100',
    osver: 'Microsoft-Windows-11-Home-China-build-22631-64bit',
    requestId: '1700000000000',
    deviceId: 'abc123',
    __csrf: 'tok',
    MUSIC_U: 'MUSIC_U-test',
    NMTID: 'nm',
  })
  assert.equal(buildNeteaseCookieHeader(header), [
    'os=pc',
    'appver=3.1.10.5100',
    'osver=Microsoft-Windows-11-Home-China-build-22631-64bit',
    'requestId=1700000000000',
    'deviceId=abc123',
    '__csrf=tok',
    'MUSIC_U=MUSIC_U-test',
    'NMTID=nm',
  ].join('; '))

  // 未登录时不带 MUSIC_U；特殊字符必须编码，否则 Cookie 会被截断。
  assert.equal('MUSIC_U' in buildNeteaseEapiHeader({ musicU: '', deviceId: 'd' }), false)
  assert.equal(buildNeteaseCookieHeader({ 'a b': 'x;y=z' }), [encodeURIComponent('a b'), encodeURIComponent('x;y=z')].join('='))
})

test('收藏请求体把歌曲和账号 ID 转成数字，取消收藏发 false', () => {
  assert.deepEqual(buildNeteaseLikeData('123456', '789', true), { trackId: 123456, userid: 789, like: true })
  assert.deepEqual(buildNeteaseLikeData('123456', '789', false), { trackId: 123456, userid: 789, like: false })
})

test('eapi 响应可以用同一把密钥解回明文', () => {
  // 服务端返回的是 AES-128-ECB 密文，解不开就会被误判成「暂时不可用」。
  const form = buildNeteaseEapiForm('/api/test', { a: 1 })
  const plain = decryptNeteaseEapi(Buffer.from(String(form.get('params')), 'hex'))
  assert.match(plain, /^\/api\/test-36cd479b6b5-\{"a":1\}-36cd479b6b5-[0-9a-f]{32}$/)
  assert.throws(() => decryptNeteaseEapi(Buffer.from('not-a-cipher', 'utf8')))
})

test('歌单加歌请求体按上游格式序列化', () => {
  assert.deepEqual(buildNeteasePlaylistAddData('123', ['456', '789']), {
    op: 'add',
    pid: 123,
    trackIds: '["456","789"]',
    imme: 'true',
  })
})
