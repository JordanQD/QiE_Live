# LiveParse 直播平台插件制作与发布流程

本文总结一套可复用的 LiveParse 平台插件开发方法。企鹅体育插件是文中的实际案例，但流程也适用于其他公开直播平台。

目标不是简单“抓到一个播放地址”，而是交付一套可以安装、升级、回归测试和公开维护的插件：

- 插件清单 `manifest.json`
- 插件入口 `index.js`
- 可选的弹幕驱动脚本
- 平台图标资源
- 可安装 ZIP 包
- 订阅源 JSON
- GitHub 源码、Pull Request 和 Release

## 一、先读宿主规范，再研究目标网站

开发前先确认宿主要求的接口和数据模型，不要直接从网页请求开始写代码。

至少需要理解以下内容：

- 插件入口必须暴露 `globalThis.LiveParsePlugin`
- `manifest.json` 的版本、入口文件和预加载脚本必须一致
- 分类、房间、播放、搜索、详情、状态、分享解析和弹幕的返回结构
- `liveType`、`liveState`、`requestContext` 等字段的类型约束
- 宿主支持的网络、加密、Cookie 和错误处理能力

最有效的起点是找一个已经可用的同类插件作为参考。参考它的接口形状、错误处理和打包结构，不要照搬目标平台无关的业务代码。

## 二、确认接入边界

先回答四个问题：

1. 房间标识是什么，例如纯数字房间号还是短链接？
2. 未登录用户能否直接观看？
3. 播放地址是否需要 Cookie、Token、时间戳或网页签名？
4. 弹幕使用 WebSocket、轮询还是平台私有协议？

如果网页本身允许未登录观看，插件通常也应优先实现免登录流程。不要额外引入不必要的 Cookie、账号或设备标识。

只分析浏览器正常访问时公开执行的网页逻辑和公开请求。不要绕过付费、账号权限、地域限制、DRM 或访问控制。

## 三、用浏览器还原网页的数据流

打开一个确定正在直播的房间和平台目录页，通过浏览器开发者工具或自动化浏览器观察：

- 页面初始 HTML 和内嵌状态，例如 `__NEXT_DATA__`
- XHR/Fetch 请求
- 播放接口及其查询参数
- 多清晰度字段
- 房间分类和分页参数
- WebSocket 地址、握手帧、心跳和消息帧

建议把发现记录成接口表：

| 能力 | 页面/接口 | 关键输入 | 关键输出 |
|---|---|---|---|
| 分类 | 分类接口 | 无 | 分类 ID、名称、URL |
| 房间列表 | 目录接口 | 分类、页码、页面大小 | 房间数组、总数 |
| 房间详情 | 房间页或详情接口 | 房间号 | 标题、主播、封面、状态 |
| 播放 | 播放接口 | 房间号、时间戳、签名、CDN | 流地址、多码率 |
| 弹幕 | WebSocket/轮询 | 房间号、节点 | 聊天消息、心跳规则 |

不要只观察一个时间点。直播状态、清晰度数量和 CDN 可能随房间、赛事及时间变化。

## 四、按最小闭环逐步实现

推荐按以下顺序开发，每一步都能独立测试：

1. 房间号和链接解析
2. 房间详情与直播状态
3. 单一可播放地址
4. 播放地址刷新
5. 动态清晰度
6. 搜索和分享链接解析
7. 分类与房间列表
8. 主播头像
9. 弹幕
10. 图标、清单和发布元数据

这样可以先证明“房间能打开并播放”，再逐渐补齐用户体验，出现问题时也容易定位。

## 五、统一网络请求和错误处理

所有请求通过宿主能力发出，集中设置超时、User-Agent 和 Referer：

```js
async function request(url, headers) {
  return await Host.http.request({
    url,
    method: "GET",
    headers: Object.assign({
      "User-Agent": WEB_USER_AGENT,
      "Referer": "https://example.com/"
    }, headers || {}),
    timeout: 20
  });
}
```

JSON 解析、参数校验和上游错误也应封装。错误统一使用 `Host.raise(code, message, context)`，并在 `context` 中放入房间号、URL、页码或上游错误码，方便真机排查。

## 六、把平台字段映射为宿主模型

房间列表、搜索、详情和分享解析最终都应转换为统一的 `LiveModel`：

```js
{
  userName: "主播名",
  roomTitle: "直播标题",
  roomCover: "https://...",
  userHeadImg: "https://...",
  liveType: "平台编号",
  liveState: "1",
  userId: "主播 ID",
  roomId: "房间号",
  liveWatchedCount: "热度"
}
```

