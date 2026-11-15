# StarTab

一个可部署在 **Cloudflare Pages** 的组件化新标签页：图标导航、每日壁纸、天气、热搜、待办、倒计时，数据存在 Workers KV，多设备同步，带可视化后台。

纯原生 HTML/CSS/JS，无构建步骤、无前端框架、无第三方 CDN 依赖。

## 功能

**导航**
- 分类分组 + 图标网格，支持拖拽排序（桌面端）
- 自动抓取网站图标，失败时降级为彩色首字母块
- 自定义图标（emoji / 图片地址）、自定义颜色
- 在线增删改：网站、分类（含隐藏分类，游客不可见）

**小组件**
- 时钟 / 日期 / 按时段问候
- 天气：Open-Meteo 免费接口，无需 API Key，支持城市搜索、摄氏度/华氏度
- 热搜：微博 / 百度 / B站 三源切换，后端代理 + 10 分钟缓存
- 待办：勾选、删除，仅登录后可见
- 倒计时：剩余天数自动计算

**外观**
- 亮色 / 深色 / 跟随系统，可调主题色、毛玻璃强度、图标大小、每行数量
- 壁纸：Bing 每日、图片 URL、纯色、渐变、本地图片上传（压缩后仅存本机）
- 响应式布局，移动端单列

**搜索**
- 多引擎切换：Bing / Google / 百度 / DuckDuckGo / GitHub / B站 / 知乎
- 输入域名直接打开，输入关键词则搜索
- 快捷键 `/` 聚焦搜索框

**数据**
- 配置存 Workers KV，换设备登录即同步
- 本地缓存秒开，离线可用（显示上次数据）
- 一键导出 / 导入 JSON、恢复默认
- PWA，可安装到桌面

## 部署

仓库同时支持 **Workers Builds** 与 **Pages**，`wrangler.toml` 默认是 Workers 配置。

### 方式 A：Cloudflare Workers（推荐）

`worker/index.js` 是入口：把 `/api/*` 交给 `functions/api/*` 里已有的处理器，其余请求交给 `public/` 静态资源。因此同一套接口代码两种部署方式都能跑。

1. **Workers & Pages → Create → Workers → Connect to Git**，选择本仓库
2. 构建命令：**留空**
3. 部署命令：`npx wrangler deploy`
4. 预览命令：`npx wrangler versions upload`
5. 创建 KV：**Workers & Pages → KV → Create a namespace**
6. 项目 **Settings → Bindings → Add → KV Namespace**：
   - Variable name：`nav`（代码里写死 `env.nav`，不要改）
   - 选择刚创建的命名空间
7. **Settings → Variables and Secrets** 添加：
   - `TOKEN`：管理后台密码，`openssl rand -base64 24` 生成
   - `SESSION_SECRET`：另一个随机串（不填则用 `TOKEN` 派生）
8. 重新部署

访问 `https://<项目名>.<子域>.workers.dev`，点右上角 ⚙ → 登录管理。

### 方式 B：Cloudflare Pages

1. 先改 `wrangler.toml`：删掉 `main` 与 `[assets]` 两段，改成一行 `pages_build_output_dir = "public"`
2. **Workers & Pages → Create → Pages → Connect to Git**，选择本仓库
3. 构建命令留空，构建输出目录 `public`，**部署命令留空**
4. KV 绑定变量名 `nav`，环境变量同上
5. 重新部署

> 常见错误：在 Pages 项目里把部署命令填成 `npx wrangler deploy`，会报 `Missing entry-point to Worker script or to assets directory`。Pages 不需要部署命令，产物目录已经由 `public` 指定。

### 设为新标签页（可选）

部署出来的是一个网页，**不能直接替换 `chrome://newtab`**。三种方式：

1. 浏览器设置里把「启动时打开的页面」设为你的站点域名
2. 安装任意 New Tab Redirect 类扩展，把新标签页指向该域名
3. Chrome/Edge 安装 PWA 后从桌面启动

## 本地开发

需要 Node 18+：

```bash
npm i -g wrangler
wrangler pages dev public --kv=nav --binding TOKEN=dev123 --binding SESSION_SECRET=devsecret
```

打开 `http://localhost:8788`。本地 KV 是模拟的，重启后数据会重置。

> 直接用 `python -m http.server` 只能预览静态页面，`/api/*` 会 404，此时前端走本地缓存与兜底数据。

## 目录结构

```
public/
  index.html              页面结构
  assets/css/style.css    样式（CSS 变量驱动的主题系统）
  assets/js/store.js      数据层：KV 读写、缓存、登录态
  assets/js/widgets.js    小组件：时钟/天气/热搜/待办/倒计时
  assets/js/app.js        渲染、搜索、拖拽、设置、后台
  sw.js                   Service Worker（离线缓存）
  manifest.json           PWA
functions/
  _lib.js                 哈希、HMAC 会话、常量时间比较
  _seed.js                默认配置
  api/config.js           GET / PUT / DELETE 配置
  api/auth.js             登录、会话校验、失败限流
  api/weather.js          Open-Meteo 代理 + 缓存
  api/hot.js              微博/百度/B站 热搜代理 + 缓存
worker/
  index.js                Workers 入口：/api/* 转给 functions，其余交给静态资源
wrangler.toml             Workers 配置（main + [assets]）
```

## 安全设计

- `TOKEN` 未配置时直接返回 500，拒绝所有写操作（不会用空字符串兜底）
- 密码用 SHA-256 + 常量时间比较，登录成功签发 HMAC 签名的 7 天会话，后续请求只带 Bearer token
- 登录失败 5 次锁定 5 分钟（按 IP）
- 写接口校验 `Content-Length` 与序列化后体积，上限 512KB
- 服务端白名单清洗字段，URL 只允许 `http/https`，分类数量与字符串长度均有限制
- 游客请求在服务端过滤隐藏分类/网站，待办与倒计时不下发
- 前端全部使用 `textContent` / DOM API 渲染，不拼接用户数据到 HTML

## 已知限制

- 拖拽排序依赖 HTML5 Drag & Drop，移动端不支持；移动端可通过设置面板编辑/删除
- 本地壁纸存在 `localStorage`，不上传 KV，因此不会跨设备同步
- 热搜源为公开接口，可能被上游风控导致偶发为空，刷新或稍后重试即可
- 待办与倒计时属于个人数据，游客不可见

## License

MIT
