# Deployment Guide

## Single Class (Filesystem Mode)

Zero dependencies. Just the binary and a data directory.

```bash
# Build
cargo build --release

# Set data directory
export EAA_DATA_DIR=/path/to/data

# Run
./target/release/eaa info
```

## Single Machine (PostgreSQL Mode)

```bash
# 1. Start PostgreSQL
cd docker && docker compose up -d

# 2. Run migrations
psql -U eaa -d eaa -f migrations/001_init.sql

# 3. Create tenant
psql -U eaa -d eaa -c "INSERT INTO tenants (slug, name) VALUES ('class_2026_1', '一年级一班');"

# 4. Migrate existing data
python3 scripts/migrate_to_pg.py

# 5. Configure
export EAA_BACKEND=postgres
export DATABASE_URL=postgres://eaa:password@localhost:5432/eaa
export EAA_TENANT_ID=<uuid-from-step-3>

# 6. Run
eaa info
```

## Multi-Class / School-Wide

Each class gets its own `tenant_id`. RLS automatically isolates data.

```bash
# Create tenants
eaa tenant create --slug class_2026_1 --name "一年级一班"
eaa tenant create --slug class_2026_2 --name "一年级二班"

# Switch tenant
export EAA_TENANT_ID=<tenant-uuid>
```

## Backup

### Filesystem Mode
```bash
tar czf eaa-backup-$(date +%Y%m%d).tar.gz $EAA_DATA_DIR
```

### PostgreSQL Mode
```bash
pg_dump -U eaa eaa > eaa-backup-$(date +%Y%m%d).sql
```

## Health Check

```bash
eaa doctor
# Checks: data directory, entities, events, privacy engine, schema, DB connection
```
