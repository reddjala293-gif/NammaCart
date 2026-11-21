-- ==============================================================================
-- Migration: 001_init_retail_schema.sql
-- Target: Aiven PostgreSQL (High-Concurrency Mini-Warehouse Omnichannel Retail)
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create Enums
DO $$ BEGIN
    CREATE TYPE item_status AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD', 'DAMAGED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM ('PENDING', 'CONFIRMED', 'FULFILLMENT_PENDING', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE fulfillment_type AS ENUM ('IN_STORE_PICKUP', 'SHIP_FROM_STORE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE outbox_status AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 3. Table: stores (Physical Mini-Warehouses)
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    address VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 6) NOT NULL,
    longitude DECIMAL(10, 6) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Table: products (Catalog Definitions)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Table: unique_items (Core of "Never Sell Twice" Invariant)
CREATE TABLE IF NOT EXISTS unique_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
    serial_number VARCHAR(120) NOT NULL UNIQUE,
    status item_status NOT NULL DEFAULT 'AVAILABLE',
    reserved_by_user_id VARCHAR(100),
    reserved_at TIMESTAMPTZ,
    reservation_expires_at TIMESTAMPTZ,
    order_id UUID,
    sold_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- High-Concurrency Query Indexes for SELECT ... FOR UPDATE
CREATE INDEX IF NOT EXISTS idx_unique_items_prod_store_status 
    ON unique_items (product_id, store_id, status);

CREATE INDEX IF NOT EXISTS idx_unique_items_status_expires 
    ON unique_items (status, reservation_expires_at) 
    WHERE status = 'RESERVED';

CREATE INDEX IF NOT EXISTS idx_unique_items_store_status 
    ON unique_items (store_id, status);

-- 6. Table: orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) NOT NULL UNIQUE,
    user_id VARCHAR(100) NOT NULL,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
    status order_status NOT NULL DEFAULT 'CONFIRMED',
    fulfillment_type fulfillment_type NOT NULL DEFAULT 'IN_STORE_PICKUP',
    total_amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    payment_reference VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders (store_id);

-- 7. Table: order_items (1:1 Binding to Physical Unit)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unique_item_id UUID NOT NULL UNIQUE REFERENCES unique_items(id) ON DELETE RESTRICT,
    serial_number VARCHAR(120) NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Table: outbox_events (Transactional Outbox for Aiven Kafka)
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic VARCHAR(150) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    partition_key VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL,
    status outbox_status NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    error_message TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_status_created 
    ON outbox_events (status, created_at) 
    WHERE status = 'PENDING';

-- 9. Table: users (Auth Module)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'CUSTOMER',
    assigned_store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
