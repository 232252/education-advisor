# Windows installer packing

This is the source of truth for how Education Advisor packs the desktop
installer. When the pipeline changes, update this document in the same
change as the scripts. Historical notes such as
`docs/superpowers/specs/2026-11-09-installer-offline-slim.md` describe
older layouts. Do not follow them when they disagree with this file.

The gates live in `scripts/lib/pack-budget.mjs`. A clean teacher Setup
is near **287 MB**. The pack fails above **310,000,000 bytes** (~310 MB)
or when `dsh-runtime.zip` is above **200,000,000 bytes** (~200 MB), is
not a STORE zip, or contains `pnpm` / `@pnpm/exe`.

## Standing approach

Keep this layout. It is what produced the ~287 MB Setup on both a
teacher machine and a clean GitHub runner. It is smaller than the older
official ~323 MB loose-file pack, and it is not the 0.8–1.1 GB
uncompressed payload.

| Piece | What ships | Why |
| --- | --- | --- |
| dsh closure | One STORE zip, `resources/dsh-runtime/dsh-runtime.zip` | The dsh child is stock `node` (`vendor/dsh-node`). It cannot read `app.asar`. A zip is one file for NSIS to write. First launch extracts it under userData and skips the extract when the sha256 is unchanged. |
| Connection center | One STORE zip, `resources/dsh-im/dsh-im.zip` | `link:` needs a real directory, so the tree cannot stay inside `app.asar`. Same first-launch extract. |
| Office PDF | One deflate zip, copied by `afterPack` into `resources/office-kit/` | The kit is already a compressed binary blob (~66 MB). Deflating it once is enough. Do not pre-extract the ~735 files. The copy on the GitHub Release is the repair channel, not a reason to drop it from the installer. |
| `app.asar` | Main, preload, renderer, and the JS the main process requires | asar is an uncompressed concatenation. The NSIS 7z is what compresses it. |
| `asarUnpack` | `*.node`, `*.dll`, `*.exe`, `*.dylib`, `*.so` only | Loaders need real paths. Unpacking `**/node_modules/**` turns the install into tens of thousands of files. Install time is dominated by file count and antivirus scans, not by LZMA decode. |
| NSIS payload | Default 7z level: `-mx=9`, LZMA2, 64 MB dictionary | electron-builder's archive step uses level 9 for 7z when `compression` is unset. `compression: store` and `ELECTRON_BUILDER_COMPRESSION_LEVEL=0` are `-mx=0` and produce a ~0.8–1.1 GB Setup. |
| Teacher toolchain | No `pnpm`, no `@pnpm/exe` | The connection center rewrites profile links. It does not run pnpm on the teacher machine. The pnpm package root is eight hardlinked copies of a ~50 MB program; once copied they become real files (~391 MB on disk). |
| Upgrade | `scripts/nsis/installer.nsh` renames the old directory and extracts the full new tree | This script does not change the 7z level. Skipping unchanged files is future work. It is not why a Setup file gets larger. |

STORE (zip method 0) plus one LZMA pass is deliberate. A deflated zip
inside the 7z looks random to LZMA, so the second pass barely shrinks
it and the Setup grows. Office-kit is the exception because its bytes
are already compressed binaries; LZMA would not shrink that zip usefully.

Electron 45 still fails dsh's runtime fingerprint check. Do not "fix"
the pack by putting the whole dsh tree in `app.asar` and launching it
with Electron's node.

Functionality stays: Office PDF conversion, the connection center,
grading, and the offline runtime. The gates reject a fat layout. They
do not delete those features.

End-user install, once Setup.exe is already on disk, should finish in
under 60 seconds on a normal PC. That depends on writing a few large
files instead of tens of thousands of small ones. It does not depend on
turning LZMA off.

## Current pipeline

`directories.output` is `release-v11`. The Windows artifact name is
`Education-Advisor-Setup.exe` (no version in the file name). There is
no `compression:` key in `electron-builder.yml`.

### `npm run prepackage`

npm runs a script named `prepackage` automatically only before the
script named `package`. `package:installer` does not get that hook, so
it calls `npm run prepackage` itself. The chain is:

1. `scripts/prebuild-check.mjs` — EAA binary, `agents/`, `config/`.
2. `scripts/stage-dsh-node.mjs` — stock `node` into `vendor/dsh-node/`.
   Skipped when a copy is already staged.
