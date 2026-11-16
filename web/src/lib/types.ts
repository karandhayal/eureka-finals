export type Startup = {
  id: number; eureka_id: string; name: string; email: string; track_id: number; track: string;
  status: 'registered' | 'waiting' | 'hold' | 'on_deck' | 'pitching' | 'done' | 'no_show' | 'withdrawn';
  ticket_no: number | null; queue_pos: number | null; checked_in_at: string | null; checked_in_by: string | null;
  on_deck_room_id: number | null; pinned_room_id: number | null; skip_count: number; version: number;
};
export type Session = {
  id: number; startup_id: number; room_id: number; actual_no: number; status: 'pitch' | 'qa' | 'done' | 'cancelled';
  phase_started_at: string; phase_paused_s: number; paused_at: string | null; pitch_started_at: string;
  pitch_ended_at: string | null; qa_ended_at: string | null; started_by: string; is_override: boolean;
  override_reason: string | null; elapsed_s: number;
};
export type Room = {
  id: number; name: string; status: 'open' | 'break' | 'closed'; version: number; display_code: string;
  last_ended_at: string | null; track_ids: number[]; tracks: string[];
  live: (Session & { startup: Startup }) | null; on_deck: Startup[];
  judges: { id: number; name: string; status: string; kind: string }[];
  last: { startup: string; startup_id: number; ended_at: string; scores_in: number; scorers: number } | null;
  done_count: number;
  history?: (Session & { startup_name: string; eureka_id: string; cancel_reason: string | null; ended_by: string | null })[];
};
export type Settings = { event_name: string; pitch_s: number; qa_s: number; changeover_s: number; on_deck: number; skip_limit: number; overrun_alert_s: number };
export type Track = { id: number; name: string; locked: boolean; counts: Record<string, number> | null };
export type Alert = { level: 'critical' | 'warning'; kind: string; text: string; room_id?: number; track_id?: number };
export type LogEntry = { id: number; at: string; actor: string; actor_role: string; action: string; startup_id: number | null; room_id: number | null; startup: string | null; room: string | null; reason: string | null; details: any; eureka_id?: string; judge?: string };
export type AdminState = {
  now: string; me: any; settings: Settings; cycle_s: number; tracks: Track[]; rooms: Room[]; startups: Startup[];
  counts: Record<string, number> | null; alerts: Alert[]; judges: { total: number; arrived: number };
  criteria: Criterion[]; hall_code: string | null; activity: LogEntry[];
};
export type Criterion = { id: number; name: string; description: string | null; max_score: number; weight: number };
export type Judge = { id: number; name: string; email: string | null; phone: string | null; kind: 'jury' | 'mentor' | 'both'; token: string; status: 'not_arrived' | 'arrived' | 'left'; room_id: number | null; certificate: boolean; added_by: string | null; scored: number };
