# 京东自动评价（大模型版 · 全自动闭环）

一个基于 [Tampermonkey](https://www.tampermonkey.net/) 的油猴脚本：在京东评价页面（新版「评价中心」与旧版「我的评价」均支持），用大模型为每个待评商品生成拟真评价、自动打五星、自动抓取该商品的买家晒单图随机配图上传，再自动发表，并在「评价列表 → 评价页 → 成功页 → 返回列表」之间单标签页循环，直到待评列表清空。整个流程由**一个「开始 / 暂停」按钮**控制。

**📦 一键安装：[GreasyFork](https://greasyfork.org/zh-CN/scripts/580937)**（已安装 Tampermonkey 后点击「安装此脚本」即可）

> ⚠️ 本工具会自动生成并提交商品评价，可能违反京东用户协议，且自动好评涉及评价真实性问题。**仅供个人学习与自动化技术研究**，请自行评估合规与账号风险，后果自负。详见文末「免责声明」。

---

## 目录

- [功能特性](#功能特性)
- [闭环流程](#闭环流程)
- [安装](#安装)
- [配置说明](#配置说明)
- [使用流程](#使用流程)
- [工作原理](#工作原理)
- [页面 / DOM 依赖](#页面--dom-依赖)
- [已知限制与风险](#已知限制与风险)
- [常见问题](#常见问题)
- [版本历史](#版本历史)
- [来源与许可](#来源与许可)
- [免责声明](#免责声明)

---

## 功能特性

- **大模型生成评价**：按商品全称推断品类，生成 60–100 字、针对该品类特性的拟真评价（兼容 OpenAI 格式接口：DeepSeek / OpenAI / 智谱 GLM 等）。生成失败不兜底，直接暂停并在浮窗显示报错原因。
- **自动五星**：统一打五星好评（新版评价页默认已是五星）。
- **自动配图**（v8 新增）：按 skuId 调用京东晒单图接口，随机取 N 张买家秀照片，下载后注入上传组件，绕过系统文件选择框。
- **全自动闭环**：评价 → 配图 → 发表 → 返回列表 → 进入下一单，循环至列表清空；全程在同一个标签页内完成，不累积标签页。
- **新旧版页面通用**（v9）：新版评价中心 `comment.m.jd.com/pc-static` 与旧版 `club.jd.com/myJdcomments` 均可运行；新版列表中的**京东外卖**订单也会自动评价（商家 5 星、骑手满意）。
- **开始 / 暂停**：单按钮两态，所有页面通用。暂停在「步骤边界」生效（每条评价之间、每次跳转点击之前），点「开始」从断点继续。循环状态跨页面跳转持久化（`localStorage`）。
- **安全降级**：配图任意环节异常都跳过配图直接发表，不阻断闭环；上传完成检测带超时兜底，绝不卡死。

---

## 闭环流程

```
┌─────────────────────────────────────────────────────────────┐
│  评价列表页                                                   │
│    新版 comment.m.jd.com/pc-static/center（按商品列出）        │
│    旧版 club.jd.com/myJdcomments/myJdcomment.action（按订单）  │
│  点「开始」/ 循环中自动 → 点第一条「去评价」（旧版「评价」）     │
└───────────────┬─────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│  评价页                                                       │
│    新版 /pc-static/publish?orderId=&skuId=（单商品）           │
│    新版外卖 /pc-static/deliveryrate?orderId=（商家 + 骑手）     │
│    旧版 orderVoucher.action?ruleid=xxx（整单多商品）           │
│   1. 逐商品调大模型生成评价并回填（失败即暂停）                 │
│   2. 统一打五星                                               │
│   3. 自动配图：抓晒单图 → 随机取 N 张 → 注入上传              │
│   4. 等上传完成 → 点「发布」（旧版「发表」）                   │
└───────────────┬─────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│  成功页                                                       │
│    新版：评价页内渲染的完成态（URL 不变）                       │
│    旧版 saveCommentSuccess.action                              │
│  自动点击「返回待评价列表」                                     │
└───────────────┬─────────────────────────────────────────────┘
                ▼
          回到列表页，循环；列表为空 → 自动停止
```

---

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展。
2. 安装脚本（任选其一）：
   - **方式 A（推荐）**：打开 [GreasyFork 脚本页](https://greasyfork.org/zh-CN/scripts/580937) → 点「**安装此脚本**」，后续 GreasyFork 自动推送更新。
     > GreasyFork 已接入本仓库 `main` 分支的自动同步：每次 push 经 GitHub Webhook 触发，GreasyFork 自动拉取最新脚本。
   - **方式 B**：打开 Tampermonkey → **管理面板 → 实用工具 → 导入**，选择本仓库的 `jd-auto-review.user.js`；或新建脚本把全文粘贴保存。
3. 安装后**务必先填配置**（至少 `API_KEY`，见[配置说明](#配置说明)），再确认脚本已启用。

> 脚本通过 `@require` 引入 jQuery；`@grant GM_xmlhttpRequest` 用于请求大模型接口与跨域抓图，`@connect` 已声明所需域名；`@grant unsafeWindow` 用于在自动点击期间接管页面的 `window.open`（保证单标签页跳转）。首次跨域请求时 Tampermonkey 可能弹窗询问是否允许访问 `*.360buyimg.com` 或你的大模型接口域名，选择「总是允许」。

---

## 配置说明

打开脚本顶部「🛠️ 用户配置区域」，按需修改：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `API_KEY` | `''`（空） | **必填**。大模型 API 密钥。出于安全，仓库内不保存真实密钥，请自行填入。 |
| `API_URL` | `http://192.168.2.20:6321/v1/chat/completions` | 兼容 OpenAI 格式的 Chat Completions 接口地址。可换 DeepSeek / OpenAI / GLM 官方地址。 |
| `MODEL_NAME` | `gpt-5.5` | 模型名，按你的接口提供商填（如 `deepseek-chat` / `gpt-4o` / `glm-4`）。 |
| `AUTO_CLICK_DELAY` | `3000` | 各环节自动点击前的等待（毫秒）。 |
| `ENABLE_IMAGE` | `true` | 是否自动配图。设 `false` 则跳过配图直接发表。 |
| `IMG_PER_PRODUCT` | `2` | 每个商品上传几张晒单图。 |
| `UPLOAD_WAIT_TIMEOUT` | `12000` | 配图上传完成的最长等待（毫秒），检测不到完成信号时到点即发表。 |

> **安全提示**：不要把填好真实 `API_KEY` 的版本提交进 git。本地想保留可填的版本，建议命名为 `*.local.user.js`（已在 `.gitignore` 忽略）。

---

## 使用流程

### 准备（仅首次）

1. 安装 Tampermonkey 与本脚本（见[安装](#安装)）。
2. 编辑脚本顶部「🛠️ 用户配置区域」，**至少填好 `API_KEY`**，确认 `API_URL` / `MODEL_NAME` 指向你可用的大模型接口（见[配置说明](#配置说明)）。
3. 在浏览器**登录京东账号**。

### 运行

1. 打开 **评价中心**（新版，推荐）：`https://comment.m.jd.com/pc-static/center`；旧版 **我的评价** `https://club.jd.com/myJdcomments/myJdcomment.action` 仍兼容。
2. 页面右侧出现「🤖 AI 自动评价助手」浮窗，点击 **开始**。
3. 脚本随即自动执行闭环，全程无需干预：

   | 阶段 | 页面 | 脚本动作 |
   |------|------|----------|
   | ① 进单 | 评价列表页 | 点击第一条待评商品的「去评价」（旧版为订单的「评价」），在本标签页进入评价页 |
   | ② 写评价 | 评价页 | 逐个商品调大模型生成评价并回填（失败即暂停并显示原因，点「开始」重试） |
   | ③ 打星 | 评价页 | 统一打五星 |
   | ④ 配图 | 评价页 | 按 sku 抓该商品买家晒单图，随机取 N 张上传（`ENABLE_IMAGE=false` 可关闭） |
   | ⑤ 发表 | 评价页 | 等图片上传完成后点「发布」（旧版「发表」） |
   | ⑥ 返回 | 成功页 | 点「返回待评价列表」回到列表页 |
   | ↻ 循环 | — | 回到 ①，处理下一单 |

4. **待评列表清空后自动停止**，浮窗提示「循环结束」，按钮复位为「开始」。

### 暂停 / 继续

- 任意时刻点 **暂停**：脚本在**当前步骤完成后**停下（不会停在跨页跳转的半路），按钮变回「开始」。
- 再点 **开始**：从断点继续后续步骤与循环。
- 循环进度跨页面跳转保持（`localStorage`），即使页面跳转/刷新也不会丢失「正在循环」状态。

> 💡 **强烈建议首次运行**：先盯着**一单**走完整流程，确认「评价回填正常、配图缩略图出现、发表成功跳转」都 OK，再放开让它循环跑完全部待评。多商品订单的配图归属也借这一单确认。

---

## 工作原理

### 1. 评价生成
逐个可见商品的输入框（旧版 `.f-textarea textarea` / 新版 `textarea.rate-comment-content-textarea`）取商品名（旧版 `.p-name` / 新版 `.rate-comment-goods-title`），调用 `API_URL` 生成评价，经原生 value setter 回填并触发 `input`/`change` 事件让页面识别。生成失败（接口报错、超时、内容过短）不兜底，直接暂停并在浮窗显示原因，点「开始」从当前商品重试。

### 2. 自动配图（关键设计）
- **图源**：不抓商品详情页（详情页对自动化访问有风控、且规格/晒单区多为 JS 异步渲染）。改用 club.jd.com 的晒单图接口（旧版评价页同域；新版 `comment.m.jd.com` 下跨域，但接口放行 CORS，可直接 `fetch`）：
  ```
  https://club.jd.com/discussion/getProductPageImageCommentList.action?productId=<sku>&isShadowSku=0&page=1&pageSize=10
  ```
  返回 JSON，`imgComments.imgList[].imageUrl` 即买家晒单图（`*.360buyimg.com/shaidan/...jpg`）。无风控、结构化。
- **skuId 来源**：旧版取评价页 `.p-name a` 的 href（`//item.jd.com/<sku>.html`）；新版取评价页 URL 参数 `skuId`。
- **重编码为 JPEG**：360buyimg CDN 对 `.jpg` 晒单图常按内容协商返回 webp 字节，京东上传按文件头校验会拒收。脚本经 canvas 重编码为真 JPEG（白底、最长边限 1920px）后再上传。
- **上传**：旧版 `.btn-upload` 底层是 **plupload（html5 runtime）** 的原生 `<input type="file" multiple>`，新版是原生 `input.uploadAddInput`。脚本用 `GM_xmlhttpRequest` 把图片抓成 `Blob` → 重编码为 JPEG `File` → 经 `DataTransfer` 写入 `input.files` → 派发 `change` 事件触发上传，**绕过系统文件选择框**。
- **sku ↔ input 映射**：单商品单直接用唯一 input；多商品单按 `.btn-upload`（`#image-upload-<sku>`）与各 input 的几何重叠定位。

### 3. 新版评价中心（comment.m.jd.com）适配要点
- **列表按商品粒度**：每个待评商品一个「去评价」（`.wait-rate-card .rate-btn`），评价页 `/pc-static/publish?orderId=&skuId=` 每页只有一个商品，sku 直接取 URL 的 `skuId`。
- **「去评价」原本 `window.open` 新标签**：脚本自动点击没有用户手势会被弹窗拦截，且每单多开一页。复用 v8.6 的单标签导航：自动点击期间临时接管页面的 `window.open` 改为本页跳转。注意必须改 `unsafeWindow.open`（需 `@grant unsafeWindow`），有 `@grant` 时脚本里的 `window` 是沙箱对象，改它拦不到页面自己的调用。
- **React 受控输入框**：jQuery `.val()` 赋值会被 React 值追踪吞掉，回填改用 `HTMLTextAreaElement` 原生 value setter 再派发 `input`。
- **星级默认全五星**，无需点击。
- **上传**：原生 `input.uploadAddInput`，注入后立即传到 `pic.jd.com`；上传中每张图带「上传中...」遮罩 `.filePreviewStateMask`，遮罩消失即完成。
- **发布成功不跳页**：同 URL 内渲染完成态，脚本轮询 `.rate-finish-return`（「返回待评价列表」）/ 外卖页 `[class*="finishReturn"]`（「返回评价中心」）后切到返回步骤。
- **京东外卖**（列表里的外卖订单点「去评价」进入 `/pc-static/deliveryrate?orderId=`）：
  - 商家「满意值」星级**默认为空**，须点 `[aria-label="满意值：5星"]`；打星后口味 / 包装自动满星，并展开菜品列表与输入框。
  - 骑手须选 `[aria-label="满意"]`，否则「发布」按钮置灰（显示「请评价骑手」）。
  - 输入框是 contenteditable 富文本（不是 textarea），用 `document.execCommand('insertText')` 模拟真实输入，React 才能拿到内容。
  - 评价按「店名 的外卖：菜品1、菜品2」交给大模型生成。
  - 外卖没有商品 sku、取不到买家晒单图，**不自动配图**。
  - 页面类名是带哈希的 CSS Modules，故星级 / 骑手按 `aria-label` 定位，发布按钮 / 返回按钮按类名子串（`submitBtn` / `finishReturn`）定位。
  - 已核对提交编码：选项 `A1` 为最高分（5 星 / 满意），`A5` 为最低。

### 4. 开始 / 暂停状态机
- `running`（`localStorage` 持久化）：循环是否激活，决定按钮显示「暂停」还是「开始」，并驱动各页面加载后自动续跑。
- 暂停永远停在「步骤边界」（导航点击之前 / 每条评价之间），不会停在跨页跳转的中间态，故断点续作只需内存变量（`resumeAction`），无需持久化。
- `localStorage` 按域名隔离：新版（`comment.m.jd.com`）与旧版（`club.jd.com`）的循环状态互不影响。

### 5. 单标签页导航（v8.6）
自动点击前，把目标元素祖先链上 `<a>`/`<form>` 的 `target` 改为 `_self`，并在点击期间临时把页面的 `window.open` 改为本页跳转（点击结束即还原），使整条闭环在同一个标签页内完成。

---

## 页面 / DOM 依赖

脚本依赖以下京东页面结构（**京东改版时这里最易失效，排查从此表入手**）：

| 页面 | 选择器 / 接口 | 用途 |
|------|---------------|------|
| 列表页 `myJdcomment.action` | `.operate` 下文案为「评价」的 `a.btn-def` | 进入下一单 |
| 评价页 `orderVoucher.action` | `.f-textarea textarea` | 评价输入框 |
| 评价页 | `.p-name` / `.p-name a[href*="item.jd.com/<sku>.html"]` | 商品名 / 取 skuId |
| 评价页 | `.star5` | 五星 |
| 评价页 | `.btn-upload`（`#image-upload-<sku>`）、`input[type=file]`（plupload html5） | 配图上传 |
| 评价页 | 文案「发表」的 `a.btn-submit` | 发表 |
| 成功页 `saveCommentSuccess.action` | 文案含「返回待评价列表」的元素 | 返回列表 |
| 新版列表页 `comment.m.jd.com/pc-static/center` | `.wait-rate-card .rate-btn`（「去评价」，原为 `window.open`） | 进入下一单 |
| 新版评价页 `/pc-static/publish?orderId=&skuId=` | `textarea.rate-comment-content-textarea`（React 受控） | 评价输入框 |
| 新版评价页 | `.rate-comment-goods-title` / URL 参数 `skuId` | 商品名 / 取 skuId |
| 新版评价页 | `input.uploadAddInput`、`.filePreviewBox`、`.filePreviewStateMask`（上传中遮罩） | 配图上传 / 完成检测 |
| 新版评价页 | `.rate-publish-submit-button`（「发布」） | 发表 |
| 新版评价页（成功态） | `.rate-finish-return`（「返回待评价列表」） | 返回列表 |
| 新版外卖评价页 `/pc-static/deliveryrate?orderId=` | `[aria-label="满意值：5星"]`、`[aria-label="满意"]`（骑手） | 商家 5 星 / 骑手满意 |
| 新版外卖评价页 | `[class*="shopName"]`、`[class*="skuName"]`、`[contenteditable="true"]` | 店名 / 菜品名 / 评价输入框 |
| 新版外卖评价页 | `[class*="submitBtn"]`（「发布」）、成功态 `[class*="finishReturn"]`（「返回评价中心」） | 发表 / 返回列表 |
| 配图接口 | `getProductPageImageCommentList.action?productId=<sku>` | 取晒单图 |

---

## 已知限制与风险

- **详情页风控**：直接自动访问 `item.jd.com` 会被风控拦截（`pc-frequent-pro` 403）。本脚本因此改用同域晒单接口取图，**不访问详情页**。
- **多商品订单的 sku↔input 映射**：单商品单已验证；多商品单按几何重叠匹配，尚未充分验证，首次遇到请留意是否配错图。
- **上传完成检测**：旧版靠已上传缩略图（`img[src*="imageUpload"]`）计数，新版靠图片数减去「上传中...」遮罩数。若选择器未匹配上，会等满 `UPLOAD_WAIT_TIMEOUT` 再发表（图大概率已传完），不会误发空图但会偏慢。
- **新版列表异步渲染**：新版列表页数据加载后才渲染，网络很慢时若 `AUTO_CLICK_DELAY` 倒计时结束仍未出现「去评价」，会误判为列表已空而停止。不会误操作，再点「开始」即可；常遇到可调大 `AUTO_CLICK_DELAY`。
- **试用装 / 赠品 / 下架品**：可能无晒单图，脚本会跳过配图直接发表。
- **京东外卖不配图**：外卖页没有商品 sku，取不到买家晒单图，只发文字评价（拿不到「1 图」的额外京豆）。
- **接口 / DOM 变更**：京东随时可能改版，相关选择器与接口失效时需按上表更新。
- **合规与账号风险**：见免责声明。
- **标签页**：v8.6 起整条闭环在单个标签页内完成（跳转前中和 `target="_blank"`、接管 `window.open`），挂机批量评价不再累积标签页。但历史运行已堆出的旧标签页需手动关闭一次——浏览器禁止脚本关闭非脚本打开的标签页，无法代为回收。

---

## 常见问题

- **浮窗只有一个「手动生成」按钮，提示「未检测到可见的评价输入框」**：装的是上游原脚本（GreasyFork 570776），不是本脚本。它只在单个评价页运行、不支持列表循环。请在 Tampermonkey 中停用它，从 [GreasyFork 580937](https://greasyfork.org/zh-CN/scripts/580937) 安装本脚本（浮窗为「开始 / 暂停」单按钮）。见 [#8](https://github.com/charmingYouYou/JDAIAutoComment/issues/8)。
- **点「开始」后提示未配置 `API_KEY`**：在脚本顶部「🛠️ 用户配置区域」填入密钥并保存。
- **评价生成失败后停住了**：v8.4 起失败不再兜底，浮窗会显示原因（接口报错信息、超时 / 网络错误、返回内容过短等），排查后点「开始」从当前商品重试。
- **「去评价」新开了标签页**：确认脚本版本 ≥ 9.0（需要 `@grant unsafeWindow`），旧版本在新版评价中心上接管不到页面的 `window.open`。

---

## 版本历史

| 版本 | 主要变化 |
|------|----------|
| v9.0 | 适配新版评价中心 `comment.m.jd.com/pc-static`（按商品逐个评价、React 受控输入框、发布成功态检测），支持京东外卖订单评价，旧版页面继续兼容；`window.open` 接管改为作用于页面（`unsafeWindow`） |
| v8.6 | 单标签页导航：跳转前中和 `target="_blank"` 并接管 `window.open`，挂机不再累积标签页 |
| v8.5 | 元信息补 `@icon` / `@noframes` |
| v8.4 | AI 生成评价失败不再兜底，改为暂停并显示报错原因 |
| v8.2 | 配图上传前用 canvas 重编码为真 JPEG，修复格式被拒 |
| v8.1 | `@connect *` 放行大模型接口域名，修复请求被白名单拒绝 |
| v8 | 新增自动配图：同域晒单接口取图 + plupload 文件注入上传，串接进发表前 |
| v7 | 「开始 / 暂停」合并为单按钮两态，统一所有页面；移除独立「恢复」「手动生成」 |
| v6 | 引入开始 / 暂停 / 恢复三态控制 |
| v5 | 多页面闭环：评价页发表 → 成功页返回 → 列表页进入下一单 |
| v4 | 原始版本：单页评价生成（基于 greasyfork 上 oscar 的脚本） |

---

## 来源与许可

- 基础评价生成逻辑改编自 [GreasyFork 上 oscar 的「京东自动评价（大模型版）」](https://greasyfork.org/scripts/570776)。
- 本仓库为在其上扩展的**个人修改版**（多页面闭环、开始/暂停、自动配图、新版评价中心适配）。原作者保留其权利，本仓库仅供个人使用与学习，不主张额外授权。

## 免责声明

本脚本用于自动化技术学习与个人效率研究。使用本脚本自动生成、提交商品评价（尤其是统一好评与非本人拍摄的配图），**可能违反京东平台用户协议、涉及评价真实性与消费者知情权问题，并可能导致账号被风控、限制或封禁**。是否使用、如何使用由使用者自行决定，作者与贡献者不对由此产生的任何账号、法律或其他后果负责。请遵守平台规则与当地法律法规。
