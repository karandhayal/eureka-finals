// Human labels for activity-log actions.
export const ACTION_LABEL: Record<string, string> = {
  'checkin': 'Checked in', 'checkin.undo': 'Check-in undone', 'pitch.start': 'Pitch started', 'pitch.override': 'Manual override',
  'pitch.end': 'Pitch ended, Q&A', 'pitch.finish': 'Finished', 'pitch.pause': 'Paused', 'pitch.resume': 'Resumed',
  'pitch.cancel': 'Pitch cancelled', 'pitch.restart': 'Pitch restarted', 'pitch.skip': 'Skipped',
  'queue.move': 'Moved in queue', 'queue.hold': 'Put on hold', 'queue.release': 'Released from hold', 'queue.pin': 'Pinned to room',
  'startup.add': 'Startup added', 'startup.edit': 'Startup edited', 'startup.withdraw': 'Withdrawn', 'startup.restore': 'Restored',
  'startups.import': 'CSV imported', 'room.save': 'Room saved', 'room.open': 'Room opened', 'room.break': 'Room on break',
  'room.closed': 'Room closed', 'room.delete': 'Room deleted', 'track.save': 'Track saved', 'track.delete': 'Track deleted',
  'staff.save': 'Staff account saved', 'staff.duty': 'Duty changed', 'settings.save': 'Settings changed',
  'judge.add': 'Judge added', 'judge.edit': 'Judge edited', 'judge.update': 'Judge updated', 'judge.reissue': 'Judge link reissued',
  'judges.import': 'Judges imported', 'criteria.save': 'Rubric changed', 'score.submit': 'Score submitted', 'score.update': 'Score changed',
  'score.recuse': 'Judge recused', 'results.lock': 'Results locked', 'results.unlock': 'Results unlocked',
  'event.reset': 'Event reset', 'setup.first_admin': 'Event created',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
