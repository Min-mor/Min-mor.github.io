/**
 * R2 列表中转（Pages Function）
 *
 * 为什么需要它（渗透报告 #64，LOW）：
 *   r2img worker 的 `GET /?dir=` 曾经完全没有鉴权，任何人可以枚举目录、拿到
 *   整个桶的对象清单。列表是内容创建器的正当功能（上传后要看目录已有图并回填
 *   链接），不能直接删掉；而 worker 侧的鉴权是 X-Upload-Token，令牌一旦下发
 *   浏览器，任何 XSS 都能把整桶清单拖走。
 *   所以照搬上传那套设计：浏览器 → 本接口（校验 GitHub 登录态）→ 带服务端令牌
 *   转发给 worker。浏览器永远拿不到令牌。
 *
 * 链路：浏览器（带 GitHub token）→ 本接口校验身份 → 用 R2_UPLOAD_TOKEN
 *      请求 r2img worker 的 GET 列表 → 原样透回 [{ name, url, key, size, uploaded }]
 *
 * 环境变量（用 wrangler 配置，不要写进仓库）：
 *   R2_UPLOAD_TOKEN   r2img worker 的 UPLOAD_TOKEN（两端同值）
 *   R2_WORKER_URL     可选，默认 https://r2img.example.com
 *   ALLOWED_GH_LOGIN  可选，允许访问的 GitHub 用户名（逗号分隔），默认 Min-mor
 *
 * 路由：GET /api/r2-list?dir=album/xxx
 */

import { json, requireAllowedGithubUser } from "./_github-auth.js";

const WORKER_URL_DEFAULT = "https://r2img.example.com";

/**
 * 目录名只允许 ASCII 路径段：R2 的 key 是扁平命名空间，不含真实目录语义，
 * 但仍然要拦住 `..`、空值、超长串，避免把奇怪的前缀原样打到 worker 上。
 */
const DIR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/;

export async function onRequestGet(context) {
	const { request, env } = context;

	// ---- 1. 鉴权：必须是已登录的允许用户 ----
	const auth = await requireAllowedGithubUser(request, env);
	if (!auth.ok) return auth.response;

	// ---- 2. 校验目录参数 ----
	const dir = (new URL(request.url).searchParams.get("dir") || "").trim();
	if (!dir) return json({ error: "缺少 dir 参数" }, 400);
	if (!DIR_PATTERN.test(dir) || dir.includes(".."))
		return json({ error: "dir 参数不合法" }, 400);

	// ---- 3. 带令牌转发给 worker ----
	const uploadToken = env.R2_UPLOAD_TOKEN;
	if (!uploadToken) return json({ error: "服务端未配置 R2_UPLOAD_TOKEN" }, 500);
	const workerUrl = env.R2_WORKER_URL || WORKER_URL_DEFAULT;

	let resp;
	try {
		// 用 URL 拼参数：workerUrl 带不带结尾斜杠、带不带路径都能正确带上 dir
		const target = new URL(workerUrl);
		target.searchParams.set("dir", dir);
		resp = await fetch(target.toString(), {
			headers: { "X-Upload-Token": uploadToken },
		});
	} catch (err) {
		return json({ error: `转发列表请求失败: ${err.message}` }, 502);
	}

	// 原样透回：worker 的错误体同样带 error，客户端已有解析逻辑
	const text = await resp.text();
	return new Response(text, {
		status: resp.status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}
