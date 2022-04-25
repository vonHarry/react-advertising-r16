function executeParallelAuctionAlongsidePrebid() {

  let FAILSAFE_TIMEOUT = 2000;
  let requestManager = {
    adserverRequestSent: false,
    aps: false,
    prebid: false
  };

  // when both APS and Prebid have returned, initiate ad request
  function biddersBack() {
    if (requestManager.aps && requestManager.prebid) {
      sendAdserverRequest();
    }
    return;
  }

  // sends adserver request
  function sendAdserverRequest() {
    if (requestManager.adserverRequestSent === true) {
      return;
    }
    requestManager.adserverRequestSent = true;
    googletag.cmd.push(function() {
      googletag.pubads().refresh();
    });
  }

  // sends bid request to APS and Prebid
  function requestHeaderBids() {

    // APS request
    apstag.fetchBids({
        slots: [{
          slotID: 'your-gpt-div-id',
          slotName: '12345/yourAdUnit',
          sizes: [[300, 250], [300, 600]]
        }]
      },function(bids) {
        googletag.cmd.push(function() {
          apstag.setDisplayBids();
          requestManager.aps = true; // signals that APS request has completed
          biddersBack(); // checks whether both APS and Prebid have returned
        });
      }
    );

    // put prebid request here
    pbjs.que.push(function() {
      pbjs.requestBids({
        bidsBackHandler: function() {
          googletag.cmd.push(function() {
            pbjs.setTargetingForGPTAsync();
            requestManager.prebid = true; // signals that Prebid request has completed
            biddersBack(); // checks whether both APS and Prebid have returned
          })
        }
      });
    });
  }

  // initiate bid request
  requestHeaderBids();

  // set failsafe timeout
  window.setTimeout(function() {
    sendAdserverRequest();
  }, FAILSAFE_TIMEOUT);
};
