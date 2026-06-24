//! DeepSeek-style dark sci-fi design system for egui.
//!
//! All colors live in sRGB space as egui expects. The dark palette mirrors
//! the DeepSeek reference: an ultra-deep blue-black canvas, translucent glass
//! cards, hairline white borders and a blue→purple→cyan accent triad. Light
//! mode reuses the same accents on clean white/slate surfaces. No external
//! widget crates are used; every visual element is drawn with primitive egui
//! painters.

use eframe::egui::{Color32, Rgba};

/// Generate the application's procedural icon as raw RGBA bytes.
pub fn app_icon_rgba() -> (Vec<u8>, u32, u32) {
    let size = 64usize;
    let mut rgba = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let nx = x as f32 / size as f32;
            let ny = y as f32 / size as f32;
            let t = (nx + ny) / 2.0;
            // DeepSeek-style blue→purple gradient icon.
            let r = (59.0 + t * 80.0) as u8;
            let g = (92.0 + t * 40.0) as u8;
            let b = (246.0 - t * 60.0) as u8;
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

#[derive(Clone)]
#[allow(dead_code)]
pub struct Theme {
    pub dark: bool,
    pub bg: Color32,
    pub bg_gradient_from: Color32,
    pub bg_gradient_to: Color32,
    pub elevated: Color32,
    pub bg_elevated: Color32,
    pub surface: Color32,
    pub surface_glass: Color32,
    pub surface_hover: Color32,
    pub border: Color32,
    pub border_strong: Color32,
    pub text: Color32,
    pub text_dim: Color32,
    pub text_faint: Color32,
    pub accent: Color32,
    pub accent_strong: Color32,
    pub accent_hover: Color32,
    pub accent_dim: Color32,
    pub accent_bg: Color32,
    pub success: Color32,
    pub success_dim: Color32,
    pub warning: Color32,
    pub warning_dim: Color32,
    pub danger: Color32,
    pub danger_dim: Color32,
    pub info: Color32,
    pub info_dim: Color32,
    pub purple: Color32,
    pub purple_dim: Color32,
    pub cyan: Color32,
    pub pink: Color32,
    pub shadow: Color32,
    // Premium v4 brand gradients / glows / glass
    pub gradient_primary_from: Color32,
    pub gradient_primary_to: Color32,
    pub gradient_purple: Color32,
    pub gradient_cyan: Color32,
    pub glow_accent: Color32,
    pub glow_purple: Color32,
    pub glow_cyan: Color32,
    pub glass_bg: Color32,
}

impl Theme {
    /// DeepSeek-style dark sci-fi theme. This is the primary/default theme.
    pub const fn dark() -> Self {
        Self {
            dark: true,
            // Ultra-deep blue-black canvas.
            bg: Color32::from_rgb(8, 12, 22),
            bg_gradient_from: Color32::from_rgb(8, 12, 22),
            bg_gradient_to: Color32::from_rgb(12, 18, 34),
            elevated: Color32::from_rgb(15, 23, 42),
            bg_elevated: Color32::from_rgb(15, 23, 42),
            // Translucent deep-blue glass card.
            surface: Color32::from_rgba_premultiplied(23, 34, 58, 153),
            surface_glass: Color32::from_rgba_premultiplied(12, 18, 34, 166),
            surface_hover: Color32::from_rgba_premultiplied(255, 255, 255, 13),
            // Hairline white borders.
            border: Color32::from_rgba_premultiplied(255, 255, 255, 15),
            border_strong: Color32::from_rgba_premultiplied(255, 255, 255, 31),
            // Text.
            text: Color32::from_rgb(255, 255, 255),
            text_dim: Color32::from_rgb(148, 163, 184),
            text_faint: Color32::from_rgb(100, 116, 139),
            // Blue accent triad.
            accent: Color32::from_rgb(59, 130, 246),
            accent_strong: Color32::from_rgb(37, 99, 235),
            accent_hover: Color32::from_rgb(96, 165, 250),
            accent_dim: Color32::from_rgba_premultiplied(59, 130, 246, 38),
            accent_bg: Color32::from_rgba_premultiplied(59, 130, 246, 26),
            // Status colors.
            success: Color32::from_rgb(16, 185, 129),
            success_dim: Color32::from_rgba_premultiplied(16, 185, 129, 38),
            warning: Color32::from_rgb(234, 179, 8),
            warning_dim: Color32::from_rgba_premultiplied(234, 179, 8, 38),
            danger: Color32::from_rgb(239, 68, 68),
            danger_dim: Color32::from_rgba_premultiplied(239, 68, 68, 38),
            info: Color32::from_rgb(6, 182, 212),
            info_dim: Color32::from_rgba_premultiplied(6, 182, 212, 38),
            // Brand triad.
            purple: Color32::from_rgb(139, 92, 246),
            purple_dim: Color32::from_rgba_premultiplied(139, 92, 246, 38),
            cyan: Color32::from_rgb(6, 182, 212),
            pink: Color32::from_rgb(236, 72, 153),
            shadow: Color32::from_rgba_premultiplied(0, 0, 0, 204),
            // Button gradient: linear-gradient(135deg, #3b82f6, #8b5cf6).
            gradient_primary_from: Color32::from_rgb(59, 130, 246),
            gradient_primary_to: Color32::from_rgb(139, 92, 246),
            gradient_purple: Color32::from_rgb(139, 92, 246),
            gradient_cyan: Color32::from_rgb(6, 182, 212),
            // Radial-gradient glows.
            glow_accent: Color32::from_rgba_premultiplied(59, 130, 246, 102),
            glow_purple: Color32::from_rgba_premultiplied(139, 92, 246, 102),
            glow_cyan: Color32::from_rgba_premultiplied(6, 182, 212, 102),
            glass_bg: Color32::from_rgba_premultiplied(12, 18, 34, 166),
        }
    }

    /// Clean light theme mirroring the same blue/purple/cyan accents on
    /// white/slate surfaces.
    pub const fn light() -> Self {
        Self {
            dark: false,
            bg: Color32::from_rgb(248, 250, 252),
            bg_gradient_from: Color32::from_rgb(248, 250, 252),
            bg_gradient_to: Color32::from_rgb(238, 242, 247),
            elevated: Color32::from_rgb(255, 255, 255),
            bg_elevated: Color32::from_rgb(255, 255, 255),
            surface: Color32::from_rgb(255, 255, 255),
            surface_glass: Color32::from_rgba_premultiplied(255, 255, 255, 178),
            surface_hover: Color32::from_rgba_premultiplied(15, 23, 42, 8),
            border: Color32::from_rgba_premultiplied(15, 23, 42, 20),
            border_strong: Color32::from_rgba_premultiplied(15, 23, 42, 38),
            text: Color32::from_rgb(15, 23, 42),
            text_dim: Color32::from_rgb(71, 85, 105),
            text_faint: Color32::from_rgb(148, 163, 184),
            accent: Color32::from_rgb(59, 130, 246),
            accent_strong: Color32::from_rgb(37, 99, 235),
            accent_hover: Color32::from_rgb(96, 165, 250),
            accent_dim: Color32::from_rgba_premultiplied(59, 130, 246, 31),
            accent_bg: Color32::from_rgba_premultiplied(59, 130, 246, 20),
            success: Color32::from_rgb(16, 185, 129),
            success_dim: Color32::from_rgba_premultiplied(16, 185, 129, 31),
            warning: Color32::from_rgb(234, 179, 8),
            warning_dim: Color32::from_rgba_premultiplied(234, 179, 8, 31),
            danger: Color32::from_rgb(239, 68, 68),
            danger_dim: Color32::from_rgba_premultiplied(239, 68, 68, 31),
            info: Color32::from_rgb(6, 182, 212),
            info_dim: Color32::from_rgba_premultiplied(6, 182, 212, 31),
            purple: Color32::from_rgb(139, 92, 246),
            purple_dim: Color32::from_rgba_premultiplied(139, 92, 246, 31),
            cyan: Color32::from_rgb(6, 182, 212),
            pink: Color32::from_rgb(236, 72, 153),
            shadow: Color32::from_rgba_premultiplied(0, 0, 0, 25),
            gradient_primary_from: Color32::from_rgb(59, 130, 246),
            gradient_primary_to: Color32::from_rgb(139, 92, 246),
            gradient_purple: Color32::from_rgb(139, 92, 246),
            gradient_cyan: Color32::from_rgb(6, 182, 212),
            glow_accent: Color32::from_rgba_premultiplied(59, 130, 246, 51),
            glow_purple: Color32::from_rgba_premultiplied(139, 92, 246, 51),
            glow_cyan: Color32::from_rgba_premultiplied(6, 182, 212, 51),
            glass_bg: Color32::from_rgba_premultiplied(255, 255, 255, 178),
        }
    }

    pub const fn risk_color(&self, level: crate::models::RiskLevel) -> Color32 {
        match level {
            crate::models::RiskLevel::Low => self.success,
            crate::models::RiskLevel::Medium => self.warning,
            crate::models::RiskLevel::High => Color32::from_rgb(249, 115, 22),
            crate::models::RiskLevel::Critical => self.danger,
        }
    }

    /// Alpha-blend a color on top of the background.
    pub fn translucent(&self, color: Color32, alpha: f32) -> Color32 {
        let a = alpha.clamp(0.0, 1.0);
        let base = Rgba::from(self.bg);
        let top = Rgba::from(color);
        let r = (top.r() - base.r()).mul_add(a, base.r());
        let g = (top.g() - base.g()).mul_add(a, base.g());
        let b = (top.b() - base.b()).mul_add(a, base.b());
        let al = (top.a() - base.a()).mul_add(a, base.a());
        Rgba::from_rgba_premultiplied(r, g, b, al).into()
    }

    /// Linear interpolation between two colors in RGBA.
    pub fn lerp(a: Color32, b: Color32, t: f32) -> Color32 {
        let t = t.clamp(0.0, 1.0);
        let ar = Rgba::from(a);
        let br = Rgba::from(b);
        let r = (br.r() - ar.r()).mul_add(t, ar.r());
        let g = (br.g() - ar.g()).mul_add(t, ar.g());
        let bl = (br.b() - ar.b()).mul_add(t, ar.b());
        let al = (br.a() - ar.a()).mul_add(t, ar.a());
        Rgba::from_rgba_premultiplied(r, g, bl, al).into()
    }
}
