// =============================================================
// GitHub Release 资产分类与归一化（纯函数，无 IO、无全局依赖）
// - 分类按「模式」匹配而非固定文件名：资产命名跨版本有三种演进
//   （v3.3.x 无版本号 / v3.2.0 带版本号 / v0.x 点号命名），见
//   tests/site/releases.test.ts 的真实资产用例。
// - 本文件是分类规则的唯一事实来源：Worker 用它供数，前端只渲染。
// =============================================================

const GITEE_OWNER = 'qdzwwqd';
const GITEE_REPO = 'education-advisor';

function giteeDownloadUrl(tag, name) {
  return `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/${name}`;
}

// 架构推断：按名称标注推断，无标注时按扩展名兜底 x64
// （现有产物 .exe/.dmg/.AppImage/.deb 均以 x64 为主，早期无架构标注的
//  dmg 为 Intel/universal，兜底 x64 与历史事实一致）。
const ARCH_PATTERNS = [
  { re: /arm64|aarch64/i, arch: 'arm64' },
  { re: /x64|amd64|x86_64|win64/i, arch: 'x64' },
  { re: /armv7|armhf|arm(?![a-z0-9])/i, arch: 'arm' },
  { re: /mips/i, arch: 'mips' },
];

export function inferArch(name) {
  for (const { re, arch } of ARCH_PATTERNS) {
    if (re.test(name)) return arch;
  }
  return 'x64';
}

/**
 * 资产分类。返回：
 * - { kind: 'meta' }                        差量更新清单 / 源码包 / 单文件校验（不进表）
 * - { kind: 'checksums' }                   SHA256SUMS（提为 release 级校验入口）
 * - { os, arch, kind, label }               用户可下载物
 * - { os: null, arch: null, kind: 'other' } 未识别（保留展示，便于发现命名演进）
 */
export function classifyAsset(name) {
  const lower = name.toLowerCase();

  // --- meta：不进安装包表 ---
  if (lower.endsWith('.blockmap')) return { kind: 'meta' }; // electron-builder 差量更新清单
  if (/^latest[\w-]*\.yml$/.test(lower)) return { kind: 'meta' }; // electron-updater 通道清单
  if (/^v[\w.+-]+\.(zip|tar\.gz)$/.test(lower)) return { kind: 'meta' }; // 自动生成源码包（v3.3.5.zip 等）
  if (lower.endsWith('.sha256')) return { kind: 'meta' }; // v1.0.3 的单文件校验

  if (lower === 'sha256sums') return { kind: 'checksums' };

  // --- Windows ---
  if (lower.endsWith('.exe')) {
    if (lower.includes('portable')) {
      return { os: 'windows', arch: inferArch(name), kind: 'portable', label: 'Windows 便携版 (.exe)' };
    }
    return { os: 'windows', arch: inferArch(name), kind: 'installer', label: 'Windows 安装程序 (.exe)' };
  }
  // v0.2/v0.3 的 EducationAdvisor-Portable-Windows-x64.zip：便携 zip（须先于 macOS zip 规则）
  if (lower.endsWith('.zip') && lower.includes('portable') && lower.includes('windows')) {
    return { os: 'windows', arch: inferArch(name), kind: 'portable', label: 'Windows 便携版 (.zip)' };
  }

  // --- macOS ---
  if (lower.endsWith('.dmg')) {
    return { os: 'macos', arch: inferArch(name), kind: 'dmg', label: 'macOS 磁盘映像 (.dmg)' };
  }
  if (lower.endsWith('.zip')) {
    return { os: 'macos', arch: inferArch(name), kind: 'zip', label: 'macOS 便携压缩包 (.zip)' };
  }

  // --- Linux ---
  if (lower.endsWith('.appimage')) {
    return { os: 'linux', arch: inferArch(name), kind: 'appimage', label: 'Linux 便携版 (.AppImage)' };
  }
  if (lower.endsWith('.deb')) {
    return { os: 'linux', arch: inferArch(name), kind: 'deb', label: 'Linux 安装包 (.deb)' };
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.rpm')) {
    return { os: 'linux', arch: inferArch(name), kind: 'archive', label: 'Linux 压缩包' };
  }

  return { os: null, arch: null, kind: 'other', label: '其他文件' };
}

/**
 * 归一化单个 GitHub release。giteeAssets 为该 tag 在 Gitee 上实际存在的
 * 资产名集合（Set 或数组）；命中的资产补 giteeUrl，未命中为 null
 * （Gitee 免费版单附件 100MB 上限，安装包大多未同步）。
 */
export function normalizeRelease(release, giteeAssets) {
  const gitee = giteeAssets instanceof Set ? giteeAssets : new Set(giteeAssets || []);
  const checksumAsset = (release.assets || []).find((a) => a.name.toLowerCase() === 'sha256sums');

  const assets = (release.assets || [])
    .map((asset) => ({ asset, cls: classifyAsset(asset.name) }))
    .filter(({ cls }) => cls.kind !== 'meta' && cls.kind !== 'checksums')
    .map(({ asset, cls }) => ({
      name: asset.name,
      size: asset.size,
      url: asset.browser_download_url,
      os: cls.os,
      arch: cls.arch,
      kind: cls.kind,
      label: cls.label,
      giteeUrl: gitee.has(asset.name) ? giteeDownloadUrl(release.tag_name, asset.name) : null,
    }));

  return {
    tag: release.tag_name,
    prerelease: Boolean(release.prerelease),
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    body: release.body || '',
    assets,
    checksumsUrl: checksumAsset ? checksumAsset.browser_download_url : null,
    giteeChecksumsUrl: gitee.has('SHA256SUMS')
      ? giteeDownloadUrl(release.tag_name, 'SHA256SUMS')
      : null,
  };
}

/**
 * 全量 payload：按发布时间倒序 + 逐 release 归一化。
 * giteeReleases 为 Gitee releases API 原始数组（可为 null：抓取失败不阻断）。
 */
export function buildPayload(releases, giteeReleases) {
  const giteeByTag = new Map(
    (giteeReleases || []).map((r) => [r.tag_name, (r.assets || []).map((a) => a.name)]),
  );
  const sorted = [...releases].sort(
    (a, b) => new Date(b.published_at) - new Date(a.published_at),
  );
  return {
    updatedAt: new Date().toISOString(),
    repo: { owner: '232252', name: GITEE_REPO },
    releases: sorted.map((r) => normalizeRelease(r, giteeByTag.get(r.tag_name) || [])),
  };
}

/**
 * 通道切分（入参为归一化后的 release 数组）：
 * - stable：最新的非预发布版
 * - prerelease：最新的预发布版（可能为 null）
 * - all：全部 release（历史版本下拉）
 */
export function splitChannels(releases) {
  const sorted = [...releases].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
  );
  return {
    stable: sorted.find((r) => !r.prerelease) || null,
    prerelease: sorted.find((r) => r.prerelease) || null,
    all: sorted,
  };
}
