use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    // ggml's Metal code checks `@available`, whose runtime lives in compiler-rt; rustc links
    // with -nodefaultlibs, so release builds targeting an older macOS miss
    // ___isPlatformVersionAtLeast unless it is linked explicitly.
    let Ok(output) = Command::new("clang").arg("--print-resource-dir").output() else {
        return;
    };
    let resource_dir = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() && !resource_dir.is_empty() {
        println!("cargo:rustc-link-search=native={resource_dir}/lib/darwin");
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
}
