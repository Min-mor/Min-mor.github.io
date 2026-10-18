# R2 媒体 Worker

为内容创建器提供图片**上传**与**列表**能力的 Cloudflare Worker。

部署为与旧列表 Worker 同名的 `r2img`，因此 `r2img.example.com` 直接获得上传能力；
返回契约保持不变（`name/url/key/size/uploaded` 并按上传时间倒序），
覆盖部署不影响现有相册/日记。

> **2026-xx 安全修复（渗透报告 #64，LOW）**：
> 旧版 `GET /?dir=` 列表分支**没有任何鉴权**，任何人不带请求头就能枚举目录、
> 拿到整个桶的对象清单（报告实测泄露 579 个对象、其中 431 张个人相册）。
> 现在 **列表与上传同级要求 `X-Upload-Token`**，`Authorization`/来源不符一律 401/403。
> 浏览器不再直连本 Worker，统一走同源 Pages Function 中转：
> `GET /api/r2-list`（列表）、`POST /api/r2-upload`（上传）。
> 单对象读取不受影响 —— 图片一直由 R2 公开自定义域名 `img.example.com` 直接提供，
> 不经过本 Worker，所以文章/相册配图继续照常显示。

## 一次性部署（约 2 分钟）

前置：已安装 Node 18+ 和本仓库依赖（`pnpm install`）。在**仓库根目录**执行。

```bash
# 1. 登录 Cloudflare（浏览器授权，只需一次）
pnpm worker:login

# 2. 设置上传令牌（secret，不进仓库）——输入一个足够随机的字符串
#    注意：#64 之后这个令牌不只保护上传，也保护列表，等于"管理密钥"
pnpm worker:secret

# 3. 部署
pnpm worker:deploy
```

Pages Function 一侧还要这两个变量（`wrangler pages secret put`）：

| 变量 | 说明 |
| --- | --- |
| `R2_UPLOAD_TOKEN` | 与 Worker 的 `UPLOAD_TOKEN` 同值 |
| `R2_WORKER_URL` | 可选，默认 `https://r2img.example.com` |

> **Windows 坑 1**：不要用 `npx wrangler`。npx 的临时安装常漏装
> `@cloudflare/workerd-windows-64` 导致启动即崩。本仓库已把 wrangler 装为
> devDependency，用 `pnpm worker:*` 或 `pnpm exec wrangler` 即可。
>
> **Windows 坑 2（代理）**：若系统设了 `HTTPS_PROXY`/`ALL_PROXY`，
> `wrangler login` 换令牌的请求走代理会失败。解决办法是给当前命令窗口设
> `NO_PROXY` 例外（代理变量本身不用删）：
> - cmd：`set "NO_PROXY=dash.cloudflare.com,api.cloudflare.com,localhost,127.0.0.1" & pnpm worker:login`
> - bash：`NO_PROXY="..." pnpm worker:login`

## 在内容创建器里使用

部署完成后，在内容创建器的 R2 区域：

1. 先登录 GitHub（上传/列表都用这个登录态鉴权）
2. 目录名跟随标题自动生成，改完自动读取该目录已有图片
3. 选择图片 → 自动转 WebP（质量 82，可关）→ 上传 → 链接自动填入

**不再需要**填 Worker URL 和上传令牌 —— 令牌只在服务端。本地开发时
Pages Functions 不运行，需要 `wrangler pages dev dist` 才能用到列表/上传。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/?dir=album/xxx` | 列出目录下媒体，返回 `[{name,url,key,size,uploaded}]`（按 uploaded 倒序）。**需 `X-Upload-Token`** |
| `POST` | `/` | multipart：`dir` + `files[]`，需 `X-Upload-Token` 头，返回 `{uploaded:[{url,key,size}],errors:[]}` |
| `OPTIONS` | `/` | CORS 预检 |

## 安全说明

- 列表与上传都必须携带 `X-Upload-Token`，与服务端 `UPLOAD_TOKEN` 常量时间比较。
  服务端未配置 `UPLOAD_TOKEN` 时直接 500，**不会**退化成无鉴权。
- CORS 从 `*` 收成白名单（默认 `https://min-mor.github.io` + `http://localhost:4321`），
  可用 Worker 变量 `ALLOWED_ORIGINS`（逗号分隔）覆盖；白名单外的来源拿不到
  `Access-Control-Allow-Origin`，浏览器会拦下响应。
- 列表响应带 `Cache-Control: no-store`，对象清单不进任何缓存。
- 仅接受图片/视频扩展名，单文件上限 100MB。
- 浏览器永远不持有令牌：只带 GitHub 登录态，令牌在 Pages Function 环境变量里。
