# YT Translate — YouTube 沉浸式双语翻译浏览器扩展

## 项目概述

基于 Chrome Extension Manifest V3 的 YouTube 双语翻译扩展，使用 DeepSeek v4 Flash API 进行实时翻译。纯原生 JavaScript 实现，无构建工具、无框架依赖。

- **作者**: Pear (453910959@qq.com)
- **仓库**: https://github.com/qin858526/yt_translate
- **许可证**: MIT

## 功能模块

| 功能 | 说明 |
|------|------|
| 字幕翻译 | 实时双语字幕覆盖层，`requestAnimationFrame` 与视频播放同步 |
| 评论翻译 | 评论区双语对照翻译 |
| 标题 & 简介翻译 | 视频标题和简介内联翻译 |
| 直播弹幕翻译 | 实时聊天消息翻译 |

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    YouTube 页面                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │          Content Scripts (document_start)         │   │
│  │                                                   │   │
│  │  lib/utils.js      → 工具函数 (防抖/哈希/等待)     │   │
│  │  lib/cache.js      → LRU 翻译缓存 (max 2000)      │   │
│  │  lib/translator.js → 翻译客户端 (批量 + 缓存)      │   │
│  │                                                   │   │
│  │  content/page/selectors.js → YouTube DOM 选择器   │   │
│  │  content/page/injector.js  → 翻译文本注入 DOM      │   │
│  │  content/page/observer.js  → MutationObserver 监听 │   │
│  │                                                   │   │
│  │  content/subtitle/extractor.js → 字幕数据提取      │   │
│  │  content/subtitle/overlay.js   → 双语字幕渲染层    │   │
│  │                                                   │   │
│  │  content/main.js → 入口/编排器 (初始化/SPA/生命周期)│   │
│  └──────────────────┬───────────────────────────────┘   │
└─────────────────────┼────────────────────────────────────┘
                      │ chrome.runtime.sendMessage
┌─────────────────────┼────────────────────────────────────┐
│  Background Service Worker                              │
│  background/service-worker.js                           │
│  → 接收翻译请求 → 调用 DeepSeek API → 返回译文            │
│  → 重试逻辑: 指数退避, 最多3次, 单次超时15s               │
│  → API Key 缓存在内存, 监听 storage 变更自动刷新           │
└─────────────────────────────────────────────────────────┘
                      ↑
┌─────────────────────┼────────────────────────────────────┐
│  Popup UI (扩展图标弹窗)                                  │
│  popup/popup.{html,js,css}                              │
│  → API Key 配置 / 功能开关 / 清除缓存                     │
│  → 通过 chrome.storage.local 持久化                       │
│  → 通过 chrome.tabs.sendMessage 通知 content script       │
└─────────────────────────────────────────────────────────┘
```

## 文件结构

```
yt_translate/
├── manifest.json              # MV3 扩展清单
├── background/
│   └── service-worker.js      # 后台服务: DeepSeek API 代理
├── lib/
│   ├── utils.js               # 工具: debounce, hash(djb2), waitForElement
│   ├── cache.js               # LRU 缓存实现 (Map-based)
│   └── translator.js          # 翻译客户端: 批量翻译 + 缓存查询
├── content/
│   ├── main.js                # 内容脚本入口: 初始化/SPA导航/生命周期
│   ├── style.css              # 页面翻译注入样式 (原文+译文双语显示)
│   ├── page/
│   │   ├── selectors.js       # YouTube 页面元素 CSS 选择器
│   │   ├── injector.js        # 翻译文本注入到 DOM 元素
│   │   └── observer.js        # MutationObserver + scroll 监听
│   └── subtitle/
│       ├── extractor.js       # 字幕提取: ytInitialPlayerResponse → XML → 解析
│       ├── overlay.js         # 字幕覆盖层: rAF 同步 + 二分查找
│       └── overlay.css        # 字幕覆盖层样式
├── popup/
│   ├── popup.html             # 弹窗 UI (API Key + 功能开关)
│   ├── popup.js               # 弹窗逻辑 (设置持久化/消息通知)
│   └── popup.css              # 深色主题弹窗样式
├── icons/
│   ├── icon.svg               # SVG 源图标
│   └── icon{16,48,128,300}.png # 各尺寸 PNG 图标
├── PRIVACY.md                 # 隐私政策 (Markdown)
├── privacy.html               # 隐私政策 (HTML, Edge 商店要求)
└── README.md                  # 项目说明
```

## 核心技术细节

### 字幕翻译流程
1. **提取**: 注入 script 标签读取 `window.ytInitialPlayerResponse`
2. **选轨**: 优先英文非自动生成 → 英文自动生成 → 第一条可用轨道
3. **获取**: `fetch(baseUrl)` 获取 XML 格式的 timed text (TTML)
4. **解析**: `DOMParser` 解析 XML, 提取 `{start, dur, text}` 数组
5. **翻译**: 每 30 条一批, 用 `|||` 分隔符拼接, 通过 background worker 调用 API
6. **缓存**: djb2 哈希原文 → LRU 缓存 (容量 2000)
7. **渲染**: `requestAnimationFrame` 循环 + 二分查找当前字幕 → 显示双语

### 页面翻译流程
1. `MutationObserver` 监听整个 `<body>` 的 DOM 变化
2. `scroll` 事件 (防抖 500ms) 补充懒加载内容的扫描
3. CSS 选择器匹配目标元素 (标题/评论/描述/弹幕/章节)
4. `WeakSet` 去重, `data-yt-translated` 标记防止重复处理
5. 翻译后替换 `innerHTML`: 原文 `<span>` + `<br>` + 译文 `<span>`
6. 译文用蓝色 (`#4da6ff`) 区分, 原文用半透明白色

