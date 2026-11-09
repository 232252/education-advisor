// =============================================================
// 下载页 Worker 纯函数单测（site-build/worker/src/releases.js）
// 用例资产名全部来自 GitHub/Gitee Releases API 实查（2026-11-08），
// 覆盖三种历史命名演进：v3.3.x 无版本号 / v3.2.0 带版本号 /
// v0.x 点号命名（Education.Advisor-...）。
// =============================================================
import { describe, it, expect } from 'vitest';
import {
  classifyAsset,
  inferArch,
  normalizeRelease,
  buildPayload,
  splitChannels,
} from '../../site-build/worker/src/releases.js';

describe('inferArch', () => {
  it('按名称标注推断架构，arm64 优先于 arm', () => {
    expect(inferArch('Education-Advisor-arm64.dmg')).toBe('arm64');
    expect(inferArch('education-advisor_3.2.0_amd64.deb')).toBe('x64');
    expect(inferArch('app-armv7-release.apk')).toBe('arm');
  });

  it('无标注时兜底 x64（历史 dmg 为 Intel/universal）', () => {
    expect(inferArch('Education.Advisor-0.1.0-rc.1.dmg')).toBe('x64');
    expect(inferArch('Education-Advisor-Setup.exe')).toBe('x64');
  });
});

describe('classifyAsset', () => {
  it('Windows：installer / portable / 便携 zip（v0.2 命名）', () => {
    expect(classifyAsset('Education-Advisor-Setup.exe')).toEqual({
      os: 'windows', arch: 'x64', kind: 'installer', label: 'Windows 安装程序 (.exe)',
    });
    expect(classifyAsset('Education-Advisor-Portable.exe')).toEqual({
      os: 'windows', arch: 'x64', kind: 'portable', label: 'Windows 便携版 (.exe)',
    });
    expect(classifyAsset('Education-Advisor-3.2.0-Setup.exe').kind).toBe('installer');
    expect(classifyAsset('Education-Advisor-3.2.0-Portable.exe').kind).toBe('portable');
    // 便携 zip 必须先于 macOS zip 规则命中
    expect(classifyAsset('EducationAdvisor-Portable-Windows-x64.zip')).toEqual({
      os: 'windows', arch: 'x64', kind: 'portable', label: 'Windows 便携版 (.zip)',
    });
  });

  it('macOS：dmg 双架构 + 无标注兜底 + 便携 zip', () => {
    expect(classifyAsset('Education-Advisor-arm64.dmg')).toEqual({
      os: 'macos', arch: 'arm64', kind: 'dmg', label: 'macOS 磁盘映像 (.dmg)',
    });
    expect(classifyAsset('Education-Advisor-x64.dmg')).toEqual({
      os: 'macos', arch: 'x64', kind: 'dmg', label: 'macOS 磁盘映像 (.dmg)',
    });
    // v0.x / v1.0.3 的无架构标注 dmg
    expect(classifyAsset('Education-Advisor.dmg')).toEqual({
      os: 'macos', arch: 'x64', kind: 'dmg', label: 'macOS 磁盘映像 (.dmg)',
    });
    expect(classifyAsset('Education.Advisor-0.1.0-rc.1.dmg').arch).toBe('x64');
    expect(classifyAsset('Education-Advisor-arm64.zip')).toEqual({
      os: 'macos', arch: 'arm64', kind: 'zip', label: 'macOS 便携压缩包 (.zip)',
    });
    expect(classifyAsset('Education-Advisor-x64.zip').kind).toBe('zip');
  });

  it('Linux：AppImage / deb（含 amd64 命名）', () => {
    expect(classifyAsset('Education-Advisor.AppImage')).toEqual({
      os: 'linux', arch: 'x64', kind: 'appimage', label: 'Linux 便携版 (.AppImage)',
    });
    expect(classifyAsset('Education-Advisor.deb')).toEqual({
      os: 'linux', arch: 'x64', kind: 'deb', label: 'Linux 安装包 (.deb)',
    });
    expect(classifyAsset('education-advisor_3.2.0_amd64.deb').kind).toBe('deb');
    expect(classifyAsset('Education.Advisor-0.1.0-rc.1.AppImage').kind).toBe('appimage');
  });

  it('meta：blockmap / latest*.yml / 源码包 / 单文件 sha256 不进表', () => {
    expect(classifyAsset('Education-Advisor-Setup.exe.blockmap').kind).toBe('meta');
    expect(classifyAsset('latest.yml').kind).toBe('meta');
    expect(classifyAsset('latest-mac.yml').kind).toBe('meta');
    expect(classifyAsset('latest-linux.yml').kind).toBe('meta');
    expect(classifyAsset('v3.3.5.zip').kind).toBe('meta');
    expect(classifyAsset('v3.3.5.tar.gz').kind).toBe('meta');
    expect(classifyAsset('Education-Advisor.dmg.sha256').kind).toBe('meta');
  });

  it('SHA256SUMS 单独识别为 checksums，不进资产表', () => {
    expect(classifyAsset('SHA256SUMS').kind).toBe('checksums');
  });

  it('未识别资产归入 other（保留展示，不丢弃）', () => {
    expect(classifyAsset('something-weird.bin')).toEqual({
      os: null, arch: null, kind: 'other', label: '其他文件',
    });
  });
});

