//! The timer's state machine — SPECIFIED here, EXECUTED in the frontend.
//!
//! Time lives in the WALL CLOCK: `Running` carries a target epoch, and every
//! frame *derives* the remaining time from `now`. Nothing accumulates, so a
//! laptop sleep, a throttled tab or a minimized window cannot drift the
//! timer — the next frame is simply correct.
//!
//! The transitions must also run in a plain browser (the api-shim fallback
//! tier), so a TS implementation exists either way
//! (`app/widgets/timer/timer-core.ts`). This module is the specification and
//! the two are held together by SHARED TEST VECTORS
//! (`fixtures/timer-vectors.json`), asserted by `cargo test` AND vitest —
//! the locale-parity-gate idea applied to logic. Change behaviour here
//! WITHOUT updating the vectors and both gates go red; change the vectors
//! and forget one side, and that side's gate goes red.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::layout::TimerMode;

/// How long after the zero-crossing a wake-up still plays the chime. Crossed
/// longer ago (the laptop slept through the whole lesson) → silently
/// finished: a chime at 07:00 next morning helps nobody.
pub const SOUND_GRACE_MS: f64 = 60_000.0;

/// The timer's EPHEMERAL state. Deliberately not persisted: a restart
/// mid-countdown shows the configured duration again, honestly.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "TimerState.ts")]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TimerState {
    Idle,
    Running {
        target_epoch_ms: f64,
    },
    Paused {
        remaining_ms: f64,
    },
    Finished {
        at_epoch_ms: f64,
    },
    SwRunning {
        started_epoch_ms: f64,
        accumulated_ms: f64,
    },
    SwPaused {
        accumulated_ms: f64,
    },
}

/// What a button press means. `Start` always starts FRESH (from any state) —
/// in countdown mode with the configured duration, in stopwatch mode from
/// zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "TimerAction.ts")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TimerAction {
    Start,
    Pause,
    Resume,
    Reset,
}

/// Apply a button press. Pure: `now_ms` is an argument, never read.
pub fn transition(
    state: TimerState,
    action: TimerAction,
    mode: TimerMode,
    duration_ms: f64,
    now_ms: f64,
) -> TimerState {
    use TimerAction as A;
    use TimerState as S;
    match action {
        A::Reset => S::Idle,
        A::Start => match mode {
            TimerMode::Countdown => S::Running {
                target_epoch_ms: now_ms + duration_ms,
            },
            TimerMode::Stopwatch => S::SwRunning {
                started_epoch_ms: now_ms,
                accumulated_ms: 0.0,
            },
        },
        A::Pause => match state {
            S::Running { target_epoch_ms } => S::Paused {
                remaining_ms: (target_epoch_ms - now_ms).max(0.0),
            },
            S::SwRunning {
                started_epoch_ms,
                accumulated_ms,
            } => S::SwPaused {
                accumulated_ms: accumulated_ms + (now_ms - started_epoch_ms).max(0.0),
            },
            other => other,
        },
        A::Resume => match state {
            S::Paused { remaining_ms } => S::Running {
                target_epoch_ms: now_ms + remaining_ms,
            },
            S::SwPaused { accumulated_ms } => S::SwRunning {
                started_epoch_ms: now_ms,
                accumulated_ms,
            },
            other => other,
        },
    }
}

/// The periodic check: has a running countdown crossed zero? Returns the
/// (possibly unchanged) state and whether the chime should play NOW.
pub fn tick(state: TimerState, now_ms: f64) -> (TimerState, bool) {
    match state {
        TimerState::Running { target_epoch_ms } if now_ms >= target_epoch_ms => (
            TimerState::Finished {
                at_epoch_ms: target_epoch_ms,
            },
            now_ms - target_epoch_ms < SOUND_GRACE_MS,
        ),
        other => (other, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// serde_json's `Value` equality separates `6000` from `6000.0` — the
    /// vectors are hand-written integers, the states carry f64. Canonicalise
    /// every number to f64 before comparing.
    fn canon(v: &serde_json::Value) -> serde_json::Value {
        match v {
            serde_json::Value::Number(n) => serde_json::Number::from_f64(n.as_f64().unwrap())
                .map(serde_json::Value::Number)
                .unwrap_or_else(|| v.clone()),
            serde_json::Value::Object(map) => serde_json::Value::Object(
                map.iter().map(|(k, val)| (k.clone(), canon(val))).collect(),
            ),
            serde_json::Value::Array(items) => {
                serde_json::Value::Array(items.iter().map(canon).collect())
            }
            other => other.clone(),
        }
    }

    /// The shared-vector gate: every case in fixtures/timer-vectors.json must
    /// hold for THIS implementation. The TS side runs the same file.
    #[test]
    fn shared_vectors_hold() {
        let raw = include_str!("../../../fixtures/timer-vectors.json");
        let doc: serde_json::Value = serde_json::from_str(raw).expect("vectors parse");
        let cases = doc["cases"].as_array().expect("cases array");
        assert!(cases.len() >= 15, "the vector suite must stay substantial");

        for case in cases {
            let name = case["name"].as_str().unwrap_or("<unnamed>");
            let state: TimerState =
                serde_json::from_value(case["state"].clone()).unwrap_or_else(|e| {
                    panic!("{name}: state parse: {e}");
                });
            let now = case["nowMs"].as_f64().expect("nowMs");

            let (actual, sound) = if case["tick"].as_bool() == Some(true) {
                tick(state, now)
            } else {
                let action: TimerAction = serde_json::from_value(case["action"].clone())
                    .unwrap_or_else(|e| panic!("{name}: action parse: {e}"));
                let mode: TimerMode = serde_json::from_value(
                    case.get("mode")
                        .cloned()
                        .unwrap_or(serde_json::json!("countdown")),
                )
                .unwrap();
                let duration = case["durationMs"].as_f64().unwrap_or(0.0);
                (transition(state, action, mode, duration, now), false)
            };

            assert_eq!(
                canon(&serde_json::to_value(actual).unwrap()),
                canon(&case["expect"]),
                "{name}: state"
            );
            let expect_sound = case["expectSound"].as_bool().unwrap_or(false);
            assert_eq!(sound, expect_sound, "{name}: sound");
        }
    }

    #[test]
    fn a_sleep_through_the_target_finishes_at_the_target_not_at_wakeup() {
        let (state, _) = tick(
            TimerState::Running {
                target_epoch_ms: 1_000.0,
            },
            5_000_000.0,
        );
        assert_eq!(
            state,
            TimerState::Finished {
                at_epoch_ms: 1_000.0
            }
        );
    }
}
