import getAdUnits from './utils/getAdUnits';
import logMessage from './utils/logMessage';
import AdvertisingRequestManager from './AdvertisingRequestManager';

const defaultLazyLoadConfig = {
  marginPercent: 100,
  mobileScaling: 1,
  rootMargin: '20% 0% 100% 0%',
};
const requestManager = new AdvertisingRequestManager();

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
    this.biddingConfig = config.biddingConfig || {
      biddingApstagTimeout: 3500,
      requestTimeoutLock: false,
      requestFailsafeTimeout: 4500,
      requestWaitTimeout: 300,
    };
    requestManager.setConfig(this.biddingConfig);
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
    const { queue, isPrebidUsed } = this;

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
    const { queue, config } = this;
    const requestQueue = requestManager.getQueue();
    let tempSlots = [];
    let availableSlots = [];
    const prebidRequestData = [];
    const apstagRequestData = [];

    if (singleId) {
      tempSlots = [this.getSlotFromId(singleId)];
    } else {
      tempSlots = queue.map(({ id }) => this.getSlotFromId(id));
    }
    tempSlots = this.registerAndFilterRequestedAdSlots(tempSlots);
    const availableIDs = tempSlots.map((slot) =>
      slot.getSlotElementId()
    );
    availableSlots = tempSlots.concat(
      requestQueue.availableSlots.filter((item) => {
        if (availableIDs.indexOf(item.getSlotElementId()) < 0) {
          availableIDs.push(item.getSlotElementId());
          return true;
        }
        return false;
      })
    );
    logMessage(
      'queueBids merge and unique availableSlots',
      tempSlots,
      availableSlots,
      requestQueue.availableSlots
    );
    availableSlots.forEach((slot) => {
      if (slot.prebid) {
        prebidRequestData.push(slot.getSlotElementId());
      }
      if (slot.apstag) {
        apstagRequestData.push(slot.apstag);
      }
    });
    requestManager.updateQueue(requestQueue, {
      availableSlots,
      prebidRequestData,
      apstagRequestData,
    });
    logMessage('queueBids update requestQueue', requestQueue);
    if (
      config.biddingConfig &&
      config.biddingConfig.requestTimeoutLock === true
    ) {
      logMessage('queueBids waitTimeoutCallback added', requestQueue.id);
      requestManager.updateQueue(requestQueue, {
        waitTimeoutCallback: () => {
          logMessage(
            'queueBids waitTimeoutCallback triggered requestBids()',
            requestQueue.id,
            requestQueue.waitTimeoutCallback
          );
          this.requestBids(requestQueue);
        },
      });
    } else {
      logMessage('queueBids direct requestBids()', requestQueue.id);
      this.requestBids(requestQueue);
    }
  }

  requestBids(requestQueue) {
    const { isPrebidUsed, isApstagUsed } = this;
    const { prebidRequestData, apstagRequestData, availableSlots } =
      requestQueue;

    const prebidRequestAllowed =
      isPrebidUsed && prebidRequestData && prebidRequestData.length > 0;
    const apstagRequestAllowed =
      isApstagUsed && apstagRequestData && apstagRequestData.length > 0;

    if (prebidRequestAllowed) {
      logMessage('requestBids prebid prebidSlots', prebidRequestData);
      requestQueue.prebidDone = false;
      Advertising.queueForPrebid(
        () =>
          window.pbjs.requestBids({
            adUnitCodes: prebidRequestData,
            bidsBackHandler: (bids) => {
              window.pbjs.setTargetingForGPTAsync(prebidRequestData);
              const returnedBidsIds = Object.keys(bids);
              logMessage(
                'requestBids prebid response',
                returnedBidsIds,
                Date.now() - requestQueue.started
              );
              requestQueue.availableSlots.forEach((slot) => {
                if (slot.lifetimeData) {
                  slot.lifetimeData.prebidResponded = true;
                }
              });
              requestQueue.prebidDone = true; // signals that Prebid request has completed
              requestManager.biddersBack(requestQueue, 'prebid');
            },
          }),
        this.onError
      );
    }

    if (apstagRequestAllowed) {
      logMessage('requestBids apstag apsSlots', apstagRequestData);
      requestQueue.apstagDone = false;
      window.apstag.fetchBids(
        {
          slots: apstagRequestData,
          timeout: this.biddingConfig.biddingApstagTimeout,
        },
        (bids) => {
          const returnedBidsIds = Object.keys(bids);
          window.apstag.setDisplayBids();
          logMessage(
            'requestBids apstag response',
            returnedBidsIds,
            Date.now() - requestQueue.started
          );

          requestQueue.availableSlots.forEach((slot) => {
            if (slot.lifetimeData) {
              slot.lifetimeData.apstagResponded = true;
            }
          });
          requestQueue.apstagDone = true; // signals that APS request has completed
          requestManager.biddersBack(requestQueue, 'apstag');
        }
      );
    }

    if (!prebidRequestAllowed && !apstagRequestAllowed) {
      Advertising.queueForGPT(() => {
        logMessage('queueBids no prebid/apstag queueForGPT', availableSlots);
        window.googletag.pubads().refresh(availableSlots);
      }, this.onError);
    }
  }

  getSlotFromId(id) {
    return this.slots[id] || this.outOfPageSlots[id];
  }

  registerAndFilterRequestedAdSlots(slots) {
    const { config } = this;
    if (
      config.biddingConfig &&
      config.biddingConfig.requestTimeoutLock === true
    ) {
      const now = Date.now();
      const lockedTime = now + 5000;
      const filteredSlots = [];
      slots.forEach((slot) => {
        const canChecked = slot && slot.lifetimeData;
        const bidderNotLocked =
          canChecked && slot.lifetimeData.bidderLockedTime < now;
        if (bidderNotLocked) {
          slot.lifetimeData = { ...AdvertisingRequestManager.slotLifetimeData };
          slot.lifetimeData.bidderLockedTime = lockedTime;
        }
        filteredSlots.push(slot);
      });
      logMessage(
        'registerAndFilterRequestedAdSlots bidderRequestTimeoutLock',
        filteredSlots,
        slots
      );
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
        prebid,
        apstag,
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

        slot.lifetimeData = { ...AdvertisingRequestManager.slotLifetimeData };
        if (prebid) {
          slot.prebid = prebid;
        }
        if (apstag) {
          slot.apstag = apstag;
        }

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
        const newSlot = isLazyLoadingEnabled
          ? { ...slot, enableLazyLoad: defaultLazyLoadConfig }
          : slot;
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
