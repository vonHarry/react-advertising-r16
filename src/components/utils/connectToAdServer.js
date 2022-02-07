import React from 'react';
import AdvertisingContext from '../../AdvertisingContext';
import isLazyLoading from './isLazyLoading';

export default (Component) => (props) => (
  <AdvertisingContext.Consumer>
    {({ activate, config }) => <Component {...props} activate={activate} lazyLoad={isLazyLoading(config)} />}
  </AdvertisingContext.Consumer>
);
