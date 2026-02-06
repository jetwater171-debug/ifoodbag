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
  source_url text,
  user_agent text,
  client_ip text,
  payload jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_updated_at on public.leads (updated_at desc);
create index if not exists idx_leads_last_event on public.leads (last_event);
create index if not exists idx_leads_cpf on public.leads (cpf);

create or replace view public.leads_readable as
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
  updated_at,
  created_at
from public.leads
order by updated_at desc;
