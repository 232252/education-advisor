//! Modern commercial design system for iced.
//!
//! Mirrors the original egui palette: refined dark/light mode with subtle
//! gradients, glass surfaces and a consistent accent.

use iced::Color;

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
            bg: rgb(248, 250, 253),
            bg_gradient_from: rgb(248, 250, 253),
            bg_gradient_to: rgb(241, 245, 251),
            elevated: rgb(255, 255, 255),
            bg_elevated: rgb(255, 255, 255),
            surface: rgb(255, 255, 255),
            surface_glass: rgba(255, 255, 255, 0.72),
            surface_hover: rgb(241, 245, 251),
            border: rgba(30, 41, 59, 0.06),
            border_strong: rgba(30, 41, 59, 0.12),
            text: rgb(15, 23, 42),
            text_dim: rgb(71, 85, 105),
            text_faint: rgb(148, 163, 184),
            accent: rgb(99, 102, 241),
            accent_strong: rgb(79, 70, 229),
            accent_hover: rgb(129, 140, 248),
            accent_dim: rgba(99, 102, 241, 0.10),
            accent_bg: rgba(99, 102, 241, 0.05),
            success: rgb(16, 185, 129),
            success_dim: rgba(16, 185, 129, 0.06),
            warning: rgb(245, 158, 11),
            warning_dim: rgba(245, 158, 11, 0.06),
            danger: rgb(239, 68, 68),
            danger_dim: rgba(239, 68, 68, 0.06),
            info: rgb(14, 165, 233),
            info_dim: rgba(14, 165, 233, 0.06),
            purple: rgb(168, 85, 247),
            purple_dim: rgba(168, 85, 247, 0.06),
            cyan: rgb(6, 182, 212),
            pink: rgb(236, 72, 153),
            shadow: rgba(15, 23, 42, 0.08),
        }
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
