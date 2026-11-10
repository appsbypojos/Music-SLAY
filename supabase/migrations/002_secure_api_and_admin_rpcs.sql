-- Server-only RPCs for MUSIC SLAY 2026.
-- These functions are callable only by service_role. Keep SUPABASE_SERVICE_ROLE_KEY
-- in the Cloudflare Worker secret store; never expose it to the browser.

create or replace function public.ms_submit_candidates(
  p_nomination_id uuid,
  p_submitter_hash text,
  p_names text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_ends timestamptz;
  v_name text;
  v_norm text;
  v_candidate_id uuid;
  v_inserted integer;
  v_results jsonb := '[]'::jsonb;
begin
  if p_submitter_hash is null or length(p_submitter_hash) < 32 then
    raise exception 'invalid_submitter';
  end if;
  select s.current_phase, s.phase_ends_at into v_phase, v_ends
    from nominations n join slays s on s.id=n.slay_id
    where n.id=p_nomination_id and n.locked_at is null;
  if not found or v_phase <> 'candidates' or (v_ends is not null and v_ends <= now()) then
    raise exception 'phase_closed';
  end if;
  if coalesce(array_length(p_names,1),0) < 1 or array_length(p_names,1) > 20 then
    raise exception 'invalid_names';
  end if;
  foreach v_name in array p_names loop
    v_name := regexp_replace(trim(v_name), '[[:space:]]+', ' ', 'g');
    if length(v_name) < 2 or length(v_name) > 160 then continue; end if;
    v_norm := lower(v_name);
    insert into candidates(nomination_id,display_name,normalized_name)
      values(p_nomination_id,v_name,v_norm)
      on conflict(nomination_id,normalized_name) do nothing
      returning id into v_candidate_id;
    if v_candidate_id is null then
      select id into v_candidate_id from candidates
        where nomination_id=p_nomination_id and normalized_name=v_norm;
    end if;
    insert into submissions(nomination_id,candidate_id,submitter_hash)
      values(p_nomination_id,v_candidate_id,p_submitter_hash)
      on conflict(nomination_id,candidate_id,submitter_hash) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      update candidates set suggestion_count=suggestion_count+1 where id=v_candidate_id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'candidate_id',v_candidate_id,'display_name',v_name,'accepted',true
      ));
    else
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'candidate_id',v_candidate_id,'display_name',v_name,'accepted',false
      ));
    end if;
    v_candidate_id := null;
  end loop;
  return v_results;
end;
$$;

