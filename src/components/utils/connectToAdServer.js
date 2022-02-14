import React from 'react';
import AdvertisingContext from '../../AdvertisingContext';
import createLazyLoadConfig from './createLazyLoadConfig';

export default (Component) => (props) => (
  <AdvertisingContext.Consumer>
    {(contextData) => {
      const { activate, config } = contextData;
      const lazyConfig = createLazyLoadConfig(config.slots);
      return <Component {...props} activate={activate} lazyConfig={lazyConfig} />;
    }}
  </AdvertisingContext.Consumer>
);
