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
  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), botToken);
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

function configuredRole(id, env) {
  const value = String(id);
  const adminId = String(env.ADMIN_TELEGRAM_ID || "").trim();
  if (/^\d+$/.test(adminId) && value === adminId) return "admin";
  const jurors = (env.JURY_TELEGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (jurors.includes(value)) return "jury";
  return "participant";
}

async function dbRequest(env, path, options = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("database_not_configured");
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || "database_request_failed");
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

async function authenticate(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  const verified = await verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!verified) return null;
  let role = configuredRole(verified.user.id, env);
  if (role === "participant") {
    try {
      const rows = await dbRequest(env, `observer_permissions?telegram_id=eq.${verified.user.id}&select=telegram_id&limit=1`);
      if (rows?.length) role = "observer";
    } catch (error) {
      if (error.message === "database_not_configured") throw error;
      throw new Error("role_lookup_failed");
    }
  }
  return { user: verified.user, authDate: verified.authDate, role };
}

async function userHash(env, userId, purpose) {
  const key = new TextEncoder().encode(env.TELEGRAM_BOT_TOKEN);
  return hex(await hmac(key, `music-slay-2026:${purpose}:${userId}`));
}

const fail = (error, origin) => {
  const message = error?.message || "internal_error";
  const status = message === "database_not_configured" ? 503 :
    message === "role_lookup_failed" ? 503 :
    message === "phase_closed" || message === "top5_required" ? 409 :
    message === "slay_not_found" ? 404 :
    ["invalid_candidate","invalid_names","invalid_score","too_many_votes","invalid_top5","duplicate_candidate","invalid_duration","invalid_phase_transition","invalid_nominations"].includes(message) ? 400 : 500;
  return json({ error: status === 500 ? "request_failed" : message }, status, origin);
};

