import React from 'react';
import AdvertisingContext from '../../AdvertisingContext';
import getLazyLoadConfig from './getLazyLoadConfig';

export default (Component) => (props) => (
  <AdvertisingContext.Consumer>
    {(contextData) => {
      const { activate, config } = contextData;
      const lazyConfig = getLazyLoadConfig(config, props.id);
      return <Component {...props} activate={activate} lazyConfig={lazyConfig} />;
    }}
  </AdvertisingContext.Consumer>
);
