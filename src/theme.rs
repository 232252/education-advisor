//! Modern commercial design system for egui.
//!
//! All colors live in sRGB space as egui expects. The palette mirrors a
//! refined dark/light mode with subtle gradients, glass surfaces and a
//! consistent accent. No external widget crates are used; every visual
//! element is drawn with primitive egui painters.

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
    pub const fn dark() -> Self {
        Self {
            dark: true,
            bg: Color32::from_rgb(15, 18, 28),
            bg_gradient_from: Color32::from_rgb(15, 18, 28),
            bg_gradient_to: Color32::from_rgb(22, 26, 40),
            elevated: Color32::from_rgb(22, 26, 40),
            bg_elevated: Color32::from_rgb(22, 26, 40),
            surface: Color32::from_rgb(28, 33, 50),
            surface_glass: Color32::from_rgba_premultiplied(30, 35, 55, 191),
            surface_hover: Color32::from_rgb(40, 47, 68),
            border: Color32::from_rgba_premultiplied(60, 70, 100, 50),
            border_strong: Color32::from_rgba_premultiplied(100, 115, 155, 90),
            text: Color32::from_rgb(244, 246, 252),
            text_dim: Color32::from_rgb(165, 174, 198),
            text_faint: Color32::from_rgb(110, 122, 148),
            accent: Color32::from_rgb(80, 160, 255),
            accent_strong: Color32::from_rgb(40, 100, 220),
            accent_hover: Color32::from_rgb(120, 190, 255),
            accent_dim: Color32::from_rgba_premultiplied(80, 160, 255, 45),
            accent_bg: Color32::from_rgba_premultiplied(80, 160, 255, 22),
            success: Color32::from_rgb(74, 222, 128),
            success_dim: Color32::from_rgba_premultiplied(74, 222, 128, 20),
            warning: Color32::from_rgb(250, 204, 21),
            warning_dim: Color32::from_rgba_premultiplied(250, 204, 21, 20),
            danger: Color32::from_rgb(248, 113, 113),
            danger_dim: Color32::from_rgba_premultiplied(248, 113, 113, 20),
            info: Color32::from_rgb(56, 189, 248),
            info_dim: Color32::from_rgba_premultiplied(56, 189, 248, 20),
            purple: Color32::from_rgb(160, 90, 230),
            purple_dim: Color32::from_rgba_premultiplied(160, 90, 230, 20),
            cyan: Color32::from_rgb(34, 211, 238),
            pink: Color32::from_rgb(244, 114, 182),
            shadow: Color32::from_rgba_premultiplied(0, 0, 0, 38),
            gradient_primary_from: Color32::from_rgb(40, 100, 220),
            gradient_primary_to: Color32::from_rgb(90, 180, 255),
            gradient_purple: Color32::from_rgb(150, 80, 220),
            gradient_cyan: Color32::from_rgb(50, 170, 240),
            glow_accent: Color32::from_rgba_premultiplied(90, 180, 255, 100),
            glow_purple: Color32::from_rgba_premultiplied(150, 80, 220, 100),
            glow_cyan: Color32::from_rgba_premultiplied(50, 170, 240, 100),
            glass_bg: Color32::from_rgba_premultiplied(22, 26, 40, 191),
        }
    }

    pub const fn light() -> Self {
        Self {
            dark: false,
            bg: Color32::from_rgb(245, 247, 252),
            bg_gradient_from: Color32::from_rgb(245, 247, 252),
            bg_gradient_to: Color32::from_rgb(235, 240, 250),
            elevated: Color32::from_rgb(255, 255, 255),
            bg_elevated: Color32::from_rgb(255, 255, 255),
            surface: Color32::from_rgb(248, 249, 252),
            surface_glass: Color32::from_rgba_premultiplied(255, 255, 255, 191),
            surface_hover: Color32::from_rgb(235, 238, 246),
            border: Color32::from_rgba_premultiplied(40, 50, 80, 30),
            border_strong: Color32::from_rgba_premultiplied(60, 70, 100, 55),
            text: Color32::from_rgb(26, 30, 46),
            text_dim: Color32::from_rgb(80, 88, 112),
            text_faint: Color32::from_rgb(150, 160, 184),
            accent: Color32::from_rgb(45, 130, 255),
            accent_strong: Color32::from_rgb(30, 95, 220),
            accent_hover: Color32::from_rgb(80, 170, 255),
            accent_dim: Color32::from_rgba_premultiplied(45, 130, 255, 20),
            accent_bg: Color32::from_rgba_premultiplied(45, 130, 255, 10),
            success: Color32::from_rgb(34, 197, 94),
            success_dim: Color32::from_rgba_premultiplied(34, 197, 94, 14),
            warning: Color32::from_rgb(234, 179, 8),
            warning_dim: Color32::from_rgba_premultiplied(234, 179, 8, 14),
            danger: Color32::from_rgb(239, 68, 68),
            danger_dim: Color32::from_rgba_premultiplied(239, 68, 68, 14),
            info: Color32::from_rgb(14, 165, 233),
            info_dim: Color32::from_rgba_premultiplied(14, 165, 233, 14),
            purple: Color32::from_rgb(168, 100, 230),
            purple_dim: Color32::from_rgba_premultiplied(168, 100, 230, 20),
            cyan: Color32::from_rgb(6, 182, 212),
            pink: Color32::from_rgb(236, 72, 153),
            shadow: Color32::from_rgba_premultiplied(0, 0, 0, 25),
            gradient_primary_from: Color32::from_rgb(30, 80, 180),
            gradient_primary_to: Color32::from_rgb(80, 160, 255),
            gradient_purple: Color32::from_rgb(168, 100, 230),
            gradient_cyan: Color32::from_rgb(60, 180, 250),
            glow_accent: Color32::from_rgba_premultiplied(80, 160, 255, 80),
            glow_purple: Color32::from_rgba_premultiplied(168, 100, 230, 80),
            glow_cyan: Color32::from_rgba_premultiplied(60, 180, 250, 80),
            glass_bg: Color32::from_rgba_premultiplied(255, 255, 255, 191),
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