3. `scripts/build-office-kit-asset.mjs` — one deflate zip under
   `build/office-kit/`. Non-Windows hosts skip. The zip and its manifest
   are cached when unchanged. Do not write this zip under `dist/`;
   `files: dist/**/*` would put a second copy in `app.asar`.
4. `scripts/compute-unpack-closure.mjs` — walks the dependency closure
   and rewrites the two sentinels in `electron-builder.yml` via
   `scripts/lib/install-layout.mjs`. `asarUnpack` stays the five native
   globs. Packages that live only in the runtime zip are excluded from
   the loose `files` set so they are not packed twice. Main-process
   packages stay in the app (`better-sqlite3`, `pdfjs-dist`,
   `@napi-rs/canvas`, `yaml`, `ws`, `@earendil-works/pi-ai`,
   `cross-spawn`, `debug`, and their dependencies). Removing those
   dependencies made 3.3.7-beta.2 / beta.3 fail at startup with
   `Cannot find module`.
5. `scripts/stage-dsh-im-deps.mjs` — production dependencies for
   `vendor/dsh-im/`. Skipped when already installed.
6. `scripts/build-dsh-archives.mjs` — rewrites both STORE zips on every
   run. There is no cache. It fails if the runtime zip is over budget,
   is not method 0, or contains `node_modules/pnpm/` or
   `node_modules/@pnpm/exe`. The log line
   `[build-dsh-archives] dsh-runtime … MB store` is the zip's own size,
   not an uncompressed estimate. A clean runtime zip is about **166–178 MB**
   (CI Windows 3.3.7-beta.6 measured 178,512,965 bytes, 576 packages,
   15,335 files). A clean `dsh-im.zip` is about **69–73 MB**.
   `@deepseek-ai/libreoffice-kit-*` is not a member of this zip. The
   Windows kit is the separate office-kit deflate zip. Leaving the
   darwin kit in the runtime zip adds about 161 MB and fails the budget
   on macOS.

`runtimeArchivePackages` deletes `pnpm` and `@pnpm/exe*` from the
closure before the zip is written. `afterPack` checks the zip again.
Do not weaken either check.

### `npm run package:installer`

```text
npm run prepackage
  && npm run build
  && node scripts/run-electron-builder.mjs --win nsis
```

`npm run package` is the same Windows pack. npm runs `prepackage`
before it because of the script name, and the script body then builds
and calls the same wrapper. Prefer `package:installer` when you want
the `prepackage` call visible in the script itself.

`scripts/run-electron-builder.mjs`:

- Refuses `--prepackaged` / `--pd`, a `compression=store` override, and
  `ELECTRON_BUILDER_COMPRESSION_LEVEL=0`.
- Refuses to start when the STORE zips are missing, or when a Windows
  pack does not have exactly one office-kit zip.
- Deletes `release-v11/win-unpacked`, `linux-unpacked`, and `mac*`
  directories before every attempt. It does not delete a renamed
  Setup.exe you kept for comparison.
- Forces `--publish never`. electron-builder schedules a GitHub upload
  as each artifact is created, which can start before
  `afterAllArtifactBuild` returns. Cancelling that task is not a
  guarantee the bytes never left the machine. The release workflow
  uploads only after the budget command exits 0.
- On an Electron download failure (`ETIMEDOUT`, `ECONNRESET`, and the
  other markers in `shouldRetryPack`), waits 60 seconds, deletes the
  unpacked directories again, and retries once with the same arguments.
  A failure from `afterPack` or from the budget is not retried.
- After a zero exit, logs `[pack-inventory]` and fails if the budget
  fails.

`EA_ELECTRON_DIST`, when set, appends `-c.electronDist=<path>`. That
only selects an already unpacked Electron binary directory. It does not
skip `afterPack` and it is not `--prepackaged`.

### `afterPack` (`scripts/after-pack-trim.mjs`)

Runs after `win-unpacked` exists and before NSIS builds the 7z.

- Copies the two STORE zips and, on Windows, the one office-kit zip.
- Fails if a zip is missing. A missing zip is not a signal to unpack
  `**/node_modules/**` or to 7z whatever directory is already there.
- Fails if the runtime zip contains pnpm, is not STORE, or is over
  200 MB. The pnpm failure text stays
  `runtime zip 不应含 pnpm / @pnpm/exe`.
- Fails if `app.asar.unpacked` contains `node_modules/pnpm` or
  `node_modules/@pnpm`. It does not copy the pnpm dist tree back in.
