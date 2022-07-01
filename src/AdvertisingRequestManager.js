import logMessage from './utils/logMessage';
import Advertising from './Advertising';

export default class AdvertisingRequestManager {
  constructor() {
    this.queues = {};
    this.latestQueue = null;
    this.WAIT_QUEUE_TIME = 500;
    this.FAILSAFE_TIME = 4500;
    this.REQUEST_TIMEOUT_LOCK_ENABLED = false;
  }

  setConfig(config) {
    this.WAIT_QUEUE_TIME = config.requestWaitTimeout || this.WAIT_QUEUE_TIME;
    this.FAILSAFE_TIME = config.requestFailsafeTimeout || this.FAILSAFE_TIME;
    this.REQUEST_TIMEOUT_LOCK_ENABLED =
      config.requestTimeoutLock || this.REQUEST_TIMEOUT_LOCK_ENABLED;
  }

  newQueue(waitTimeoutCallback) {
    const now = Date.now();
    const queueId = `${now}-${Math.round(Math.random() * 100000)}`;
    logMessage('queueManager new queue', queueId);
    this.queues[queueId] = {
      id: queueId,
      waitTimeoutCallback,
      active: true,
      failsafeTimeout: window.setTimeout(() => {
        logMessage('queueManager failsave triggered', queueId);
        this.sendAdserverRequest(this.queues[queueId]);
      }, this.FAILSAFE_TIME),
      adserverRequestSent: false,
      apstagDone: true,
      prebidDone: true,
      availableSlots: [],
      prebidRequestData: [],
      apstagRequestData: [],
      started: now,
    };
    const q = this.queues[queueId];
    this.latestQueue = q;
    q.waitTimeout = this.setWaitTimeout(q);
    return q;
  }

  setWaitTimeout(queue) {
    return window.setTimeout(() => {
      logMessage('requestManager setWaitTimeout', queue.id, queue);
      if (queue) {
        queue.active = false;
        logMessage(
          'requestManager setWaitTimeout callback',
          queue.id,
          queue.waitTimeoutCallback
        );
        if (typeof queue.waitTimeoutCallback === 'function') {
          queue.waitTimeoutCallback();
        }
      }
    }, this.WAIT_QUEUE_TIME);
  }

  clearWaitTimeout(queue) {
    logMessage('requestManager clearWaitTimeout', queue.id, queue);
    window.clearTimeout(queue.waitTimeout);
  }

  getQueue(queueId) {
    const queue = this.queues[queueId];
    if (queueId && queue) {
      return queue;
    }
    if (
      this.REQUEST_TIMEOUT_LOCK_ENABLED &&
      this.latestQueue &&
      this.latestQueue.active
    ) {
      return this.latestQueue;
    }
    return this.newQueue();
  }

  updateQueue(queue, changes) {
    if (queue && changes) {
      this.clearWaitTimeout(queue);
      queue.adserverRequestSent =
        changes.adserverRequestSent || queue.adserverRequestSent;
      queue.prebidDone = changes.prebidDone || queue.prebidDone;
      queue.apstagDone = changes.apstagDone || queue.apstagDone;
      queue.availableSlots = changes.availableSlots || queue.availableSlots;
      queue.prebidRequestData =
        changes.prebidRequestData || queue.prebidRequestData;
      queue.apstagRequestData =
        changes.apstagRequestData || queue.apstagRequestData;
      queue.waitTimeoutCallback =
        changes.waitTimeoutCallback || queue.waitTimeoutCallback;
      queue.waitTimeout = this.setWaitTimeout(queue);
    }
  }

  biddersBack(queue, type) {
    logMessage(
      'requestManager.biddersBack',
      queue.id,
      queue,
      queue.availableSlots,
      type
    );
    // when both APS and Prebid bids have returned, initiate ad request
    if (queue.apstagDone && queue.prebidDone) {
      clearTimeout(queue.failsafeTimeout);
      this.sendAdserverRequest(queue, 'biddersBack');
    }
  }

  sendAdserverRequest(queue) {
    queue.availableSlots.forEach((slot) => {
      if (slot && slot.lifetimeData) {
        logMessage(
          'requestManager.sendAdserverRequest: availableSlots',
          slot.getSlotElementId(),
          slot.lifetimeData,
          typeof slot.getTargetingMap === 'function'
            ? slot.getTargetingMap()
            : 'no func'
        );
        slot.lifetimeData.response = true;
      }
    });
    if (queue.adserverRequestSent === true) {
      return;
    }
    queue.adserverRequestSent = true;
    logMessage('requestManager sendAdserverRequest refresh', queue.id);
    Advertising.queueForGPT(
      () => window.googletag.pubads().refresh(queue.availableSlots),
      this.onError
    );
  }

  static slotLifetimeData = {
    activated: false,
    bidderLockedTime: 0,
    prebidResponded: false,
    apstagResponded: false,
    adserverRequest: false,
    rendered: false,
    visible: false,
  };
}