export default {
  async scheduled(controller, env, ctx) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
      const slays = await dbRequest(env, "slays?select=id,current_phase,phase_ends_at&order=created_at.desc&limit=1");
      const slay = slays?.[0];
      if (!slay?.phase_ends_at || new Date(slay.phase_ends_at).getTime() > Date.now()) return;
      const nextPhase = { preparation: "candidates", candidates: "voting", voting: "jury", jury: "awards" }[slay.current_phase];
      if (!nextPhase) return;
      await dbRequest(env, "rpc/ms_admin_set_phase", {
        method: "POST",
        body: JSON.stringify({
          p_slay_id: slay.id,
          p_next_phase: nextPhase,
          p_duration_seconds: null,
          p_actor_telegram_id: "SYSTEM"
        })
      });
    } catch (error) {
      console.error("scheduled phase transition failed", error?.message || error);
    }
  },
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
        version: "2026.1.1",
        app: env.APP_NAME || "MUSIC SLAY 2026",
        telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
        databaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
        ts: new Date().toISOString()
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
      try {
        const auth = await authenticate(new Request(request.url, { headers: { "X-Telegram-Init-Data": body.initData } }), env);
        return json({
          authenticated: true,
          user: { id: String(auth.user.id), firstName: auth.user.first_name || "", username: auth.user.username || null },
          role: auth.role,
          authDate: auth.authDate
        }, 200, sameOrigin);
      } catch (error) { return fail(error, sameOrigin); }
    }

    if (url.pathname.startsWith("/api/")) {
      let auth;
      try { auth = await authenticate(request, env); }
      catch (error) { return fail(error, sameOrigin); }
      if (!auth) return json({ error: "unauthorized" }, 401, sameOrigin);

      try {
        if (url.pathname === "/api/state" && request.method === "GET") {
          const slays = await dbRequest(env, "slays?select=id,title,current_phase,phase_started_at,phase_ends_at&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ slay: null, nominations: [] }, 200, sameOrigin);
          const slay = slays[0];
          const nominations = await dbRequest(env, `nominations?slay_id=eq.${slay.id}&select=id,name,position,locked_at&order=position.asc`);
          const ids = nominations.map(n => n.id);
          let candidates = [];
          if (ids.length) {
            const filter = ids.join(",");
            candidates = await dbRequest(env, `candidates?nomination_id=in.(${filter})&select=id,nomination_id,display_name,suggestion_count,is_top5&order=created_at.asc`);
          }
          const myVotes = auth.role === "participant" ? await dbRequest(env, `votes?voter_hash=eq.${await userHash(env, auth.user.id, "vote")}&select=nomination_id,candidate_id`) : [];
          const myScores = auth.role === "jury" ? await dbRequest(env, `jury_scores?juror_telegram_id=eq.${auth.user.id}&select=nomination_id,candidate_id,score`) : [];
          return json({ slay, nominations: nominations.map(n => ({ ...n, candidates: candidates.filter(c => c.nomination_id === n.id) })), myVotes, myScores, role: auth.role }, 200, sameOrigin);
        }

        if (url.pathname === "/api/submissions" && request.method === "POST") {
          if (auth.role !== "participant") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (typeof body.nominationId !== "string" || !Array.isArray(body.names)) return json({ error: "invalid_payload" }, 400, sameOrigin);
          const names = body.names.map(x => String(x).trim()).filter(Boolean);
          const submitterHash = await userHash(env, auth.user.id, "submission");
          const result = await dbRequest(env, "rpc/ms_submit_candidates", {
            method: "POST",
            body: JSON.stringify({ p_nomination_id: body.nominationId, p_submitter_hash: submitterHash, p_names: names })
          });
          return json({ ok: true, results: result }, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/votes" && request.method === "GET") {
          if (auth.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const slays = await dbRequest(env, "slays?select=id,title&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ votes: [] }, 200, sameOrigin);
          const nominations = await dbRequest(env, `nominations?slay_id=eq.${slays[0].id}&select=id,name&order=position.asc`);
          const nominationIds = nominations.map(n => n.id);
          if (!nominationIds.length) return json({ votes: [] }, 200, sameOrigin);
          const filter = nominationIds.join(",");
          const votes = await dbRequest(env, `votes?nomination_id=in.(${filter})&select=id,nomination_id,candidate_id,voter_telegram_id,created_at&order=created_at.desc`);
          const candidates = await dbRequest(env, `candidates?nomination_id=in.(${filter})&select=id,display_name`);
          const nominationMap = Object.fromEntries(nominations.map(n => [n.id, n.name]));
          const candidateMap = Object.fromEntries(candidates.map(c => [c.id, c.display_name]));
          const voteCounts = votes.reduce((acc, v) => {
            acc[v.candidate_id] = (acc[v.candidate_id] || 0) + 1;
            return acc;
          }, {});
          return json({
            votes: votes.map(v => ({
              id: v.id,
              nomination_id: v.nomination_id,
              nomination: nominationMap[v.nomination_id] || "—",
              candidate: candidateMap[v.candidate_id] || "—",
              vote_count: voteCounts[v.candidate_id] || 0,
              voter: v.voter_telegram_id || "Старый голос — ID не сохранён",
              created_at: v.created_at
            }))
          }, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/voters" && request.method === "GET") {
          if (auth.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const slays = await dbRequest(env, "slays?select=id&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ voters: [] }, 200, sameOrigin);
          const nominations = await dbRequest(env, `nominations?slay_id=eq.${slays[0].id}&select=id`);
          const nominationIds = nominations.map(n => n.id);
          if (!nominationIds.length) return json({ voters: [] }, 200, sameOrigin);
          const filter = nominationIds.join(",");
          const votes = await dbRequest(env, `votes?nomination_id=in.(${filter})&select=voter_telegram_id,created_at`);
          const byVoter = new Map();
          for (const vote of votes) {
            const voter = vote.voter_telegram_id || "Старый голос — ID не сохранён";
            const current = byVoter.get(voter) || { voter, vote_count: 0, last_vote_at: null };
            current.vote_count += 1;
            if (!current.last_vote_at || new Date(vote.created_at) > new Date(current.last_vote_at)) current.last_vote_at = vote.created_at;
            byVoter.set(voter, current);
          }
          const voters = [...byVoter.values()].sort((a, b) => b.vote_count - a.vote_count || String(a.voter).localeCompare(String(b.voter), "ru"));
          return json({ voters }, 200, sameOrigin);
        }

        if (url.pathname === "/api/votes" && request.method === "POST") {
          if (auth.role !== "participant") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (typeof body.nominationId !== "string" || !Array.isArray(body.candidateIds) || body.candidateIds.some(x => typeof x !== "string")) return json({ error: "invalid_payload" }, 400, sameOrigin);
          const voterHash = await userHash(env, auth.user.id, "vote");
          const count = await dbRequest(env, "rpc/ms_save_votes", {
            method: "POST",
            body: JSON.stringify({ p_nomination_id: body.nominationId, p_voter_hash: voterHash, p_candidate_ids: body.candidateIds, p_voter_telegram_id: String(auth.user.id) })
          });
          return json({ ok: true, saved: count }, 200, sameOrigin);
        }

        if (url.pathname === "/api/jury-score" && request.method === "POST") {
          if (auth.role !== "jury") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (typeof body.nominationId !== "string" || typeof body.candidateId !== "string" || !Number.isInteger(body.score)) return json({ error: "invalid_payload" }, 400, sameOrigin);
          await dbRequest(env, "rpc/ms_save_jury_score", {
            method: "POST",
            body: JSON.stringify({
              p_nomination_id: body.nominationId,
              p_candidate_id: body.candidateId,
              p_juror_telegram_id: String(auth.user.id),
              p_score: body.score
            })
          });
          return json({ ok: true }, 200, sameOrigin);
        }
        if (url.pathname === "/api/results" && request.method === "GET") {
          const slays = await dbRequest(env, "slays?select=id,title,current_phase&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ results: [] }, 200, sameOrigin);

          const slayId = slays[0].id;
          const nominations = await dbRequest(
            env,
            `nominations?slay_id=eq.${slayId}&select=id,name,position&order=position.asc`
          );
          const nominationIds = nominations.map(n => n.id);

          let candidates = [];
          let voteRows = [];
          let juryRows = [];

          if (nominationIds.length) {
            const filter = nominationIds.map(id => `"${id}"`).join(",");
            candidates = await dbRequest(
              env,
              `candidates?nomination_id=in.(${filter})&select=id,nomination_id,display_name,is_top5&order=created_at.asc`
            );
            voteRows = await dbRequest(
              env,
              `votes?nomination_id=in.(${filter})&select=nomination_id,candidate_id`
            );
            juryRows = await dbRequest(
              env,
              `jury_scores?nomination_id=in.(${filter})&select=nomination_id,candidate_id,juror_telegram_id,score`
            );
          }

          const voteCounts = new Map();
          for (const vote of voteRows) {
            const key = `${vote.nomination_id}:${vote.candidate_id}`;
            voteCounts.set(key, (voteCounts.get(key) || 0) + 1);
          }

          const juryByCandidate = new Map();
          for (const score of juryRows) {
            const key = `${score.nomination_id}:${score.candidate_id}`;
            if (!juryByCandidate.has(key)) juryByCandidate.set(key, []);
            juryByCandidate.get(key).push({
              jurorTelegramId: String(score.juror_telegram_id),
              score: Number(score.score)
            });
          }

          const results = nominations.map(nomination => {
            const nominationCandidates = candidates
              .filter(candidate => candidate.nomination_id === nomination.id)
              .map(candidate => {
                const userVotes = voteCounts.get(`${nomination.id}:${candidate.id}`) || 0;
                const juryScores = juryByCandidate.get(`${nomination.id}:${candidate.id}`) || [];

                const juryVotes = juryScores.map(entry => ({
                  jurorTelegramId: entry.jurorTelegramId,
                  score: entry.score,
                  percent: entry.score * 10,
                  votes: userVotes * entry.score / 10
                }));

                const juryVotesTotal = juryVotes.reduce((total, entry) => total + entry.votes, 0);
                const finalScore = userVotes + juryVotesTotal;

                return {
                  candidateId: candidate.id,
                  candidate: candidate.display_name,
                  userVotes,
                  juryScores,
                  juryVotes,
                  juryVotesTotal,
                  finalScore
                };
              })
              .sort((a, b) => b.finalScore - a.finalScore || b.userVotes - a.userVotes || a.candidate.localeCompare(b.candidate));

            return {
              nominationId: nomination.id,
              nomination: nomination.name,
              candidates: nominationCandidates,
              winner: nominationCandidates[0] || null
            };
          });

          return json({
            slay: slays[0],
            formula: {
              description: "finalScore = userVotes + sum(userVotes * juryScore / 10)",
              juryVotePerMember: "userVotes * juryScore / 10"
            },
            results
          }, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/schedule-phase" && request.method === "POST") {
          if (auth.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          const at = new Date(body?.at);
          if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() + 60000 || at.getTime() > Date.now() + 31622400000) {
            return json({ error: "invalid_duration" }, 400, sameOrigin);
          }
          const slays = await dbRequest(env, "slays?select=id,current_phase&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ error: "slay_not_found" }, 404, sameOrigin);
          const result = await dbRequest(env, "rpc/ms_admin_schedule_phase", {
            method: "POST",
            body: JSON.stringify({ p_slay_id: slays[0].id, p_ends_at: at.toISOString(), p_actor_telegram_id: String(auth.user.id) })
          });
          return json({ ok: true, slay: result }, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/phase" && request.method === "POST") {
          if (auth.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (typeof body.phase !== "string" || (body.durationSeconds !== null && body.durationSeconds !== undefined && !Number.isInteger(body.durationSeconds))) return json({ error: "invalid_payload" }, 400, sameOrigin);
          const slays = await dbRequest(env, "slays?select=id&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ error: "slay_not_found" }, 404, sameOrigin);
          const result = await dbRequest(env, "rpc/ms_admin_set_phase", {
            method: "POST",
            body: JSON.stringify({ p_slay_id: slays[0].id, p_next_phase: body.phase, p_duration_seconds: body.durationSeconds ?? null, p_actor_telegram_id: String(auth.user.id) })
          });
          return json({ ok: true, slay: result }, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/nominations" && request.method === "POST") {
          if (auth.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (!Array.isArray(body.nominations) || body.nominations.length < 1 || body.nominations.length > 20) return json({ error: "invalid_nominations" }, 400, sameOrigin);
          const nominations = body.nominations.map(item => ({ id: typeof item?.id === "string" ? item.id : null, name: typeof item?.name === "string" ? item.name.trim().replace(/\\s+/g, " ") : "" }));
          const names = nominations.map(item => item.name);
          if (nominations.some(item => item.name.length < 2 || item.name.length > 100) || new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length || new Set(nominations.map(item => item.id).filter(Boolean)).size !== nominations.filter(item => item.id).length) return json({ error: "invalid_nominations" }, 400, sameOrigin);
          const slays = await dbRequest(env, "slays?select=id,current_phase&order=created_at.desc&limit=1");
          if (!slays?.length) return json({ error: "slay_not_found" }, 404, sameOrigin);
          if (slays[0].current_phase !== "preparation") return json({ error: "nominations_locked" }, 409, sameOrigin);
          const slayId = slays[0].id;
          const existing = await dbRequest(env, `nominations?slay_id=eq.${slayId}&select=id,name,position&order=position.asc`);
          const existingById = new Map(existing.map(row => [row.id, row]));
          const retained = [];
          for (let index = 0; index < nominations.length; index++) {
            const item = nominations[index];
            if (item.id) {
              if (!existingById.has(item.id)) return json({ error: "invalid_nominations" }, 400, sameOrigin);
              await dbRequest(env, `nominations?id=eq.${item.id}&slay_id=eq.${slayId}`, {
                method: "PATCH",
                headers: { Prefer: "return=minimal" },
                body: JSON.stringify({ name: item.name, position: index })
              });
              retained.push(item.id);
            } else {
              const created = await dbRequest(env, "nominations", {
                method: "POST",
                headers: { Prefer: "return=representation" },
                body: JSON.stringify({ slay_id: slayId, name: item.name, position: index })
              });
              retained.push(created[0].id);
            }
          }
          const removed = existing.filter(row => !retained.includes(row.id)).map(row => row.id);
          if (removed.length) {
            const filter = removed.join(",");
            await dbRequest(env, `nominations?id=in.(${filter})&slay_id=eq.${slayId}`, { method: "DELETE" });
          }
          await dbRequest(env, "admin_action_log", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ actor_telegram_id: String(auth.user.id), action: "edit_nominations", details: { names } })
          });
          return json({ ok: true, count: names.length }, 200, sameOrigin);
        }

        if (url.pathname === "/api/admin/top5" && request.method === "POST") {
          if (auth.role !== "admin") return json({ error: "forbidden" }, 403, sameOrigin);
          const body = await request.json();
          if (typeof body.nominationId !== "string" || !Array.isArray(body.candidateIds) || body.candidateIds.some(x => typeof x !== "string")) return json({ error: "invalid_payload" }, 400, sameOrigin);
          const count = await dbRequest(env, "rpc/ms_admin_set_top5", {
            method: "POST",
            body: JSON.stringify({ p_nomination_id: body.nominationId, p_candidate_ids: body.candidateIds, p_actor_telegram_id: String(auth.user.id) })
          });
          return json({ ok: true, selected: count }, 200, sameOrigin);
        }

        return json({ error: "not_found" }, 404, sameOrigin);
      } catch (error) { return fail(error, sameOrigin); }
    }
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get("Content-Type") || "";
      if (contentType.includes("text/html")) {
        const headers = new Headers(assetResponse.headers);
        headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        headers.set("Pragma", "no-cache");
        headers.set("Expires", "0");
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers
        });
      }
      return assetResponse;
    }
    return new Response("MUSIC SLAY 2026 API is online. Frontend assets are not attached to this Worker deployment.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};
