import React, { Component } from 'react';
import connectToAdServer from './utils/connectToAdServer';
import PropTypes from 'prop-types';
import { InView } from 'react-intersection-observer';

class AdvertisingSlot extends Component {
  constructor(props) {
    super(props);
    this.triggeredLazy = false;
  }

  componentDidMount() {
    const { lazyLoad } = this.props;
    if (!lazyLoad) {
      this.activateSlot();
    }
  }

  componentDidUpdate(prevProps) {
    const { activate, lazyLoad } = this.props;
    this.triggeredLazy = false;
    if (prevProps.activate !== activate && !lazyLoad) {
      this.activateSlot();
    }
  }

  triggerLazyLoad() {
    this.triggeredLazy = true;
    if (!this.triggeredLazy) {
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
      <div id={id} style={style} className={className} children={children} data-r16="3.0.2" />
    );
  }

  renderLazy() {
    return (
      <InView as={'div'} root={'0 0 -50vm 0'} onChange={(inView) => { if (inView) { this.triggerLazyLoad(); } }}>
        {this.renderSlot()}
      </InView>
    );
  }

  render() {
    const { lazyLoad } = this.props;
    if (lazyLoad) {
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
  lazyLoad: PropTypes.bool,
};

AdvertisingSlot.defaultProps = {
  customEventHandlers: {},
};

export default connectToAdServer(AdvertisingSlot);
