use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tokio::sync::mpsc;

use super::flow::FlowControl;
use crate::CoreError;
use crate::secrets::Secret;

const READ_CHUNK: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ShellEvent {
    /// Terminal output. `bytes` is what the UI acknowledges once rendered (ADR-0030).
    Output {
        data: String,
        bytes: f64,
    },
    Exited {
        code: Option<f64>,
    },
}

/// Finds mongosh: the configured path, the user's `PATH`, then a copy downloaded
/// into `downloads` (ADR-0014).
#[must_use]
pub fn locate_mongosh(configured: Option<&Path>, downloads: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = configured.filter(|path| path.is_file()) {
        return Some(path.to_path_buf());
    }
    let name = if cfg!(windows) {
        "mongosh.exe"
    } else {
        "mongosh"
    };
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .or_else(|| downloads.and_then(super::installed_mongosh))
}

pub struct ShellOptions<'a> {
    pub mongosh: &'a Path,
    /// Sanitized connection string, without a password.
    pub uri: &'a str,
    pub password: Option<Secret>,
    pub cols: u16,
    pub rows: u16,
}

/// A running mongosh in a PTY. Output flows to `events` under credit-based flow control.
pub struct ShellSession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    flow: Arc<FlowControl>,
    /// Input typed before mongosh's password prompt is answered. Sending it right away
    /// would feed it to the prompt as the password, so it waits (`Some`) until then.
    held_input: Mutex<Option<String>>,
}

impl std::fmt::Debug for ShellSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShellSession").finish_non_exhaustive()
    }
}

impl ShellSession {
    pub fn open(
        options: ShellOptions<'_>,
        events: mpsc::Sender<ShellEvent>,
    ) -> Result<Arc<Self>, CoreError> {
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: options.rows,
                cols: options.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)?;

        let mut command = CommandBuilder::new(options.mongosh);
        command.arg(options.uri);
        command.arg("--quiet");
        command.env("TERM", "xterm-256color");
        let child = pty.slave.spawn_command(command).map_err(pty_error)?;
        // The child holds the slave; keeping ours would stop EOF from reaching the reader.
        drop(pty.slave);

        let password = options_password(options.password);
        let reader = pty.master.try_clone_reader().map_err(pty_error)?;
        let writer = pty.master.take_writer().map_err(pty_error)?;
        let session = Arc::new(Self {
            writer: Mutex::new(writer),
            master: Mutex::new(pty.master),
            child: Mutex::new(child),
            flow: Arc::new(FlowControl::default()),
            held_input: Mutex::new(password.is_some().then(String::new)),
        });

        let reading = Arc::clone(&session);
        std::thread::Builder::new()
            .name("odin-shell-reader".into())
            .spawn(move || reading.read_loop(reader, password, &events))
            .map_err(|error| {
                CoreError::Internal(format!("cannot start the shell reader: {error}"))
            })?;
        Ok(session)
    }

    pub fn write(&self, data: &str) -> Result<(), CoreError> {
        if let Some(held) = self
            .held_input
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            held.push_str(data);
            return Ok(());
        }
        self.write_raw(data)
    }

    fn write_raw(&self, data: &str) -> Result<(), CoreError> {
        let mut writer = self.writer.lock().unwrap_or_else(PoisonError::into_inner);
        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|error| CoreError::Internal(format!("cannot write to the shell: {error}")))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), CoreError> {
        self.master
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)
    }

    /// The UI rendered `bytes` of output: lets the reader continue past the watermark.
    pub fn acknowledge(&self, bytes: usize) {
        self.flow.acknowledged(bytes);
    }

    /// Ends the session; the reader reports `Exited` once the process is gone.
    pub fn close(&self) {
        let _ = self
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .kill();
        self.flow.close();
    }

    fn read_loop(
        &self,
        mut reader: Box<dyn Read + Send>,
        mut password: Option<Secret>,
        events: &mpsc::Sender<ShellEvent>,
    ) {
        let mut buffer = vec![0_u8; READ_CHUNK];
        let mut decoder = Utf8Chunks::default();
        loop {
            if !self.flow.wait_for_credit() {
                break;
            }
            let read = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            let text = decoder.push(&buffer[..read]);
            if password.is_some() && text.to_ascii_lowercase().contains("enter password") {
                // Answer mongosh's prompt through the PTY: the password never touches argv or env.
                if let Some(secret) = password.take() {
                    let _ = self.write_raw(&format!("{}\r", secret.expose()));
                    let held = self
                        .held_input
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .take();
                    if let Some(held) = held.filter(|held| !held.is_empty()) {
                        let _ = self.write_raw(&held);
                    }
                }
            }
            if text.is_empty() {
                continue;
            }
            self.flow.sent(read);
            #[allow(clippy::cast_precision_loss)]
            let event = ShellEvent::Output {
                data: text,
                bytes: read as f64,
            };
            if events.blocking_send(event).is_err() {
                break;
            }
        }
        let code = self
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .wait()
            .ok()
            .map(|status| f64::from(status.exit_code()));
        let _ = events.blocking_send(ShellEvent::Exited { code });
    }
}

fn options_password(password: Option<Secret>) -> Option<Secret> {
    password.filter(|secret| !secret.expose().is_empty())
}

fn pty_error(error: impl std::fmt::Display) -> CoreError {
    CoreError::Internal(format!("terminal error: {error}"))
}

/// Decodes a byte stream as UTF-8 without splitting characters across chunks.
#[derive(Debug, Default)]
struct Utf8Chunks {
    pending: Vec<u8>,
}

impl Utf8Chunks {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        // An incomplete character at the end waits for the next chunk; invalid bytes
        // are replaced (by from_utf8_lossy) rather than stalling the stream.
        let valid = match std::str::from_utf8(&self.pending) {
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            _ => self.pending.len(),
        };
        let text = String::from_utf8_lossy(&self.pending[..valid]).into_owned();
        self.pending.drain(..valid);
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_characters_split_across_chunks_are_kept_whole() {
        let mut decoder = Utf8Chunks::default();
        let bytes = "città €".as_bytes();
        let split = bytes.len() - 2; // inside the 3-byte euro sign
        assert_eq!(decoder.push(&bytes[..split]), "città ");
        assert_eq!(decoder.push(&bytes[split..]), "€");
    }

    #[test]
    fn invalid_bytes_do_not_stall_the_stream() {
        let mut decoder = Utf8Chunks::default();
        assert_eq!(decoder.push(&[b'a', 0xff, b'b']), "a\u{fffd}b");
    }
}
