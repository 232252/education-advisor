-- EAA v4.0 PostgreSQL Schema
-- Event-sourced conduct score system with multi-tenant RLS

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Tenants table (class/school dimension)
-- ============================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ============================================
-- Entity registry (students)
-- ============================================
CREATE TABLE entities (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entity_id TEXT NOT NULL,
    name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    groups TEXT[] NOT NULL DEFAULT '{}',
    roles TEXT[] NOT NULL DEFAULT '{}',
    class_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, entity_id)
);

-- ============================================
-- Event stream table: append-only, immutable
-- ============================================
CREATE TABLE events (
    event_id TEXT PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entity_id TEXT NOT NULL,
    stream_seq BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    category_tags TEXT[] NOT NULL DEFAULT '{}',
    reason_code TEXT NOT NULL,
    original_reason TEXT NOT NULL DEFAULT '',
    score_delta DOUBLE PRECISION NOT NULL,
    evidence_ref TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_valid BOOLEAN NOT NULL DEFAULT true,
    reverted_by TEXT,
    schema_version INTEGER NOT NULL DEFAULT 1,

    -- Append-only constraint: no duplicate seq in same stream
    UNIQUE (tenant_id, entity_id, stream_seq),

    -- Entity must exist
    FOREIGN KEY (tenant_id, entity_id) REFERENCES entities(tenant_id, entity_id)
);

-- ============================================
-- Projections table (materialized scores/ranks)
-- ============================================
CREATE TABLE projections (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entity_id TEXT NOT NULL,
    projection_type TEXT NOT NULL,
    version BIGINT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, entity_id, projection_type)
);

-- ============================================
-- Privacy mappings: AES-256-GCM encrypted
-- ============================================
CREATE TABLE privacy_mappings (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    pseudonym TEXT NOT NULL,
    encrypted_name BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, pseudonym)
);

-- ============================================
-- Stream sequence allocator
-- ============================================
CREATE TABLE event_streams (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    entity_id TEXT NOT NULL,
    next_seq BIGINT NOT NULL DEFAULT 1,

    PRIMARY KEY (tenant_id, entity_id)
);

-- ============================================
-- Operation log (audit trail)
-- ============================================
CREATE TABLE operation_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    operation TEXT NOT NULL,
    operator TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Indexes (all prefixed with tenant_id for RLS performance)
-- ============================================
CREATE INDEX idx_events_entity_order ON events(tenant_id, entity_id, stream_seq);
CREATE INDEX idx_events_occurred_at ON events(tenant_id, occurred_at);
CREATE INDEX idx_events_type ON events(tenant_id, event_type, occurred_at);
CREATE INDEX idx_events_reason ON events(tenant_id, reason_code);
CREATE INDEX idx_projections_lookup ON projections(tenant_id, entity_id);
CREATE INDEX idx_privacy_lookup ON privacy_mappings(tenant_id, pseudonym);
CREATE INDEX idx_oplog_time ON operation_log(tenant_id, created_at);

-- ============================================
-- Append-only enforcement
-- ============================================
CREATE OR REPLACE FUNCTION prevent_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'append-only violation: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER events_no_update
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

CREATE TRIGGER events_no_delete
    BEFORE DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

-- ============================================
-- RLS (Row-Level Security) for multi-tenant isolation
-- ============================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
ALTER TABLE projections FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE event_streams FORCE ROW LEVEL SECURITY;
ALTER TABLE operation_log FORCE ROW LEVEL SECURITY;

-- Grant eaa user access
GRANT ALL ON ALL TABLES IN SCHEMA public TO eaa;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO eaa;

-- RLS policies
CREATE POLICY tenant_isolation_events ON events
    USING (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY tenant_isolation_entities ON entities
    USING (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY tenant_isolation_projections ON projections
    USING (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY tenant_isolation_privacy ON privacy_mappings
    USING (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY tenant_isolation_streams ON event_streams
    USING (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));

CREATE POLICY tenant_isolation_oplog ON operation_log
    USING (tenant_id::text = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id::text = current_setting('app.current_tenant', true));
