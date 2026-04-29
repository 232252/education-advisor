# CLI Reference - EAA v5.0

## Global Options

| Option | Default | Description |
|:-------|:--------|:------------|
| `-O, --output <fmt>` | `text` | Output format: `text` or `json` |
| `--help` | - | Show help |
| `-V, --version` | - | Show version |

## Environment Variables

| Variable | Default | Description |
|:---------|:--------|:------------|
| `EAA_DATA_DIR` | `./data` | Data directory (filesystem mode) |
| `EAA_BACKEND` | `filesystem` | Storage backend: `filesystem` or `postgres` |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `EAA_TENANT_ID` | default | Tenant UUID for RLS |
| `EAA_OPERATOR` | `班主任` | Default operator name |
| `EAA_PRIVACY_PASSWORD` | - | Privacy encryption key |

## Commands

### Query Commands

```bash
eaa info                          # System overview
eaa validate                      # Validate all events
eaa replay                        # Replay all scores
eaa ranking [N]                   # Top N ranking (default 10)
eaa score <name>                  # Student score
eaa history <name>                # Student event timeline
eaa search <keyword>              # Search events
eaa stats                         # Statistical overview
eaa codes                         # List all reason codes
eaa tag                           # List all tags
eaa range <from> <to>             # Date range query
eaa list-students                 # List all students
eaa summary [--since DATE] [--until DATE]  # Interval summary
eaa doctor                        # Environment health check
```

### Write Commands

```bash
eaa add <name> <reason_code> --delta <N> --note <text>  # Add event
eaa revert <event_id> --reason <text>                     # Revert event
eaa set-student-meta <name> --group <g> --role <r>        # Set metadata
```

### Export Commands

```bash
eaa export --output <file> --format csv|jsonl|html  # Export data
eaa dashboard [--output-dir <dir>]                   # HTML dashboard
```

### Privacy Commands

```bash
eaa privacy list                              # List pseudonym mappings
eaa privacy anonymize <text>                  # Anonymize text
eaa privacy deanonymize <text>                # Deanonymize text
eaa privacy dry-run <text>                    # Round-trip test
```

### Profile Commands (v3.2+)

```bash
eaa profile <name>          # Student profile (auto-desensitized)
eaa profile <name> --full   # Full profile (no desensitization)
eaa grades <name>           # Academic grades
eaa talks <name>            # Talk records
eaa export-profiles <file>  # Export all profiles (CSV)
```

## Output Formats

### Text (default)
Human-readable tables with Unicode box drawing.

### JSON (`-O json`)
Structured JSON for programmatic consumption.

```bash
eaa ranking 3 -O json
# {"ranking":[{"rank":1,"name":"尼尔日古莫","score":151.0,"events":6},...]}
```
