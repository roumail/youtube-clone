// Feature "watchTimeLimit" (DESIGN.md §5): the parent sets a time budget at the
// first play of a session; one budget for all videos; only actual playing time
// counts; the session survives refreshes and relaunches and never ends by
// itself — only a used-up budget or the parent (Settings → End session).
const KEY = 'watchTime.session'; // { budget, used } in seconds
export const BUDGETS = [20, 30, 45]; // minutes (owner decision 2026-11-19)

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
};
const write = (s) => localStorage.setItem(KEY, JSON.stringify(s));
const pad = (n) => String(n).padStart(2, '0');
const mmss = (sec) => `${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec % 60))}`;

export function init(ctx) {
  const { $, playerState, timeUp } = ctx;
  const bar = $('session-bar');
  const prompt = $('budget-prompt');
  let last = null;
  let onChosen = null;
  let onCancel = null;

  function render() {
    const s = read();
    bar.hidden = false;
    const used = s?.used ?? 0;
    $('session-time').dataset.seconds = used.toFixed(1);
    $('session-time').textContent = `${mmss(used)} watched`;
    $('session-remaining').textContent = s ? `${mmss(Math.max(0, s.budget - used))} left` : 'no time set';
    const now = new Date();
    $('clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  // Count only real playing time, with the monotonic clock.
  const timer = setInterval(() => {
    const now = performance.now();
    const playing = playerState.status === 'playing';
    const s = read();
    if (playing && s && last !== null) {
      s.used = Math.min(s.budget, s.used + (now - last) / 1000);
      write(s);
      if (s.used >= s.budget) timeUp();
    }
    last = playing ? now : null;
    render();
  }, 250);

  for (const minutes of BUDGETS) {
    $(`budget-option-${minutes}`).addEventListener('click', () => {
      write({ budget: minutes * 60, used: 0 });
      prompt.hidden = true;
      render();
      const go = onChosen; onChosen = null; onCancel = null;
      go?.(); // still within the tap: playback may start
    });
  }
  $('budget-cancel').addEventListener('click', () => {
    prompt.hidden = true;
    const stop = onCancel; onChosen = null; onCancel = null;
    stop?.();
  });

  render();
  return {
    /** Called after the play PIN. Returns true if it takes over (asks for a budget). */
    beforePlay(proceed, cancel) {
      const s = read();
      if (s && s.used < s.budget) return false;
      onChosen = proceed; onCancel = cancel;
      prompt.hidden = false;
      return true;
    },
    settingsRows() {
      if (!read()) return [];
      const end = document.createElement('button');
      end.type = 'button';
      end.dataset.testid = 'end-session-button';
      end.textContent = 'End watch-time session';
      end.addEventListener('click', () => { localStorage.removeItem(KEY); render(); ctx.changed(); });
      return [end];
    },
    render,
    stop() { clearInterval(timer); bar.hidden = true; prompt.hidden = true; },
  };
}
