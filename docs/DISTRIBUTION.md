# Distribution

> **How to ship Education Advisor to end users.** This document covers
> the in-app distribution channel (GitHub Releases + auto-update),
> the offline distribution (USB stick, file share), the school-wide
> deployment, and the alternative channels (apt, brew, winget,
> chocolatey).

## Table of contents

- [Distribution channels overview](#distribution-channels-overview)
- [GitHub Releases + auto-update (recommended)](#github-releases--auto-update-recommended)
- [Offline distribution (USB / file share)](#offline-distribution-usb--file-share)
- [School-wide deployment](#school-wide-deployment)
- [Alternative channels](#alternative-channels)
  - [winget (Windows)](#winget-windows)
  - [Chocolatey (Windows)](#chocolatey-windows)
  - [Homebrew (macOS)](#homebrew-macos)
  - [apt (Debian / Ubuntu)](#apt-debian--ubuntu)
  - [AUR (Arch)](#aur-arch)
- [Multi-class / multi-school deployments](#multi-class--multi-school-deployments)
- [Update policies](#update-policies)
- [Telemetry](#telemetry)
- [Support](#support)

---

## Distribution channels overview

| Channel | Best for | Effort | Auto-update |
| --- | --- | --- | --- |
| **GitHub Releases** | Open-source community, individual teachers | Low | ✓ |
| **Offline (USB / share)** | Schools with no internet on teacher machines | Medium | ✗ |
| **School-wide** | A school IT department rolling out to N teachers | High | Optional |
| **winget / Chocolatey / brew** | Developers, power users | Low | ✓ |
| **apt / AUR** | Linux shops | Medium | ✓ |

This document covers each in turn.

---

## GitHub Releases + auto-update (recommended)

The default distribution channel. The release workflow (in
`.github/workflows/release.yml`) builds the installers on every
tagged release, signs them, and uploads them to a GitHub Release.

### For end users

The user just installs the app, and from then on it updates
itself in the background. The flow:

1. **Day 0**: user downloads the installer from the GitHub
   Releases page and installs.
2. **Day N**: user launches the app. The app checks the GitHub
   Releases API for a newer version. If found, it shows a
   "New version available" toast.
3. **User clicks "Update"**: the app downloads the new installer
   to `%TEMP%` and waits for the user to quit.
4. **User quits the app**: the installer runs in update mode
   and replaces the app.
5. **Next launch**: the user is on the new version.

### For maintainers

Cutting a release is one command:

```bash
# 1. Update the version in package.json
npm version minor  # or major / patch

# 2. Update CHANGELOG.md

# 3. Commit and tag
git add -A
git commit -m "Release v0.2.0"
git tag v0.2.0

# 4. Push
git push && git push --tags

# 5. Wait for the release workflow to finish (~10 minutes)
# 6. Check the GitHub Releases page
```

The workflow will:

1. Build the Windows, macOS, and Linux installers.
2. Generate checksums.
3. Sign the checksums with cosign.
4. Create a GitHub Release with the installers, checksums, and
   signatures.

### Configuring auto-update

The default `publish` config in `electron-builder.yml`:

```yaml
publish:
  provider: github
  releaseType: release
```

To pin to a specific channel (e.g. `beta`):

```yaml
publish:
  provider: github
  releaseType: beta
```

To pin to a specific repo (e.g. a fork):

```yaml
publish:
  provider: github
  owner: your-org
  repo: your-fork
```

---

## Offline distribution (USB / file share)

For schools where the teacher machines don't have internet access
(or where the IT department prefers to control the update cadence
manually), the offline distribution is a USB stick with the
installer and the EAA binary.

### What to put on the USB

```
AI-Workstation-Offline-v0.1.0/
├── installers/
│   ├── Education Advisor-Setup-0.1.0.exe
│   ├── Education Advisor-0.1.0-Portable.exe
│   ├── (macOS DMG, if needed)
│   └── (Linux .deb, if needed)
├── eaa-binaries/
│   ├── win32-x64/eaa.exe
│   ├── darwin-arm64/eaa
│   ├── linux-x64/eaa
│   └── ...
├── checksums/
│   └── SHA256SUMS
├── README.txt                 # a one-pager for the IT admin
└── install.cmd (Windows)      # an idempotent install script
```

### The `install.cmd` script

```bat
@echo off
REM Install Education Advisor and the EAA binary.
REM
REM Usage: install.cmd [/quiet]
REM
REM /quiet runs the installer silently (no UI).

setlocal

set INSTALLER_DIR=%~dp0installers
set EAA_DIR=%LOCALAPPDATA%\Education Advisor\eaa-binaries

echo Installing Education Advisor...
if /I "%~1"=="/quiet" (
  "%INSTALLER_DIR%\Education Advisor-Setup-0.1.0.exe" /S
) else (
  "%INSTALLER_DIR%\Education Advisor-Setup-0.1.0.exe"
)

echo Installing EAA binary...
mkdir "%EAA_DIR%\win32-x64" 2>nul
copy /Y "%~dp0eaa-binaries\win32-x64\eaa.exe" "%EAA_DIR%\win32-x64\"

echo Verifying checksums...
certutil -hashfile "%INSTALLER_DIR%\Education Advisor-Setup-0.1.0.exe" SHA256
type "%~dp0checksums\SHA256SUMS"

echo Done.
endlocal
```

### How the user gets updates

The offline distribution has **no auto-update**. The user (or the
IT admin) needs to re-run the installer with a newer version.

This is a feature, not a bug: in many school settings, updates are
rolled out in batches (e.g. during the winter break) and the IT
admin wants to control the cadence.

---

## School-wide deployment

For a school-wide rollout, the recommended approach is a
**centralized configuration file** plus an **MSI wrapper** (for
Active Directory) or a **custom NSIS script** (for manual rollout).

### Step 1: Customize the `config/` directory

Edit the shipped `config/` to match the school's needs:

- `config/agents.yaml` — enable / disable agents
- `config/reason-codes.json` — add school-specific reason codes
- `config/default-settings.json` — set the default LLM, theme, etc.

### Step 2: Build a custom installer

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
git checkout v0.1.0

# Apply your customizations
# ...

npm ci
npm run build:eaa    # compiles core/eaa-cli from source — requires Rust (https://rustup.rs)
npm run build
npm run package
```

The resulting `release/Education Advisor-Setup-0.1.0-custom.exe` is
your custom installer.

### Step 3: Distribute

| Method | Tooling | Notes |
| --- | --- | --- |
| **Active Directory GPO** | `msiexec /i AI-Workstation.msi /quiet` | Convert NSIS to MSI with [nsis-msi-converter](https://github.com/mrcomplicated/nsis-msi-converter) |
| **SCCM / Intune** | Upload the .exe to the package library | Most common in enterprise |
| **MDT** | Add to the deployment share | Microsoft's free deployment tool |
| **Manual** | USB stick + the `install.cmd` script | Low-tech, works everywhere |

### Step 4: Configure per-machine settings

After install, the IT admin can pre-configure the app's settings
by writing `userData/settings.json` to each machine:

```bash
# On the teacher's machine
mkdir -p "%APPDATA%\Education Advisor"
copy settings.json "%APPDATA%\Education Advisor\"
```

The settings file format is the same as the in-app Settings
page; see [`CONFIGURATION.md`](./CONFIGURATION.md#in-app-settings)
for the full schema.

### Step 5: Configure the LLM (optional)

If the school is running a centralized LLM (e.g. an Ollama
server in the IT room), pre-configure the LLM settings in
`settings.json`:

```json
{
  "models": {
    "highQualityModel": "custom/llama-3-70b",
    "lowCostModel": "custom/qwen-3.5-4b",
    "customModels": [
      {
        "providerId": "custom",
        "name": "School LLM",
        "baseUrl": "http://10.0.0.50:11434/v1",
        "apiKey": ""
      }
    ]
  }
}
```

This is much more cost-effective than paying for hosted LLM
calls per teacher.

---

## Alternative channels

### winget (Windows)

The Windows Package Manager. Submit a manifest to
<https://github.com/microsoft/winget-pkgs>:

```yaml
# $schema: https://aka.ms/winget-manifest.version.1.6.0.schema.json
PackageIdentifier: 232252.AIWorkstation
PackageVersion: 0.1.0
PackageLocale: en-US
Publisher: Education Advisor AI Contributors
PackageName: Education Advisor
License: MIT
ShortDescription: Multi-agent AI desktop app for class teachers
ManifestType: defaultLocale
ManifestVersion: 1.6.0
```

The full submission guide is in the
[winget-pkgs repo](https://github.com/microsoft/winget-pkgs/blob/master/CONTRIBUTING.md).

### Chocolatey (Windows)

Submit a package to <https://chocolatey.org/packages>. The
maintainer is the same as the GitHub maintainer.

```powershell
# A typical chocolatey install script (tools/chocolateyinstall.ps1)
$ErrorActionPreference = 'Stop'

$packageName = 'education-advisor'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"
$url = 'https://github.com/232252/education-advisor/releases/download/v0.1.0/AI-Workstation-Setup-0.1.0.exe'
$checksum = '...'  # SHA-256
$checksumType = 'sha256'

$packageArgs = @{
  packageName    = $packageName
  unzipLocation  = $toolsDir
  fileType       = 'exe'
  url            = $url
  checksum       = $checksum
  checksumType   = $checksumType
  silentArgs     = '/S'
  validExitCodes = @(0)
  softwareName   = 'Education Advisor'
}

Install-ChocolateyPackage @packageArgs
```

### Homebrew (macOS)

Submit a formula to <https://github.com/Homebrew/homebrew-cask>:

```ruby
cask "education-advisor" do
  version "0.1.0"
  sha256 "..."  # SHA-256 of the .dmg

  url "https://github.com/232252/education-advisor/releases/download/v#{version}/AI-Workstation-#{version}-arm64.dmg"
  name "Education Advisor"
  desc "Multi-agent AI desktop app for class teachers"
  homepage "https://github.com/232252/education-advisor"

  app "Education Advisor.app"

  zap trash: [
    "~/Library/Application Support/Education Advisor",
    "~/Library/Caches/Education Advisor",
  ]
end
```

### apt (Debian / Ubuntu)

The maintainer team is **not** currently hosting an apt
repository. If you want to do this for your school, the
recommended approach is:

1. Host a local apt repo on a school-internal server.
2. Use `aptly` or `reprepro` to manage it.
3. Add the repo to the school's `/etc/apt/sources.list.d/`.

For community apt, the standard approach is to open a
[Request for Packaging](https://bugs.debian.org/cgi-bin/pkgreport.cgi?pkg=wnpp)
on the Debian bug tracker.

### AUR (Arch)

The community is **not** currently maintaining an AUR package.
If you want to maintain one, the standard approach is:

```bash
# PKGBUILD
pkgname=education-advisor
pkgver=0.1.0
pkgrel=1
pkgdesc="Multi-agent AI desktop app for class teachers"
arch=('x86_64')
url="https://github.com/232252/education-advisor"
license=('MIT')
depends=('electron33' 'better-sqlite3')
source=("https://github.com/232252/education-advisor/releases/download/v${pkgver}/AI-Workstation-${pkgver}.AppImage")
sha256sums=('...')

package() {
  install -Dm755 "${srcdir}/AI-Workstation-${pkgver}.AppImage" "${pkgdir}/opt/education-advisor/education-advisor.AppImage"
  install -Dm644 /dev/stdin "${pkgdir}/usr/share/applications/education-advisor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Education Advisor
Exec=/opt/education-advisor/education-advisor.AppImage %U
Icon=education-advisor
Categories=Education;Office;
EOF
}
```

---

## Multi-class / multi-school deployments

For deployments where one school has multiple classes (managed by
different teachers) or one district has multiple schools, the
recommended approach is:

1. **A shared EAA CLI server** (hosted on a school server or a
   cloud VM). See the EAA CLI's `multi-tenant` branch for
   the server-side code.
2. **A per-machine thin client** (this app), configured to talk
   to the server.
3. **A per-teacher configuration** in `userData/settings.json`
   that points to the right class.

The server-side supports:

- Per-class data isolation
- Per-school admin accounts
- Cross-class analytics
- Centralized audit logging

This is a **v0.4.0** feature; today, the per-machine install
model is the only one we ship.

---

## Update policies

The app has three update policies (configurable in the in-app
Settings → General):

- **Automatic (default)**: download and prompt to install on
  quit. Best for individual users.
- **Manual**: check for updates on demand, via Settings → About.
  Best for IT-managed deployments.
- **Disabled**: never check for updates. Best for air-gapped
  deployments.

The school-wide deployment guide above uses **Disabled** plus an
IT-managed update cadence.

---

## Telemetry

The app does **not** send any data to the maintainer team by
default. The `telemetry` setting is `false` out of the box.

If you opt in (Settings → General → Telemetry), the app sends:

- Anonymous usage events (agent runs, tool calls, errors) to a
  configurable endpoint.
- No PII, no student data, no LLM content.
- See [`SECURITY.md`](../SECURITY.md#data-in-motion) for the
  details.

For school-wide deployments, the recommended setting is
**opt-out per machine** via the `userData/settings.json` file
written by the IT admin.

---

## Support

End users get support through the
[GitHub Discussions](https://github.com/232252/education-advisor/discussions)
forum. The maintainer team commits to a 2-business-day response
on weekdays.

School-wide deployments can request a **support contract** by
emailing the maintainer team. The current rate is ¥X / teacher /
month and includes:

- Priority bug fixes
- Phone / WeChat support during Chinese business hours
- Custom agent development (up to 2 agents / month)
- Quarterly on-site visit (for schools within driving distance)

This is **not** a paid open-source product; the source is MIT
and you're free to fork and self-support. The support contract
is a service the maintainer team offers, not a precondition for
using the software.

---

## Next steps

- [DESKTOP_BUILD.md](./DESKTOP_BUILD.md) — how to build the
  installers.
- [DEVELOPMENT.md](./DEVELOPMENT.md) — how to set up your dev
  environment.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — the big list of
  common issues.
