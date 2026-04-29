# Contributing to EAA

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/nicholasgao/eaa.git
cd eaa
cargo build

# Run tests
cargo test

# Run with filesystem backend (default)
EAA_DATA_DIR=./examples/sample_data eaa info

# Run with PostgreSQL backend
EAA_BACKEND=postgres DATABASE_URL=postgres://eaa:pass@localhost/eaa cargo run --features postgres
```

## Guidelines

1. **Event sourcing is sacred** - Events are immutable. Never add UPDATE/DELETE operations on event data.
2. **Privacy first** - All external outputs must go through the privacy engine.
3. **Backward compatible** - New features must not break existing CLI commands.
4. **Tests required** - Add tests for any new functionality.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Code Style

- Follow `cargo fmt` formatting
- Resolve all `cargo clippy` warnings
- Add documentation comments for public APIs
