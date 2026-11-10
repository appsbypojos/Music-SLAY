const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
export default {
 async fetch(request, env) {
  const url=new URL(request.url);
  if(request.method==="OPTIONS") return new Response(null,{headers:cors});
  if(url.pathname==="/api/health") return json({ok:true,service:"music-slay-api",databaseConfigured:Boolean(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY)});
  if(url.pathname==="/api/config"&&request.method==="GET") return json({app:"MUSIC SLAY 2026",phase:"preparation"});
  if(url.pathname.startsWith("/api/")) return json({error:"API route not implemented yet",message:"Connect Supabase and deploy the database migration before enabling writes."},501);
  return env.ASSETS.fetch(request);
 }
};