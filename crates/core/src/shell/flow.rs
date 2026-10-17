//! Credit-based flow control between a PTY reader and the UI (ADR-0030).

use std::sync::{Condvar, Mutex, PoisonError};

pub const HIGH_WATERMARK: usize = 512 * 1024;
pub const LOW_WATERMARK: usize = 128 * 1024;

/// Counts output sent to the UI but not yet acknowledged. The PTY reader thread
/// blocks in `wait_for_credit` above the high watermark and resumes below the low one,
/// so a flood is throttled at its source instead of queued in memory.
#[derive(Debug, Default)]
pub struct FlowControl {
    state: Mutex<State>,
    resumed: Condvar,
}

#[derive(Debug, Default)]
struct State {
    unacknowledged: usize,
    paused: bool,
    closed: bool,
}

impl FlowControl {
    /// Records `bytes` handed to the UI.
    pub fn sent(&self, bytes: usize) {
        let mut state = self.lock();
        state.unacknowledged += bytes;
        if state.unacknowledged >= HIGH_WATERMARK {
            state.paused = true;
        }
    }

    /// Records `bytes` the UI has finished rendering.
    pub fn acknowledged(&self, bytes: usize) {
        let mut state = self.lock();
        state.unacknowledged = state.unacknowledged.saturating_sub(bytes);
        if state.paused && state.unacknowledged <= LOW_WATERMARK {
            state.paused = false;
            self.resumed.notify_all();
        }
    }

    /// Blocks the reader while paused. Returns false once the session is closed.
    pub fn wait_for_credit(&self) -> bool {
        let mut state = self.lock();
        while state.paused && !state.closed {
            state = self
                .resumed
                .wait(state)
                .unwrap_or_else(PoisonError::into_inner);
        }
        !state.closed
    }

    /// Wakes a paused reader so it can exit.
    pub fn close(&self) {
        self.lock().closed = true;
        self.resumed.notify_all();
    }

    #[cfg(test)]
    fn is_paused(&self) -> bool {
        self.lock().paused
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use super::*;

    #[test]
    fn pauses_at_high_watermark_and_resumes_at_low() {
        let flow = FlowControl::default();
        flow.sent(HIGH_WATERMARK - 1);
        assert!(!flow.is_paused());
        flow.sent(1);
        assert!(flow.is_paused());

        flow.acknowledged(HIGH_WATERMARK - LOW_WATERMARK - 1);
        assert!(flow.is_paused(), "still above the low watermark");
        flow.acknowledged(1);
        assert!(!flow.is_paused());
    }

    #[test]
    fn a_paused_reader_waits_until_acknowledged_or_closed() {
        let flow = Arc::new(FlowControl::default());
        flow.sent(HIGH_WATERMARK);
        let resumed = Arc::new(AtomicBool::new(false));

        let reader = {
            let (flow, resumed) = (Arc::clone(&flow), Arc::clone(&resumed));
            std::thread::spawn(move || {
                let open = flow.wait_for_credit();
                resumed.store(true, Ordering::SeqCst);
                open
            })
        };
        std::thread::sleep(Duration::from_millis(50));
        assert!(
            !resumed.load(Ordering::SeqCst),
            "reader must block while paused"
        );

        flow.acknowledged(HIGH_WATERMARK);
        assert!(reader.join().expect("reader thread"));

        flow.sent(HIGH_WATERMARK);
        let waiting = {
            let flow = Arc::clone(&flow);
            std::thread::spawn(move || flow.wait_for_credit())
        };
        flow.close();
        assert!(
            !waiting.join().expect("reader thread"),
            "closing wakes and stops the reader"
        );
    }
}
