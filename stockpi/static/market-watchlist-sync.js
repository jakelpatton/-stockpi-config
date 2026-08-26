(() => {
  // Legacy compatibility shim.
  // Dynamic market screen ordering is owned by market-sequence.js and timing is
  // owned by rotation-controller.js. This file deliberately does not mutate
  // cfg.screens, idx, or the global rotation timer anymore.
  window.farmMarketWatchlistSync = {
    version: 2,
    rotationOwner: 'market-sequence.js',
    schedulerOwner: 'rotation-controller.js'
  };
})();
