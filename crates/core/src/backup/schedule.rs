//! Recurring backups (ADR-0034). Times are wall-clock times in the user's time
//! zone, so a daily 02:00 backup stays at 02:00 across daylight saving changes.

use std::fmt;
use std::path::{Path, PathBuf};

use jiff::{ToSpan, Zoned, civil};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::BackupScope;
use crate::CoreError;
use crate::profiles::ProfileId;
use crate::storage::Storage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct ScheduleId(Uuid);

impl ScheduleId {
    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|error| CoreError::Storage(format!("corrupt schedule id: {error}")))
    }
}

impl fmt::Display for ScheduleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Frequency {
    Hourly,
    Daily,
    Weekly,
}

impl Frequency {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Hourly => "hourly",
            Self::Daily => "daily",
            Self::Weekly => "weekly",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        match value {
            "hourly" => Ok(Self::Hourly),
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            other => Err(CoreError::Storage(format!(
                "unknown backup frequency {other}"
            ))),
        }
    }
}

/// When a schedule runs: `minute` is the minute of the hour for hourly
/// schedules and the minute of the day otherwise; `weekday` (1 = Monday …
/// 7 = Sunday) is for weekly schedules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub frequency: Frequency,
    pub minute: u16,
    pub weekday: Option<u8>,
}

impl Timing {
    pub fn validate(&self) -> Result<(), CoreError> {
        let minutes = match self.frequency {
            Frequency::Hourly => 60,
            Frequency::Daily | Frequency::Weekly => 24 * 60,
        };
        if self.minute >= minutes {
            return Err(CoreError::Validation("choose a valid time".into()));
        }
        if self.frequency == Frequency::Weekly && !matches!(self.weekday, Some(1..=7)) {
            return Err(CoreError::Validation("choose a day of the week".into()));
        }
        Ok(())
    }

