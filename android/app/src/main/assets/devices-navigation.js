(async () => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (registration) {
        await Promise.race([registration.update().catch(() => {}), pause(5000)]);
        if (registration.installing) {
          await Promise.race([new Promise(resolve => {
            const worker = registration.installing;
            if (!worker || ['installed', 'redundant'].includes(worker.state)) return resolve();
            const changed = () => {
              if (['installed', 'redundant'].includes(worker.state)) {
                worker.removeEventListener('statechange', changed); resolve();
              }
            };
            worker.addEventListener('statechange', changed);
          }), pause(5000)]);
        }
        if (registration.waiting) {
          await new Promise(resolve => {
            let timer;
            const changed = () => {
              clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve();
            };
            navigator.serviceWorker.addEventListener('controllerchange', changed);
            timer = setTimeout(changed, 5000);
            registration.waiting.postMessage({ type: 'JARVIS_ACTIVATE_UPDATE' });
          });
        }
      }
    }
  } finally {
    location.assign('/?native=devices#/devices');
  }
})();
