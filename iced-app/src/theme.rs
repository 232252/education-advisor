//! Modern commercial design system for iced.
//!
//! Mirrors the original egui palette: refined dark/light mode with subtle
//! gradients, glass surfaces and a consistent accent.

use iced::Color;

use crate::models::ThemeMode;

/// Tokens for one of the three themes (Dark / Light / Auto-resolved-to-Dark-or-Light).
///
/// In `Auto` mode, the runtime picks the actual color set based on the OS
/// preference; the resulting `Theme` instance is always one of `dark()` or
/// `light()`, so all downstream code only ever sees two concrete variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemePreference {
    Dark,
    Light,
    Auto,
}

impl ThemePreference {
    pub fn from_mode(m: ThemeMode) -> Self {
        match m {
            ThemeMode::Dark => Self::Dark,
            ThemeMode::Light => Self::Light,
            ThemeMode::Auto => Self::Auto,
        }
    }
}

/// Generate the application's procedural icon as raw RGBA bytes.
pub fn app_icon_rgba() -> (Vec<u8>, u32, u32) {
    let size = 64usize;
    let mut rgba = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let nx = x as f32 / size as f32;
            let ny = y as f32 / size as f32;
            let t = (nx + ny) / 2.0;
            let r = (40.0 + t * 70.0) as u8;
            let g = (80.0 + t * 90.0) as u8;
            let b = (180.0 + t * 60.0) as u8;
            let mut alpha = 255u8;
            let corner = 12.0;
            let dx = (x as f32).min((size - 1 - x) as f32);
            let dy = (y as f32).min((size - 1 - y) as f32);
            if dx < corner || dy < corner {
                let d = (dx.min(dy) - corner).max(0.0);
                alpha = (255.0 * (d / corner).clamp(0.0, 1.0)) as u8;
            }
            rgba.extend_from_slice(&[r, g, b, alpha]);
        }
    }
    (rgba, size as u32, size as u32)
}

fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color::from_rgb8(r, g, b)
}

fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, a)
}

#[derive(Clone)]
pub struct Theme {
    pub dark: bool,
    pub bg: Color,
    pub bg_gradient_from: Color,
    pub bg_gradient_to: Color,
    pub elevated: Color,
    pub bg_elevated: Color,
    pub surface: Color,
    pub surface_glass: Color,
    pub surface_hover: Color,
    pub border: Color,
    pub border_strong: Color,
    pub text: Color,
    pub text_dim: Color,
    pub text_faint: Color,
    pub accent: Color,
    pub accent_strong: Color,
    pub accent_hover: Color,
    pub accent_dim: Color,
    pub accent_bg: Color,
    pub success: Color,
    pub success_dim: Color,
    pub warning: Color,
    pub warning_dim: Color,
    pub danger: Color,
    pub danger_dim: Color,
    pub info: Color,
    pub info_dim: Color,
    pub purple: Color,
    pub purple_dim: Color,
    pub cyan: Color,
    pub pink: Color,
    pub shadow: Color,
}

impl Theme {
    pub fn dark() -> Self {
        Self {
            dark: true,
            bg: rgb(10, 12, 20),
            bg_gradient_from: rgb(10, 12, 20),
            bg_gradient_to: rgb(17, 21, 35),
            elevated: rgb(17, 21, 35),
            bg_elevated: rgb(17, 21, 35),
            surface: rgb(22, 27, 42),
            surface_glass: rgba(22, 27, 42, 0.80),
            surface_hover: rgb(32, 38, 56),
            border: rgba(99, 102, 241, 0.12),
            border_strong: rgba(129, 140, 248, 0.25),
            text: rgb(241, 245, 249),
            text_dim: rgb(148, 163, 184),
            text_faint: rgb(100, 116, 139),
            accent: rgb(129, 140, 248),
            accent_strong: rgb(99, 102, 241),
            accent_hover: rgb(165, 180, 252),
            accent_dim: rgba(129, 140, 248, 0.15),
            accent_bg: rgba(129, 140, 248, 0.08),
            success: rgb(52, 211, 153),
            success_dim: rgba(52, 211, 153, 0.08),
            warning: rgb(251, 191, 36),
            warning_dim: rgba(251, 191, 36, 0.08),
            danger: rgb(248, 113, 113),
            danger_dim: rgba(248, 113, 113, 0.08),
            info: rgb(56, 189, 248),
            info_dim: rgba(56, 189, 248, 0.08),
            purple: rgb(192, 132, 252),
            purple_dim: rgba(192, 132, 252, 0.08),
            cyan: rgb(34, 211, 238),
            pink: rgb(244, 114, 182),
            shadow: rgba(0, 0, 0, 0.50),
        }
    }