    /// The first time strictly after `after` at which the schedule runs.
    #[must_use]
    pub fn next_after(&self, after: &Zoned) -> Zoned {
        let zone = after.time_zone().clone();
        let at = |date: civil::Date, minute: u16| {
            let (hour, minute) = (minute / 60, minute % 60);
            #[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
            date.at(hour as i8, minute as i8, 0, 0)
                .to_zoned(zone.clone())
                .unwrap_or_else(|_| after.clone())
        };
        let today = after.date();
        let candidate = match self.frequency {
            Frequency::Hourly => {
                #[allow(clippy::cast_sign_loss)]
                let hour = after.hour() as u16;
                at(today, hour * 60 + self.minute)
            }
            Frequency::Daily => at(today, self.minute),
            Frequency::Weekly => {
                let wanted = i16::from(self.weekday.unwrap_or(1));
                let current = i16::from(after.weekday().to_monday_one_offset());
                let ahead = (wanted - current).rem_euclid(7);
                at(today.saturating_add(i64::from(ahead).days()), self.minute)
            }
        };
        if candidate > *after {
            return candidate;
        }
        let step = match self.frequency {
            Frequency::Hourly => 1.hour(),
            Frequency::Daily => 1.day(),
            Frequency::Weekly => 1.week(),
        };
        candidate.saturating_add(step)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ScheduleInput {
    pub profile_id: ProfileId,
    pub scope: BackupScope,
    pub timing: Timing,
    /// How many of this schedule's backups to keep; older ones are deleted.
    pub keep: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackupSchedule {
    pub id: ScheduleId,
    pub profile_id: ProfileId,
    pub scope: BackupScope,
    /// Shown to the user; the webview never sends paths back (ADR-0017).
    pub folder: String,
    pub timing: Timing,
    pub keep: u32,
    pub enabled: bool,
    /// Unix milliseconds.
    pub created_at: f64,
    pub last_run_at: Option<f64>,
    /// `None` when disabled.
    pub next_run_at: Option<f64>,
}

/// Stored form; `folder` is a real path.
#[derive(Debug, Clone)]
pub(crate) struct StoredSchedule {
    pub id: ScheduleId,
    pub profile_id: ProfileId,
    pub scope: BackupScope,
    pub folder: PathBuf,
    pub timing: Timing,
    pub keep: u32,
    pub enabled: bool,
    pub created_at: i64,
    pub last_run_at: Option<i64>,
}

const MAX_KEEP: u32 = 1000;

fn validate(input: &ScheduleInput) -> Result<(), CoreError> {
    input.timing.validate()?;
    if input.keep == 0 || input.keep > MAX_KEEP {
        return Err(CoreError::Validation(format!(
            "keep between 1 and {MAX_KEEP} backups"
        )));
    }
    Ok(())
}

pub fn create_schedule(
    storage: &Storage,
    input: ScheduleInput,
    folder: &Path,
) -> Result<BackupSchedule, CoreError> {
    validate(&input)?;
    let schedule = StoredSchedule {
        id: ScheduleId(Uuid::now_v7()),
        profile_id: input.profile_id,
        scope: input.scope,
        folder: folder.to_path_buf(),
        timing: input.timing,
        keep: input.keep,
        enabled: input.enabled,
        created_at: Zoned::now().timestamp().as_millisecond(),
        last_run_at: None,
    };
    storage.insert_schedule(&schedule)?;
    Ok(to_public(schedule, &Zoned::now()))
}

/// Updates a schedule; `folder: None` keeps the current one.
pub fn update_schedule(
    storage: &Storage,
    id: ScheduleId,
    input: ScheduleInput,
    folder: Option<&Path>,
) -> Result<BackupSchedule, CoreError> {
    validate(&input)?;
    let current = storage.get_schedule(id)?;
    let schedule = StoredSchedule {
        profile_id: input.profile_id,
        scope: input.scope,
        folder: folder.map_or(current.folder, Path::to_path_buf),
        timing: input.timing,
        keep: input.keep,
        enabled: input.enabled,
        ..current
    };
    storage.update_schedule(&schedule)?;
    Ok(to_public(schedule, &Zoned::now()))
}

/// What running a schedule needs, including its real folder.
#[derive(Debug, Clone)]
pub struct ScheduleTarget {
    pub id: ScheduleId,
    pub profile_id: ProfileId,
    pub scope: BackupScope,
    pub folder: PathBuf,
    pub keep: u32,
}

pub fn schedule_target(storage: &Storage, id: ScheduleId) -> Result<ScheduleTarget, CoreError> {
    let schedule = storage.get_schedule(id)?;
    Ok(ScheduleTarget {
        id: schedule.id,
        profile_id: schedule.profile_id,
        scope: schedule.scope,
        folder: schedule.folder,
        keep: schedule.keep,
    })
}

pub fn delete_schedule(storage: &Storage, id: ScheduleId) -> Result<(), CoreError> {
    storage.delete_schedule(id)
}

pub fn list_schedules(storage: &Storage) -> Result<Vec<BackupSchedule>, CoreError> {
    let now = Zoned::now();
    Ok(storage
        .list_schedules()?
        .into_iter()
        .map(|schedule| to_public(schedule, &now))
        .collect())
}

/// Enabled schedules whose next run is due at `now`. A schedule that missed
/// several runs while the app was closed is due once, not once per miss.
pub(crate) fn due(schedule: &StoredSchedule, now: &Zoned) -> bool {
    schedule.enabled && next_run(schedule, now) <= *now
}

/// Schedules due now, for the scheduler loop.
pub fn due_schedules(storage: &Storage) -> Result<Vec<(ScheduleId, ProfileId)>, CoreError> {
    let now = Zoned::now();
    Ok(storage
        .list_schedules()?
        .into_iter()
        .filter(|schedule| due(schedule, &now))
        .map(|schedule| (schedule.id, schedule.profile_id))
        .collect())
}

fn next_run(schedule: &StoredSchedule, now: &Zoned) -> Zoned {
    let reference = schedule.last_run_at.unwrap_or(schedule.created_at);
    let after = jiff::Timestamp::from_millisecond(reference).map_or_else(
        |_| now.clone(),
        |instant| instant.to_zoned(now.time_zone().clone()),
    );
    schedule.timing.next_after(&after)
}

#[allow(clippy::cast_precision_loss)]
fn to_public(schedule: StoredSchedule, now: &Zoned) -> BackupSchedule {
    let next_run_at = schedule
        .enabled
        .then(|| next_run(&schedule, now).timestamp().as_millisecond() as f64);
    BackupSchedule {
        id: schedule.id,
        profile_id: schedule.profile_id,
        scope: schedule.scope,
        folder: schedule.folder.display().to_string(),
        timing: schedule.timing,
        keep: schedule.keep,
        enabled: schedule.enabled,
        created_at: schedule.created_at as f64,
        last_run_at: schedule.last_run_at.map(|at| at as f64),
        next_run_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rome(text: &str) -> Zoned {
        format!("{text}[Europe/Rome]")
            .parse()
            .expect("valid zoned time")
    }

    fn timing(frequency: Frequency, minute: u16, weekday: Option<u8>) -> Timing {
        Timing {
            frequency,
            minute,
            weekday,
        }
    }

    #[test]
    fn daily_runs_later_today_or_tomorrow() {
        let at_two = timing(Frequency::Daily, 2 * 60, None);
        assert_eq!(
            at_two.next_after(&rome("2026-10-17T01:00")),
            rome("2026-10-17T02:00")
        );
        assert_eq!(
            at_two.next_after(&rome("2026-10-17T02:00")),
            rome("2026-10-18T02:00"),
            "strictly after"
        );
    }

    #[test]
    fn daily_keeps_the_wall_clock_time_across_daylight_saving() {
        // Europe/Rome leaves summer time on 2026-10-25.
        let at_two = timing(Frequency::Daily, 2 * 60, None);
        let next = at_two.next_after(&rome("2026-10-24T03:00"));
        assert_eq!((next.date(), next.hour()), (civil::date(2026, 10, 25), 2));
    }

    #[test]
    fn hourly_and_weekly() {
        let quarter_past = timing(Frequency::Hourly, 15, None);
        assert_eq!(
            quarter_past.next_after(&rome("2026-10-17T10:20")),
            rome("2026-10-17T11:15")
        );
        // 2026-10-17 is a Saturday; Monday is weekday 1.
        let monday_nine = timing(Frequency::Weekly, 9 * 60, Some(1));
        assert_eq!(
            monday_nine.next_after(&rome("2026-10-17T12:00")),
            rome("2026-10-19T09:00")
        );
        let saturday_nine = timing(Frequency::Weekly, 9 * 60, Some(6));
        assert_eq!(
            saturday_nine.next_after(&rome("2026-10-17T12:00")),
            rome("2026-10-24T09:00")
        );
    }

    #[test]
    fn invalid_timings_are_rejected() {
        assert!(timing(Frequency::Hourly, 60, None).validate().is_err());
        assert!(timing(Frequency::Daily, 24 * 60, None).validate().is_err());
        assert!(timing(Frequency::Weekly, 0, None).validate().is_err());
        assert!(timing(Frequency::Weekly, 0, Some(7)).validate().is_ok());
    }

    #[test]
    fn missed_runs_make_a_schedule_due_once() {
        let now = rome("2026-10-17T12:00");
        let schedule = StoredSchedule {
            id: ScheduleId(Uuid::now_v7()),
            profile_id: ProfileId::new(),
            scope: BackupScope::Deployment,
            folder: PathBuf::from("/tmp"),
            timing: timing(Frequency::Daily, 2 * 60, None),
            keep: 7,
            enabled: true,
            created_at: rome("2026-10-10T00:00").timestamp().as_millisecond(),
            last_run_at: Some(rome("2026-10-14T02:00").timestamp().as_millisecond()),
        };
        assert!(due(&schedule, &now), "three runs were missed");
        let caught_up = StoredSchedule {
            last_run_at: Some(now.timestamp().as_millisecond()),
            ..schedule.clone()
        };
        assert!(!due(&caught_up, &now), "next run is tomorrow at 02:00");
        let disabled = StoredSchedule {
            enabled: false,
            ..schedule
        };
        assert!(!due(&disabled, &now));
    }
}
