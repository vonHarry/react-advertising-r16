import getAdUnits from './utils/getAdUnits';
import logMessage from './utils/logMessage';

const defaultLazyLoadConfig = {
  marginPercent: 100,
  mobileScaling: 1,
  rootMargin: '20% 0% 100% 0%'
};
const requestManager = {
  FAILSAFE_TIMEOUT: 4500,
  queues: {},
  newQueue: (data) => {
    const now = Date.now();
    const queueId = `${now}-${Math.round(Math.random()*100000)}`;
    logMessage('requestManager new queue', queueId, data);
    requestManager.queues[queueId] = {
      failsafeTimeout: window.setTimeout(() => {
        logMessage('requestManager failsave triggered', queueId, data);
        requestManager.sendAdserverRequest(queueId);
      }, requestManager.FAILSAFE_TIMEOUT),
      adserverRequestSent: false,
      apstagDone: true,
      prebidDone: true,
      data: { ...data, started: now }
    };
    return queueId;
  },
  biddersBack: (queueId, type) => {
    const queue = requestManager.queues[queueId];
    queue.data.availableSlots.forEach(slot => {
      slot.lifetimeData[type].response = true;
    });
    logMessage('requestManager.biddersBack', queueId, queue, queue.data.availableSlots, type);
    // when both APS and Prebid bids have returned, initiate ad request
    if (queue.apstagDone && queue.prebidDone) {
      clearTimeout(queue.failsafeTimeout);
      requestManager.sendAdserverRequest(queueId, 'biddersBack');
    }
  },
  sendAdserverRequest: (queueId) => {
    const queue = requestManager.queues[queueId];
    queue.data.availableSlots.forEach(slot => {
      logMessage('requestManager.sendAdserverRequest: availableSlots', slot.getSlotElementId());
      if (slot.lifetimeData) {
        slot.lifetimeData.response = true;
      } else {
        logMessage('requestManager.sendAdserverRequest: availableSlots no lifetime data', slot.getSlotElementId());
      }
    });
    if (queue.adserverRequestSent === true) {
      return;
    }
    queue.adserverRequestSent = true;
    googletag.cmd.push(() => {
      logMessage('requestManager sendAdserverRequest refresh', queueId);
      window.googletag.pubads().refresh(queue.data.availableSlots);
    });
  }
};

export default class Advertising {
  constructor(config, plugins = [], onError = () => {}) {
    this.config = config;
    this.slots = {};
    this.outOfPageSlots = {};
    this.plugins = plugins;
    this.onError = onError;
    this.gptSizeMappings = {};
    this.customEventCallbacks = {};
    this.customEventHandlers = {};
    this.queue = [];
    this.setDefaultConfig();
  }

  // ---------- PUBLIC METHODS ----------

  async setup() {
    this.isPrebidUsed =
      typeof this.config.usePrebid === 'undefined'
        ? typeof window.pbjs !== 'undefined'
        : this.config.usePrebid;
    this.isApstagUsed =
      typeof this.config.useApstag === 'undefined'
        ? typeof window.apstag !== 'undefined'
        : this.config.useApstag;
    logMessage('setup', this.isPrebidUsed, this.isApstagUsed);

    this.executePlugins('setup');
    const { queue, isPrebidUsed, config } = this;
    this.setupCustomEvents();
    const setUpQueueItems = [
      Advertising.queueForGPT(this.setupGpt.bind(this), this.onError),
    ];
    if (isPrebidUsed) {
      setUpQueueItems.push(
        Advertising.queueForPrebid(this.setupPrebid.bind(this), this.onError)
      );
    }
    await Promise.all(setUpQueueItems);
    if (queue.length === 0) {
      return;
    }
    for (let i = 0; i < queue.length; i++) {
      const { id, customEventHandlers } = queue[i];
      Object.keys(customEventHandlers).forEach((customEventId) => {
        if (!this.customEventCallbacks[customEventId]) {
          this.customEventCallbacks[customEventId] = {};
        }
        return (this.customEventCallbacks[customEventId][id] =
          customEventHandlers[customEventId]);
      });
    }

    this.queueBids();
  }