create or replace function public.ms_save_votes(
  p_nomination_id uuid,
  p_voter_hash text,
  p_candidate_ids uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_ends timestamptz;
  v_count integer;
begin
  select s.current_phase, s.phase_ends_at into v_phase, v_ends
    from nominations n join slays s on s.id=n.slay_id where n.id=p_nomination_id;
  if not found or v_phase <> 'voting' or (v_ends is not null and v_ends <= now()) then
    raise exception 'phase_closed';
  end if;
  if p_voter_hash is null or length(p_voter_hash) < 32 then raise exception 'invalid_voter'; end if;
  if coalesce(array_length(p_candidate_ids,1),0) > 5 then raise exception 'too_many_votes'; end if;
  if exists (
    select 1 from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x
    left join candidates c on c.id=x and c.nomination_id=p_nomination_id and c.is_top5
    where c.id is null
  ) then raise exception 'invalid_candidate'; end if;
  delete from votes where nomination_id=p_nomination_id and voter_hash=p_voter_hash;
  insert into votes(nomination_id,candidate_id,voter_hash)
    select p_nomination_id,x,p_voter_hash
    from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x
    on conflict(nomination_id,candidate_id,voter_hash) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.ms_save_jury_score(
  p_nomination_id uuid,
  p_candidate_id uuid,
  p_juror_telegram_id text,
  p_score integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_ends timestamptz;
begin
  select s.current_phase, s.phase_ends_at into v_phase, v_ends
    from nominations n join slays s on s.id=n.slay_id where n.id=p_nomination_id;
  if not found or v_phase <> 'jury' or (v_ends is not null and v_ends <= now()) then
    raise exception 'phase_closed';
  end if;
  if p_score < 0 or p_score > 10 or p_juror_telegram_id is null then raise exception 'invalid_score'; end if;
  if not exists(select 1 from candidates where id=p_candidate_id and nomination_id=p_nomination_id and is_top5) then
    raise exception 'invalid_candidate';
  end if;
  insert into jury_scores(nomination_id,candidate_id,juror_telegram_id,score,updated_at)
    values(p_nomination_id,p_candidate_id,p_juror_telegram_id,p_score,now())
    on conflict(nomination_id,candidate_id,juror_telegram_id)
    do update set score=excluded.score,updated_at=now();
end;
$$;

create or replace function public.ms_admin_set_top5(
  p_nomination_id uuid,
  p_candidate_ids uuid[],
  p_actor_telegram_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_phase text;
begin
  select s.current_phase into v_phase
    from nominations n join slays s on s.id=n.slay_id
    where n.id=p_nomination_id and n.locked_at is null;
  if not found or v_phase <> 'candidates' then raise exception 'phase_closed'; end if;
  if p_actor_telegram_id is null or coalesce(array_length(p_candidate_ids,1),0) <> 5 then
    raise exception 'invalid_top5';
  end if;
  if (select count(distinct x) from unnest(p_candidate_ids) x) <> 5 then
    raise exception 'duplicate_candidate';
  end if;
  select count(*) into v_count from candidates
    where nomination_id=p_nomination_id and id=any(p_candidate_ids);
  if v_count <> 5 then raise exception 'invalid_candidate'; end if;
  update candidates set is_top5=(id=any(p_candidate_ids)) where nomination_id=p_nomination_id;
  insert into admin_action_log(actor_telegram_id,action,details)
    values(p_actor_telegram_id,'set_top5',jsonb_build_object('nomination_id',p_nomination_id,'candidate_ids',p_candidate_ids));
  return v_count;
end;
$$;

create or replace function public.ms_admin_set_phase(
  p_slay_id uuid,
  p_next_phase text,
  p_duration_seconds integer,
  p_actor_telegram_id text
) returns public.slays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slay public.slays;
  v_expected text;
  v_now timestamptz := now();
begin
  select * into v_slay from slays where id=p_slay_id for update;
  if not found then raise exception 'slay_not_found'; end if;
  v_expected := case v_slay.current_phase
    when 'preparation' then 'candidates'
    when 'candidates' then 'voting'
    when 'voting' then 'jury'
    when 'jury' then 'awards'
    else null end;
  if v_expected is null or p_next_phase <> v_expected then raise exception 'invalid_phase_transition'; end if;
  if p_duration_seconds is not null and (p_duration_seconds < 60 or p_duration_seconds > 2592000) then
    raise exception 'invalid_duration';
  end if;
  if p_next_phase='voting' and exists (
    select 1 from nominations n where n.slay_id=p_slay_id
      and (select count(*) from candidates c where c.nomination_id=n.id and c.is_top5) <> 5
  ) then raise exception 'top5_required'; end if;
  update slays set current_phase=p_next_phase,phase_started_at=v_now,
    phase_ends_at=case when p_duration_seconds is null then null else v_now+make_interval(secs=>p_duration_seconds) end
    where id=p_slay_id returning * into v_slay;
  if p_next_phase='voting' then
    update nominations set locked_at=v_now where slay_id=p_slay_id and locked_at is null;
  end if;
  insert into admin_action_log(actor_telegram_id,action,details)
    values(p_actor_telegram_id,'advance_phase',jsonb_build_object(
      'from',case p_next_phase when 'candidates' then 'preparation' when 'voting' then 'candidates' when 'jury' then 'voting' else 'jury' end,
      'to',p_next_phase,'duration_seconds',p_duration_seconds
    ));
  return v_slay;
end;
$$;

revoke all on function public.ms_submit_candidates(uuid,text,text[]) from public,anon,authenticated;
revoke all on function public.ms_save_votes(uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function public.ms_save_jury_score(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.ms_admin_set_top5(uuid,uuid[],text) from public,anon,authenticated;
revoke all on function public.ms_admin_set_phase(uuid,text,integer,text) from public,anon,authenticated;

grant execute on function public.ms_submit_candidates(uuid,text,text[]) to service_role;
grant execute on function public.ms_save_votes(uuid,text,uuid[]) to service_role;
grant execute on function public.ms_save_jury_score(uuid,uuid,text,integer) to service_role;
grant execute on function public.ms_admin_set_top5(uuid,uuid[],text) to service_role;
grant execute on function public.ms_admin_set_phase(uuid,text,integer,text) to service_role;