注意事项：

- ID 和状态字段尽量返回字符串
- 图片 URL 应补齐 `https:`，避免混合内容或 ATS 问题
- 列表接口没有头像时，可以用方形房间图兜底；详情页再请求真实头像
- 不要用 `a || b` 处理可能为 `0` 的有效数值，应明确判断 `undefined`
- 列表与详情可以使用不同的直播状态判定，因为上游字段往往不同

## 七、分类和房间列表的宿主触发机制

这次开发中最容易忽略的问题是：接口请求正确，不代表宿主一定会调用 `getRooms`。

在当前宿主中，只有选中了主分类的 `subList` 叶子项，房间页才会触发 `getRooms`。如果目标平台只有一层分类，也要为每个主分类挂一个“全部”叶子：

```js
{
  id: "Football",
  title: "足球",
  subList: [{
    id: "Football",
    parentId: "Football",
    title: "全部",
    icon: "",
    biz: ""
  }]
}
```

房间列表实现应兼容宿主可能传入的字段，并限制页面大小：

```js
const shortName = String(
  payload.id || payload.categoryId || payload.shortName || ""
);
const page = Math.max(1, Number(payload.page) || 1);
const pageSize = Math.min(60, Math.max(1, Number(payload.pageSize) || 60));
```

请求参数名称必须与网页完全一致。例如有的平台区分 `shortName` 和 `short_name`，写错后接口可能仍返回 HTTP 200，但分类过滤不会生效。

## 八、播放签名与地址刷新

如果播放接口带时间戳或签名，应从网页当前公开执行的逻辑中确认：

- 签名输入字段和拼接顺序
- 时间戳单位，例如秒、毫秒或分钟
- 是否依赖服务端时间
- CDN 是否参与签名
- 播放 URL 的有效期

把签名和请求拆成独立函数，并使用宿主提供的加密能力。不要把临时播放地址写死在插件中。

播放地址会过期时必须实现 `refreshPlayback`。刷新时要保留用户选择的 CDN 和清晰度，不能每次都退回默认档位。

## 九、清晰度必须动态生成

不要假设平台永远提供“原画、超清、高清、标清”四档。

正确做法是：

1. 读取播放接口本次实际返回的流
2. 去重并过滤空地址
3. 按码率从高到低排序
4. 根据实际数量生成显示名称
5. 在 `requestContext` 中保存稳定的清晰度键和码率
6. 刷新地址后按稳定键重新选择同一档

某些宿主模型对 JSON 类型严格解码。即使 JavaScript 中数字和字符串看起来可以互换，`requestContext` 内的字段类型不匹配也可能导致 iOS 报 `Decoding Array<LiveQualityModel> failed`。发布前必须验证真实返回 JSON 的每个字段类型。

## 十、弹幕作为独立驱动实现

弹幕比播放更适合独立成预加载脚本。宿主负责建立网络连接，插件负责平台协议：

- `getDanmaku`：返回连接地址、Headers 和运行时描述
- `createDanmakuSession`：创建连接级状态
- `onDanmakuOpen`：生成登录/订阅帧
- `onDanmakuFrame`：解析二进制或文本消息
- `onDanmakuTick`：生成心跳
- `destroyDanmakuSession`：释放状态

所有状态必须按 `connectionId` 隔离，不能让两个房间共享序号、缓冲区或游标。

测试至少覆盖：

- 握手帧字段
- 心跳周期和递增序号
- 二进制消息解码
- 昵称、文本和颜色映射
- 断开重连后的状态清理

## 十一、建立本地测试宿主

不要依赖每次都安装到手机测试。可以用 Node.js 的 `vm` 创建最小宿主环境：

- 注入 `Host.http.request`
- 注入 `Host.crypto.md5` 等能力
- 加载预加载脚本和入口脚本
- 直接调用 `LiveParsePlugin` 方法

建议把测试拆为：

- 房间列表专项测试
- 动态清晰度纯数据测试
- 弹幕协议测试
- 完整在线房间回归测试

房间列表测试应检查第一页、第二页、页面大小、分类参数以及每个 `LiveModel` 的必需字段。在线播放测试要注意房间可能临时下播；这类失败应与结构测试分开，避免把“当前没有直播流”误判为代码回归。

## 十二、真机错误的定位顺序

宿主报错时，先看错误属于哪一层：