- Drops `dxcompiler.dll`, extra locales, and other-platform binaries.
- Fails if `app.asar.unpacked` has more than 800 files.
- Logs `[pack-inventory] stage=afterPack` for the runtime zip, the im
  zip, office-kit, and `app.asar`. Setup.exe does not exist yet.

### NSIS and the size hook

`scripts/nsis/installer.nsh` is `nsis.include`. It handles the upgrade
rename. It does not set the 7z level.

`scripts/after-all-artifact-build.mjs` stats Setup.exe and the unpacked
resources and throws when the budget fails. `scripts/check-pack-budget.mjs`
is the same check as a standalone command so CI can show it as its own
step.

Inventory lines look like:

```text
[pack-inventory] stage=check Setup.exe bytes=287227957 limit=310000000 path=...
[pack-inventory] stage=check dsh-runtime.zip bytes=174063616 limit=200000000 method=0 path=...
[pack-inventory] stage=check dsh-im.zip bytes=72876032 method=0 path=...
[pack-inventory] stage=check office-kit bytes=69000000 method=8 path=...
[pack-inventory] stage=check app.asar bytes=45000000 path=...
[pack-budget] ok
```

`method=0` is STORE. `method=8` is deflate, which is expected for
office-kit and forbidden for the two module zips.

### CI (`/.github/workflows/release.yml`)

Official releases are packed in GitHub Actions. This document does not
change that. The workflow:

1. Resolves the version. A `main` push whose tag already has a GitHub
   Release does not pack again. Prerelease versions (`-beta`, `-rc`,
   `-alpha`) are published as prereleases.
2. Runs typecheck, lint, test, and `npm run verify:dsh` once.
   `verify:dsh` checks the pack wiring: `package:installer` starts with
   `prepackage`, the workflow calls the wrapper and the budget script,
   and it contains `--publish never`.
3. On each platform: `npm ci`, Rust EAA build, `npm run build`,
   `npm run prepackage`, then `node scripts/run-electron-builder.mjs`
   with `--publish never`.
4. Runs `scripts/check-pack-budget.mjs`. Windows passes
   `--require-setup`.
5. Runs `npm run verify:dsh -- --dist release-v11/win-unpacked` on
   Windows.
6. Uploads the artifacts only if those steps passed. The publish job
   then creates the GitHub Release and attaches the installers,
   `latest*.yml`, blockmaps, checksums, and the office-kit zip.

`actions/setup-node` caches npm. It does not cache `release-v11`. Do
not add an Actions cache for `win-unpacked` or for the output
directory. Caching `ELECTRON_CACHE` only avoids re-downloading the
Electron zip. It does not change which files are packed. A long-lived
machine keeps `release-v11/win-unpacked` across failed downloads. A
GitHub-hosted runner does not, which is why a clean CI pack can be
287 MB while a later local retry on the same disk is not.

Do not run this workflow to "see if the gate works". A dry run still
creates tags and releases when `should_release` is true.

## Why the 2026-11-12 pack grew from ~287 MB to ~370 MB

The scripts did not change between the slim pack and the fat one.
`git diff 1a13b22..443b0e0` touches `package.json` only to bump
`3.3.7-beta.4` to `3.3.7-beta.5`. It does not touch
`electron-builder.yml`, the archive scripts, `afterPack`, NSIS, or
`release.yml`. The commits in between are the teacher-chat work
(about +1775 / −187 lines). That cannot add 82 MB.

| Pack | Bytes | When |
| --- | ---: | --- |
| Official v3.3.6 CI, older loose-file layout | 323,009,354 | Policy ceiling for that layout |
| Local 3.3.7-beta.4 `Education-Advisor-Setup.3.3.7-beta.4-20261112-1212.exe` | 287,550,146 | 12:12, after pnpm left the runtime zip |
| GitHub CI v3.3.7-beta.4 | 287,227,957 | SHA256 `8139cdaf999c751516cf796380b2a3684f878c23bcf338fade105309c4b2b25e` |
| t58 complete `Education-Advisor-Setup.t58-complete-20261112-1050.exe` | 369,388,880 | 10:50:50, before pnpm left the runtime zip |
| Local 3.3.7-beta.5 `Education-Advisor-Setup.3.3.7-beta.5-20261112-1716.exe` | 369,660,622 | 17:16. SHA256 `8CECB94E1F5687BA4ADC54C45F31FB26A970F604075ADC5CFC25017B4E7BC0F9`. No trailing zero padding |