### API 调用细节
- **模型**: `deepseek-v4-flash`
- **温度**: 0.3 (低随机性, 保证翻译一致性)
- **Max tokens**: 4096
- **System Prompt**: 要求简洁自然中文, 保留原意和风格, `|||` 分隔批量, 不合并/拆分行
- **重试**: 指数退避 1s/2s/4s, 最多 3 次

### SPA 导航处理
YouTube 是单页应用, 页面切换不刷新:
- 监听 `yt-navigate-finish` 事件
- 切换时先 `teardown()` (销毁 overlay/observer), 再 `initialize()`

### 全局命名空间
所有模块挂载到 `window.YTTranslate` 命名空间下:
```
YTTranslate.utils      → 工具函数
YTTranslate.LRUCache   → LRU 缓存类
YTTranslate.Translator → 翻译客户端类
YTTranslate.selectors  → CSS 选择器
YTTranslate.injector   → DOM 注入器
YTTranslate.observer   → DOM 观察器
YTTranslate.extractor  → 字幕提取器
YTTranslate.overlay    → 字幕覆盖层
```

## 消息通信

| 方向 | 消息类型 | 用途 |
|------|---------|------|
| Content → Background | `TRANSLATE` | 发送文本给 DeepSeek 翻译 |
| Popup → Background | `CHECK_API_KEY` | 检查 API Key 是否已配置 |
| Popup → Content | `SETTINGS_UPDATED` | 通知 content script 重新加载设置 |
| Popup → Content | `REINIT` | 强制 content script 重新初始化 |
| Popup → Content | `CLEAR_CACHE` | 清除翻译缓存 |
| Content → Popup | `GET_STATUS` | 查询当前初始化状态 |

---

## 用户偏好 (必须遵守)

1. **全程中文沟通**: 所有思考和回答都用中文, 包括内部思考过程
2. **代码解释**: 每次提交的代码变更都要解释其作用和涉及的技术原理, 帮助用户学习

---

## 提交历史与技术要点

### cef91a9 — Initial commit: YouTube immersive translate extension
**初始提交**, 包含完整的扩展代码 (19 个文件, 1626 行)。项目最初就有硬编码的 API Key。

### e9bfc83 — Fix Unicode encoding in README and manifest
**修复编码问题**: README.md 和 manifest.json 中的中文描述出现乱码, 更正为正确的 UTF-8 编码。

### 1d19e74 — Remove hardcoded API key, add user-configurable key in popup
**安全性重大改进**: 
- 移除 `service-worker.js` 中硬编码的 DeepSeek API Key
- 在 popup 弹窗中添加 API Key 输入框 (密码类型, 可切换显示)
- 添加 API Key 格式校验 (必须以 `sk-` 开头)
- 通过 `chrome.storage.local` 持久化存储 API Key
- Background worker 改为从 storage 读取 API Key (带内存缓存)
- 添加 PNG 图标 (16/48/128) 和隐私政策 (PRIVACY.md)
- 弹窗 UI 新增 API Key 状态提示 (未配置/已配置)

**技术要点**: 浏览器扩展中敏感信息 (API Key) 应存储在 `chrome.storage.local`, 不能硬编码在源码中。Background worker 用内存变量缓存 Key 避免频繁读取 storage。

### c478f22 — Add HTML privacy policy page for Edge Store submission
**上架准备**: 添加 `privacy.html` 隐私政策页面, 满足 Edge 扩展商店的审核要求 (需要可访问的 HTML 格式隐私政策页面)。

### 5d6af3a — Add 300x300 store listing icon
**上架准备**: 添加 300×300 像素的商店列表图标, 满足浏览器扩展商店的展示要求。

