-- Execute somente no projeto imfauyhhjbwlcpvkpmsz, depois que o novo deploy
-- estiver publicado. Este script NAO envia SMS antigos retroativamente.
do $$
begin
  if to_regclass('public.leads') is null
     or to_regclass('public.event_dispatch_queue') is null
     or not exists (
       select 1 from public.app_settings
       where key = 'admin_config'
         and value->'smsmais'->>'enabled' = 'true'
         and nullif(value->'smsmais'->>'token', '') is not null
     ) then
    raise exception 'Base ou SMSMais nao estao preparados. Nada foi ativado.';
  end if;
end
$$;

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
          url := 'https://ifoodparceiros.vercel.app/api/jobs/dispatch?limit=12',
          headers := jsonb_build_object('Accept', 'application/json', 'x-vercel-cron', '1'),
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
end
$$;

-- A janela comeca agora: pagamentos anteriores nao entram no backfill.
update public.app_settings
set value = jsonb_set(
    jsonb_set(value, '{smsmais,remarketingEnabled}', 'true'::jsonb, true),
    '{smsmais,remarketingActivatedAt}', to_jsonb(now()::text), true
  ),
  updated_at = now()
where key = 'admin_config';

select j.jobid, j.jobname, j.schedule, j.active,
       s.value->'smsmais'->>'remarketingEnabled' as auto_enabled,
       s.value->'smsmais'->>'remarketingActivatedAt' as activated_at
from cron.job j
cross join public.app_settings s
where j.jobname = 'ifoodbag-dispatch-every-minute'
  and s.key = 'admin_config';
