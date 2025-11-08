-- =====================================
-- CALDA CHALLENGE DATABASE SETUP
-- =====================================

-- ======================
-- 1. USERS TABLE
-- ======================
create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null unique,
    email text,
    full_name text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ======================
-- 2. ITEMS TABLE
-- ======================
create table if not exists items (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text,
    price numeric(10,2),
    stock int,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ======================
-- 3. ORDERS TABLE
-- ======================
create table if not exists orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references users(id),
    recipient_name text,
    shipping_address text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ======================
-- 4. ORDER_ITEMS TABLE
-- ======================
create table if not exists order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid references orders(id),
    item_id uuid references items(id),
    quantity int,
    price_at_purchase numeric(10,2),
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- ======================
-- 5. ITEM_AUDIT TABLE
-- ======================
create table if not exists item_audit (
    id uuid primary key default gen_random_uuid(),
    item_id uuid,
    operation text,
    old_data jsonb,
    new_data jsonb,
    changed_at timestamptz default now()
);

-- ======================
-- 6. WEEKLY_ORDER_TOTALS TABLE
-- ======================
create table if not exists weekly_order_totals (
    id uuid primary key default gen_random_uuid(),
    week_start_date date,
    total numeric(10,2),
    created_at timestamptz default now()
);

-- ======================
-- 7. TRIGGERS
-- ======================
-- Trigger to update updated_at on update
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- Attach trigger to all tables that need updated_at
create trigger trg_users_updated_at
before update on users
for each row
execute function set_updated_at();

create trigger trg_items_updated_at
before update on items
for each row
execute function set_updated_at();

create trigger trg_orders_updated_at
before update on orders
for each row
execute function set_updated_at();

create trigger trg_order_items_updated_at
before update on order_items
for each row
execute function set_updated_at();

-- Trigger for item audit history
create or replace function audit_item_changes()
returns trigger as $$
begin
    if (TG_OP = 'UPDATE') then
        insert into item_audit(item_id, operation, old_data, new_data)
        values(OLD.id, TG_OP, to_jsonb(OLD), to_jsonb(NEW));
    elsif (TG_OP = 'INSERT') then
        insert into item_audit(item_id, operation, old_data, new_data)
        values(NEW.id, TG_OP, null, to_jsonb(NEW));
    elsif (TG_OP = 'DELETE') then
        insert into item_audit(item_id, operation, old_data, new_data)
        values(OLD.id, TG_OP, to_jsonb(OLD), null);
    end if;
    return NEW;
end;
$$ language plpgsql;

create trigger trg_items_audit
after insert or update or delete on items
for each row
execute function audit_item_changes();

-- ======================
-- 8. ORDER AGGREGATOR VIEW
-- ======================
create or replace view order_aggregator as
select
    o.id as order_id,
    o.user_id,
    o.recipient_name,
    o.shipping_address,
    o.created_at,
    o.updated_at,
    json_agg(json_build_object(
        'item_id', oi.item_id,
        'quantity', oi.quantity,
        'price_at_purchase', oi.price_at_purchase
    )) as order_items
from orders o
join order_items oi on o.id = oi.order_id
group by o.id;

-- ======================
-- 9. RLS POLICIES
-- ======================
-- Enable RLS
alter table users enable row level security;
alter table items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table item_audit enable row level security;

-- Users can select/update their own info
create policy "Users can manage self" on users
for all
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

-- Items: allow CRUD for authenticated users
create policy "Authenticated users can CRUD items" on items
for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

-- Orders: only owner can see/update
create policy "Users can manage their orders" on orders
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Order_items: only visible through order ownership
create policy "Users can manage order items" on order_items
for all
using (exists(select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid()))
with check (exists(select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid()));

-- Example: only allow SELECT for authenticated users
CREATE POLICY "Select own audit records" 
ON item_audit
FOR SELECT
USING (true);

-- Prevent manual INSERT/UPDATE/DELETE
CREATE POLICY "Prevent manual modification" 
ON item_audit
FOR ALL
USING (false)
WITH CHECK (false);

