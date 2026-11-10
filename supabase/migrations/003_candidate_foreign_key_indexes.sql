-- Cover candidate_id foreign keys for vote, submission, and jury-score lookups.
create index if not exists jury_scores_candidate_id_idx on public.jury_scores(candidate_id);
create index if not exists submissions_candidate_id_idx on public.submissions(candidate_id);
create index if not exists votes_candidate_id_idx on public.votes(candidate_id);