beta.5 − local beta.4 = 82,110,476 bytes. beta.5 − t58 complete =
271,742 bytes. Local beta.4 − CI beta.4 = 322,189 bytes. The ~300 KB
gaps are the same layout with small content differences. The 82 MB gap
is not.

### What the 287 MB flow did

1. Tree includes `07fae8c` (11:41 Asia/Shanghai), which removes `pnpm`
   and `@pnpm/exe` from `dsh-runtime.zip` and fails `afterPack` if they
   return.
2. `prepackage` logged runtime **574 packages / 15,336 files / 166.0 MB
   store** and dsh-im **2,207 files / 69.5 MB**.
3. `afterPack` copied those zips. The pnpm check passed.
4. NSIS used the default LZMA pass. No `compression: store`.
5. CI did this on a fresh runner: explicit `prepackage`, then
   electron-builder, no leftover `win-unpacked`. Result 287,227,957.
6. The local 12:12 pack was the same script generation. Result
   287,550,146.

### What the fat flow did

1. t58 at 10:50 was packed from the previous module-archive scripts
   (`1e0b257` / the beta.2 line), which still put `pnpm` and
   `@pnpm/exe` in the runtime zip. `07fae8c` had not landed. Result
   369,388,880. A damaged t58 file with 17,993,211 trailing zero bytes
   is not part of the comparison.
2. beta.5's source is the slim scripts plus the chat change and the
   version bump. The packing scripts match beta.4.
3. The beta.5 session ran `prepackage` (about 16 seconds, exit 0), then
   `package:installer`. The first builder failed with
   `connect ETIMEDOUT 20.205.243.166:443` while downloading Electron.
   The retry succeeded with `CSC_IDENTITY_AUTO_DISCOVERY=false` and
   `-c.electronDist=node_modules/electron/dist`. Result 369,660,622.

### Concrete process differences

These are the differences that let a fat layout out. They are not a
compression-setting diff, and they are not the chat patch.

1. **Nothing failed the build on size.** `afterPack` rejects pnpm only
   when that `afterPack` actually runs on the tree being 7z'd. A
   369 MB Setup was still a successful pack. CI published prereleases
   from whatever electron-builder uploaded.
2. **`package:installer` did not run `prepackage`.** Operators ran it
   by hand. A later pack can forget. If `build/dsh-runtime/dsh-runtime.zip`
   is left over from an older `prepackage`, `afterPack` copies that
   file. Current `afterPack` then fails if the old zip contains pnpm.
   The hole is a retry that never reaches current `afterPack`.
3. **The download retry did not delete `release-v11/win-unpacked`.**
   t58 had already been packed in that directory the same day.
   `--prepackaged <dir>` tells electron-builder to wrap an existing
   unpacked app and does not run `afterPack`. A retry that 7z's the
   t58 tree, or that otherwise skips rebuilding it, produces a Setup
   within a few hundred KB of t58. `-c.electronDist` itself only
   selects the Electron binaries. beta.4 local and CI used the same
   Electron major and differed by 322 KB. The flag does not explain
   82 MB unless the unpacked tree was not rebuilt.
4. **CI and the teacher disk are not the same input.** CI's npm cache
   does not restore `win-unpacked`. The teacher machine's
   `release-v11` still held the morning's output. The beta.4 CI pack
   is the evidence that the scripts themselves emit ~287 MB when the
   tree is clean.
5. **Two unconfirmed ways the fat zip got into the 7z.** Both are
   "the input was still the t58 layout". Neither has been confirmed by
   listing `resources/dsh-runtime/dsh-runtime.zip` inside the two
   Setup files.
   - **A.** The retry 7z'd a stale `win-unpacked` from t58, so current
     `afterPack` never replaced the zips. The prepackage log would
     still show ~166 MB, and the retry log would have no successful
     `[after-pack-trim] +…MB dsh runtime` line.
   - **B.** `prepackage` wrote a runtime zip that still contained the
     toolchain. The prepackage log would show a zip of several hundred
     MB. Current `build-dsh-archives.mjs` rewrites the zip every time
     and deletes pnpm from the closure, and current `afterPack` exits
     1 if those paths are present. So B means the `prepackage` that
     actually ran was not this script, or `afterPack` did not run.
