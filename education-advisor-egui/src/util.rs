//! Small utility helpers shared across modules.

use std::time::{Duration, Instant};

/// Easing functions for buttery UI animations.
pub mod ease {
    pub fn out_cubic(t: f32) -> f32 {
        let t = 1.0 - t;
        (t * t).mul_add(-t, 1.0)
    }
    #[allow(dead_code)]
    pub fn in_out_cubic(t: f32) -> f32 {
        if t < 0.5 {
            4.0 * t * t * t
        } else {
            let f = 2.0f32.mul_add(t, -2.0);
            (0.5 * f * f).mul_add(f, 1.0)
        }
    }
    pub fn out_back(t: f32) -> f32 {
        let c1 = 1.70158_f32;
        let c3 = c1 + 1.0;
        c1.mul_add((t - 1.0).powi(2), 1.0 + c3 * (t - 1.0).powi(3))
    }
    #[allow(dead_code)]
    pub fn out_elastic(t: f32) -> f32 {
        let c4 = (2.0 * std::f32::consts::PI) / 3.0;
        if t <= 0.0 {
            0.0
        } else if t >= 1.0 {
            1.0
        } else {
            (-10.0 * t).exp2().mul_add((t.mul_add(10.0, -0.75) * c4).sin(), 1.0)
        }
    }
}

/// A time-based animation tracker that lerps toward a target.
#[derive(Clone, Debug)]
pub struct Anim {
    start: Instant,
    duration: Duration,
    from: f32,
    to: f32,
}

impl Anim {
    pub fn new(to: f32, duration_ms: u64) -> Self {
        Self {
            start: Instant::now(),
            duration: Duration::from_millis(duration_ms),
            from: to,
            to,
        }
    }

    #[allow(dead_code)]
    pub const fn target(&self) -> f32 {
        self.to
    }

    pub fn set_target(&mut self, to: f32, duration_ms: u64) {
        if (self.to - to).abs() > 1e-4 {
            self.from = self.value();
            self.to = to;
            self.start = Instant::now();
            self.duration = Duration::from_millis(duration_ms);
        }
    }

    pub fn value(&self) -> f32 {
        let elapsed = self.start.elapsed().as_secs_f32();
        let dur = self.duration.as_secs_f32().max(1e-4);
        let t = (elapsed / dur).clamp(0.0, 1.0);
        let eased = ease::out_cubic(t);
        (self.to - self.from).mul_add(eased, self.from)
    }

    pub fn done(&self) -> bool {
        self.start.elapsed() >= self.duration
    }
}

/// Format a duration in a human-friendly way.
pub fn fmt_duration(ms: u64) -> String {
    if ms < 1000 {
        format!("{ms} ms")
    } else if ms < 60_000 {
        format!("{:.1} s", ms as f64 / 1000.0)
    } else {
        format!("{:.1} min", ms as f64 / 60_000.0)
    }
}

/// Truncate a string to `max` chars with an ellipsis.
pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}
