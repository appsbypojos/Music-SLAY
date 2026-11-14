-- Сброс текущего цикла премии: очищает связанные голоса, оценки, заявки,
-- игровые результаты и кандидатов; разблокирует номинации и возвращает этап к preparation.
-- Вызывается только серверным Worker через service_role после подтверждения администратора.
-- Не запускайте вручную в production без резервной копии и проверки целевого slay_id.
create or replace function public.ms_admin_restart_slay(
  p_slay_id uuid,
  p_actor_telegram_id text
)
returns public.slays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slay public.slays;
begin
  if nullif(trim(coalesce(p_actor_telegram_id, '')), '') is null then
    raise exception 'invalid_actor';
  end if;

  delete from public.votes
  where nomination_id in (select id from public.nominations where slay_id = p_slay_id);

  delete from public.jury_scores
  where nomination_id in (select id from public.nominations where slay_id = p_slay_id);

  delete from public.submissions
  where nomination_id in (select id from public.nominations where slay_id = p_slay_id);

  delete from public.jury_waiting_game_scores
  where slay_id = p_slay_id;

  delete from public.candidates
  where nomination_id in (select id from public.nominations where slay_id = p_slay_id);

  update public.nominations
  set locked_at = null
  where slay_id = p_slay_id;

  update public.slays
  set current_phase = 'preparation',
      phase_started_at = now(),
      phase_ends_at = null
  where id = p_slay_id
  returning * into v_slay;

  if not found then
    raise exception 'slay_not_found';
  end if;

  insert into public.admin_action_log(actor_telegram_id, action, details)
  values (
    p_actor_telegram_id,
    'restart_slay',
    jsonb_build_object('slay_id', p_slay_id)
  );

  return v_slay;
end;
$$;

revoke all on function public.ms_admin_restart_slay(uuid, text) from public;
revoke all on function public.ms_admin_restart_slay(uuid, text) from anon;
revoke all on function public.ms_admin_restart_slay(uuid, text) from authenticated;
grant execute on function public.ms_admin_restart_slay(uuid, text) to service_role;