describe('normalizeRelease', () => {
  const githubRelease = {
    tag_name: 'v3.3.5',
    prerelease: false,
    published_at: '2026-11-08T12:42:29Z',
    html_url: 'https://github.com/232252/education-advisor/releases/tag/v3.3.5',
    body: '**Full Changelog**: https://github.com/232252/education-advisor/compare/v3.3.4...v3.3.5',
    assets: [
      { name: 'Education-Advisor-Setup.exe', size: 475779113, browser_download_url: 'https://github.com/232252/education-advisor/releases/download/v3.3.5/Education-Advisor-Setup.exe' },
      { name: 'Education-Advisor-Setup.exe.blockmap', size: 373358, browser_download_url: 'https://github.com/232252/education-advisor/releases/download/v3.3.5/Education-Advisor-Setup.exe.blockmap' },
      { name: 'Education-Advisor.AppImage', size: 423359908, browser_download_url: 'https://github.com/232252/education-advisor/releases/download/v3.3.5/Education-Advisor.AppImage' },
      { name: 'latest.yml', size: 351, browser_download_url: 'https://github.com/232252/education-advisor/releases/download/v3.3.5/latest.yml' },
      { name: 'SHA256SUMS', size: 756, browser_download_url: 'https://github.com/232252/education-advisor/releases/download/v3.3.5/SHA256SUMS' },
    ],
  };

  it('剔除 meta / checksums 资产，仅保留可下载物', () => {
    const rel = normalizeRelease(githubRelease, []);
    expect(rel.assets.map((a) => a.name)).toEqual([
      'Education-Advisor-Setup.exe',
      'Education-Advisor.AppImage',
    ]);
  });

  it('giteeAssets 命中 → giteeUrl 指向 Gitee 下载；未命中 → null', () => {
    const rel = normalizeRelease(githubRelease, ['Education-Advisor.AppImage', 'SHA256SUMS']);
    const exe = rel.assets.find((a) => a.name === 'Education-Advisor-Setup.exe');
    const appimage = rel.assets.find((a) => a.name === 'Education-Advisor.AppImage');
    expect(exe.giteeUrl).toBeNull(); // >100MB 未同步
    expect(appimage.giteeUrl).toBe(
      'https://gitee.com/qdzwwqd/education-advisor/releases/download/v3.3.5/Education-Advisor.AppImage',
    );
  });

  it('checksumsUrl 提为 release 级；giteeChecksumsUrl 按 SHA256SUMS 是否同步判定', () => {
    const noGitee = normalizeRelease(githubRelease, []);
    expect(noGitee.checksumsUrl).toContain('SHA256SUMS');
    expect(noGitee.giteeChecksumsUrl).toBeNull();

    const withGitee = normalizeRelease(githubRelease, ['SHA256SUMS']);
    expect(withGitee.giteeChecksumsUrl).toBe(
      'https://gitee.com/qdzwwqd/education-advisor/releases/download/v3.3.5/SHA256SUMS',
    );
  });

  it('prerelease 与基础字段透传', () => {
    const rel = normalizeRelease(githubRelease, []);
    expect(rel.tag).toBe('v3.3.5');
    expect(rel.prerelease).toBe(false);
    expect(rel.publishedAt).toBe('2026-11-08T12:42:29Z');
    expect(rel.htmlUrl).toBe(githubRelease.html_url);
    expect(rel.body).toContain('Full Changelog');
  });
});

