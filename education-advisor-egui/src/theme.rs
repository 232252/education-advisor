//! Modern commercial design system: glassmorphism + neumorphism hybrid tokens.
//!
//! All colors live in linear-ish sRGB space as egui expects. The palette is
//! tuned for high contrast in both light and dark themes and consistent accent
//! usage across every page.

use eframe::egui::{Color32, Rgba, Stroke};

#[derive(Clone)]
pub struct Theme {
    pub dark: bool,
    pub bg: Color32,
    pub bg_elevated: Color32,
    pub surface: Color32,
    pub surface_glass: Color32,
    pub border: Color32,
    pub text: Color32,
    pub text_dim: Color32,
    pub text_faint: Color32,
    pub accent: Color32,
    pub accent_hover: Color32,
    pub accent_dim: Color32,
    pub success: Color32,
    pub warning: Color32,
    pub danger: Color32,
    pub info: Color32,
    pub shadow: Color32,
}

impl Theme {
    pub const fn dark() -> Self {
        Self {
            dark: true,
            bg: Color32::from_rgb(14, 16, 24),
            bg_elevated: Color32::from_rgb(20, 23, 33),
            surface: Color32::from_rgb(28, 32, 45),
            surface_glass: Color32::from_rgba_premultiplied(40, 46, 66, 160),
            border: Color32::from_rgba_premultiplied(120, 130, 160, 60),
            text: Color32::from_rgb(236, 240, 248),
            text_dim: Color32::from_rgb(168, 176, 196),
            text_faint: Color32::from_rgb(110, 118, 138),
            accent: Color32::from_rgb(124, 142, 255),
            accent_hover: Color32::from_rgb(150, 166, 255),
            accent_dim: Color32::from_rgba_premultiplied(124, 142, 255, 50),
            success: Color32::from_rgb(86, 210, 138),
            warning: Color32::from_rgb(255, 184, 86),
            danger: Color32::from_rgb(255, 96, 110),
            info: Color32::from_rgb(86, 196, 255),
            shadow: Color32::from_rgba_premultiplied(0, 0, 0, 120),
        }
    }

    pub const fn light() -> Self {
        Self {
            dark: false,
            bg: Color32::from_rgb(244, 246, 252),
            bg_elevated: Color32::from_rgb(252, 253, 255),
            surface: Color32::from_rgb(255, 255, 255),
            surface_glass: Color32::from_rgba_premultiplied(255, 255, 255, 200),
            border: Color32::from_rgba_premultiplied(40, 50, 80, 40),
            text: Color32::from_rgb(28, 32, 48),
            text_dim: Color32::from_rgb(90, 98, 120),
            text_faint: Color32::from_rgb(150, 158, 178),
            accent: Color32::from_rgb(96, 110, 240),
            accent_hover: Color32::from_rgb(76, 90, 220),
            accent_dim: Color32::from_rgba_premultiplied(96, 110, 240, 40),
            success: Color32::from_rgb(40, 180, 100),
            warning: Color32::from_rgb(220, 150, 40),
            danger: Color32::from_rgb(220, 70, 84),
            info: Color32::from_rgb(40, 160, 230),
            shadow: Color32::from_rgba_premultiplied(40, 50, 80, 40),
        }
    }

    pub const fn risk_color(&self, level: crate::models::RiskLevel) -> Color32 {
        match level {
            crate::models::RiskLevel::Low => self.success,
            crate::models::RiskLevel::Medium => self.warning,
            crate::models::RiskLevel::High => Color32::from_rgb(255, 140, 86),
            crate::models::RiskLevel::Critical => self.danger,
        }
    }

    #[inline]
    #[allow(dead_code)]
    pub fn stroke(color: Color32, width: f32) -> Stroke {
        Stroke::new(width, color)
    }

    /// Linear interpolation between two colors (t in 0..=1).
    #[allow(dead_code)]
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
