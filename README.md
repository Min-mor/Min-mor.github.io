# 🌸 Min-mor 的小世界 — 带「树洞日记」的个人博客

一个基于 **Astro 5 + Svelte 5 + Tailwind CSS** 的个人博客，Fork 自 [Doulor/Blog](https://github.com/Doulor/Blog)（[Mizuki](https://github.com/LyraVoid/Mizuki) 的二次重构版），并完成了个人化与「树洞日记」改造。

- 🌐 在线地址：**https://min-mor.github.io/**（由 GitHub Pages 自动部署）
- 🕳️ 特色：**树洞日记**（整篇密码锁 + 段落暗号隐藏）+ **匿名树洞**（访客匿名倾诉）+ 相册 / 碎碎念 / 文章 / 归档

---

## ✨ 已完成的改造

### 1. 个人化

- 站点标题：`Min-mor 的小世界`，作者：`Min-mor`
- 头像、社交链接（GitHub / RSS）已替换
- 主题色、首页横幅文案、公告、关于页全部改为自己的内容
- 删除了原作者的全部示例文章 / 日记 / 相册 / 碎碎念，保留精简模板

### 2. 「树洞日记」（`/diary/`）

- 日记页更名为「树洞日记」
- **整篇上锁**：frontmatter 写 `password: "密码"`，正文在构建时被 AES 加密，访客需输入密码才能看；
- **段落暗号**：frontmatter 写 `secret: "暗号"`，正文中用 `<Hide-想隐藏的内容=显示标签>` 包裹，访客输入暗号才展开；
- 示例：`src/content/diary/` 里有一篇公开、一篇上锁、一篇含隐藏段落的示例。

### 3. 「匿名树洞」（`/treehole/`）

- 原「留言板」改造：没有昵称、没有账号，访客只需写下内容，即可匿名倾诉；
- 防刷：同一浏览器 5 分钟一条；服务端只存内容、IP 哈希与 UA，不存真实 IP；
- 后端使用 [Supabase](https://supabase.com/)（免费），**需要自己配置一次**才能使用（见下方）。

### 4. 部署

- `.github/workflows/deploy-pages.yml`：每次 push 到 `main` 自动构建并发布到 GitHub Pages；
- 也保留了 `vercel.json`，可一键导入 Vercel / Netlify。

---

## 🚀 本地开发

要求：Node.js ≥ 20、pnpm ≥ 9。

```bash
pnpm install
pnpm dev        # 本地预览 http://localhost:4321
pnpm build      # 构建到 dist/（含 Pagefind 全文搜索索引）
pnpm preview    # 预览构建产物
```

## 🕳️ 配置「匿名树洞」（Supabase，免费 5 分钟）

1. 注册 [supabase.com](https://supabase.com/)，新建一个免费项目；
2. 在 SQL Editor 里执行：

```sql
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) <= 200),
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

-- 允许任何人匿名留言
create policy "anyone can insert messages"
  on messages for insert to anon with check (true);

-- 允许任何人读取留言
create policy "anyone can read messages"
  on messages for select to anon using (true);
```

3. 在项目根目录新建 `.env`：

```bash
PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
PUBLIC_SUPABASE_ANON_KEY=你的 anon key
```

4. 重新构建 / 部署即可。未配置时，`/treehole/` 页面会显示「树洞功能未配置」。

> 部署到 GitHub Pages 时，把这两个变量加到仓库
> **Settings → Secrets and variables → Actions → Variables** 里（`PUBLIC_SUPABASE_URL`、`PUBLIC_SUPABASE_ANON_KEY`），workflow 会自动读取。

## 📝 写内容

| 类型 | 目录 | 说明 |
|---|---|---|
| 文章 | `src/content/posts/` | frontmatter：`title` / `published` / `description` / `tags` / `category` |
| 树洞日记 | `src/content/diary/` | `title` / `date` / `description`；可选 `password`（整篇上锁）、`secret`（段落暗号） |
| 匿名树洞 | 页面 `/treehole/` | 访客匿名留言（需 Supabase） |
| 碎碎念 | `src/content/thoughts/` | `content` / `date` / `context` |
| 相册 | `src/content/albums/` | 外链图片填 `mode: "external"` + `photos`；本地图片放 `public/images/albums/<相册名>/` |

也可以直接访问站点的 **`/admin/`（管理台）**：配置 GitHub Personal Access Token 后，可以在网页端新建/编辑内容并直接提交到本仓库，自动触发部署。

## ⚙️ 个人化配置

所有站点配置集中在 **`src/config.ts`**：

- `siteConfig`：标题、主题色、横幅、首页文案
- `navBarConfig`：导航菜单
- `profileConfig`：头像、昵称、简介、社交链接
- `announcementConfig`：侧边栏公告
- `musicPlayerConfig`：音乐播放器（默认关闭，开启需自备音乐文件并配置歌单）

头像放在 `src/assets/images/avatar.png`；横幅图片在 `public/assets/desktop-banner/` 与 `public/assets/mobile-banner/`。

## 📄 许可

- 博客框架与主题：[MIT](LICENSE)（源自 Doulor/Blog 与 Mizuki）
- 自己写的内容（文章、日记、照片）默认不使用上面的许可，保留所有权利。
