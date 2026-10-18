//! Models offered for download, pinned by size and SHA-256 like mongosh (ADR-0014).

use serde::Serialize;

/// Stable identifier of a catalog model; the file on disk is named after it.
pub type ModelId = &'static str;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    /// Runs anywhere, answers simple requests.
    Fast,
    Balanced,
    /// Better with compound requests, needs more memory.
    Accurate,
}

/// How the model did on `tests/eval` (105 requests over five schemas) on an Apple M3.
#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Benchmark {
    /// Share of requests answered with exactly the expected query, from 0 to 1.
    pub accuracy: f64,
    pub seconds_per_query: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub publisher: &'static str,
    pub parameters: &'static str,
    pub license: &'static str,
    pub tier: Tier,
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub size: u64,
    /// Memory below which the model is not recommended, in GiB.
    pub min_memory_gib: u32,
    /// `None` until the model has been through the eval.
    pub benchmark: Option<Benchmark>,
    #[serde(skip)]
    pub url: &'static str,
    #[serde(skip)]
    pub sha256: &'static str,
}

pub const CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: "qwen2.5-coder-0.5b",
        name: "Qwen2.5 Coder 0.5B",
        publisher: "Alibaba Qwen",
        parameters: "0.5B",
        license: "Apache-2.0",
        tier: Tier::Fast,
        size: 491_400_064,
        min_memory_gib: 4,
        benchmark: Some(Benchmark {
            accuracy: 0.55,
            seconds_per_query: 1.1,
        }),
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        sha256: "1d9614638d18024d0fbb36575a15f1302a3adf044df10345688ec4f6e1c4ff32",
    },
    ModelSpec {
        id: "qwen2.5-coder-1.5b",
        name: "Qwen2.5 Coder 1.5B",
        publisher: "Alibaba Qwen",
        parameters: "1.5B",
        license: "Apache-2.0",
        tier: Tier::Balanced,
        size: 1_117_320_768,
        min_memory_gib: 8,
        benchmark: Some(Benchmark {
            accuracy: 0.85,
            seconds_per_query: 2.9,
        }),
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
        sha256: "cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046",
    },
    ModelSpec {
        id: "qwen3.5-2b",
        name: "Qwen3.5 2B",
        publisher: "Alibaba Qwen",
        parameters: "2B",
        license: "Apache-2.0",
        tier: Tier::Balanced,
        size: 1_280_835_840,
        min_memory_gib: 8,
        benchmark: Some(Benchmark {
            accuracy: 0.65,
            seconds_per_query: 3.3,
        }),
        url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
        sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
    },
    ModelSpec {
        id: "qwen3.5-4b",
        name: "Qwen3.5 4B",
        publisher: "Alibaba Qwen",
        parameters: "4B",
        license: "Apache-2.0",
        tier: Tier::Accurate,
        size: 2_740_937_888,
        min_memory_gib: 16,
        benchmark: Some(Benchmark {
            accuracy: 0.9,
            seconds_per_query: 7.1,
        }),
        url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
        sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    },
    ModelSpec {
        id: "llama-3.2-3b",
        name: "Llama 3.2 3B",
        publisher: "Meta",
        parameters: "3B",
        license: "Llama 3.2 Community",
        tier: Tier::Accurate,
        size: 2_019_377_696,
        min_memory_gib: 12,
        benchmark: Some(Benchmark {
            accuracy: 0.69,
            seconds_per_query: 4.9,
        }),
        url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        sha256: "6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff",
    },
    ModelSpec {
        id: "gemma-3-4b",
        name: "Gemma 3 4B",
        publisher: "Google",
        parameters: "4B",
        license: "Gemma Terms",
        tier: Tier::Accurate,
        size: 2_489_757_856,
        min_memory_gib: 16,
        benchmark: None,
        url: "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
        sha256: "882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863",
    },
    ModelSpec {
        id: "phi-4-mini",
        name: "Phi-4 mini",
        publisher: "Microsoft",
        parameters: "3.8B",
        license: "MIT",
        tier: Tier::Accurate,
        size: 2_491_874_688,
        min_memory_gib: 16,
        benchmark: None,
        url: "https://huggingface.co/bartowski/microsoft_Phi-4-mini-instruct-GGUF/resolve/main/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf",
        sha256: "01999f17c39cc3074afae5e9c539bc82d45f2dd7faa3917c66cbef76fce8c0c2",
    },
];

#[must_use]
pub fn find(id: &str) -> Option<&'static ModelSpec> {
    CATALOG.iter().find(|spec| spec.id == id)
}

/// The model to suggest for a machine with `memory_gib`. Larger models answer slightly
/// better but take several seconds per query (ADR-0040), so they are never the default.
#[must_use]
pub fn recommended(memory_gib: u32) -> &'static ModelSpec {
    let pick = if memory_gib >= 8 {
        "qwen2.5-coder-1.5b"
    } else {
        "qwen2.5-coder-0.5b"
    };
    find(pick).unwrap_or(&CATALOG[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_pins_look_right() {
        for (index, spec) in CATALOG.iter().enumerate() {
            assert!(CATALOG[..index].iter().all(|other| other.id != spec.id));
            assert_eq!(spec.sha256.len(), 64, "{}", spec.id);
            assert!(
                spec.url.starts_with("https://huggingface.co/"),
                "{}",
                spec.id
            );
            assert!(
                std::path::Path::new(spec.url)
                    .extension()
                    .is_some_and(|ext| ext == "gguf"),
                "{}",
                spec.id
            );
        }
    }

    #[test]
    fn benchmarks_are_shares_and_durations() {
        for spec in CATALOG {
            if let Some(benchmark) = spec.benchmark {
                assert!((0.0..=1.0).contains(&benchmark.accuracy), "{}", spec.id);
                assert!(benchmark.seconds_per_query > 0.0, "{}", spec.id);
            }
        }
        assert!(recommended(16).benchmark.is_some());
    }

    #[test]
    fn recommends_by_memory() {
        assert_eq!(recommended(4).id, "qwen2.5-coder-0.5b");
        assert_eq!(recommended(8).id, "qwen2.5-coder-1.5b");
        assert_eq!(recommended(32).id, "qwen2.5-coder-1.5b");
    }
}