6. **What it is not.**
   - Not `-mx=0`. That Setup is about 0.8–1.1 GB.
   - Not "deflate the module zips, then LZMA". That grows the Setup by
     the gap between deflate and LZMA, on the order of tens of MB, not
     82 MB.
   - Not "go back to loose files". That returns to the ~323 MB,
     ~20k-file pack. File count dominates install time, not this 82 MB.
   - Not a second copy of office-kit. The ~66 MB zip is already inside
     the 287 MB pack. Unpacking the 184 MB kit as loose files would add
     more than 82 MB and a large file count.
   - Not the chat patch. beta.5 is 272 KB above t58, which matches a
     small `app.asar` delta on the same payload.

Why pnpm in a STORE zip is about +82 MB rather than +400 MB: NSIS still
uses LZMA with a 64 MB dictionary. Eight identical ~50 MB aliases that
sit next to each other collapse toward one copy. `@pnpm/exe` sorts near
the front of the zip and the `pnpm` package sorts near the back, with
the rest of the ~166 MB closure between them, past the dictionary. The
second copy does not collapse. Two barely compressible ~40 MB binaries
are about 80 MB. The beta.4 runtime zip at 166.0 MB is the closure
without those binaries.

`07fae8c` also stopped excluding `cross-spawn`, `debug`, and `js-yaml`
from the app, so those packages exist both in `app.asar` and in the
runtime zip. That change is already inside the 287 MB pack. It is not
the beta.5 delta.

The gates below make both A and B fail the pack even if the operator
never opens the 7z.

## Gates and how to bump a budget

| Check | Limit | Where it runs |
| --- | --- | --- |
| Setup.exe | 310,000,000 bytes | `afterAllArtifactBuild`, the wrapper, `check-pack-budget.mjs --require-setup` |
| `dsh-runtime.zip` size | 200,000,000 bytes | `build-dsh-archives.mjs`, `afterPack`, the same final check |
| `dsh-runtime.zip` method | 0 (STORE) | same |
| `dsh-im.zip` method | 0 (STORE) | same |
| pnpm / `@pnpm/exe` in the runtime zip | none | `build-dsh-archives.mjs` and `afterPack` (the `afterPack` message is unchanged) plus the final check |
| pnpm directory in `app.asar.unpacked` | none | `afterPack` |
| office-kit zip count on Windows | exactly 1 | `afterPack` and the final check |
| `app.asar.unpacked` file count | 800 | `afterPack` |
| 7z left uncompressed | forbidden | `verify-dsh-package.mjs` reads `electron-builder.yml`; the wrapper refuses the override |

Bytes are decimal (287,550,146 bytes is ~287.6 MB). Windows Explorer
sometimes labels the same file in MiB. Compare the byte count.

To raise a ceiling because a feature legitimately grew the pack:

1. Pack once and keep the `[pack-inventory]` lines.
2. Name the component that grew (runtime zip, office-kit, `app.asar`,
   Electron) and why the product needs it.
3. Change `SETUP_MAX_BYTES` or `RUNTIME_ZIP_MAX_BYTES` in
   `scripts/lib/pack-budget.mjs`.
4. Update the equality in `tests/main/pack-budget.test.ts` and this
   section. The test still requires the ceiling to stay under the
   369,388,880 byte toolchain pack. Accepting that layout is not a
   budget bump.
5. Do not bump the ceiling to hide a stale `win-unpacked`, a skipped
   `prepackage`, or a zip that contains pnpm.

## Operator runbook

### Clean local pack on the teacher Windows machine

Close Education Advisor first so the unpacked directory is not locked.
Rename any `release-v11\Education-Advisor-Setup.exe` you want to keep;
the pack overwrites that exact name and leaves renamed copies alone.

```powershell
npm ci
npm run build:eaa
npm run package:installer
npm run verify:dsh -- --dist release-v11/win-unpacked
```

`package:installer` runs `prepackage`, the Vite build, deletes
`release-v11\win-unpacked`, runs electron-builder, and fails if Setup
is over 310 MB. A clean result is near 287 MB. The inventory is in the
log as `[pack-inventory]`.

Official publishing stays in `.github/workflows/release.yml`. Do not
pass a publish flag, do not create a tag, and do not upload the exe
from this machine as a GitHub Release.

### Electron download timeout

The wrapper retries once by itself: it deletes the unpacked directories
and runs electron-builder again. `afterPack` runs on the new tree.

If it still cannot download Electron and `node_modules\electron\dist`
already contains the binaries:

```powershell
$env:EA_ELECTRON_DIST = 'node_modules/electron/dist'
npm run package:installer
```

