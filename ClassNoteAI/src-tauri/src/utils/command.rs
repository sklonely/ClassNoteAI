//! Subprocess helpers that hide the console window on Windows.
//!
//! Release binaries run without an attached console, so every
//! `std::process::Command::new(...)` call on Windows briefly flashes
//! a cmd window when the child launches — users see a black square
//! blink every time the app shells out to `nvidia-smi`, `ffmpeg`,
//! `netstat`, `soffice`, etc. The fix is to pass `CREATE_NO_WINDOW`
//! (0x08000000) via `CommandExt::creation_flags` on Windows only;
//! other OSes don't have this behavior and the method isn't available.
//!
//! Usage: `utils::command::no_window("nvidia-smi")` returns a
//! ready-to-configure `Command` with the flag applied (or an
//! untouched `Command` on non-Windows). Continue with `.args(...)`,
//! `.output()`, `.spawn()` as usual.

use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Construct a `Command` that won't pop a console on Windows.
pub fn no_window<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let cmd = Command::new(program);
    apply_no_window(cmd)
}

/// Apply the no-window creation flag to an existing `Command`
/// (useful when the caller built the `Command` with a resolved
/// path / env / etc. before handing off).
pub fn apply_no_window(#[allow(unused_mut)] mut cmd: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