  async teardown() {
    this.teardownCustomEvents();
    const teardownQueueItems = [
      Advertising.queueForGPT(this.teardownGpt.bind(this), this.onError),
    ];
    if (this.isPrebidUsed) {
      teardownQueueItems.push(
        Advertising.queueForPrebid(this.teardownPrebid.bind(this), this.onError)
      );
    }
    await Promise.all(teardownQueueItems);
    this.slots = {};
    this.gptSizeMappings = {};
    this.queue = [];
  }

  activate(id, customEventHandlers = {}) {
    const { slots } = this;
    logMessage('activate', id);
    if (Object.values(slots).length === 0) {
      this.queue.push({ id, customEventHandlers });
      logMessage('activate slot - slots not defined', id);
      return;
    }
    Object.keys(customEventHandlers).forEach((customEventId) => {
      if (!this.customEventCallbacks[customEventId]) {
        this.customEventCallbacks[customEventId] = {};
      }
      return (this.customEventCallbacks[customEventId][id] =
        customEventHandlers[customEventId]);
    });
    const slot = this.getSlotFromId(id);
    if (slot && slot.lifetimeData) {
      this.getSlotFromId(id).lifetimeData.activated = true;
    } else {
      logMessage('activate slot - getSlotFromId error', slot);
    }

    logMessage('activate slot - bidding triggered', id);

    this.queueBids(id);
  }

  queueBids(singleId) {
    logMessage('queueBids', singleId);
    const { queue, isPrebidUsed, isApstagUsed } = this;
    let availableSlots = [], prebidRequestData = [], apstagRequestData = [];

    if (singleId) {
      availableSlots = [this.getSlotFromId(singleId)];
    } else {
      availableSlots = queue.map(({ id }) => this.getSlotFromId(id));
    }
    prebidRequestData = this.registerAndFilterRequestedAdSlots(availableSlots.map(slot => {
      if (slot.prebid) {
        return slot.id;
      }
    }), 'prebid');
    apstagRequestData = this.registerAndFilterRequestedAdSlots(availableSlots.map(slot => {
      if (slot.apstag) {
        return slot.apstag;
      }
    }));

    const prebidRequestAllowed = isPrebidUsed && prebidRequestData && prebidRequestData.length > 0;
    const apstagRequestAllowed = isApstagUsed && apstagRequestData && apstagRequestData.length > 0;

    logMessage('queueBids requestable prebid, apstag', prebidRequestAllowed, apstagRequestAllowed);

    if (prebidRequestAllowed || apstagRequestAllowed) {
      const queueId = requestManager.newQueue({
        availableSlots,
        prebidRequestData,
        apstagRequestData
      });
      const requestQueue = requestManager.queues[queueId];

      if (prebidRequestAllowed) {
        logMessage('queueBids prebid prebidSlots', prebidRequestData);
        requestQueue.prebidDone = false;
        Advertising.queueForPrebid(
          () =>
            window.pbjs.requestBids({
              adUnitCodes: prebidRequestData,
              bidsBackHandler: (bids) => {
                window.pbjs.setTargetingForGPTAsync(prebidRequestData);
                Advertising.queueForGPT(
                  () => {
                    const returnedBidsIds = Object.keys(bids);
                    logMessage('queueBids prebid queueForGPT bids done', returnedBidsIds, Date.now() - requestQueue.data.started);
                    requestQueue.prebidDone = true; // signals that Prebid request has completed
                    requestManager.biddersBack(queueId, 'prebid');
                  },
                  this.onError
                );
              },
            }),
          this.onError
        );
      }

      if (apstagRequestAllowed) {
        logMessage('queueBids apstag apsSlots', apstagRequestData);
        requestQueue.apstagDone = false;
        window.apstag.fetchBids({
          slots: apstagRequestData,
          timeout: 3500
        }, (bids) => {
          Advertising.queueForGPT(
            () => {
              const returnedBidsIds = Object.keys(bids);
              window.apstag.setDisplayBids();
              logMessage('queueBids apstag queueForGPT bids done', returnedBidsIds, Date.now() - requestQueue.data.started);
              requestQueue.apstagDone = true; // signals that APS request has completed
              requestManager.biddersBack(queueId, 'apstag');
            },
            this.onError
          );
        });
      }
    } else {
      Advertising.queueForGPT(
        () => {
          logMessage('queueBids no prebid/apstag queueForGPT', availableSlots);
          window.googletag.pubads().refresh(availableSlots);
        },
        this.onError
      );
    }
  }

