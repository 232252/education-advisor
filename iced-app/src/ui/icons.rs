//! Inline SVG icon set, lucide-style (stroke-width 2, 24x24 viewBox).
//!
//! All icons live in this file so the rest of the UI never has to know
//! about file paths or asset loading. Use [`icon`] to obtain a
//! `widget::svg::Handle` that can be passed straight into `widget::svg`.

use iced::widget::svg::Handle;
pub use iced::widget::Svg as SvgWidget;

/// Names of all available icons. Use [`icon`] to convert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconName {
    // Nav
    Home, Message, Bot, Book, Users, Cpu, Database, Clock, Shield, History, Settings,
    // Common actions
    Search, Plus, Send, Bell, ChevronRight, MoreHorizontal, X, Check,
    // Status
    ArrowUp, ArrowDown, Sparkles, AlertTriangle, TrendingUp,
    // Media
    Play, Pause,
    // Utility
    Lock, Key, Eye, Edit, Trash, Download, Upload, Filter, Zap, Target, Activity,
    GraduationCap, Briefcase, Refresh, Phone, Mail, FileText, Layers, GitBranch,
    Heart, Star, Flag, Bookmark, PieChart, BarChart, Sun, Moon, Monitor,
}

const STROKE: &str = r#" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round""#;

// We pre-wrap every icon as a complete <svg> string at compile time would be
// ideal, but `concat!` can't take `&str` constants from match arms. So the
// [`icon`] function does the wrapping at runtime. Each inner string below
// contains the `<path>` / `<circle>` / `<rect>` content only.

const I_HOME: &str = r#"<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z"/>"#;
const I_MESSAGE: &str = r#"<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7A8.38 8.38 0 0 1 4.5 12 8.5 8.5 0 0 1 13 3.5a8.38 8.38 0 0 1 8 8z"/>"#;
const I_BOT: &str = r#"<rect x="3" y="8" width="18" height="12" rx="3"/><circle cx="9" cy="14" r="1.3"/><circle cx="15" cy="14" r="1.3"/><path d="M12 5v3M9 3h6"/>"#;
const I_BOOK: &str = r#"<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>"#;
const I_USERS: &str = r#"<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>"#;
const I_CPU: &str = r#"<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>"#;
const I_DATABASE: &str = r#"<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"/>"#;
const I_CLOCK: &str = r#"<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>"#;
const I_SHIELD: &str = r#"<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>"#;
const I_HISTORY: &str = r#"<path d="M3 3v5h5M3.05 13A9 9 0 1 0 12 3"/><path d="M12 7v5l4 2"/>"#;
const I_SETTINGS: &str = r#"<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>"#;
const I_SEARCH: &str = r#"<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>"#;
const I_PLUS: &str = r#"<path d="M12 5v14M5 12h14"/>"#;
const I_SEND: &str = r#"<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>"#;
const I_BELL: &str = r#"<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>"#;
const I_CHEVRON: &str = r#"<path d="M9 18l6-6-6-6"/>"#;
const I_MORE: &str = r#"<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>"#;
const I_X: &str = r#"<path d="M18 6L6 18M6 6l12 12"/>"#;
const I_CHECK: &str = r#"<path d="M20 6L9 17l-5-5"/>"#;
const I_ARROW_UP: &str = r#"<path d="M12 19V5M5 12l7-7 7 7"/>"#;
const I_ARROW_DOWN: &str = r#"<path d="M12 5v14M5 12l7 7 7-7"/>"#;
const I_SPARKLES: &str = r#"<path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15l-1.7-4-4.3-1.7 4.3-1.7L12 3zM5 17l.85 2.3L8 20.15l-2.15.85L5 23l-.85-2-2.15-.85L4.15 19.3 5 17zM19 13l.6 1.7L21 15.3l-1.4.6L19 17.6l-.6-1.7L17 15.3l1.4-.6L19 13z"/>"#;
const I_ALERT: &str = r#"<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>"#;
const I_TREND: &str = r#"<path d="M3 3v18h18M7 14l4-4 4 4 5-5"/>"#;
const I_PLAY: &str = r#"<polygon points="5 3 19 12 5 21 5 3"/>"#;
const I_PAUSE: &str = r#"<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>"#;
const I_LOCK: &str = r#"<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>"#;
const I_KEY: &str = r#"<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M18 5l3 3M15 8l3 3"/>"#;
const I_EYE: &str = r#"<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>"#;
const I_EDIT: &str = r#"<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>"#;
const I_TRASH: &str = r#"<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>"#;
const I_DOWNLOAD: &str = r#"<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>"#;
const I_UPLOAD: &str = r#"<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>"#;
const I_FILTER: &str = r#"<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>"#;
const I_ZAP: &str = r#"<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>"#;
const I_TARGET: &str = r#"<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>"#;
const I_ACTIVITY: &str = r#"<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>"#;
const I_GRADUATION: &str = r#"<path d="M22 10L12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5"/>"#;
const I_BRIEFCASE: &str = r#"<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>"#;
const I_REFRESH: &str = r#"<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>"#;
const I_PHONE: &str = r#"<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>"#;
const I_MAIL: &str = r#"<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>"#;
const I_FILE: &str = r#"<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>"#;
const I_LAYERS: &str = r#"<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>"#;
const I_BRANCH: &str = r#"<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>"#;
const I_HEART: &str = r#"<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>"#;
const I_STAR: &str = r#"<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>"#;
const I_FLAG: &str = r#"<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>"#;
const I_BOOKMARK: &str = r#"<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>"#;
const I_PIE: &str = r#"<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>"#;
const I_BAR: &str = r#"<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>"#;
const I_SUN: &str = r#"<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>"#;
const I_MOON: &str = r#"<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>"#;
const I_MONITOR: &str = r#"<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>"#;

