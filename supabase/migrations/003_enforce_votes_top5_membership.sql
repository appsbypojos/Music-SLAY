-- Enforce the approved top-five list at the database boundary for participant votes.
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
