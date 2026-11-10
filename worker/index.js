const json = (data, status = 200, origin = null) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {})
  }
});

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;
  params.delete("hash");
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = await hmac(new TextEncoder().encode(botToken), "WebAppData");
  const calculated = hex(await hmac(secretKey, checkString));
  if (!safeEqual(calculated.toLowerCase(), receivedHash.toLowerCase())) return null;
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 30 || now - authDate > 86400) return null;
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { return null; }
  if (!user || !Number.isSafeInteger(user.id)) return null;
  return { user, authDate };
}

function roleFor(id, env) {
  const value = String(id);
  if (value === String(env.ADMIN_TELEGRAM_ID || "")) return "admin";
  const jurors = (env.JURY_TELEGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (jurors.includes(value)) return "jury";
  const observers = (env.OBSERVER_TELEGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (observers.includes(value)) return "observer";
  return "participant";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const sameOrigin = !origin || origin === url.origin ? url.origin : null;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": sameOrigin || "null",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }});
    }
    if (origin && !sameOrigin) return json({ error: "origin_not_allowed" }, 403);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "music-slay-api",
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
        databaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
      }, 200, sameOrigin);
    }
    if (url.pathname === "/api/config" && request.method === "GET") {
      return json({ app: "MUSIC SLAY 2026", telegramMiniApp: true, authentication: "telegram-initdata" }, 200, sameOrigin);
    }
    if (url.pathname === "/api/telegram/session" && request.method === "POST") {
      if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "telegram_not_configured" }, 503, sameOrigin);
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400, sameOrigin); }
      const verified = await verifyTelegramInitData(body?.initData, env.TELEGRAM_BOT_TOKEN);
      if (!verified) return json({ error: "invalid_or_expired_telegram_init_data" }, 401, sameOrigin);
      const role = roleFor(verified.user.id, env);
      return json({
        authenticated: true,
        user: { id: String(verified.user.id), firstName: verified.user.first_name || "", username: verified.user.username || null },
        role,
        authDate: verified.authDate
      }, 200, sameOrigin);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not_implemented" }, 501, sameOrigin);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("MUSIC SLAY 2026 API is online. Frontend assets are not attached to this Worker deployment.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};