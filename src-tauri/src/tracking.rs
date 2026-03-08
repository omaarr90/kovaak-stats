use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use sysinfo::{ProcessExt, System, SystemExt};

use crate::db::{Database, NewSegment};
use crate::parser::{parse_session_file, SessionSnapshot};
use crate::types::{ActiveSegmentContribution, TrackerDiagnostics};

#[derive(Clone, Default)]
pub struct TrackerHandle {
  machine: Arc<Mutex<SegmentStateMachine>>,
  diagnostics: Arc<Mutex<TrackerDiagnostics>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SegmentKey {
  scenario_path: String,
  scenario_name: String,
  playlist_in_progress: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ActiveSegment {
  key: SegmentKey,
  started_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CompletedSegment {
  key: SegmentKey,
  started_at: i64,
  ended_at: i64,
}

#[derive(Default)]
struct SegmentStateMachine {
  active: Option<ActiveSegment>,
}

struct PollResult {
  snapshot: Option<SessionSnapshot>,
  diagnostics: TrackerDiagnostics,
}

impl TrackerHandle {
  pub fn active_contribution(&self) -> Option<ActiveSegmentContribution> {
    let machine = self.machine.lock().ok()?;
    machine.active.as_ref().map(|active| ActiveSegmentContribution {
      scenario_path: active.key.scenario_path.clone(),
      scenario_name: active.key.scenario_name.clone(),
      playlist_in_progress: active.key.playlist_in_progress,
      started_at: active.started_at,
    })
  }

  pub fn diagnostics(&self) -> TrackerDiagnostics {
    self
      .diagnostics
      .lock()
      .map(|diagnostics| diagnostics.clone())
      .unwrap_or_default()
  }

  fn update_diagnostics(&self, diagnostics: TrackerDiagnostics) {
    if let Ok(mut current) = self.diagnostics.lock() {
      *current = diagnostics;
    }
  }
}

pub fn start_tracking_loop(db: Database, tracker: TrackerHandle) {
  thread::spawn(move || {
    run_tracking_loop(db, tracker);
  });
}

fn run_tracking_loop(db: Database, tracker: TrackerHandle) {
  let mut system = System::new_all();

  loop {
    let now = current_unix_seconds();
    let poll_result = poll_snapshot(&db, &mut system);
    tracker.update_diagnostics(poll_result.diagnostics);

    let next_key = match poll_result.snapshot {
      Some(snapshot) => Some(SegmentKey {
        scenario_path: snapshot.scenario_path,
        scenario_name: snapshot.scenario_name,
        playlist_in_progress: snapshot.playlist_in_progress,
      }),
      None => None,
    };

    let completed_segment = {
      let mut machine = match tracker.machine.lock() {
        Ok(guard) => guard,
        Err(_) => {
          thread::sleep(Duration::from_secs(1));
          continue;
        }
      };
      machine.advance(now, next_key)
    };

    if let Some(completed) = completed_segment {
      let _ = db.insert_segment(NewSegment {
        started_at: completed.started_at,
        ended_at: completed.ended_at,
        scenario_path: completed.key.scenario_path,
        scenario_name: completed.key.scenario_name,
        playlist_in_progress: completed.key.playlist_in_progress,
      });
    }

    thread::sleep(Duration::from_secs(1));
  }
}

fn poll_snapshot(db: &Database, system: &mut System) -> PollResult {
  let matched_process_name = detect_kovaak_process(system);
  let mut diagnostics = TrackerDiagnostics {
    is_kovaak_running: matched_process_name.is_some(),
    matched_process_name,
    ..TrackerDiagnostics::default()
  };

  let session_path = match db.get_session_path() {
    Ok(path) => path,
    Err(error) => {
      diagnostics.last_error = Some(error);
      PathBuf::from("session.sav")
    }
  };
  diagnostics.session_path = session_path.display().to_string();

  if let Ok(metadata) = fs::metadata(&session_path) {
    diagnostics.session_file_exists = true;
    diagnostics.session_file_modified_at = metadata.modified().ok().and_then(system_time_to_unix_seconds);
  }

  if !diagnostics.is_kovaak_running {
    return PollResult {
      snapshot: None,
      diagnostics,
    };
  }

  match parse_session_file(&session_path) {
    Ok(snapshot) => {
      diagnostics.last_snapshot_scenario_name = Some(snapshot.scenario_name.clone());
      diagnostics.last_snapshot_scenario_path = Some(snapshot.scenario_path.clone());
      diagnostics.last_snapshot_playlist_in_progress = Some(snapshot.playlist_in_progress);
      PollResult {
        snapshot: Some(snapshot),
        diagnostics,
      }
    }
    Err(error) => {
      diagnostics.last_error = Some(error);
      PollResult {
        snapshot: None,
        diagnostics,
      }
    }
  }
}

fn detect_kovaak_process(system: &mut System) -> Option<String> {
  system.refresh_processes();
  system
    .processes()
    .values()
    .find(|process| {
      matches_kovaak_process(process.name(), &process.exe().to_string_lossy())
    })
    .map(|process| process.name().to_string())
}

fn matches_kovaak_process(name: &str, executable_path: &str) -> bool {
  let name = name.to_ascii_lowercase();
  let executable_path = executable_path.to_ascii_lowercase();
  ["fpsaimtrainer", "kovaak"]
    .iter()
    .any(|needle| name.contains(needle) || executable_path.contains(needle))
}

impl SegmentStateMachine {
  fn advance(&mut self, now: i64, next: Option<SegmentKey>) -> Option<CompletedSegment> {
    match (&self.active, next) {
      (None, None) => None,
      (None, Some(next_key)) => {
        self.active = Some(ActiveSegment {
          key: next_key,
          started_at: now,
        });
        None
      }
      (Some(_), None) => self.close_current(now),
      (Some(active), Some(next_key)) if active.key == next_key => None,
      (Some(_), Some(next_key)) => {
        let closed = self.close_current(now);
        self.active = Some(ActiveSegment {
          key: next_key,
          started_at: now,
        });
        closed
      }
    }
  }

  fn close_current(&mut self, now: i64) -> Option<CompletedSegment> {
    let active = self.active.take()?;
    if now <= active.started_at {
      return None;
    }

    Some(CompletedSegment {
      key: active.key,
      started_at: active.started_at,
      ended_at: now,
    })
  }
}

fn current_unix_seconds() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs() as i64)
    .unwrap_or(0)
}

fn system_time_to_unix_seconds(time: SystemTime) -> Option<i64> {
  time
    .duration_since(UNIX_EPOCH)
    .ok()
    .map(|duration| duration.as_secs() as i64)
}

#[cfg(test)]
mod tests {
  use super::{matches_kovaak_process, SegmentKey, SegmentStateMachine};

