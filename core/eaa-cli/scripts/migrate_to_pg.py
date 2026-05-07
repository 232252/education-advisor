#!/usr/bin/env python3
"""Migrate existing EAA filesystem data to PostgreSQL."""
import json
import subprocess
import sys
from datetime import datetime

TENANT_ID = "a0000000-0000-0000-0000-000000000001"
DATA_DIR = "/vol2/copaw-data/data"

def psql(sql, params=None):
    """Execute SQL via psql."""
    cmd = ["psql", "-U", "postgres", "-d", "eaa", "-t", "-A", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"SQL Error: {r.stderr}")
        return None
    return r.stdout.strip()

def psql_execute(sql):
    """Execute multi-statement SQL."""
    cmd = ["psql", "-U", "postgres", "-d", "eaa", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"SQL Error: {r.stderr}")
        return False
    return True

def escape_sql(s):
    return s.replace("'", "''").replace("\\", "\\\\")

def main():
    # Load data
    with open(f"{DATA_DIR}/entities/entities.json") as f:
        entities_data = json.load(f)
    with open(f"{DATA_DIR}/events/events.json") as f:
        events = json.load(f)
    
    entities = entities_data["entities"]
    print(f"Loaded {len(entities)} entities, {len(events)} events")

    # Insert entities
    entity_count = 0
    for eid, ent in entities.items():
        name = escape_sql(ent["name"])
        aliases = ent.get("aliases", [])
        status = ent.get("status", "ACTIVE")
        groups = ent.get("groups", [])
        roles = ent.get("roles", [])
        class_id = ent.get("class_id")
        metadata = json.dumps(ent.get("metadata", {}), ensure_ascii=False).replace("'", "''")
        
        aliases_str = "{" + ",".join(f'"{escape_sql(a)}"' for a in aliases) + "}"
        groups_str = "{" + ",".join(f'"{escape_sql(g)}"' for g in groups) + "}"
        roles_str = "{" + ",".join(f'"{escape_sql(r)}"' for r in roles) + "}"
        class_id_val = f"'{escape_sql(class_id)}'" if class_id else "NULL"
        
        sql = f"""INSERT INTO entities (tenant_id, entity_id, name, aliases, status, groups, roles, class_id, metadata, created_at)
VALUES ('{TENANT_ID}', '{escape_sql(eid)}', '{name}', '{aliases_str}', '{escape_sql(status)}', '{groups_str}', '{roles_str}', {class_id_val}, '{metadata}'::jsonb, '{ent.get("created_at", "2026-01-01")}')
ON CONFLICT (tenant_id, entity_id) DO UPDATE SET name=EXCLUDED.name;"""
        
        if psql_execute(sql):
            entity_count += 1
    
    print(f"✅ Migrated {entity_count} entities")

    # Insert events with stream_seq
    event_count = 0
    # Group events by entity for sequential numbering
    from collections import defaultdict
    entity_events = defaultdict(list)
    for evt in events:
        entity_events[evt["entity_id"]].append(evt)
    
    # Sort each entity's events by timestamp
    for eid in entity_events:
        entity_events[eid].sort(key=lambda x: x.get("timestamp", ""))
    
    seq_map = {}
    for eid, evts in entity_events.items():
        seq_map[eid] = 0
    
    # Re-sort all events globally by timestamp for deterministic ordering
    all_events_sorted = sorted(events, key=lambda x: x.get("timestamp", ""))
    
    for evt in all_events_sorted:
        eid = evt["entity_id"]
        seq_map[eid] += 1
        seq = seq_map[eid]
        
        event_id = escape_sql(evt["event_id"])
        event_type = escape_sql(evt.get("event_type", "CONDUCT_DEDUCT"))
        tags = evt.get("category_tags", [])
        tags_str = "{" + ",".join(f'"{escape_sql(t)}"' for t in tags) + "}"
        reason_code = escape_sql(evt["reason_code"])
        original_reason = escape_sql(evt.get("original_reason", ""))
        score_delta = evt["score_delta"]
        operator = escape_sql(evt.get("operator", ""))
        note = escape_sql(evt.get("note", ""))
        evidence_ref = escape_sql(evt.get("evidence_ref", ""))
        timestamp = evt.get("timestamp", "2026-01-01T00:00:00")
        is_valid = "true" if evt.get("is_valid", True) else "false"
        reverted_by = f"'{escape_sql(evt['reverted_by'])}'" if evt.get("reverted_by") else "NULL"
        
        sql = f"""INSERT INTO events (event_id, tenant_id, entity_id, stream_seq, event_type, category_tags, reason_code, original_reason, score_delta, evidence_ref, operator, note, occurred_at, is_valid, reverted_by)
VALUES ('{event_id}', '{TENANT_ID}', '{escape_sql(eid)}', {seq}, '{event_type}', '{tags_str}', '{reason_code}', '{original_reason}', {score_delta}, '{evidence_ref}', '{operator}', '{note}', '{timestamp}', {is_valid}, {reverted_by})
ON CONFLICT (event_id) DO NOTHING;"""
        
        if psql_execute(sql):
            event_count += 1
    
    print(f"✅ Migrated {event_count} events")
    
    # Insert privacy mappings if they exist
    try:
        with open(f"{DATA_DIR}/privacy/mapping.json") as f:
            mappings = json.load(f)
        
        privacy_count = 0
        # We need to import the AES mapping - for now just create pseudonym records
        # The actual encrypted names will be re-encrypted with pgcrypto
        print(f"ℹ️  Found {len(mappings)} privacy mappings (will be re-encrypted during full migration)")
    except FileNotFoundError:
        print("ℹ️  No privacy mappings file found, skipping")
    
    # Update projections (compute scores)
    psql_execute(f"""
    INSERT INTO projections (tenant_id, entity_id, projection_type, version, data, updated_at)
    SELECT '{TENANT_ID}', e.entity_id, 'score_total', 
           MAX(ev.stream_seq),
           jsonb_build_object(
               'score', 100.0 + SUM(CASE WHEN ev.is_valid AND ev.reverted_by IS NULL THEN ev.score_delta ELSE 0 END),
               'event_count', COUNT(*),
               'deductions', SUM(CASE WHEN ev.score_delta < 0 AND ev.is_valid AND ev.reverted_by IS NULL THEN 1 ELSE 0 END),
               'bonuses', SUM(CASE WHEN ev.score_delta > 0 AND ev.is_valid AND ev.reverted_by IS NULL THEN 1 ELSE 0 END)
           ),
           now()
    FROM entities e
    JOIN events ev ON ev.entity_id = e.entity_id AND ev.tenant_id = '{TENANT_ID}'
    WHERE e.tenant_id = '{TENANT_ID}'
    GROUP BY e.entity_id
    ON CONFLICT (tenant_id, entity_id, projection_type) 
    DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at;
    """)
    
    # Verify
    result = psql(f"SELECT count(*) FROM entities WHERE tenant_id = '{TENANT_ID}'")
    print(f"📊 DB entities: {result}")
    result = psql(f"SELECT count(*) FROM events WHERE tenant_id = '{TENANT_ID}'")
    print(f"📊 DB events: {result}")
    result = psql(f"SELECT count(*) FROM projections WHERE tenant_id = '{TENANT_ID}'")
    print(f"📊 DB projections: {result}")
    
    print("\n🎉 Migration complete!")

if __name__ == "__main__":
    main()
