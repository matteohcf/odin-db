//! What the machine can run, to recommend a model.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub memory_gib: u32,
    /// Apple silicon runs models on its GPU through Metal.
    pub gpu: bool,
}

#[must_use]
pub fn detect() -> Hardware {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    #[allow(clippy::cast_precision_loss)]
    let gib = system.total_memory() as f64 / f64::from(1u32 << 30);
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Hardware {
        memory_gib: gib.round() as u32,
        gpu: cfg!(all(target_os = "macos", target_arch = "aarch64")),
    }
}