  getSlotFromId(id) {
    return this.slots[id] || this.outOfPageSlots[id];
  }

  registerAndFilterRequestedAdSlots(slots, framework) {
    const { config } = this;
    if (config.bidderRequestTimeoutLock === true) {
      const now = Date.now();
      const lockedTime = now + 5000;
      const filteredSlots = [];
      const lifetimeData = {
        prebid: { lockedTime: framework === 'prebid' ? lockedTime : 0, response: false },
        apstag: { lockedTime: framework === 'apstag' ? lockedTime : 0, response: false },
        activated: false,
        adserverRequest: false,
        rendered: false,
        visible: false
      };
      slots.forEach(slot => {
        if (slot && (!slot.lifetimeData || slot.lifetimeData[framework].lockedTime < now)) {
          slot.lifetimeData = lifetimeData;
        }
        filteredSlots.push(slot);
      });
      return filteredSlots;
    }
    return slots;
  }

  isConfigReady() {
    return Boolean(this.config);
  }

  setConfig(config) {
    this.config = config;
    this.setDefaultConfig();
  }

  // ---------- PRIVATE METHODS ----------

  setupCustomEvents() {
    if (!this.config.customEvents) {
      return;
    }
    Object.keys(this.config.customEvents).forEach((customEventId) =>
      this.setupCustomEvent(
        customEventId,
        this.config.customEvents[customEventId]
      )
    );
  }

  setupCustomEvent(customEventId, { eventMessagePrefix, divIdPrefix }) {
    const { customEventCallbacks } = this;
    this.customEventHandlers[customEventId] = ({ data }) => {
      if (
        typeof data !== 'string' ||
        !data.startsWith(`${eventMessagePrefix}`)
      ) {
        return;
      }
      const divId = `${divIdPrefix || ''}${data.substr(
        eventMessagePrefix.length
      )}`;
      const callbacks = customEventCallbacks[customEventId];
      if (!callbacks) {
        return;
      }
      const callback = callbacks[divId];
      if (callback) {
        callback();
      }
    };
    window.addEventListener('message', this.customEventHandlers[customEventId]);
  }

  teardownCustomEvents() {
    if (!this.config.customEvents) {
      return;
    }
    Object.keys(this.config.customEvents).forEach((customEventId) =>
      window.removeEventListener(
        'message',
        this.customEventHandlers[customEventId]
      )
    );
  }

