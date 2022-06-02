import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { InView } from 'react-intersection-observer';
import connectToAdServer from './utils/connectToAdServer';

class AdvertisingSlot extends Component {
  constructor(props) {
    super(props);
    this.triggeredLazy = false;
    this.lazyConfig = props.lazyConfig?.find((slot) => slot.id === props.id);
  }

  componentDidMount() {
    if (!this.isLazy()) {
      this.activateSlot();
    }
  }

  componentDidUpdate(prevProps) {
    const { id, activate } = this.props;
    if (prevProps.activate !== activate && !this.isLazy()) {
      this.activateSlot();
    }
    this.triggeredLazy = false;
  }

  isLazy() {
    return this.lazyConfig !== undefined;
  }

  triggerLazyLoad() {
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
      <div
        id={id}
        style={style}
        children={children}
        className={className}
        data-r16={'4.1.5-beta.23'}
      />
    );
  }

  renderLazy() {
    const { id } = this.props;
    if (!this.isLazy()) {
      return null;
    }
    return (
      <InView
        id={id + '-inview'}
        as={'div'}
        rootMargin={this.lazyConfig.data.rootMargin}
        onChange={(inView) => {
          if (inView) {
            this.triggerLazyLoad();
          }
        }}
        triggerOnce={true}
      >
        {this.renderSlot()}
      </InView>
    );
  }

  render() {
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
  lazyConfig: PropTypes.array,
};

AdvertisingSlot.defaultProps = {
  customEventHandlers: {},
};

export default connectToAdServer(AdvertisingSlot);
