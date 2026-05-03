-- =================================================================
--  Fidelavis — Schéma Supabase v1.0
--  Migration progressive depuis Google Sheets / localStorage / JSON
--  À exécuter dans : Supabase Dashboard > SQL Editor
-- =================================================================

-- ───────────────────────────────────────────────────
-- EXTENSION : UUID v4
-- ───────────────────────────────────────────────────
create extension if not exists "uuid-ossp";


-- ═══════════════════════════════════════════════════
-- TABLE : restaurants
-- Remplace : {resto}/config.json + data/restaurants.json
-- ═══════════════════════════════════════════════════
create table public.restaurants (
  id                    uuid primary key default uuid_generate_v4(),
  slug                  text not null unique,          -- "le-martin"
  name                  text not null,                 -- "Le Martin"
  color                 text default '#B8924F',
  color2                text default '#9E7A3E',
  phone                 text,
  address               text,
  google_review_url     text,
  reservation_url       text,
  logo_url              text,
  icon_url              text,

  -- Offre du jour
  offre_active          boolean default false,
  offre_titre           text,
  offre_description     text,
  offre_image           text,
  offre_date_fin        date,

  -- Abonnement
  plan                  text default 'essentiel',      -- 'essentiel' | 'pro'
  subscription_status   text default 'trialing',       -- 'trialing' | 'active' | 'past_due' | 'canceled'
  setup_paid            boolean default false,
  trial_end_date        date,
  billing_email         text,
  next_billing_date     date,

  -- Stripe (stocké côté serveur, jamais dans config.json public)
  stripe_customer_id    text,
  stripe_subscription_id text,

  -- Brevo email marketing
  brevo_list_id         integer,
  brevo_gas_url         text,

  -- Ambassadeur
  ambassador_code       text,

  -- Google Business Profile
  google_location_id    text,
  google_client_id      text,

  -- Factures (historique JSON)
  invoices              jsonb default '[]',

  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

comment on table public.restaurants is 'Configuration et abonnement de chaque restaurant client';


-- ═══════════════════════════════════════════════════
-- TABLE : clients
-- Remplace : Google Sheets Brevo + localStorage fv_registered_*
-- ═══════════════════════════════════════════════════
create table public.clients (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  email           text not null,
  first_name      text,
  device_id       text,                -- device_id généré côté client
  src             text,                -- 'nfc' | 'qr' | 'brevo_form' | ...
  user_agent      text,
  brevo_contact_id text,               -- ID Brevo si synchronisé
  registered_at   timestamptz default now(),
  last_seen_at    timestamptz,

  -- Un email est unique par restaurant
  unique(restaurant_id, email)
);

comment on table public.clients is 'Clients inscrits via scan NFC/QR pour chaque restaurant';

create index idx_clients_restaurant on public.clients(restaurant_id);
create index idx_clients_email on public.clients(email);
create index idx_clients_device on public.clients(device_id);


-- ═══════════════════════════════════════════════════
-- TABLE : events
-- Remplace : Google Sheets "events" (via GAS stats)
-- ═══════════════════════════════════════════════════
create table public.events (
  id              bigint generated always as identity primary key,
  restaurant_id   uuid references public.restaurants(id) on delete set null,
  client_id       uuid references public.clients(id) on delete set null,
  event_type      text not null,       -- 'scan' | 'signup' | 'install_confirmed' | 'coupon_validate' | 'review' | ...
  device_id       text,
  session_id      text,
  src             text,
  demo            boolean default false,
  jour            date,
  mois            smallint,
  annee           smallint,
  page_url        text,
  user_agent      text,
  created_at      timestamptz default now()
);

comment on table public.events is 'Journal de tous les événements tracking (scans, inscriptions, installations PWA, coupons, avis)';

create index idx_events_restaurant on public.events(restaurant_id);
create index idx_events_type on public.events(event_type);
create index idx_events_jour on public.events(jour);
create index idx_events_restaurant_type on public.events(restaurant_id, event_type);


-- ═══════════════════════════════════════════════════
-- TABLE : coupons
-- Remplace : localStorage "coupon_SLUG_YEAR_MONTH"
-- ═══════════════════════════════════════════════════
create table public.coupons (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  device_id       text,                -- fallback si pas de client_id
  month_key       text not null,       -- "2026-05" (YYYY-MM)
  status          text default 'available', -- 'available' | 'used'
  created_at      timestamptz default now(),
  used_at         timestamptz,

  -- Un coupon par appareil/client par mois par restaurant
  unique(restaurant_id, device_id, month_key)
);

comment on table public.coupons is 'Coupons mensuels — un par client/appareil par mois';

create index idx_coupons_restaurant on public.coupons(restaurant_id);
create index idx_coupons_device on public.coupons(device_id);


-- ═══════════════════════════════════════════════════
-- TABLE : validations
-- Remplace : validation PIN dans admin (localStorage uniquement)
-- ═══════════════════════════════════════════════════
create table public.validations (
  id              uuid primary key default uuid_generate_v4(),
  coupon_id       uuid not null references public.coupons(id) on delete cascade,
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  validated_by    text,                -- 'admin' | 'employe' (rôle du validateur)
  amount          numeric(8,2),        -- montant addition en euros (optionnel)
  notes           text,
  validated_at    timestamptz default now()
);

comment on table public.validations is 'Validations de coupons par les commerçants';

create index idx_validations_coupon on public.validations(coupon_id);
create index idx_validations_restaurant on public.validations(restaurant_id);


-- ═══════════════════════════════════════════════════
-- TABLE : ambassadeurs
-- Remplace : data/ambassadeurs.json (fichier PUBLIC ⚠️)
-- ═══════════════════════════════════════════════════
create table public.ambassadeurs (
  id                    uuid primary key default uuid_generate_v4(),
  legacy_id             text unique,              -- ancien "amb_modifbiy"
  code                  text not null unique,     -- "AMB-JEN-MAR-001"
  prenom                text not null,
  nom                   text not null,
  email                 text not null,
  telephone             text,
  ville                 text,
  statut                text default 'actif',     -- 'actif' | 'inactif' | 'suspendu'
  max_restaurants_test  integer default 5,
  notes                 text,

  -- Token hashé (SHA-256 ou bcrypt) — JAMAIS stocker en clair
  token_hash            text,

  -- Stats commission
  commission_taux       numeric(5,2) default 10.00,  -- % en centimes
  commission_totale     numeric(10,2) default 0,

  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

comment on table public.ambassadeurs is 'Ambassadeurs commerciaux — tokens hashés, jamais en clair';

create index idx_ambassadeurs_code on public.ambassadeurs(code);
create index idx_ambassadeurs_email on public.ambassadeurs(email);


-- ═══════════════════════════════════════════════════
-- TABLE : subscriptions
-- Complète restaurants avec historique Stripe
-- ═══════════════════════════════════════════════════
create table public.subscriptions (
  id                      uuid primary key default uuid_generate_v4(),
  restaurant_id           uuid not null references public.restaurants(id) on delete cascade,
  stripe_subscription_id  text unique,
  stripe_customer_id      text,
  plan                    text not null,         -- 'essentiel' | 'pro'
  status                  text not null,         -- 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
  trial_end_date          timestamptz,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  amount                  integer,               -- en centimes (ex: 4900 = 49€)
  currency                text default 'eur',
  canceled_at             timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

comment on table public.subscriptions is 'Historique des abonnements Stripe';

create index idx_subscriptions_restaurant on public.subscriptions(restaurant_id);
create index idx_subscriptions_stripe on public.subscriptions(stripe_subscription_id);


-- ═══════════════════════════════════════════════════
-- TABLE : reviews
-- Nouveau : avis Google stockés en BDD (remplace localStorage fv_reviews)
-- ═══════════════════════════════════════════════════
create table public.reviews (
  id                  uuid primary key default uuid_generate_v4(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  google_review_id    text unique,             -- ID Google natif
  author_name         text,
  author_photo_url    text,
  rating              smallint check (rating between 1 and 5),
  text                text,
  published_at        timestamptz,
  status              text default 'pending',  -- 'pending' | 'replied' | 'ignored'
  reply_text          text,
  reply_sent_at       timestamptz,
  reply_draft         text,                    -- brouillon IA
  synced_at           timestamptz default now(),
  created_at          timestamptz default now()
);

comment on table public.reviews is 'Avis Google Business Profile synchronisés';

create index idx_reviews_restaurant on public.reviews(restaurant_id);
create index idx_reviews_status on public.reviews(status);


-- ═══════════════════════════════════════════════════
-- TABLE : admins
-- Remplace : mots de passe en clair dans login.html
-- ═══════════════════════════════════════════════════
create table public.admins (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid references public.restaurants(id) on delete cascade,
  role            text not null,         -- 'admin' | 'employe' | 'superadmin'
  username        text not null,
  password_hash   text not null,         -- bcrypt via Supabase Auth ou Edge Function
  is_active       boolean default true,
  last_login_at   timestamptz,
  created_at      timestamptz default now(),

  unique(restaurant_id, username)
);

comment on table public.admins is 'Comptes admin par restaurant — mots de passe hashés';


-- ═══════════════════════════════════════════════════
-- TABLE : scans
-- Enrichit events avec contexte NFC/QR spécifique
-- ═══════════════════════════════════════════════════
create table public.scans (
  id              bigint generated always as identity primary key,
  restaurant_id   uuid references public.restaurants(id) on delete set null,
  device_id       text,
  session_id      text,
  src             text,                  -- 'nfc' | 'qr'
  user_agent      text,
  scanned_at      timestamptz default now()
);

create index idx_scans_restaurant on public.scans(restaurant_id);
create index idx_scans_date on public.scans(scanned_at);


-- =================================================================
-- ROW LEVEL SECURITY (RLS)
-- Principe : chaque restaurant ne voit que ses données
-- =================================================================

-- Activer RLS sur toutes les tables sensibles
alter table public.restaurants    enable row level security;
alter table public.clients        enable row level security;
alter table public.events         enable row level security;
alter table public.coupons        enable row level security;
alter table public.validations    enable row level security;
alter table public.ambassadeurs   enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.reviews        enable row level security;
alter table public.admins         enable row level security;
alter table public.scans          enable row level security;


-- ─── Politiques : Accès public en lecture pour config restaurant ──
-- (remplace config.json — données non-sensibles uniquement)
create policy "restaurants_public_read"
  on public.restaurants for select
  using (true);   -- tout le monde peut lire le nom, couleur, plan

-- ─── Politiques : Service Role bypass (backend uniquement) ────────
-- Note : service_role bypasse RLS automatiquement.
-- Toutes les écritures depuis le backend (Edge Functions) utilisent service_role.
-- Le frontend n'utilise QUE la clé anon avec RLS.


-- ─── Politiques : Insertion publique (tracking events côté client) ─
create policy "events_public_insert"
  on public.events for insert
  with check (true);   -- le client peut envoyer des events

create policy "scans_public_insert"
  on public.scans for insert
  with check (true);

-- ─── Politiques : Lecture events — service_role uniquement ────────
-- (pas de politique select → bloque tout accès anon en lecture)

-- ─── Politiques : Coupons — lecture par device_id ─────────────────
create policy "coupons_read_by_device"
  on public.coupons for select
  using (device_id = current_setting('request.jwt.claims', true)::json->>'device_id'
         OR auth.role() = 'service_role');

-- ─── Politiques : Clients — insertion publique ────────────────────
create policy "clients_public_insert"
  on public.clients for insert
  with check (true);


-- =================================================================
-- FONCTIONS UTILITAIRES
-- =================================================================

-- Mise à jour automatique de updated_at
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.update_updated_at();

create trigger ambassadeurs_updated_at
  before update on public.ambassadeurs
  for each row execute function public.update_updated_at();

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.update_updated_at();


-- =================================================================
-- DONNÉES INITIALES : migration depuis data/restaurants.json
-- =================================================================

-- À compléter avec les vraies valeurs lors de la migration Phase 2
insert into public.restaurants (slug, name, color, color2, plan, subscription_status)
values
  ('le-martin',              'Le Martin',              '#b8924f', '#9c7c43', 'pro',      'trialing'),
  ('les-jardins-de-voltaire','Les Jardins de Voltaire','#B8924F', '#9E7A3E', 'essentiel','trialing'),
  ('axouvukupeh',            'Axouvukupeh',            '#B8924F', '#9E7A3E', 'essentiel','trialing')
on conflict (slug) do nothing;


-- =================================================================
-- DONNÉES INITIALES : migration depuis data/ambassadeurs.json
-- ATTENTION : les tokens sont à re-générer + hasher
-- Les tokens actuels en clair dans ambassadeurs.json doivent être
-- invalidés après cette migration.
-- =================================================================

insert into public.ambassadeurs (legacy_id, code, prenom, nom, email, telephone, ville, statut, max_restaurants_test)
values
  ('amb_modifbiy', 'AMB-JEN-MAR-001', 'Jen',  'Martin',  'axou.v@aliceadsl.fr',    '013445556666', 'Paris12',             'actif', 5),
  ('amb_modjew9q', 'AMB-GOGO-OUR-002','Gogo', 'Ours',    'axou.v@aliceadsl.fr',    '0233344454',   'Paris10',             'actif', 5),
  ('amb_mog4b3lt', 'AMB-DANY-DRU-003','Dany', 'Drumonde','danydrumonde@gmail.com', '0661613240',   'La Garenne Colombes', 'actif', 5)
on conflict (code) do nothing;
