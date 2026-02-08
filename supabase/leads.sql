create table if not exists public.leads (
  session_id text primary key,
  stage text,
  last_event text,
  name text,
  cpf text,
  email text,
  phone text,
  cep text,
  address_line text,
  number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  reference text,
  shipping_id text,
  shipping_name text,
  shipping_price numeric,
  bump_selected boolean,
  bump_price numeric,
  pix_txid text,
  pix_amount numeric,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  fbclid text,
  ttclid text,
  referrer text,
  landing_page text,
  source_url text,
  user_agent text,
  client_ip text,
  payload jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.leads add column if not exists utm_source text;
alter table public.leads add column if not exists utm_medium text;
alter table public.leads add column if not exists utm_campaign text;
alter table public.leads add column if not exists utm_term text;
alter table public.leads add column if not exists utm_content text;
alter table public.leads add column if not exists gclid text;
alter table public.leads add column if not exists fbclid text;
alter table public.leads add column if not exists ttclid text;
alter table public.leads add column if not exists referrer text;
alter table public.leads add column if not exists landing_page text;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_updated_at on public.leads (updated_at desc);
create index if not exists idx_leads_last_event on public.leads (last_event);
create index if not exists idx_leads_cpf on public.leads (cpf);
create index if not exists idx_leads_email on public.leads (email);
create index if not exists idx_leads_phone on public.leads (phone);

drop view if exists public.leads_readable;
create view public.leads_readable as
select
  session_id,
  coalesce(name, '-') as nome,
  coalesce(cpf, '-') as cpf,
  coalesce(email, '-') as email,
  coalesce(phone, '-') as telefone,
  coalesce(stage, '-') as etapa,
  coalesce(last_event, '-') as evento,
  coalesce(cep, '-') as cep,
  trim(concat_ws(', ', address_line, number, neighborhood, city, state)) as endereco,
  coalesce(shipping_name, '-') as frete,
  shipping_price as valor_frete,
  case when bump_selected then 'sim' else 'nao' end as seguro_bag,
  bump_price as valor_seguro,
  coalesce(pix_txid, '-') as pix_txid,
  pix_amount as valor_total,
  coalesce(utm_source, '-') as utm_source,
  coalesce(utm_campaign, '-') as utm_campaign,
  coalesce(fbclid, '-') as fbclid,
  coalesce(gclid, '-') as gclid,
  case
    when pix_txid is not null then 'pix_gerado'
    when shipping_id is not null then 'frete_selecionado'
    when cep is not null then 'cep_confirmado'
    when email is not null or phone is not null then 'dados_pessoais'
    else 'inicio'
  end as status_funil,
  updated_at,
  created_at
from public.leads
order by updated_at desc;
