# 0005 — PII encrypted at rest with AES-256-GCM

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

The privacy engine stores a mapping table from real identifiers
(names, IDs, phone numbers) to pseudonyms (`S_017`, etc.). This
table is the most sensitive data in the system — if leaked, it
un-anonymizes every other piece of data in the system.

Three options for at-rest encryption:

1. **No encryption.** The table is a plain JSON file. Simple, but
   anyone with file system access can read the table.
2. **Application-level encryption** with a hard-coded key. The
   table is encrypted with a key that ships in the app. Defeats
   the purpose — the key is as public as the app.
3. **Application-level encryption with a user-supplied key.** The
   table is encrypted with a key derived from the user's master
   password. The user has to enter the password to use the
   system.

## Decision

We use **option 3**: AES-256-GCM encryption with a key derived
from the user's master password via Argon2id.

The flow:

1. The user picks a master password on first run.
2. A random 16-byte salt is generated and stored at
   `userData/eaa-data/privacy/salt.bin`.
3. The encryption key is derived: `key = Argon2id(password, salt)`.
4. The mapping table is encrypted with `key` and stored at
   `userData/eaa-data/privacy/mapping.bin`.
5. On each app launch, the user re-enters the password, the key
   is re-derived, and the table is decrypted in memory.

The key never leaves memory. The encrypted file never contains
plaintext.

## Rationale

- **Security**: the at-rest encryption is only as strong as the
  user's password. A strong password + Argon2id is industry
  standard.
- **Recovery**: no recovery — if the user forgets the password,
  the table is unrecoverable. This is a deliberate trade-off
  (false sense of security with a "recovery" question is worse
  than no recovery).
- **Performance**: Argon2id at ~250 ms / derivation is a one-time
  cost on app launch. The per-anonymize cost is microseconds
  (AES-GCM is fast).

## Consequences

- **Good**: the mapping table is unreadable to anyone who
  doesn't have the password.
- **Good**: the Argon2id derivation is GPU-resistant, so brute
  force is expensive.
- **Bad**: no password recovery. Users have to write the
  password down (in a password manager) or risk losing the
  mapping.
- **Bad**: the user has to enter the password every time the
  app launches. This is a friction point; we mitigate with
  the OS keystore integration (where the password is cached
  in the OS keychain for the session).

## Alternatives considered

- **OS keystore only (no application-level encryption)**: rejected
  because the OS keystore doesn't follow the user across
  machines. If the teacher moves to a new laptop, the mapping
  table is lost.
- **Recovery question**: rejected because recovery questions are
  notoriously weak (mother's maiden name is often public).
- **Hardware security key (YubiKey etc.)**: rejected for v0.1.0
  but planned for v0.4.0.

## References

- [`PRIVACY_ENGINE.md#the-crypto`](../PRIVACY_ENGINE.md#the-crypto)
- [`SECURITY.md#cryptography`](../SECURITY.md#cryptography)
