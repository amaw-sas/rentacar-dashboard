create table public.category_models (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.vehicle_categories(id) on delete cascade,
  name text not null,
  description text not null default '',
  image_url text not null default '',
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.category_models enable row level security;

create policy "Authenticated users can read category_models"
  on public.category_models for select to authenticated using (true);

create policy "Admins can insert category_models"
  on public.category_models for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Admins can update category_models"
  on public.category_models for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create trigger on_category_models_updated
  before update on public.category_models
  for each row execute function public.handle_updated_at();
