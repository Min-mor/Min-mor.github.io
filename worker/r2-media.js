/**
 * R2 媒体 Worker（列表 + 上传，两者都必须鉴权）
 *
 * 安全修复（渗透报告 #64，LOW）：
 *   旧版 GET `?dir=` 列表分支**完全没有鉴权**：任何人不带任何请求头就能枚举目录、
 *   拿到整个桶的对象清单与公开 URL（报告实测泄露 579 个对象、其中 431 张个人相册）。
 *   列表本身是内容创建器的正当功能（上传后要看目录里已有哪些图、回填链接），
 *   所以保留能力、补齐鉴权：GET 列表与 POST 上传现在**同级**要求 X-Upload-Token，
 *   与 UPLOAD_TOKEN 做常量时间比较。没有令牌一律 401，不再返回任何对象信息。
 *
 * 浏览器永远不持有令牌：内容创建器走同源 Pages Function 中转
 *   POST /api/r2-upload   上传
 *   GET  /api/r2-list     列表
 * 由 Function 校验 GitHub 登录态（ALLOWED_GH_LOGIN）后，带上令牌转发到本 Worker。
 *
 * 单对象读取**不经过本 Worker**：图片由 R2 公开自定义域名（wrangler.toml 的
 * PUBLIC_BASE_URL = https://img.example.com）直接提供。因此收紧本 Worker 不会
 * 影响文章/相册里的配图，只有"列目录/上传"这两个管理动作被保护。
 *
 * 接口:
 *   GET  /?dir=album/xxx   列出目录下媒体文件  → [{ name, url, key, size, uploaded }]
 *                          请求头: X-Upload-Token=<与 UPLOAD_TOKEN 一致>
 *   POST /  (multipart)    上传文件            → { uploaded: [{ url, key, size }], errors: [] }
 *                          表单字段: dir=目标目录, files=文件(可多个)
 *                          请求头: X-Upload-Token=<与 UPLOAD_TOKEN 一致>
 *   OPTIONS /              CORS 预检
 */

const MEDIA_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".gif",
	".webp",
	".avif",
	".bmp",
	".svg",
	".mp4",
	".webm",
	".ogg",
	".mov",
];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * CORS 白名单默认值：只允许博客自己的管理界面。
 * 正常链路是同源 Function 转发（不发 Origin，也不看 CORS），
 * 这个白名单只为"万一有人拿浏览器直连 Worker"时兜底。
 */
const DEFAULT_ALLOWED_ORIGINS = [
	"https://min-mor.github.io",
	"http://localhost:4321", // astro dev 默认端口，方便本地调试
];

/** 常量时间比较，避免计时攻击 */
function tokensMatch(a, b) {
	if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
		return false;
	let result = 0;
	for (let i = 0; i < a.length; i++)
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return result === 0;
}

