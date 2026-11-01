# 网易云音乐收藏写回

在播放详情页或底部播放栏点击爱心，弹层里除「本地收藏」和 QQ 音乐入口外，新增「网易云音乐 · 我喜欢的音乐」一项。点击后把当前歌曲写进**当前登录网易云账号**的「我喜欢的音乐」歌单，已收藏时按钮变为「取消网易云收藏」，再点一次即从云端移除。

## 入口与支持范围

- 只对网易云来源的歌曲生效：要求 `musicInfo.source == 'wy'` 且 `meta.songId` 是纯数字。其他来源的歌曲不做跨平台猜测，按钮禁用并提示「目前支持网易云音乐来源的歌曲」。
- 未登录或凭证失效时，按钮变为「登录网易云音乐」，点击走已有的官方网页登录窗口，登录成功后需要用户再点一次收藏（不自动重放上次操作）。
- 爱心本身仍表示**本地收藏**状态，云端结果只在弹层里单独提示，两者不混用。

## 写入链路

1. `setNeteaseFavoriteSong`（`src/main/modules/winMain/musicAccount.ts`）先检查 `persist:qmusic-account-netease` 分区里有没有 `MUSIC_U`，并套用与播放一致的账号代理设置。
2. 用 `getNeteasePlaybackContext` 取出 `MUSIC_U`、`__csrf`、`deviceId`、`NMTID`，再由 `buildNeteaseEapiHeader` 生成 eapi header。这个 header 同时进请求体、也编码成 Cookie 发送，两边必须一致。
3. 写入前先调 `/api/song/like/get` 读一次全量收藏 ID：如果已经是目标状态就直接返回，不重复写。
4. 写入调 `POST https://interface.music.163.com/eapi/song/like`，请求体由 `buildNeteaseLikeData` 生成：`{ trackId, userid, like }`，`trackId` 与 `userid` 都是数字，取消收藏时 `like` 为 `false`。
5. 写入后再读一次 `/api/song/like/get` 核对。只有云端状态与请求一致才提示成功；否则提示「平台已受理，但云端暂未查到结果」，不会把受理 code 当成到账证明。

**eapi 响应是加密的。** `interface.music.163.com` 返回的是 AES-128-ECB 密文而不是 JSON，直接 `JSON.parse` 会失败并误报「暂时无法完成账号查询」。`requestNeteaseEapi` 先按明文解析，失败后用 `decryptNeteaseEapi`（同一把 eapi 密钥）解密再解析，两条路都不通才报错，并把 `status / bytes / encrypted / code` 写进 `main.log`。

## 收藏到指定歌单

卡片下方的「收藏到歌单…」展开账号歌单列表（`/weapi/user/playlist`，与「导入歌单」同一份数据），点哪个歌单就把当前歌曲加进去：

1. 调 `POST /eapi/api/playlist/manipulate/tracks`，请求体由 `buildNeteasePlaylistAddData` 生成：`{ op: 'add', pid, trackIds: '["<id>"]', imme: 'true' }`。
2. 遇到上游怪癖 `code 512` 时，把歌曲 ID 重复一次重试，与参考客户端一致。
3. 写入后用 `/weapi/v6/playlist/detail` 读回 `trackIds` 核对，确认这首歌真的在歌单里才算成功。

请求体加密（md5 摘要 + AES-128-ECB）与 header/Cookie 构造抽在 `src/common/utils/neteaseEapi.ts`，不依赖 electron，因此可以被 `node:test` 直接导入。播放日志上报仍在用同一份 eapi 构造，行为未变。

## 状态含义

| status | 界面提示 | 含义 |
| --- | --- | --- |
| `added` | 已收藏 | 云端「我喜欢的音乐」里查到了这首歌 |
| `removed` | 已移除 | 云端已不存在这首歌 |
| `login_required` | 未登录 | 无 `MUSIC_U`，或接口返回 301/401 |
| `rejected` | 平台未接受 | 写接口返回非 200 业务码，附带错误码 |
| `unconfirmed` | 待核对 | 写接口受理了，但读回结果与请求不一致 |
| `unavailable` | 暂时不可用 | 网络、超时或响应无法解析，本次未提交 |
| `unsupported` | 不支持 | 歌曲 ID 不是网易云数字 ID |

歌单加歌另有四个结果：`added`（已加入「歌单名」）、`unconfirmed`（受理但歌单里暂未查到）、`rejected`（带错误码）、`unavailable`（请求没完成，未提交）。

## 验证

```bash
npm run test:netease-favorite
```

覆盖：接口路径与 eapi 域名、eapi 密文对同一输入稳定且与 `test/fixtures/neteaseEapi.json` 的固定基准一致、header 字段顺序与 Cookie 编码、收藏请求体的数字转换、eapi 响应解密回明文、歌单加歌请求体格式。

`test/fixtures/neteaseEapi.json` 由 `node --experimental-strip-types` 生成，用于锁定密文。改动算法、密钥或字段顺序时必须重新生成并人工确认差异，不能直接覆盖。

真实账号已用一次性探针验证过（收藏 → 回读 1015→1016 命中 → 取消 → 1015 消失；歌单加歌 → 详情命中 → 删除 → 详情消失，净效果为零）。日常回归仍需人工确认：登录网易云后收藏一首歌，去官方客户端或网页版「我喜欢的音乐」看，再点一次确认移除。自动化测试只覆盖请求构造与解密，不等于真实账号端到端成功。

## 尚未接入

- 本地「我喜欢」歌单整单批量推送到网易云（当前只做单曲，歌单加歌也只加当前这一首）。
- 网易云侧歌单的新建、改名（加歌已支持，删除与排序还没接）。
- 网易云「我喜欢的音乐」反向增量同步到本地歌单（QQ 已有该能力，网易云尚未接入）。