  fn key(path: &str, playlist: bool) -> SegmentKey {
    SegmentKey {
      scenario_path: path.to_string(),
      scenario_name: path.to_string(),
      playlist_in_progress: playlist,
    }
  }

  #[test]
  fn opens_and_closes_segment_on_process_boundaries() {
    let mut machine = SegmentStateMachine::default();
    assert!(machine.advance(10, Some(key("scenario://a", false))).is_none());
    let closed = machine
      .advance(18, None)
      .expect("segment should close when process/session is gone");
    assert_eq!(closed.started_at, 10);
    assert_eq!(closed.ended_at, 18);
    assert_eq!(closed.key.scenario_path, "scenario://a");
  }

  #[test]
  fn closes_and_reopens_when_scenario_changes() {
    let mut machine = SegmentStateMachine::default();
    machine.advance(10, Some(key("scenario://a", false)));
    let first = machine
      .advance(15, Some(key("scenario://b", false)))
      .expect("scenario switch should close old segment");
    assert_eq!(first.key.scenario_path, "scenario://a");

    let second = machine
      .advance(25, None)
      .expect("second scenario should close");
    assert_eq!(second.key.scenario_path, "scenario://b");
    assert_eq!(second.started_at, 15);
    assert_eq!(second.ended_at, 25);
  }

  #[test]
  fn playlist_flag_change_starts_new_segment() {
    let mut machine = SegmentStateMachine::default();
    machine.advance(30, Some(key("scenario://same", false)));
    let closed = machine
      .advance(40, Some(key("scenario://same", true)))
      .expect("playlist mode change should close segment");
    assert!(!closed.key.playlist_in_progress);
    let closed_again = machine
      .advance(50, None)
      .expect("new playlist segment should close");
    assert!(closed_again.key.playlist_in_progress);
  }

  #[test]
  fn matches_shipping_process_by_name() {
    assert!(matches_kovaak_process(
      "FPSAimTrainer-Win64-Shipping",
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer-Win64-Shipping.exe"
    ));
  }

  #[test]
  fn matches_process_by_executable_path() {
    assert!(matches_kovaak_process(
      "Shipping",
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\FPSAimTrainer\\FPSAimTrainer.exe"
    ));
  }

  #[test]
  fn ignores_unrelated_processes() {
    assert!(!matches_kovaak_process(
      "Code",
      "C:\\Users\\omara\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
    ));
  }
}
