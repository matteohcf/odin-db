//! Regenerates `packages/bindings` from the Rust command and type definitions (ADR-0005).

use std::path::Path;

fn main() {
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/bindings/src/bindings.gen.ts");

    if let Err(error) = odin_desktop_lib::export_bindings(&output) {
        eprintln!("failed to export bindings: {error}");
        std::process::exit(1);
    }
}
