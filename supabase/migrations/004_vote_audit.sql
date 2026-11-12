-- Store the Telegram identity alongside each vote so admins can audit who voted for whom.
alter table public.votes add column if not exists voter_telegram_id text;

create index if not exists votes_nomination_created_idx
  on public.votes(nomination_id, created_at desc);

create or replace function public.ms_save_votes(
  p_nomination_id uuid,
  p_voter_hash text,
  p_candidate_ids uuid[],
  p_voter_telegram_id text default null
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
  insert into votes(nomination_id,candidate_id,voter_hash,voter_telegram_id)
    select p_nomination_id,x,p_voter_hash,p_voter_telegram_id
    from unnest(coalesce(p_candidate_ids,'{}'::uuid[])) x
    on conflict(nomination_id,candidate_id,voter_hash) do update
      set voter_telegram_id = coalesce(excluded.voter_telegram_id, votes.voter_telegram_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