function allowedOrigins(env) {
	const raw = env?.ALLOWED_ORIGINS;
	if (!raw) return DEFAULT_ALLOWED_ORIGINS;
	return String(raw)
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

/**
 * 收紧 CORS：从 `*` 改为"命中白名单才回显该 Origin"。
 * 白名单外的来源拿不到 Access-Control-Allow-Origin，浏览器会直接拦下响应。
 */
function corsHeaders(request, env) {
	const headers = {
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-Upload-Token",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
	const origin = request.headers.get("Origin");
	if (origin && allowedOrigins(env).includes(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}

function json(data, request, env, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"Content-Type": "application/json",
			// 管理数据（对象清单）不进任何缓存
			"Cache-Control": "no-store",
			...corsHeaders(request, env),
		},
	});
}

function hasMediaExtension(key) {
	const ext = key.toLowerCase().substring(key.lastIndexOf("."));
	return MEDIA_EXTENSIONS.includes(ext);
}

/**
 * R2 key 强制 ASCII：自定义域名（img.example.com）不提供非 ASCII key，
 * 实测含中文的 key 永远 404（百分号编码也 404）。非 ASCII 字符统一替换为 _。
 */
function toAsciiKey(value) {
	return String(value || "").replace(/[^\w/.-]+/g, "_");
}

/**
 * 统一鉴权：OPTIONS 之外的所有请求都必须带正确的 X-Upload-Token。
 * 返回 null 表示通过，否则返回应当直接回给客户端的 Response。
 */
function rejectUnauthorized(request, env) {
	const uploadToken = env.UPLOAD_TOKEN;
	if (!uploadToken) {
		// 没配令牌时宁可全拒，也不能退化成"无鉴权"
		return json({ error: "服务端未配置 UPLOAD_TOKEN" }, request, env, 500);
	}
	const clientToken = request.headers.get("X-Upload-Token") || "";
	if (!tokensMatch(clientToken, uploadToken)) {
		return json({ error: "令牌缺失或无效" }, request, env, 401);
	}
	return null;
}

export default {
	async fetch(request, env) {
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(request, env),
			});
		}

		// ---------- 鉴权（#64 修复点：列表与上传共用同一道门）----------
		const unauthorized = rejectUnauthorized(request, env);
		if (unauthorized) return unauthorized;

		const url = new URL(request.url);

		// ---------- 列出目录（保持旧 Worker 的返回契约）----------
		if (request.method === "GET") {
			const directory = url.searchParams.get("dir") || "";
			if (!directory) {
				return json(
					{ error: "请提供目录参数，例如 ?dir=photos 或 ?dir=reality" },
					request,
					env,
					400,
				);
			}

			try {
				const prefix = directory.endsWith("/") ? directory : `${directory}/`;
				const list = await env.R2_BUCKET.list({ prefix });

				const mediaUrls = list.objects
					.filter((obj) => obj.size > 0 && hasMediaExtension(obj.key))
					.map((obj) => {
						const parts = obj.key.split("/");
						return {
							name: parts.pop(),
							url: `${env.PUBLIC_BASE_URL}/${obj.key}`,
							key: obj.key,
							size: obj.size,
							uploaded: obj.uploaded,
						};
					});

				// 按上传时间排序（最新的在前）
				mediaUrls.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

				return json(mediaUrls, request, env);
			} catch (err) {
				console.error("Worker 错误:", err);
				return json(
					{ error: err.message || "获取列表时发生错误" },
					request,
					env,
					500,
				);
			}
		}

		// ---------- 上传文件 ----------
		if (request.method === "POST") {
			let formData;
			try {
				formData = await request.formData();
			} catch {
				return json(
					{ error: "请求体不是有效的 multipart 表单" },
					request,
					env,
					400,
				);
			}

			const dir = toAsciiKey(
				(formData.get("dir") || "")
					.trim()
					.replace(/^\/+/, "")
					.replace(/\/+$/, ""),
			);
			if (!dir) return json({ error: "缺少 dir 字段" }, request, env, 400);

			const files = formData.getAll("files").filter((f) => f instanceof File);
			if (files.length === 0)
				return json({ error: "未检测到文件" }, request, env, 400);

			const results = [];
			const errors = [];

			for (const file of files) {
				// 安全的文件名：去路径、去非法字符、强制 ASCII（自定义域名不提供非 ASCII key）
				const safeName = toAsciiKey(
					file.name.replace(/[\\/]+/g, "").replace(/[^\w.\-一-龥]+/gu, "_"),
				);
				if (!safeName || !hasMediaExtension(safeName)) {
					errors.push({ name: file.name, error: "不支持的文件类型" });
					continue;
				}
				if (file.size > MAX_FILE_SIZE) {
					errors.push({ name: file.name, error: "文件超过 100MB 限制" });
					continue;
				}

				const key = `${dir}/${safeName}`;
				try {
					await env.R2_BUCKET.put(key, file.stream(), {
						httpMetadata: {
							contentType: file.type || "application/octet-stream",
						},
					});
					results.push({
						url: `${env.PUBLIC_BASE_URL}/${key}`,
						key,
						size: file.size,
					});
				} catch (error) {
					errors.push({ name: file.name, error: error.message });
				}
			}

			return json(
				{ uploaded: results, errors },
				request,
				env,
				errors.length && !results.length ? 500 : 200,
			);
		}

		return json({ error: "Method Not Allowed" }, request, env, 405);
	},
};
