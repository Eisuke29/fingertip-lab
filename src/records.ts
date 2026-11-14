import { newId, type DisplayCondition, type InputMode, type InputSource } from './types';

export const STORAGE_KEY = 'fingertip-lab.session.v1';
export type Trial = {
  id: string; pairId: string; index: number; attempt: number; gain: number;
  mode: InputMode; display: DisplayCondition; source: InputSource;
  startedAt: string; endedAt?: string; contacts: string[]; releases: string[];
  rating?: number; interrupted: boolean; completed: boolean;
};
export type Pair = {
  id: string; order: number[]; mode: InputMode; display: DisplayCondition;
  startedAt: string; endedAt?: string; choice?: string;
};
export type LogEvent = {
  at: string; elapsed: number; event: string; reason?: string; trialId?: string; pairId?: string;
  mode: InputMode; display: DisplayCondition; source: InputSource; gain: number;
  value?: number; lift?: number; seq?: number;
};
type Session = { version: 1; id: string; createdAt: string; pairs: Pair[]; trials: Trial[]; events: LogEvent[] };
const makeSession = (): Session => ({ version: 1, id: newId(), createdAt: new Date().toISOString(), pairs: [], trials: [], events: [] });

export class SessionRecords {
  data: Session;
  storageError = '';
  private start = performance.now();
  private elapsedBeforeOpen = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor() {
    this.data = makeSession();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.version === 1 && Array.isArray(saved.events) && Array.isArray(saved.trials) && Array.isArray(saved.pairs)) {
        this.data = saved;
        // Reloaded unfinished trials cannot silently turn into completed data.
        for (const trial of this.data.trials) if (!trial.endedAt) { trial.interrupted = true; trial.endedAt = new Date().toISOString(); }
      }
    } catch { this.storageError = 'ローカル保存を利用できません。終了前にCSVを保存してください'; }
    this.elapsedBeforeOpen = Math.max(0, Date.now() - Date.parse(this.data.createdAt));
  }
  log(event: Omit<LogEvent, 'at' | 'elapsed'>) {
    this.data.events.push({ ...event, at: new Date().toISOString(), elapsed: Math.round(this.elapsedBeforeOpen + performance.now() - this.start) });
    this.save();
  }
  save(immediate = false) {
    clearTimeout(this.timer);
    const flush = () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); }
      catch { this.storageError = 'ローカル保存に失敗しました。CSVで記録を取り出してください'; }
    };
    if (immediate) flush(); else this.timer = setTimeout(flush, 250);
  }
  csv() {
    const columns = ['row_type', 'session_id', 'pair_id', 'trial_id', 'presentation_index', 'attempt', 'input_mode', 'display_condition',
      'input_source', 'gain', 'presentation_order', 'choice_harder', 'ownership_rating_1_7', 'started_at', 'ended_at',
      'contact_times', 'release_times', 'interrupted', 'completed', 'event', 'event_at', 'elapsed_ms', 'input_value', 'display_lift', 'sequence', 'reason'];
    const rows: Record<string, unknown>[] = [];
    for (const pair of this.data.pairs) rows.push({ row_type: 'pair', session_id: this.data.id, pair_id: pair.id,
      input_mode: pair.mode, display_condition: pair.display, presentation_order: pair.order.join(' > '),
      choice_harder: pair.choice, started_at: pair.startedAt, ended_at: pair.endedAt });
    for (const trial of this.data.trials) rows.push({ row_type: 'trial', session_id: this.data.id, pair_id: trial.pairId, trial_id: trial.id,
      presentation_index: trial.index, attempt: trial.attempt, input_mode: trial.mode, display_condition: trial.display,
      input_source: trial.source, gain: trial.gain, ownership_rating_1_7: trial.rating, started_at: trial.startedAt, ended_at: trial.endedAt,
      contact_times: trial.contacts.join(' | '), release_times: trial.releases.join(' | '), interrupted: trial.interrupted, completed: trial.completed });
    for (const event of this.data.events) rows.push({ row_type: 'event', session_id: this.data.id, pair_id: event.pairId, trial_id: event.trialId,
      input_mode: event.mode, display_condition: event.display, input_source: event.source, gain: event.gain,
      event: event.event, event_at: event.at, elapsed_ms: event.elapsed, input_value: event.value, display_lift: event.lift,
      sequence: event.seq, reason: event.reason });
    return '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n');
  }
  download() {
    this.save(true);
    const url = URL.createObjectURL(new Blob([this.csv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `fingertip-${this.data.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
export function csvCell(value: unknown) {
  let text = value === undefined || value === null ? '' : String(value);
  if (typeof value === 'string' && /^[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
