//! GPU backend detection for Whisper acceleration.
//!
//! This module is *detection only* — it answers "what GPU backends
//! could work on this machine?" without actually loading any of them.
//! The answer drives two UI surfaces:
//!
//!   1. The setup wizard's GPU-check step, which tells the user what
//!      kind of acceleration they'll get before they finish onboarding.
//!   2. The Settings → "ASR 加速後端" selector, which shows which
//!      backends are available as checkmarks and which are greyed out.
//!
//! Detection strategies:
//!   - **CUDA**: probe `nvidia-smi` (shipped with every NVIDIA driver
//!     ≥ R460) for GPU name + driver version. If the driver is present,
//!     the runtime cudart/cuBLAS DLLs we'll ship alongside the GPU
//!     build (Phase 4) will find a GPU to talk to.
//!   - **Metal**: `cfg(target_os = "macos")`. Every Mac since ~2016
//!     has Metal; there's no device-level fallback to worry about.
//!   - **Vulkan**: look for the Vulkan loader — `vulkan-1.dll` on
//!     Windows, `libvulkan.so.1` on Linux. Every modern GPU driver
//!     ships it, so this is effectively "does the user have any
//!     functional GPU driver installed?"
//!
//! What we **don't** do:
//!   - Install CUDA Toolkit. Users don't need it — the runtime DLLs
//!     we ship (Phase 4) + their existing driver are enough. Toolkit
//!     is only needed at *build* time, which is handled in CI.
//!   - Install drivers. Windows Update + GeForce Experience already
//!     cover 99% of cases, and silent driver installs can trigger
//!     reboots/kernel changes we shouldn't own.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CudaInfo {
    /// First GPU name (e.g. "NVIDIA GeForce RTX 4060 Ti"). Multi-GPU
    /// setups are rare for end users; we surface only the primary.
    pub gpu_name: String,
    /// Driver version as reported by `nvidia-smi --query-gpu=driver_version`.
    pub driver_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GpuDetection {
    pub cuda: Option<CudaInfo>,
    pub metal: bool,
    pub vulkan: bool,
    /// Which backend will actually run when the user picks `auto`,
    /// taking into account what's compiled in (Phase 1: always CPU)
    /// + what was detected here. Phase 2+ will fill this in for real.
    pub effective: String,
}

fn detect_cuda() -> Option<CudaInfo> {
    // `nvidia-smi` is in PATH on every NVIDIA-driver install since
    // R460. If it's missing, either no NVIDIA driver or the PATH isn't
    // propagated (rare — system installer adds it).
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,driver_version",
            "--format=csv,noheader",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next()?;
    let mut parts = first_line.split(',').map(|p| p.trim());
    let name = parts.next()?.to_string();
    let driver = parts.next()?.to_string();
    if name.is_empty() {
        return None;
    }
    Some(CudaInfo {
        gpu_name: name,
        driver_version: driver,
    })
}

fn detect_vulkan() -> bool {
    // The Vulkan loader ships inside every modern GPU driver. If it's
    // present on the filesystem, a Vulkan-enabled build will have
    // something to talk to. We don't try to enumerate physical devices
    // here — doing so would require linking vulkan-loader into the
    // detection path, which is exactly what we're trying to avoid at
    // this stage.
    if cfg!(target_os = "windows") {
        // System32 is the guaranteed location for OS-provided loaders.
        Path::new(r"C:\Windows\System32\vulkan-1.dll").exists()
    } else if cfg!(target_os = "linux") {
        Path::new("/usr/lib/x86_64-linux-gnu/libvulkan.so.1").exists()
            || Path::new("/usr/lib/libvulkan.so.1").exists()
            || Path::new("/usr/lib64/libvulkan.so.1").exists()
    } else {
        // macOS ships MoltenVK via Vulkan SDK, not by default. Not
        // worth probing — Metal covers it.
        false
    }
}

fn resolve_effective(
    preference: Option<&str>,
    cuda: bool,
    metal: bool,
    vulkan: bool,
) -> String {
    let pref = preference.unwrap_or("auto").to_lowercase();
    match pref.as_str() {
        "cuda" if cuda => "cuda".into(),
        "metal" if metal => "metal".into(),
        "vulkan" if vulkan => "vulkan".into(),
        "cpu" => "cpu".into(),
        _ => {
            // auto (or invalid / unavailable preference) — priority
            // order picks the strongest acceleration we actually have.
            if cuda {
                "cuda".into()
            } else if metal {
                "metal".into()
            } else if vulkan {
                "vulkan".into()
            } else {
                "cpu".into()
            }
        }
    }
}

/// Runs all detection probes. Cheap (couple of fork/exec + filesystem
/// stats) — fine to call on every settings-page open or wizard step.
///
/// `preference` is the user's `experimental.asrBackend` value if set;
/// `None` or `"auto"` picks the best available.
pub fn detect(preference: Option<&str>) -> GpuDetection {
    let cuda = detect_cuda();
    let metal = cfg!(target_os = "macos");
    let vulkan = detect_vulkan();
    let effective = resolve_effective(preference, cuda.is_some(), metal, vulkan);
    GpuDetection {
        cuda,
        metal,
        vulkan,
        effective,
    }
}

// ----- Tauri command wrapper ------------------------------------------------

#[tauri::command]
pub async fn detect_gpu_backends(preference: Option<String>) -> Result<GpuDetection, String> {
    Ok(detect(preference.as_deref()))
}

/// Which GPU feature set the binary was compiled with. Used by the
/// updater (frontend) to pick the right artifact URL out of the merged
/// `latest.json` — a CPU build has no business pulling a CUDA
/// installer and vice-versa.
///
/// Priority of the `cfg` checks matches the CI matrix: exactly one of
/// the three gpu features should be on in a release build, but if
/// multiple are somehow on (dev override) we still pick deterministically.
#[tauri::command]
pub fn get_build_variant() -> &'static str {
    #[cfg(feature = "gpu-cuda")]
    {
        return "cuda";
    }
    #[cfg(all(feature = "gpu-metal", not(feature = "gpu-cuda")))]
    {
        return "metal";
    }
    #[cfg(all(
        feature = "gpu-vulkan",
        not(feature = "gpu-cuda"),
        not(feature = "gpu-metal")
    ))]
    {
        return "vulkan";
    }
    #[cfg(not(any(feature = "gpu-cuda", feature = "gpu-metal", feature = "gpu-vulkan")))]
    {
        return "cpu";
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_auto_prefers_cuda_over_vulkan() {
        let eff = resolve_effective(Some("auto"), true, false, true);
        assert_eq!(eff, "cuda");
    }

    #[test]
    fn resolve_auto_falls_back_to_cpu() {
        let eff = resolve_effective(Some("auto"), false, false, false);
        assert_eq!(eff, "cpu");
    }

    #[test]
    fn resolve_explicit_preference_falls_back_when_unavailable() {
        // User picked CUDA but machine has only Vulkan; we quietly fall
        // back rather than trying to use a backend that isn't there.
        let eff = resolve_effective(Some("cuda"), false, false, true);
        assert_eq!(eff, "vulkan");
    }

    #[test]
    fn resolve_explicit_cpu_is_honoured_even_with_gpu() {
        // User opting into CPU (e.g. to conserve GPU for another app)
        // should be respected.
        let eff = resolve_effective(Some("cpu"), true, true, true);
        assert_eq!(eff, "cpu");
    }
}