describe('buildPayload', () => {
  it('按发布时间倒序，并按 tag 匹配 Gitee 资产集合', () => {
    const releases = [
      { ...makeRaw('v3.3.4', '2026-09-25T11:28:04Z'), assets: [] },
      { ...makeRaw('v3.3.5', '2026-11-08T12:42:29Z'), assets: [] },
      { ...makeRaw('v3.3.3', '2026-09-12T06:41:52Z'), assets: [] },
    ];
    const gitee = [
      { tag_name: 'v3.3.5', assets: [{ name: 'SHA256SUMS' }] },
      { tag_name: 'v3.3.4', assets: [] },
    ];
    const payload = buildPayload(releases, gitee);
    expect(payload.releases.map((r) => r.tag)).toEqual(['v3.3.5', 'v3.3.4', 'v3.3.3']);
    expect(payload.repo).toEqual({ owner: '232252', name: 'education-advisor' });
    expect(typeof payload.updatedAt).toBe('string');
    // Gitee 上没有的 tag → giteeChecksumsUrl 为 null
    expect(payload.releases.find((r) => r.tag === 'v3.3.3').giteeChecksumsUrl).toBeNull();
  });

  it('giteeReleases 为 null（抓取失败）不阻断归一化', () => {
    const payload = buildPayload([makeRaw('v3.3.5', '2026-11-08T12:42:29Z')], null);
    expect(payload.releases).toHaveLength(1);
  });
});

describe('splitChannels', () => {
  const channels = () => splitChannels([
    { tag: 'v0.1.0-rc.1', prerelease: true, publishedAt: '2026-08-19T06:38:50Z', assets: [] },
    { tag: 'v3.3.4', prerelease: false, publishedAt: '2026-09-25T11:28:04Z', assets: [] },
    { tag: 'v3.3.5', prerelease: false, publishedAt: '2026-11-08T12:42:29Z', assets: [] },
  ]);

  it('稳定版 = 最新非预发布；预发布 = 最新预发布', () => {
    const { stable, prerelease } = channels();
    expect(stable.tag).toBe('v3.3.5');
    expect(prerelease.tag).toBe('v0.1.0-rc.1');
  });

  it('历史版本 = 全部 release，按时间倒序', () => {
    const { all } = channels();
    expect(all.map((r) => r.tag)).toEqual(['v3.3.5', 'v3.3.4', 'v0.1.0-rc.1']);
  });

  it('无预发布时 prerelease 为 null', () => {
    const { prerelease } = splitChannels([
      { tag: 'v3.3.5', prerelease: false, publishedAt: '2026-11-08T12:42:29Z', assets: [] },
    ]);
    expect(prerelease).toBeNull();
  });
});

function makeRaw(tag, publishedAt) {
  return {
    tag_name: tag,
    prerelease: false,
    published_at: publishedAt,
    html_url: `https://github.com/232252/education-advisor/releases/tag/${tag}`,
    body: '',
    assets: [],
  };
}