  defineGptSizeMappings() {
    if (!this.config.sizeMappings) {
      return;
    }
    const entries = Object.entries(this.config.sizeMappings);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const sizeMapping = window.googletag.sizeMapping();
      for (let q = 0; q < value.length; q++) {
        const { viewPortSize, sizes } = value[q];
        sizeMapping.addSize(viewPortSize, sizes);
      }
      this.gptSizeMappings[key] = sizeMapping.build();
    }
  }

  getGptSizeMapping(sizeMappingName) {
    return sizeMappingName && this.gptSizeMappings[sizeMappingName]
      ? this.gptSizeMappings[sizeMappingName]
      : null;
  }

  defineSlots() {
    this.config.slots.forEach(
      ({
        id,
        path,
        collapseEmptyDiv,
        targeting = {},
        sizes,
        sizeMappingName,
      }) => {
        const slot = window.googletag.defineSlot(
          path || this.config.path,
          sizes,
          id
        );

        const sizeMapping = this.getGptSizeMapping(sizeMappingName);
        if (sizeMapping) {
          slot.defineSizeMapping(sizeMapping);
        }

        if (
          collapseEmptyDiv &&
          collapseEmptyDiv.length &&
          collapseEmptyDiv.length > 0
        ) {
          slot.setCollapseEmptyDiv(...collapseEmptyDiv);
        }

        const entries = Object.entries(targeting);
        for (let i = 0; i < entries.length; i++) {
          const [key, value] = entries[i];
          slot.setTargeting(key, value);
        }

        slot.lifetimeData = {
          prebid: { lockedTime: 0, response: false },
          apstag: { lockedTime: 0, response: false },
          activated: false,
          adserverRequest: false,
          rendered: false,
          visible: false
        };

        slot.addService(window.googletag.pubads());

        this.slots[id] = slot;
      }
    );
  }

  defineOutOfPageSlots() {
    if (this.config.outOfPageSlots) {
      this.config.outOfPageSlots.forEach(({ id, path }) => {
        const slot = window.googletag.defineOutOfPageSlot(
          path || this.config.path,
          id
        );
        slot.addService(window.googletag.pubads());
        this.outOfPageSlots[id] = slot;
      });
    }
  }

  displaySlots() {
    this.executePlugins('displaySlots');
    this.config.slots.forEach(({ id }) => {
      window.googletag.display(id);
    });
  }

  displayOutOfPageSlots() {
    this.executePlugins('displayOutOfPageSlot');
    if (this.config.outOfPageSlots) {
      this.config.outOfPageSlots.forEach(({ id }) => {
        window.googletag.display(id);
      });
    }
  }

  setupPrebid() {
    this.executePlugins('setupPrebid');
    const adUnits = getAdUnits(this.config.slots);
    window.pbjs.addAdUnits(adUnits);
    window.pbjs.setConfig(this.config.prebid);
  }

  teardownPrebid() {
    this.executePlugins('teardownPrebid');
    getAdUnits(this.config.slots).forEach(({ code }) =>
      window.pbjs.removeAdUnit(code)
    );
  }

  setupGpt() {
    this.executePlugins('setupGpt');
    logMessage('setupGpt', requestManager.queues);
    const pubads = window.googletag.pubads();
    pubads.addEventListener('impressionViewable', (event) => {
      const id = event.slot.id;
      const slot = this.getSlotFromId(id);
      if (slot) {
        slot.lifetimeData.visible = true;
      }
    });
    const { targeting } = this.config;
    this.defineGptSizeMappings();
    this.defineSlots();
    this.defineOutOfPageSlots();
    const entries = Object.entries(targeting);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      pubads.setTargeting(key, value);
    }
    pubads.disableInitialLoad();
    pubads.enableSingleRequest();

    window.googletag.enableServices();
    this.displaySlots();
    this.displayOutOfPageSlots();
  }

  teardownGpt() {
    this.executePlugins('teardownGpt');
    window.googletag.destroySlots();
  }

  setDefaultConfig() {
    if (!this.config) {
      return;
    }
    if (!this.config.prebid) {
      this.config.prebid = {};
    }
    if (!this.config.metaData) {
      this.config.metaData = {};
    }
    if (!this.config.targeting) {
      this.config.targeting = {};
    }
    if (this.config.enableLazyLoad === true) {
      this.config.enableLazyLoad = defaultLazyLoadConfig;
    }
    if (this.config.slots) {
      this.config.slots = this.config.slots.map((slot) => {
        const isLazyLoadingEnabled = slot.enableLazyLoad === true;
        const newSlot = isLazyLoadingEnabled ? { ...slot, enableLazyLoad: defaultLazyLoadConfig } : slot;
        return newSlot;
      });
    }
  }

  executePlugins(method) {
    for (let i = 0; i < this.plugins.length; i++) {
      const func = this.plugins[i][method];
      if (func) {
        func.call(this);
      }
    }
  }

  static queueForGPT(func, onError) {
    return Advertising.withQueue(window.googletag.cmd, func, onError);
  }

  static queueForPrebid(func, onError) {
    return Advertising.withQueue(window.pbjs.que, func, onError);
  }

  static withQueue(queue, func, onError) {
    return new Promise((resolve) =>
      queue.push(() => {
        try {
          func();
          resolve();
        } catch (error) {
          onError(error);
        }
      })
    );
  }
}