/// Build a themed `svg::Handle` for the given icon name.
///
/// The handle uses `currentColor` for `stroke`, so the icon will inherit
/// the surrounding text color automatically.
pub fn icon(name: IconName) -> Handle {
    let body = match name {
        IconName::Home => I_HOME,
        IconName::Message => I_MESSAGE,
        IconName::Bot => I_BOT,
        IconName::Book => I_BOOK,
        IconName::Users => I_USERS,
        IconName::Cpu => I_CPU,
        IconName::Database => I_DATABASE,
        IconName::Clock => I_CLOCK,
        IconName::Shield => I_SHIELD,
        IconName::History => I_HISTORY,
        IconName::Settings => I_SETTINGS,
        IconName::Search => I_SEARCH,
        IconName::Plus => I_PLUS,
        IconName::Send => I_SEND,
        IconName::Bell => I_BELL,
        IconName::ChevronRight => I_CHEVRON,
        IconName::MoreHorizontal => I_MORE,
        IconName::X => I_X,
        IconName::Check => I_CHECK,
        IconName::ArrowUp => I_ARROW_UP,
        IconName::ArrowDown => I_ARROW_DOWN,
        IconName::Sparkles => I_SPARKLES,
        IconName::AlertTriangle => I_ALERT,
        IconName::TrendingUp => I_TREND,
        IconName::Play => I_PLAY,
        IconName::Pause => I_PAUSE,
        IconName::Lock => I_LOCK,
        IconName::Key => I_KEY,
        IconName::Eye => I_EYE,
        IconName::Edit => I_EDIT,
        IconName::Trash => I_TRASH,
        IconName::Download => I_DOWNLOAD,
        IconName::Upload => I_UPLOAD,
        IconName::Filter => I_FILTER,
        IconName::Zap => I_ZAP,
        IconName::Target => I_TARGET,
        IconName::Activity => I_ACTIVITY,
        IconName::GraduationCap => I_GRADUATION,
        IconName::Briefcase => I_BRIEFCASE,
        IconName::Refresh => I_REFRESH,
        IconName::Phone => I_PHONE,
        IconName::Mail => I_MAIL,
        IconName::FileText => I_FILE,
        IconName::Layers => I_LAYERS,
        IconName::GitBranch => I_BRANCH,
        IconName::Heart => I_HEART,
        IconName::Star => I_STAR,
        IconName::Flag => I_FLAG,
        IconName::Bookmark => I_BOOKMARK,
        IconName::PieChart => I_PIE,
        IconName::BarChart => I_BAR,
        IconName::Sun => I_SUN,
        IconName::Moon => I_MOON,
        IconName::Monitor => I_MONITOR,
    };
    // Wrap the inner SVG body in a complete <svg> element.
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{}</svg>"#,
        body
    );
    Handle::from_memory(svg.into_bytes())
}