    pub fn light() -> Self {
        Self {
            dark: false,
            bg: rgb(244, 245, 250),
            bg_gradient_from: rgb(244, 245, 250),
            bg_gradient_to: rgb(235, 240, 250),
            elevated: rgb(255, 255, 255),
            bg_elevated: rgb(255, 255, 255),
            surface: rgb(255, 255, 255),
            surface_glass: rgba(255, 255, 255, 0.78),
            surface_hover: rgb(238, 242, 252),
            border: rgba(99, 102, 241, 0.10),
            border_strong: rgba(99, 102, 241, 0.18),
            text: rgb(15, 23, 42),
            text_dim: rgb(71, 85, 105),
            text_faint: rgb(148, 163, 184),
            accent: rgb(99, 102, 241),
            accent_strong: rgb(79, 70, 229),
            accent_hover: rgb(129, 140, 248),
            accent_dim: rgba(99, 102, 241, 0.12),
            accent_bg: rgba(99, 102, 241, 0.07),
            success: rgb(16, 185, 129),
            success_dim: rgba(16, 185, 129, 0.08),
            warning: rgb(245, 158, 11),
            warning_dim: rgba(245, 158, 11, 0.08),
            danger: rgb(239, 68, 68),
            danger_dim: rgba(239, 68, 68, 0.08),
            info: rgb(14, 165, 233),
            info_dim: rgba(14, 165, 233, 0.08),
            purple: rgb(168, 85, 247),
            purple_dim: rgba(168, 85, 247, 0.08),
            cyan: rgb(6, 182, 212),
            pink: rgb(236, 72, 153),
            shadow: rgba(15, 23, 42, 0.06),
        }
    }

    /// `Auto` mode: read the OS preference and return the resolved theme.
    /// On Windows this reads `HKCU\...\Themes\Personalize\AppsUseLightTheme`.
    /// On macOS / Linux this reads `~/.config/gtk-3.0/settings.ini` or falls
    /// back to dark. The current function returns `dark()` on platforms
    /// where detection is not yet wired in; the real implementation lives
    /// in `app::detect_os_theme` which is called at startup.
    pub fn auto(os_uses_light: bool) -> Self {
        if os_uses_light { Self::light() } else { Self::dark() }
    }

    pub fn risk_color(&self, level: crate::models::RiskLevel) -> Color {
        match level {
            crate::models::RiskLevel::Low => self.success,
            crate::models::RiskLevel::Medium => self.warning,
            crate::models::RiskLevel::High => rgb(249, 115, 22),
            crate::models::RiskLevel::Critical => self.danger,
        }
    }

    pub fn lerp(a: Color, b: Color, t: f32) -> Color {
        let t = t.clamp(0.0, 1.0);
        Color::from_rgba(
            a.r + (b.r - a.r) * t,
            a.g + (b.g - a.g) * t,
            a.b + (b.b - a.b) * t,
            a.a + (b.a - a.a) * t,
        )
    }
}

/// Detect whether the OS prefers light mode. Used for `ThemeMode::Auto`.
///
/// * Windows: reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize\AppsUseLightTheme`.
/// * macOS: reads `defaults read -g AppleInterfaceStyle` (returns "Dark" when dark mode is on).
/// * Linux: checks `~/.config/gtk-3.0/settings.ini` for `gtk-application-prefer-dark-theme=1`.
/// * Fallback (or any error): `false` (dark).
pub fn detect_os_uses_light() -> bool {
    #[cfg(target_os = "windows")]
    {
        detect_windows_light().unwrap_or(false)
    }
    #[cfg(target_os = "macos")]
    {
        detect_macos_light().unwrap_or(false)
    }
    #[cfg(target_os = "linux")]
    {
        detect_linux_light().unwrap_or(false)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn detect_windows_light() -> Option<bool> {
    use std::process::Command;
    // Use `reg query` to avoid pulling the `winreg` crate dependency. Returns
    // a value of 1 (light) or 0 (dark) under `REG_DWORD`.
    let out = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "/v",
            "AppsUseLightTheme",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    // Output looks like: `    AppsUseLightTheme    REG_DWORD    0x1`
    let last = s.split_whitespace().last()?;
    match last {
        "0x1" | "1" => Some(true),
        "0x0" | "0" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn detect_macos_light() -> Option<bool> {
    use std::process::Command;
    let out = Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .ok()?;
    if !out.status.success() {
        // Key absent => light mode is the default on macOS.
        return Some(true);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Some(s != "Dark")
}

#[cfg(target_os = "linux")]
fn detect_linux_light() -> Option<bool> {
    use std::fs;
    // Try gtk-3 first.
    if let Some(home) = dirs::config_dir() {
        let p = home.join("gtk-3.0").join("settings.ini");
        if let Ok(s) = fs::read_to_string(&p) {
            for line in s.lines() {
                let t = line.trim();
                if t.starts_with("gtk-application-prefer-dark-theme") {
                    if let Some(v) = t.split('=').nth(1) {
                        return Some(v.trim() != "1" && v.trim().to_lowercase() != "true");
                    }
                }
            }
        }
        // Also try kdeglobals
        let p = home.join("kdeglobals");
        if let Ok(s) = fs::read_to_string(&p) {
            for line in s.lines() {
                if line.trim().starts_with("ColorScheme") {
                    if let Some(v) = line.split('=').nth(1) {
                        let low = v.trim().to_lowercase();
                        return Some(!low.contains("dark"));
                    }
                }
            }
        }
    }
    None
}
