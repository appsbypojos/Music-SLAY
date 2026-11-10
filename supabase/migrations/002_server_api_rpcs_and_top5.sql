-- MUSIC SLAY 2026: server-side operations and top-five selection
alter table public.candidates add column if not exists is_top5 boolean not null default false;

create or replace function public.submit_candidate(p_nomination_id uuid, p_display_name text, p_submitter_hash text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_slay public.slays%rowtype;
  v_candidate public.candidates%rowtype;
  v_name text := btrim(regexp_replace(coalesce(p_display_name,''), '\s+', ' ', 'g'));
  v_inserted integer := 0;
begin
  if length(v_name) < 2 or length(v_name) > 160 or p_submitter_hash is null or length(p_submitter_hash) < 32 then raise exception 'invalid_submission'; end if;
  select s.* into v_slay from public.slays s join public.nominations n on n.slay_id=s.id where n.id=p_nomination_id for update of s;
  if not found or v_slay.current_phase <> 'candidates' or (v_slay.phase_ends_at is not null and v_slay.phase_ends_at <= now()) then raise exception 'phase_closed'; end if;
  if exists(select 1 from public.nominations where id=p_nomination_id and locked_at is not null) then raise exception 'nomination_locked'; end if;
  insert into public.candidates(nomination_id,display_name,normalized_name)
  values(p_nomination_id,v_name,lower(v_name))
  on conflict(nomination_id,normalized_name) do update set display_name=excluded.display_name
  returning * into v_candidate;
  insert into public.submissions(nomination_id,candidate_id,submitter_hash)
  values(p_nomination_id,v_candidate.id,p_submitter_hash)
  on conflict(nomination_id,candidate_id,submitter_hash) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=1 then update public.candidates set suggestion_count=suggestion_count+1 where id=v_candidate.id returning * into v_candidate; end if;
  return jsonb_build_object('candidate_id',v_candidate.id,'display_name',v_candidate.display_name,'suggestion_count',v_candidate.suggestion_count,'duplicate',v_inserted=0);
end;
$$;

create or replace function public.replace_votes(p_nomination_id uuid, p_candidate_ids uuid[], p_voter_hash text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_slay public.slays%rowtype;
  v_count integer;
  v_distinct integer;
begin
  if p_voter_hash is null or length(p_voter_hash)<32 or coalesce(array_length(p_candidate_ids,1),0)>5 then raise exception 'invalid_vote'; end if;
  select s.* into v_slay from public.slays s join public.nominations n on n.slay_id=s.id where n.id=p_nomination_id for update of s;
  if not found or v_slay.current_phase<>'voting' or (v_slay.phase_ends_at is not null and v_slay.phase_ends_at<=now()) then raise exception 'phase_closed'; end if;
  select count(distinct x),count(*) into v_distinct,v_count from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x;
  if v_distinct<>v_count then raise exception 'duplicate_candidates'; end if;
  if exists(select 1 from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x where not exists(select 1 from public.candidates c where c.id=x and c.nomination_id=p_nomination_id and c.is_top5)) then raise exception 'candidate_not_in_nomination'; end if;
  delete from public.votes where nomination_id=p_nomination_id and voter_hash=p_voter_hash;
  insert into public.votes(nomination_id,candidate_id,voter_hash) select p_nomination_id,x,p_voter_hash from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x;
  return jsonb_build_object('saved',v_count);
end;
$$;

create or replace function public.save_jury_score(p_nomination_id uuid, p_candidate_id uuid, p_juror_id text, p_score integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_slay public.slays%rowtype;
  v_row public.jury_scores%rowtype;
begin
  if p_juror_id is null or length(p_juror_id)>32 or p_score not between 0 and 10 then raise exception 'invalid_score'; end if;
  select s.* into v_slay from public.slays s join public.nominations n on n.slay_id=s.id where n.id=p_nomination_id for update of s;
  if not found or v_slay.current_phase<>'jury' or (v_slay.phase_ends_at is not null and v_slay.phase_ends_at<=now()) then raise exception 'phase_closed'; end if;
  if not exists(select 1 from public.candidates c where c.id=p_candidate_id and c.nomination_id=p_nomination_id and c.is_top5) then raise exception 'candidate_not_in_top5'; end if;
  insert into public.jury_scores(nomination_id,candidate_id,juror_telegram_id,score) values(p_nomination_id,p_candidate_id,p_juror_id,p_score)
  on conflict(nomination_id,candidate_id,juror_telegram_id) do update set score=excluded.score,updated_at=now()
  returning * into v_row;
  return jsonb_build_object('saved',true,'score',v_row.score);
end;
$$;

create or replace function public.set_nomination_top5(p_nomination_id uuid, p_candidate_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_slay public.slays%rowtype;
  v_count integer;
  v_distinct integer;
begin
  select s.* into v_slay from public.slays s join public.nominations n on n.slay_id=s.id where n.id=p_nomination_id for update of s;
  if not found or v_slay.current_phase<>'candidates' or (v_slay.phase_ends_at is not null and v_slay.phase_ends_at<=now()) then raise exception 'phase_closed'; end if;
  if exists(select 1 from public.nominations where id=p_nomination_id and locked_at is not null) then raise exception 'nomination_locked'; end if;
  select count(distinct x),count(*) into v_distinct,v_count from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x;
  if v_count>5 or v_count<>v_distinct then raise exception 'invalid_top5'; end if;
  if exists(select 1 from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x where not exists(select 1 from public.candidates c where c.id=x and c.nomination_id=p_nomination_id)) then raise exception 'candidate_not_in_nomination'; end if;
  update public.candidates set is_top5=false where nomination_id=p_nomination_id;
  update public.candidates set is_top5=true where nomination_id=p_nomination_id and id=any(coalesce(p_candidate_ids,'{}'::uuid[]));
  return jsonb_build_object('selected',v_count);
end;
$$;

create or replace function public.transition_slay_phase(p_slay_id uuid, p_actor_id text, p_next_phase text, p_duration_seconds integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_slay public.slays%rowtype;
  v_allowed text[] := array['preparation','candidates','voting','jury','awards'];
begin
  if p_next_phase<>all(v_allowed) or p_duration_seconds<0 or p_duration_seconds>2592000 then raise exception 'invalid_phase_or_duration'; end if;
  select * into v_slay from public.slays where id=p_slay_id for update;
  if not found then raise exception 'slay_not_found'; end if;
  update public.slays set current_phase=p_next_phase,phase_started_at=now(),phase_ends_at=case when p_duration_seconds=0 then null else now()+make_interval(secs=>p_duration_seconds) end where id=p_slay_id;
  if p_next_phase in ('voting','jury','awards') then update public.nominations set locked_at=coalesce(locked_at,now()) where slay_id=p_slay_id; end if;
  insert into public.admin_action_log(actor_telegram_id,action,details) values(p_actor_id,'phase_transition',jsonb_build_object('from',v_slay.current_phase,'to',p_next_phase,'duration_seconds',p_duration_seconds));
  return jsonb_build_object('phase',p_next_phase,'phase_started_at',now(),'phase_ends_at',case when p_duration_seconds=0 then null else now()+make_interval(secs=>p_duration_seconds) end);
end;
$$;

revoke all on function public.submit_candidate(uuid,text,text) from public,anon,authenticated;
revoke all on function public.replace_votes(uuid,uuid[],text) from public,anon,authenticated;
revoke all on function public.save_jury_score(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.set_nomination_top5(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.transition_slay_phase(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.submit_candidate(uuid,text,text) to service_role;
grant execute on function public.replace_votes(uuid,uuid[],text) to service_role;
grant execute on function public.save_jury_score(uuid,uuid,text,integer) to service_role;
grant execute on function public.set_nomination_top5(uuid,uuid[]) to service_role;
grant execute on function public.transition_slay_phase(uuid,text,text,integer) to service_role;

do $$
declare v_slay_id uuid;
begin
  select id into v_slay_id from public.slays where title='MUSIC SLAY 2026' order by created_at desc limit 1;
  if v_slay_id is null then insert into public.slays(title) values('MUSIC SLAY 2026') returning id into v_slay_id; end if;
  insert into public.nominations(slay_id,name,position) values
    (v_slay_id,'Артист года',1),(v_slay_id,'Песня года',2),(v_slay_id,'Открытие года',3),(v_slay_id,'Альбом года',4)
  on conflict(slay_id,name) do nothing;
  insert into public.candidates(nomination_id,display_name,normalized_name,is_top5)
  select n.id,v.display_name,lower(v.display_name),true
  from public.nominations n
  join (values
    ('Артист года','Артист1'),('Артист года','Артист2'),('Артист года','Артист3'),('Артист года','Артист4'),('Артист года','Артист5'),
    ('Песня года','Артист1 — Название трека1'),('Песня года','Артист2 — Название трека2'),('Песня года','Артист3 — Название трека3'),('Песня года','Артист4 — Название трека4'),('Песня года','Артист5 — Название трека5'),
    ('Открытие года','Исполнитель1'),('Открытие года','Исполнитель2'),('Открытие года','Исполнитель3'),('Открытие года','Исполнитель4'),('Открытие года','Исполнитель5'),
    ('Альбом года','Артист1 — Название альбома1'),('Альбом года','Артист2 — Название альбома2'),('Альбом года','Артист3 — Название альбома3'),('Альбом года','Артист4 — Название альбома4'),('Альбом года','Артист5 — Название альбома5')
  ) as v(nomination_name,display_name) on v.nomination_name=n.name
  where n.slay_id=v_slay_id
  on conflict(nomination_id,normalized_name) do nothing;
end;
$$;
