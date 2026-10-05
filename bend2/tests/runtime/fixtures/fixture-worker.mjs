// Worker fixture: stays alive briefly so the host can enumerate it, then its
// event loop drains and the worker ends. execArgv is emptied by the host so
// inspector flags are not inherited (workers inherit them otherwise).
const kept = { marker: 'worker-alive', values: [1, 2, 3] };
setTimeout(() => {
  kept.marker = 'worker-done';
}, 120);