1. `Missing function`：清单声明了能力，但入口没有对应方法
2. `Invalid JS return value`：字段缺失或类型错误
3. `Decoding ... failed`：返回 JSON 与宿主模型不一致
4. HTTP/上游错误：请求参数、Header、签名或直播状态问题
5. 播放器错误：流协议、URL 时效、User-Agent 或 Referer 问题

对于不需要登录的平台，即使凭证功能为空，也可以实现一个返回空对象的 `clearCredential`，避免宿主统一调用时出现 `Missing function`。

## 十三、版本、打包和校验

使用语义化版本：

- 修复兼容性问题：PATCH
- 新增房间列表、弹幕等能力：MINOR
- 不兼容的接口或数据结构变化：MAJOR

插件目录示例：

```text
qie-1.2.4/
├─ manifest.json
├─ index.js
├─ lp_plugin_qie_1.2.4_danmaku.js
└─ assets/
```

ZIP 的根目录必须直接包含 `manifest.json` 和 `index.js`，不能再多套一层版本目录。

PowerShell 打包示例：

```powershell
Compress-Archive -Path qie-1.2.4\* -DestinationPath qie-1.2.4.zip
Get-FileHash -Algorithm SHA256 qie-1.2.4.zip
tar -tf qie-1.2.4.zip
```

发布前同时检查：

- `manifest.version`
- `manifest.entry`
- `preloadScripts` 文件名
- 入口脚本和弹幕脚本共享键
- ZIP 内容层级
- SHA-256

## 十四、构建订阅源

订阅源负责告诉客户端当前版本、下载地址、哈希和能力：

```json
{
  "apiVersion": 1,
  "plugins": [{
    "pluginId": "qie",
    "version": "1.2.4",
    "zipURL": "https://github.com/OWNER/REPO/releases/download/qie-v1.2.4/qie-1.2.4.zip?sha256=...",
    "sha256": "...",
    "capabilities": {
      "rooms": { "status": "available" },
      "playback": { "status": "available" }
    }
  }]
}
```

Release 上传完成后再验证 raw 订阅源内容，确保版本、下载地址、哈希和能力状态都已经更新。

## 十五、GitHub 发布流程

推荐使用功能分支和 Pull Request：

1. 从最新 `main` 创建功能分支
2. 只添加本次版本目录、ZIP、订阅源和文档
3. 本地测试全部通过后提交
4. 推送分支并创建 PR
5. 检查变更文件和合并状态
6. 合并 PR
7. 创建版本 Tag 和 GitHub Release
8. 上传 ZIP
9. 核对 Release 资产的 SHA-256
10. 再次读取 `main` 上的 raw 订阅源验证发布结果

仓库建议保留历史版本目录和 ZIP，订阅源只指向当前推荐版本。这样出现回归时可以快速比较或回退。

## 十六、发布检查清单

### 功能

- [ ] 房间号和链接能解析
- [ ] 直播、未开播状态正确
- [ ] 播放地址可用且能刷新
- [ ] 清晰度数量来自实时接口
- [ ] 分类选择后宿主会调用房间列表
- [ ] 房间分页和页面大小生效
- [ ] 搜索、详情和分享解析返回统一模型
- [ ] 头像和封面使用 HTTPS
- [ ] 弹幕握手、心跳和消息解析正常

### 兼容性

- [ ] 所有 ID、状态和上下文字段类型匹配宿主模型
- [ ] 无登录平台实现空凭证兼容方法
- [ ] `liveType` 不与其他平台冲突
- [ ] iOS、macOS 或 tvOS 至少完成一次真机验证

### 发布

- [ ] 版本号和文件名一致
- [ ] ZIP 根目录结构正确
- [ ] SHA-256 已写入订阅源
- [ ] README 已更新
- [ ] PR 已检查并合并
- [ ] Release 非草稿、非预发布
- [ ] Release 资产哈希与本地一致
- [ ] raw 订阅源已显示新版本

## 十七、这次实践得到的核心经验

1. 先理解宿主调用条件，再判断接口是否有问题。房间接口可用但 UI 不加载，最终原因可能是 `subList` 结构。
2. 网页显示几档，插件就返回几档；不要硬编码清晰度数量。
3. JavaScript 能运行不代表宿主能解码，返回值的字段名和类型必须精确。
4. 播放、列表、弹幕应分别测试，避免直播间临时下播掩盖真正的回归结果。
5. 参考成熟插件的宿主适配方式，平台请求逻辑则以目标网站的实际网络行为为准。
6. 每次发布都保留源码、安装包、哈希和可追踪的 PR，后续维护成本会大幅降低。
