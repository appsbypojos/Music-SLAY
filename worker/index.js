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

async function authenticate(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  const verified = await verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!verified) return null;
  return {
    user: verified.user,
    authDate: verified.authDate,
    role: roleFor(verified.user.id, env)
  };
}

async function dbRequest(env, path, options = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("database_not_configured");
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const err = new Error(data?.message || data?.hint || `database_http_${response.status}`);
    err.status = response.status;
    err.code = data?.code || null;
    throw err;
  }
  return data;
}

async function activeSlay(env) {
  const rows = await dbRequest(env, "slays?select=id,title,current_phase,phase_started_at,phase_ends_at&order=created_at.desc&limit=1");
  return rows?.[0] || null;
}

async function identityHash(env, telegramId) {
  const secret = env.IDENTITY_HASH_SECRET || env.TELEGRAM_BOT_TOKEN;
  return hex(await hmac(new TextEncoder().encode(secret), `music-slay-user:${telegramId}`));
}

function errorResponse(error, origin) {
  const message = String(error?.message || "internal_error");
  const known = ["phase_closed", "nomination_locked", "invalid_submission", "invalid_vote", "duplicate_candidates", "candidate_not_in_nomination", "candidate_not_in_top5", "invalid_score", "invalid_phase_or_duration", "slay_not_found"];
  const matched = known.find(code => message.includes(code));
  if (matched) return json({ error: matched }, 409, origin);
  if (message === "database_not_configured") return json({ error: message }, 503, origin);
  return json({ error: "server_error" }, 500, origin);
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
        "Access-Control-Allow-Headers": "Content-Type,X-Telegram-Init-Data",
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
      return json({
        authenticated: true,
        user: { id: String(verified.user.id), firstName: verified.user.first_name || "", username: verified.user.username || null },
        role: roleFor(verified.user.id, env),
        authDate: verified.authDate
      }, 200, sameOrigin);
    }

    if (url.pathname.startsWith("/api/")) {
      const session = await authenticate(request, env);
      if (!session) return json({ error: "unauthorized" }, 401, sameOrigin);
      try {
        if (url.pathname === "/api/state" && request.method === "GET") {
          const slay = await activeSlay(env);
          if (!slay) return json({ slay: null, nominations: [] }, 200, sameOrigin);
          const nominations = await dbRequest(env,
            `nominations?select=id,name,position,locked_at,candidates(id,display_name,suggestion_count,is_top5)&slay_id=eq.${slay.id}&order=position.asc`);
          return json({
            slay: {
              id: slay.id, title: slay.title, phase: slay.current_phase,
              phaseStartedAt: slay.phase_started_at, phaseEndsAt: slay.phase_ends_at,
              phaseExpired: Boolean(slay.phase_ends_at && Date.parse(slay.phase_ends_at) <= Date.now())
            },
            nominations: (nominations || []).map(n => ({
              id: n.id, name: n.name, position: n.position, locked: Boolean(n.locked_at),
              candidates: (n.candidates || []).sort((a,b) => a.display_name.localeCompare(b.display_name, "ru"))
            })),
            role: session.role
          }, 200, sameOrigin);
        }

        if (url.pathname === "/api/submissions" && request.method === "POST") {
          if (session.role !== "participant") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          const names = Array.isArray(body.names) ? body.names : [body.name];
          if (!body.nominationId || names.length < 1 || names.length > 5) return json({ error: "invalid_submission" }, 400, sameOrigin);
          const submitterHash = await identityHash(env, session.user.id);
          const results = [];
          for (const name of names) {
            results.push(await dbRequest(env, "rpc/submit_candidate", {
              method: "POST", body: { p_nomination_id: body.nominationId, p_display_name: name, p_submitter_hash: submitterHash }
            }));
          }
          return json({ saved: results }, 200, sameOrigin);
        }

        if (url.pathname === "/api/votes" && request.method === "POST") {
          if (session.role !== "participant") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (!body.nominationId || !Array.isArray(body.candidateIds)) return json({ error: "invalid_vote" }, 400, sameOrigin);
          const voterHash = await identityHash(env, session.user.id);
          const result = await dbRequest(env, "rpc/replace_votes", {
            method: "POST", body: { p_nomination_id: body.nominationId, p_candidate_ids: body.candidateIds, p_voter_hash: voterHash }
          });
          return json(result, 200, sameOrigin);
        }

        if (url.pathname === "/api/jury-score" && request.method === "POST") {
          if (session.role !== "jury") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          const result = await dbRequest(env, "rpc/save_jury_score", {
            method: "POST", body: {
              p_nomination_id: body.nominationId, p_candidate_id: body.candidateId,
              p_juror_id: String(session.user.id), p_score: Number(body.score)
            }
          });
          return json(result, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/top5" && request.method === "POST") {
          if (session.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (!body.nominationId || !Array.isArray(body.candidateIds)) return json({ error: "invalid_top5" }, 400, sameOrigin);
          const result = await dbRequest(env, "rpc/set_nomination_top5", {
            method: "POST", body: { p_nomination_id: body.nominationId, p_candidate_ids: body.candidateIds }
          });
          return json(result, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/phase" && request.method === "POST") {
          if (session.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          const slay = await activeSlay(env);
          if (!slay) return json({ error: "slay_not_found" }, 404, sameOrigin);
          const result = await dbRequest(env, "rpc/transition_slay_phase", {
            method: "POST", body: {
              p_slay_id: slay.id, p_actor_id: String(session.user.id),
              p_next_phase: body.phase, p_duration_seconds: Number(body.durationSeconds || 0)
            }
          });
          return json(result, 200, sameOrigin);
        }

        return json({ error: "not_found" }, 404, sameOrigin);
      } catch (error) {
        return errorResponse(error, sameOrigin);
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("MUSIC SLAY 2026 API is online. Frontend assets are not attached to this Worker deployment.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};
