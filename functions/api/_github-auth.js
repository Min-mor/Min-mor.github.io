/**
 * GitHub 登录态校验（Pages Function 共享模块，不是路由）
 *
 * 为什么抽出来：上传（/api/r2-upload）和列表（/api/r2-list）都必须"先确认
 * 是站长本人的 GitHub 身份"，两处各写一遍最容易在后续改动里漏掉一处 ——
 * 渗透报告 #64 就是典型的漏掉一处鉴权导致的。
 *
 * 环境变量（用 wrangler 配置，不要写进仓库）：
 *   ALLOWED_GH_LOGIN  允许的 GitHub 用户名（逗号分隔），默认 Min-mor
 */

const GITHUB_USER_API = "https://api.github.com/user";

export function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			// 鉴权相关内容一律不缓存
			"Cache-Control": "no-store",
		},
	});
}

/**
 * 校验请求头里的 GitHub token 属于允许的用户。
 *
 * @returns {Promise<{ ok: true, login: string } | { ok: false, response: Response }>}
 */
export async function requireAllowedGithubUser(request, env) {
	const authHeader = request.headers.get("Authorization") || "";
	const ghToken = authHeader.replace(/^Bearer\s+/i, "").trim();
	if (!ghToken) return { ok: false, response: json({ error: "未登录，请先登录 GitHub" }, 401) };

	const allowed = (env.ALLOWED_GH_LOGIN || "Min-mor")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);

	let login = null;
	try {
		const resp = await fetch(GITHUB_USER_API, {
			headers: {
				Authorization: `Bearer ${ghToken}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "blog-admin-r2-proxy",
			},
		});
		if (resp.ok) login = (await resp.json()).login;
		else console.log("github /user failed:", resp.status);
	} catch (err) {
		console.log("github /user error:", err.message);
	}

	if (!login)
		return { ok: false, response: json({ error: "GitHub 身份校验失败，请重新登录" }, 401) };
	if (!allowed.includes(login))
		return { ok: false, response: json({ error: `用户 ${login} 无权访问` }, 403) };

	return { ok: true, login };
}
