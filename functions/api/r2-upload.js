/**
 * R2 上传中转（Pages Function）
 *
 * 为什么需要它：r2img worker 的上传接口要求 X-Upload-Token，令牌若下发浏览器，
 * 任何 XSS 都能偷走往 R2 桶乱传文件。这里用 GitHub 登录态做鉴权，令牌只在
 * 服务端环境变量里，浏览器永远拿不到。
 *
 * 链路：浏览器（带 GitHub token）→ 本接口校验身份 → 用 R2_UPLOAD_TOKEN
 *      转发 multipart 给 r2img worker → 原样透回结果
 *
 * 环境变量（用 wrangler 配置，不要写进仓库）：
 *   R2_UPLOAD_TOKEN   r2img worker 的 UPLOAD_TOKEN（两端同值）
 *   R2_WORKER_URL     可选，默认 https://r2img.example.com
 *   ALLOWED_GH_LOGIN  可选，允许上传的 GitHub 用户名（逗号分隔），默认 Min-mor
 *
 * 路由：POST /api/r2-upload
 * 请求体：原样 multipart（dir=目标目录, files=文件），与 worker 契约一致
 *
 * 列表接口见 ./r2-list.js（同一次安全修复：#64 之前列表分支没有鉴权）。
 */

import { json, requireAllowedGithubUser } from "./_github-auth.js";

const WORKER_URL_DEFAULT = "https://r2img.example.com";

export async function onRequestPost(context) {
	const { request, env } = context;

	// ---- 1. 鉴权：必须是已登录的允许用户 ----
	const auth = await requireAllowedGithubUser(request, env);
	if (!auth.ok) return auth.response;

	// ---- 2. 转发 multipart 给 worker ----
	const uploadToken = env.R2_UPLOAD_TOKEN;
	if (!uploadToken) {
		return json({ error: "服务端未配置 R2_UPLOAD_TOKEN" }, 500);
	}
	const workerUrl = env.R2_WORKER_URL || WORKER_URL_DEFAULT;

	// 流式透传请求体：零额外 CPU、不受体积限制。
	// Content-Type 必须原样带上，否则丢失 multipart boundary。
	const contentType = request.headers.get("Content-Type");
	if (!contentType || !contentType.startsWith("multipart/form-data")) {
		return json({ error: "请求体必须是 multipart 表单" }, 400);
	}

	let resp;
	try {
		resp = await fetch(workerUrl, {
			method: "POST",
			headers: {
				"Content-Type": contentType,
				"X-Upload-Token": uploadToken,
			},
			body: request.body,
		});
	} catch (err) {
		return json({ error: `转发上传请求失败: ${err.message}` }, 502);
	}

	// 原样透回：worker 的错误体同样带 error，客户端已有解析逻辑
	const text = await resp.text();
	return new Response(text, {
		status: resp.status,
		headers: { "Content-Type": "application/json" },
	});
}
