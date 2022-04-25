import getAdUnits from './utils/getAdUnits';

const defaultLazyLoadConfig = {
  marginPercent: 100,
  mobileScaling: 1,
  rootMargin: '20% 0% 100% 0%'
};
const requestManager = {
  adserverRequestSent: false,
  apsDone: false,
  prebidDone: false,
  biddersBack: (type) => {
    console.log('biddersBack', requestManager, type);
    // when both APS and Prebid have returned, initiate ad request
    if (requestManager.apsDone && requestManager.prebidDone) {
      console.log('biddersBack refresh');
      window.googletag.pubads().refresh();
    }
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
    this.isApsTagUsed =
      typeof this.config.useApsTag === 'undefined'
        ? typeof window.apstag !== 'undefined'
        : this.config.useApsTag;
    console.log('setup', this.isPrebidUsed, this.isApsTagUsed);
    this.executePlugins('setup');
    const { slots, outOfPageSlots, queue, isPrebidUsed } = this;
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
    const divIds = queue.map(({ id }) => id);
    const selectedSlots = queue.map(
      ({ id }) => {
        const slot = slots[id] || outOfPageSlots[id];
        if (!slot?.enableLazyLoad) {
          return slot;
        }
      }
    );
    if (this.isPrebidUsed || this.isApsTagUsed) {
      if (this.isPrebidUsed) {
        Advertising.queueForPrebid(
          () =>
            window.pbjs.requestBids({
              adUnitCodes: divIds,
              bidsBackHandler: () => {
                window.pbjs.setTargetingForGPTAsync(divIds);
                Advertising.queueForGPT(
                  () => {
                    console.log('setup Advertising.queueForGPT prebid done bids', selectedSlots);
                    requestManager.prebidDone = true; // signals that Prebid request has completed
                    requestManager.biddersBack('prebid');
                  },
                  this.onError
                );
              },
            }),
          this.onError
        );
      } else {
        requestManager.prebidDone = true; // don't wait for prebid
      }

      if (this.isApsTagUsed) {
        const apsSlots = this.config.amazonPublisherServicesSlots;
        console.log('setup apstag apsSlots', apsSlots);
        console.log('setup apstag window.apstag', window.apstag);
        if (apsSlots && apsSlots.length > 0) {
          window.apstag.fetchBids({
            slots: apsSlots,
            timeout: 3500
          }, function(bids) {
            console.log('pluginAmazonPublisherServices fetchBids callback', bids);
            window.googletag.cmd.push(function() {
              window.apstag.setDisplayBids();
              requestManager.apsDone = true; // signals that APS request has completed
              requestManager.biddersBack('apstag');
            });
          });
        } else {
          requestManager.apsDone = true; // don't wait for apstag
        }
      } else {
        requestManager.apsDone = true; // don't wait for apstag
      }
    } else {
      Advertising.queueForGPT(
        () => {
          console.log('setup Advertising.queueForGPT no prebid/apstag refresh', selectedSlots);
          window.googletag.pubads().refresh(selectedSlots);
          },
        this.onError
      );
    }
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
    const { slots, isPrebidUsed } = this;
    if (Object.values(slots).length === 0) {
      this.queue.push({ id, customEventHandlers });
      return;
    }
    Object.keys(customEventHandlers).forEach((customEventId) => {
      if (!this.customEventCallbacks[customEventId]) {
        this.customEventCallbacks[customEventId] = {};
      }
      return (this.customEventCallbacks[customEventId][id] =
        customEventHandlers[customEventId]);
    });
    if (isPrebidUsed) {
      Advertising.queueForPrebid(
        () =>
          window.pbjs.requestBids({
            adUnitCodes: [id],
            bidsBackHandler: () => {
              window.pbjs.setTargetingForGPTAsync([id]);
              Advertising.queueForGPT(
                () => {
                  console.log('activate Advertising.queueForGPT prebid refresh', [slots[id]]);
                  window.googletag.pubads().refresh([slots[id]]);
                },
                this.onError
              );
            },
          }),
        this.onError
      );
    } else {
      Advertising.queueForGPT(
        () => {
          console.log('activate Advertising.queueForGPT prebid refresh', [slots[id]]);
          window.googletag.pubads().refresh([slots[id]]);
        },
        this.onError
      );
    }
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
    console.log('setupGpt');
    const pubads = window.googletag.pubads();
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
