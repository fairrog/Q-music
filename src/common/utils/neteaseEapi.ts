import { constants, createCipheriv, createDecipheriv, createHash, publicEncrypt, randomBytes } from 'node:crypto'

/**
 * 网易云 weapi / eapi 请求体与请求头构造。
 *
 * 抽成不依赖 electron 的纯函数模块，主进程和 node:test 共用：
 * - weapi：`params` + `encSecKey`（AES-CBC 两次 + RSA 无填充）
 * - eapi：单个 `params`（md5 摘要 + AES-128-ECB）
 * - eapi 的 header 同时作为 Cookie 发送，收藏/歌单这类写接口依赖它
 *
 * 同一份输入永远得到同一份 eapi 密文，因此可以被测试固定成回归基准。
 */

export const neteaseEapiBase = 'https://interface.music.163.com'
export const neteaseLikePath = '/api/song/like'
export const neteaseLikedIdsPath = '/api/song/like/get'
export const neteasePlaylistTracksPath = '/api/playlist/manipulate/tracks'

const neteaseIv = Buffer.from('0102030405060708')
const neteasePresetKey = Buffer.from('0CoJUm6Qyw8W8jud')
const neteaseEapiKey = Buffer.from('e82ckenh8dichen8')
const neteaseBase62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const neteasePublicKey = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----'
const aesEncrypt = (buffer: Buffer, key: Buffer) => {
  const cipher = createCipheriv('aes-128-cbc', key, neteaseIv)
  return Buffer.concat([cipher.update(buffer), cipher.final()])
}

export const buildNeteaseWeapiForm = (data: Record<string, unknown>) => {
  const secretKey = Buffer.from(Array.from(randomBytes(16), value => neteaseBase62.charCodeAt(value % neteaseBase62.length)))
  const firstPass = aesEncrypt(Buffer.from(JSON.stringify(data)), neteasePresetKey).toString('base64')
  const params = aesEncrypt(Buffer.from(firstPass), secretKey).toString('base64')
  const reversedKey = Buffer.from(secretKey).reverse()
  const paddedKey = Buffer.concat([Buffer.alloc(128 - reversedKey.length), reversedKey])
  const encSecKey = publicEncrypt({ key: neteasePublicKey, padding: constants.RSA_NO_PADDING }, paddedKey).toString('hex')
  return new URLSearchParams({ params, encSecKey })
}

export const buildNeteaseEapiForm = (path: string, data: Record<string, unknown>) => {
  const text = JSON.stringify(data)
  const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex')
  const payload = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const cipher = createCipheriv('aes-128-ecb', neteaseEapiKey, null)
  const params = Buffer.concat([cipher.update(Buffer.from(payload)), cipher.final()]).toString('hex').toUpperCase()
  return new URLSearchParams({ params })
}

export interface NeteaseEapiContext {
  musicU: string
  deviceId: string
  csrfToken?: string
  nmtid?: string
}

/** eapi 的 header 既要进请求体，也要编码成 Cookie，两边必须完全一致。 */
export const buildNeteaseEapiHeader = (context: NeteaseEapiContext, requestId = '0'): Record<string, string> => {
  const header: Record<string, string> = {
    os: 'pc',
    appver: '3.1.10.5100',
    osver: 'Microsoft-Windows-11-Home-China-build-22631-64bit',
    requestId,
    deviceId: context.deviceId,
  }
  if (context.csrfToken) header.__csrf = context.csrfToken
  if (context.musicU) header.MUSIC_U = context.musicU
  if (context.nmtid) header.NMTID = context.nmtid
  return header
}

export const buildNeteaseCookieHeader = (header: Record<string, string>) => {
  return Object.entries(header)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('; ')
}

/** `/api/song/like` 的请求体：trackId 与 userid 都是数字，like 是布尔值。 */
export const buildNeteaseLikeData = (songId: string, userId: string, like: boolean) => ({
  trackId: Number(songId),
  userid: Number(userId),
  like,
})

/** eapi 响应可能被同一把 eapi 密钥加密，解不开就当明文处理。 */
export const decryptNeteaseEapi = (buffer: Buffer) => {
  const decipher = createDecipheriv('aes-128-ecb', neteaseEapiKey, null)
  return Buffer.concat([decipher.update(buffer), decipher.final()]).toString('utf8')
}

/** `/api/playlist/manipulate/tracks` 的请求体：pid 与 trackIds 都要按字符串/数组原样发。 */
export const buildNeteasePlaylistAddData = (playlistId: string, songIds: string[]) => ({
  op: 'add',
  pid: Number(playlistId),
  trackIds: JSON.stringify(songIds),
  imme: 'true',
})
