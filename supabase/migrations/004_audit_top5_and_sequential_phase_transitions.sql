-- Audit top-five changes and require strictly sequential phase transitions.
drop function if exists public.set_nomination_top5(uuid,uuid[]);
create function public.set_nomination_top5(p_nomination_id uuid, p_candidate_ids uuid[], p_actor_id text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_slay public.slays%rowtype; v_count integer; v_distinct integer;
begin
  select s.* into v_slay from public.slays s join public.nominations n on n.slay_id=s.id where n.id=p_nomination_id for update of s;
  if not found or v_slay.current_phase<>'candidates' or (v_slay.phase_ends_at is not null and v_slay.phase_ends_at<=now()) then raise exception 'phase_closed'; end if;
  if exists(select 1 from public.nominations where id=p_nomination_id and locked_at is not null) then raise exception 'nomination_locked'; end if;
  select count(distinct x),count(*) into v_distinct,v_count from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x;
  if v_count>5 or v_count<>v_distinct then raise exception 'invalid_top5'; end if;
  if exists(select 1 from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x where not exists(select 1 from public.candidates c where c.id=x and c.nomination_id=p_nomination_id)) then raise exception 'candidate_not_in_nomination'; end if;
  update public.candidates set is_top5=false where nomination_id=p_nomination_id;
  update public.candidates set is_top5=true where nomination_id=p_nomination_id and id=any(coalesce(p_candidate_ids,'{}'::uuid[]));
  insert into public.admin_action_log(actor_telegram_id,action,details) values(p_actor_id,'top5_updated',jsonb_build_object('nomination_id',p_nomination_id,'candidate_ids',coalesce(p_candidate_ids,'{}'::uuid[])));
  return jsonb_build_object('selected',v_count);
end;
$$;
revoke all on function public.set_nomination_top5(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.set_nomination_top5(uuid,uuid[],text) to service_role;

create or replace function public.transition_slay_phase(p_slay_id uuid, p_actor_id text, p_next_phase text, p_duration_seconds integer)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_slay public.slays%rowtype; v_allowed text[] := array['preparation','candidates','voting','jury','awards']; v_end timestamptz;
begin
  if p_next_phase is null or p_duration_seconds is null or p_duration_seconds<1 or p_duration_seconds>2592000 then raise exception 'invalid_phase_or_duration'; end if;
  select * into v_slay from public.slays where id=p_slay_id for update;
  if not found then raise exception 'slay_not_found'; end if;
  if array_position(v_allowed,p_next_phase) is null or array_position(v_allowed,p_next_phase) <> array_position(v_allowed,v_slay.current_phase)+1 then raise exception 'invalid_phase_transition'; end if;
  v_end := now()+make_interval(secs=>p_duration_seconds);
  update public.slays set current_phase=p_next_phase,phase_started_at=now(),phase_ends_at=v_end where id=p_slay_id;
  if p_next_phase in ('voting','jury','awards') then update public.nominations set locked_at=coalesce(locked_at,now()) where slay_id=p_slay_id; end if;
  insert into public.admin_action_log(actor_telegram_id,action,details) values(p_actor_id,'phase_transition',jsonb_build_object('from',v_slay.current_phase,'to',p_next_phase,'duration_seconds',p_duration_seconds));
  return jsonb_build_object('phase',p_next_phase,'phase_started_at',now(),'phase_ends_at',v_end);
end;
$$;
