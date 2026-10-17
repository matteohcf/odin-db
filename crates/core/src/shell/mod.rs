//! Integrated mongosh shell sessions (ADR-0013, ADR-0030).

mod flow;
mod session;

pub use flow::{FlowControl, HIGH_WATERMARK};
pub use session::{ShellEvent, ShellOptions, ShellSession, locate_mongosh};
