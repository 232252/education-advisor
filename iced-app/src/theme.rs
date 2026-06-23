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
            bg: rgb(14, 17, 26),
            bg_gradient_from: rgb(14, 17, 26),
            bg_gradient_to: rgb(22, 26, 42),
            elevated: rgb(22, 26, 40),
            bg_elevated: rgb(22, 26, 40),
            surface: rgb(28, 33, 50),
            surface_glass: rgb(32, 38, 56),
            surface_hover: rgb(40, 47, 68),
            border: rgba(60, 70, 100, 0.20),
            border_strong: rgba(100, 115, 155, 0.35),
            text: rgb(244, 246, 252),
            text_dim: rgb(165, 174, 198),
            text_faint: rgb(110, 122, 148),
            accent: rgb(86, 160, 255),
            accent_strong: rgb(66, 143, 246),
            accent_hover: rgb(120, 185, 255),
            accent_dim: rgba(86, 160, 255, 0.18),
            accent_bg: rgba(86, 160, 255, 0.09),
            success: rgb(74, 222, 128),
            success_dim: rgba(74, 222, 128, 0.08),
            warning: rgb(250, 204, 21),
            warning_dim: rgba(250, 204, 21, 0.08),
            danger: rgb(248, 113, 113),
            danger_dim: rgba(248, 113, 113, 0.08),
            info: rgb(56, 189, 248),
            info_dim: rgba(56, 189, 248, 0.08),
            purple: rgb(192, 132, 252),
            purple_dim: rgba(192, 132, 252, 0.08),
            cyan: rgb(34, 211, 238),
            pink: rgb(244, 114, 182),
            shadow: rgba(0, 0, 0, 0.63),
        }
    }

    pub fn light() -> Self {
        Self {
            dark: false,
            bg: rgb(242, 244, 250),
            bg_gradient_from: rgb(242, 244, 250),
            bg_gradient_to: rgb(255, 255, 255),
            elevated: rgb(255, 255, 255),
            bg_elevated: rgb(255, 255, 255),
            surface: rgb(248, 249, 252),
            surface_glass: rgb(250, 251, 254),
            surface_hover: rgb(235, 238, 246),
            border: rgba(40, 50, 80, 0.12),
            border_strong: rgba(60, 70, 100, 0.22),
            text: rgb(26, 30, 46),
            text_dim: rgb(80, 88, 112),
            text_faint: rgb(150, 160, 184),
            accent: rgb(45, 125, 240),
            accent_strong: rgb(30, 105, 220),
            accent_hover: rgb(70, 150, 255),
            accent_dim: rgba(45, 125, 240, 0.07),
            accent_bg: rgba(45, 125, 240, 0.04),
            success: rgb(34, 197, 94),
            success_dim: rgba(34, 197, 94, 0.06),
            warning: rgb(234, 179, 8),
            warning_dim: rgba(234, 179, 8, 0.06),
            danger: rgb(239, 68, 68),
            danger_dim: rgba(239, 68, 68, 0.06),
            info: rgb(14, 165, 233),
            info_dim: rgba(14, 165, 233, 0.06),
            purple: rgb(168, 85, 247),
            purple_dim: rgba(168, 85, 247, 0.06),
            cyan: rgb(6, 182, 212),
            pink: rgb(236, 72, 153),
            shadow: rgba(40, 50, 80, 0.16),
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