### bc842bb — Fix: improve initialization timing, add logging, force reinit on API key save
**初始化时序修复 (关键提交)**:
- **问题**: Content script 在 `document_start` 时运行, 此时 DOM 还未就绪, 直接调用 `initialize()` 找不到视频元素
- **修复**: 改用 `setTimeout(initialize, 500)` 给页面 500ms 的初始加载时间
- 视频元素等待: 添加重试循环 (每 500ms 检查, 最多 20 次), 等待 `video.readyState >= 1`
- SPA 导航: `yt-navigate-finish` 后延迟从 300ms 增加到 500ms
- API Key 保存后: popup 通过 `REINIT` 消息通知 content script 重新初始化
- 添加大量 `console.log` 日志用于调试 (后续提交中部分被移除)

**技术要点**: 浏览器扩展 `"run_at": "document_start"` 会在 HTML 解析前执行, 此时 `document.body` 可能为 null。对于需要操作 DOM 的扩展, 必须等待 DOM 就绪。YouTube 是 SPA, 视频元素的出现时间和普通页面不同, 需要轮询等待。`video.readyState` 值: 0=HAVE_NOTHING, 1=HAVE_METADATA, 2=HAVE_CURRENT_DATA...

### 873f3bf — Fix: lazy-initialize LRUCache to avoid load order race condition in content scripts
**加载顺序竞态修复**:
- **问题**: `translator.js` 加载时直接 `new YTTranslate.LRUCache()`, 但如果 `cache.js` (定义 LRUCache) 还未加载, 会导致 `YTTranslate.LRUCache is not a constructor` 错误
- **原因**: manifest.json 中虽然指定了 JS 文件加载顺序 (`lib/cache.js` 在 `lib/translator.js` 之前), 但在某些情况下 (缓存/网络延迟) 可能乱序
- **修复**: 将 `var cache = new YTTranslate.LRUCache()` 改为延迟初始化:
  ```javascript
  var cache = null;
  function getCache() {
    if (!cache) { cache = new YTTranslate.LRUCache(); }
    return cache;
  }
  ```
  所有访问 cache 的地方改为调用 `getCache()`

**技术要点**: 这是**懒初始化 (Lazy Initialization)** 模式。在浏览器扩展中, 多个 content script 文件虽然按声明顺序加载, 但执行时机可能因浏览器优化而乱序。懒初始化将对象创建推迟到第一次使用时, 此时所有依赖的脚本必定已执行完毕。

### 0c54da3 — Fix: prevent duplicate translation injection loop and improve translation text color visibility
**防止重复注入循环 + 译文颜色改进**:
- **问题**: 注入的翻译结果 (`<span class="yt-tl-original">` 和 `<span class="yt-tl-translated">`) 会被 MutationObserver 再次检测到, 导致无限循环翻译
- **修复**: 在 `injector.inject()` 开头检查元素是否已有 `yt-tl-original` / `yt-tl-translated` class, 如果有则直接标记为已翻译并跳过
- 同时给注入的 span 元素添加 `data-yt-translated="true"` 标记, 双重防护
- 译文颜色从 `rgba(255,255,255,0.95)` 改为 `#4da6ff` (蓝色), 使译文和原文有明显视觉区分
- 译文添加 `font-weight: 500`, 增强可读性

**技术要点**: 这是经典的**观察者-修改者循环问题** (Observer-Modifier Loop)。MutationObserver 监听 DOM 变化, 而翻译注入本身又修改 DOM, 触发新的观察回调。解决方案是给注入的元素添加标记 (class/data attribute), 在观察回调中检查并跳过。

### 59a7af0 — Fix: broaden isWatchPage detection, update YouTube selectors for comments and live chat
**最新修复 (HEAD)**:
- **`isWatchPage()` 改进**: 原来仅检查 `location.pathname` 是否以 `/watch` 开头, 新增 `!!getVideoId()` 作为后备判断 (YouTube 有些 URL 变体不严格以 /watch 开头但包含 v 参数)
- **评论选择器更新**: YouTube 更新了 DOM 结构:
  - 旧: `#content-text.ytd-comment-renderer` (ID + class 组合)
  - 新: `ytd-comment-renderer #content-text` (标签名后代 + ID)
  - 新增: `ytd-comment-thread-renderer #content-text` (评论线程)
- **直播弹幕选择器更新**: 同样调整选择器写法
  - 旧: `#message.yt-live-chat-text-message-renderer`
  - 新: `yt-live-chat-text-message-renderer #message`
- **清理日志**: 移除大量调试用的 `console.log`, 只保留关键日志 (字幕数量、翻译批次、错误)

**技术要点**: YouTube 频繁更新其 DOM 结构和 CSS class 命名。使用 Shadow DOM 的组件 (如 `ytd-*` 标签) 其内部选择器策略需要持续适配。选择器写法从 `#id.class-name` 改为 `tag-name #id` 是因为 YouTube 改用了 Shadow DOM 的 `::part` 或改变了 class 的挂载方式, 后者更具鲁棒性。
