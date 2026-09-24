# Third-Party Notices

Education Advisor is distributed under the [MIT License](./LICENSE).

This project bundles or links the third-party components listed below. Each entry
records the version, license, and where the full license text lives. **Vendored
code is redistributed verbatim**, so its license and copyright notice must ship
with every copy of this software (including packaged builds).

If you believe a component is listed incorrectly or is missing, please open an
issue.

---

## Vendored source code (redistributed verbatim)

These directories contain third-party code committed directly into this
repository under `vendor/`. Each carries its own license file and an
`UPSTREAM.json` provenance manifest (repo, version, and a SHA-256 for every
file) so drift can be detected.

### `@earendil-works/pi-ai` — MIT

- **Version**: 0.85.1
- **License file**: [`vendor/pi-ai/LICENSE`](./vendor/pi-ai/LICENSE)
- **Provenance**: [`vendor/pi-ai/UPSTREAM.json`](./vendor/pi-ai/UPSTREAM.json)
- **Upstream**: <https://github.com/earendil-works/pi> (`packages/ai`)
- **Copyright**: Copyright (c) 2025 Mario Zechner
- **Used by**: the Chat / grading LLM layer (`src/main/services/pi-ai/`)

### `@earendil-works/pi-agent-core` — MIT

- **Version**: 0.85.1
- **License file**: [`vendor/pi-agent-core/LICENSE`](./vendor/pi-agent-core/LICENSE)
- **Provenance**: [`vendor/pi-agent-core/UPSTREAM.json`](./vendor/pi-agent-core/UPSTREAM.json)
- **Upstream**: <https://github.com/earendil-works/pi> (`packages/agent`)
- **Copyright**: Copyright (c) 2025 Mario Zechner
- **Used by**: agent message types and compaction helpers

### Submitty SQL schema — BSD-3-Clause

- **License file**: [`vendor/submitty/LICENSE.md`](./vendor/submitty/LICENSE.md)
- **Provenance**: [`vendor/submitty/UPSTREAM.json`](./vendor/submitty/UPSTREAM.json)
- **Upstream**: <https://github.com/Submitty/Submitty>
- **Copyright**: Copyright (c) 2014-2026, Submitty team. All rights reserved.
- **Used by**: reference schema for the grading subsystem (`vendor/submitty/sql/`)

BSD-3-Clause is compatible with MIT redistribution. The full notice and
disclaimer are reproduced below.

<details>
<summary>Submitty BSD 3-Clause License (full text)</summary>

```
BSD 3-Clause License

Copyright (c) 2014-2026, [Submitty team](AUTHORS.md)
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

</details>

---

## npm dependencies

Installed via npm; license texts are available in each package under
`node_modules/<name>/LICENSE`. Grouped by declared license:

### Permissive (no special obligations beyond notice retention)

| License | Packages |
| --- | --- |
| MIT | `@deepseek-ai/dsh-sdk-client`, `@larksuiteoapi/node-sdk`, `better-sqlite3`, `cross-spawn`, `electron-updater`, `imapflow`, `lxgw-wenkai-webfont`, `mqtt`, `pinyin-pro`, `selfsigned`, `typebox`, `uqr`, `ws`, `react`, `react-dom`, `react-router-dom`, `@napi-rs/canvas`, and build tooling (46 total) |
| Apache-2.0 | `pdfjs-dist`, `xlsx`, `echarts`, `sharp`, `typescript` (5 total) |
| BSD-2-Clause | `mammoth` |
| ISC | `node-cron`, `yaml`, `lucide-react` |
| MIT-0 | `nodemailer` |
| BlueOak-1.0.0 | `rimraf` |
| MIT OR Apache-2.0 | `@biomejs/biome` (dual-licensed; used under MIT) |

**`xlsx@0.18.5` is Apache-2.0.** Note that SheetJS moved later releases off npm
under a proprietary license; this project pins the last Apache-2.0 release
published to the public registry.

### Fonts — SIL Open Font License 1.1

Bundled webfonts are redistributed under the OFL-1.1, which permits bundling
provided the fonts are not sold by themselves and any derivative keeps the
reserved font name.

| Package | Font | License |
| --- | --- | --- |
| `@fontsource/jetbrains-mono` | JetBrains Mono | OFL-1.1 |
| `@fontsource-variable/inter` | Inter | OFL-1.1 |
| `lxgw-wenkai-webfont` | LXGW WenKai | MIT (per package metadata) |

### Build-only / platform binaries

These are used to build or package the app and are not part of the shipped
application logic:

- `electron`, `electron-builder`, `@electron/rebuild`, `rcedit` — MIT
- `vite`, `vitest`, `@vitest/coverage-v8` — MIT
- `typescript` — Apache-2.0
- `@biomejs/biome` — MIT OR Apache-2.0
- `tailwindcss`, `@tailwindcss/postcss`, `postcss` — MIT
- `jsdom`, `@testing-library/*` — MIT
- `@napi-rs/canvas` and `@napi-rs/canvas-win32-x64-msvc` — MIT
- `rimraf` — BlueOak-1.0.0

---

## Rust dependencies (`core/eaa-cli`)

The EAA data engine is compiled from source in this repository
(`core/eaa-cli`). Its dependency tree is pinned by `Cargo.lock`; all crates are
used under permissive licenses (MIT / Apache-2.0 / BSD / ISC). Run
`cargo license` inside `core/eaa-cli` for a full inventory. Because the engine
is compiled from first-party source at build time, no third-party Rust binary
is redistributed here.

---

## Verification

```bash
npm run verify:vendor                       # vendored packages + provenance
node scripts/update-vendor-pi-provenance.mjs --check   # vendored file hashes
```
