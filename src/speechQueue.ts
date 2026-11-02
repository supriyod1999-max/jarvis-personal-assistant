type QueueOptions<T> = {
  take: () => string | undefined;
  done: () => boolean;
  valid: () => boolean;
  check?: () => void;
  prepare: (text: string) => Promise<T>;
  play: (audio: T) => Promise<void>;
};
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 20));

// One generator, one playing segment, at most one prepared segment ahead.
// Never launch competing GPU requests or let prefetched audio outlive its turn.
export async function runSpeechQueue<T>({ take, done, valid, check = () => {}, prepare, play }: QueueOptions<T>) {
  let stopped = false, finished = false, failure: unknown;
  const buffer: { slot: { audio: T } | null } = { slot: null };
  const active = () => !stopped && valid();
  const producer = (async () => {
    try {
      while (active()) {
        check();
        if (buffer.slot) { await pause(); continue; }
        const text = take();
        if (text === undefined) { if (done()) break; await pause(); continue; }
        const audio = await prepare(text);
        if (active()) buffer.slot = { audio };
      }
    } catch (error) { failure = error; }
    finally { finished = true; }
  })();
  try {
    while (active() && (!finished || buffer.slot)) {
      check(); if (failure) throw failure;
      const current = buffer.slot;
      if (current) { buffer.slot = null; await play(current.audio); }
      else await pause();
    }
    if (active()) { await producer; check(); if (failure) throw failure; }
  } finally {
    stopped = true; buffer.slot = null;
    // The producer catches its own error. The caller aborts its HTTP request on
    // cancellation/failure; no late buffer can be enqueued or played afterward.
  }
}
