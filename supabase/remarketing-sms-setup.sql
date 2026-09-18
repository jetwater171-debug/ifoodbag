-- Execute apenas no projeto Supabase que atende a producao, depois de confirmar
-- que SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel apontam para este projeto.
-- Nao altera leads nem configuracoes existentes; cria a fila somente se faltar.
create table if not exists public.event_dispatch_queue (
  id bigserial primary key,
  channel text not null,
  event_name text,
  kind text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'pending',
  attempts int not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_event_dispatch_queue_dedupe
  on public.event_dispatch_queue (dedupe_key);
create index if not exists idx_event_dispatch_queue_pending
  on public.event_dispatch_queue (status, scheduled_at);

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'ifoodbag-dispatch-every-minute') then
    perform cron.schedule(
      'ifoodbag-dispatch-every-minute',
      '* * * * *',
      $job$
        select net.http_get(
          url := 'https://ifoodparceiros.vercel.app/api/jobs/dispatch?limit=120',
          headers := jsonb_build_object('Accept', 'application/json', 'x-vercel-cron', '1'),
          timeout_milliseconds := 15000
        );
      $job$
    );
  end if;
end
$$;

-- Confirmacao somente leitura: o agendador deve apontar para o dominio publicado.
select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'ifoodbag-dispatch-every-minute';
