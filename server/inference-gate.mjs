// Share one inference slot between foreground conversation and background scans.
// Background failures retain their scan cursor and retry on the next scheduled run.
export function inferenceGate(provider) {
  let busy = false;
  return {
    models: () => provider.models ? provider.models() : Promise.resolve([]),
    status: () => provider.status(),
    run(...args) {
      if (busy) throw Object.assign(new Error('JARVIS is busy with another reply. Try again shortly.'), { status: 409 });
      busy = true;
      try { const handle = provider.run(...args); return { ...handle, done: handle.done.finally(() => { busy = false; }) }; }
      catch (error) { busy = false; throw error; }
    },
  };
}
