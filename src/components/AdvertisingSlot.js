import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { InView } from 'react-intersection-observer';
import connectToAdServer from './utils/connectToAdServer';

class AdvertisingSlot extends Component {
  constructor(props) {
    super(props);
    this.triggeredLazy = false;
  }

  componentDidMount() {
    if (!this.isLazy()) {
      this.activateSlot();
    }
  }

  isLazy() {
    return !(this.props.lazyConfig === undefined || this.props.lazyConfig === null)
  }

  componentDidUpdate(prevProps) {
    console.log('AdvertisingSlot: componentDidUpdate', this.triggeredLazy, !this.isLazy());
    const { activate } = this.props;
    this.triggeredLazy = false;
    if (prevProps.activate !== activate && !this.isLazy()) {
      console.log('AdvertisingSlot: componentDidUpdate active slot');
      this.activateSlot();
    }
    console.log('AdvertisingSlot: componentDidUpdate finished');
  }

  triggerLazyLoad() {
    console.log('AdvertisingSlot: triggerLazyLoad', this.triggeredLazy, !this.isLazy());
    if (!this.triggeredLazy) {
      this.triggeredLazy = true;
      this.activateSlot();
    }
  }

  activateSlot() {
    const { activate, id, customEventHandlers } = this.props;
    activate(id, customEventHandlers);
  }

  renderSlot() {
    const { id, style, className, children } = this.props;
    return (
      <div id={id} style={style} className={className} children={children} data-r16={'4.0.0'} />
    );
  }

  renderLazy() {
    const { lazyConfig, id } = this.props;
    return (
      <InView
        key={id+'inview'}
        as={'div'}
        rootMargin={lazyConfig.rootMargin}
        onChange={(inView) => { if (inView) { this.triggerLazyLoad(); } }}
        triggerOnce={true}
      >
        {this.renderSlot()}
      </InView>
    );
  }

  render() {
    const { id } = this.props;
    console.log('AdvertisingSlot: render', id);
    if (this.isLazy()) {
      return this.renderLazy();
    }
    return this.renderSlot();
  }
}

AdvertisingSlot.propTypes = {
  id: PropTypes.string.isRequired,
  activate: PropTypes.func.isRequired,
  customEventHandlers: PropTypes.objectOf(PropTypes.func).isRequired,
  style: PropTypes.object,
  className: PropTypes.string,
  children: PropTypes.node,
  lazyConfig: PropTypes.object,
};

AdvertisingSlot.defaultProps = {
  customEventHandlers: {},
};

export default connectToAdServer(AdvertisingSlot);