If `prepackage` already succeeded in this checkout and you do not want
to rebuild the renderer, the wrapper alone is enough. It still refuses
to start without the current zips, and it still deletes `win-unpacked`:

```powershell
node scripts/run-electron-builder.mjs --win nsis
```

Do not point the builder at `release-v11\win-unpacked`. Do not set
`ELECTRON_BUILDER_COMPRESSION_LEVEL=0`. If the delete fails because a
file is locked, close the app and run the same command again.

`CSC_IDENTITY_AUTO_DISCOVERY=false` only skips Windows certificate
discovery. It is not a size fix.

### What to read when a pack is the wrong size

1. `[build-dsh-archives] dsh-runtime … MB store` and the
   `[pack-inventory] stage=prepackage` line. About 166 MB means the
   toolchain is not in the new zip. Several hundred MB means `prepackage`
   wrote the fat zip.
2. `[after-pack-trim] +…MB dsh runtime` in the builder log. If the
   retry has no such line, the 7z was not built from a tree that
   current `afterPack` prepared.
3. `[pack-inventory] stage=pack Setup.exe bytes=…`. Over 310,000,000
   fails the command. The previous behavior was to keep that exe anyway.
4. On the Setup file itself, list the embedded 7z
   (`$PLUGINSDIR/app-64.7z`) and compare
   `resources/dsh-runtime/dsh-runtime.zip`. The slim zip is about
   166 MB and has no `node_modules/pnpm/pnpm.exe` or
   `node_modules/@pnpm/exe`. Also check there is one office-kit zip,
   one `app.asar`, no second `electron.exe`, and no `dxcompiler.dll`.

## Adding an archive or a module

1. Produce it from `prepackage`, not from a manual step the pack can
   skip.
2. Copy it in `afterPack`. Do not use `extraResources` for a zip that
   only Windows has; a missing directory fails macOS and Linux builds.
3. If NSIS will LZMA the installer, write the zip as STORE
   (`scripts/lib/store-zip.mjs`). Use deflate only for a payload that
   is already compressed, and say so in this document.
4. Exclude the loose tree from `electron-builder.yml` `files` so the
   same bytes are not in `app.asar` as well. `install-layout.mjs` owns
   the generated exclude sentinel. Do not hand-edit between the
   sentinel comments.
5. Add the file to the inventory in `inspectResources`. If it can grow
   by tens of MB, give it a budget in `pack-budget.mjs` and a test.
6. Keep `pnpm` and `@pnpm/exe` out of the teacher tree.
7. Update this document and `docs/DESKTOP_BUILD.md` in the same change.
   A comment at the top of a pack script that still describes the old
   layout is a defect, not history. Historical specs stay historical
   and point here.

## CI must fail closed

- The pack command and the workflow both go through
  `scripts/run-electron-builder.mjs`. A direct `npx electron-builder`
  in `release.yml` skips the delete and the publish lock.
- `--publish never` during the pack. The publish job uploads the
  artifacts. `verify:dsh` fails if the workflow file loses that flag,
  the wrapper, or the budget script.
- The budget step runs before `upload-artifact`. A failed budget skips
  the upload, and the publish job does not run.
- Do not cache `release-v11` or `win-unpacked`.
- Do not treat a missing zip as permission to unpack
  `**/node_modules/**` or to compress with level 0.
- `npm run verify:dsh -- --dist <unpacked>` stays in the Windows job.
  It does not replace the byte budget. A large zip without pnpm paths
  can still pass the pnpm check.

## Future work

Skipping unchanged files on upgrade was designed separately and is not
in `scripts/nsis/installer.nsh`. The current upgrade renames the old
directory and extracts the full tree. That changes install time, not
Setup.exe size. Do not implement it as part of a size-budget change.

## Do not

- Ship `pnpm` or `@pnpm/exe` to teacher machines.
- Set the NSIS 7z to uncompressed, or set `ELECTRON_BUILDER_COMPRESSION_LEVEL=0`.
- Deflate the module zips and then LZMA them.
- Unpack `**/node_modules/**`, or unpack the dsh closure as loose files.
- Pack with `--prepackaged` pointed at a directory whose `afterPack`
  you did not just run.
- Retry a failed Electron download by 7z-ing the `win-unpacked` that is
  already on disk.
- Skip `prepackage` because the zips "are probably still there".
- Publish from the pack command. Upload after the budget exits 0.
- Raise the byte ceiling so a fat tree turns green.
