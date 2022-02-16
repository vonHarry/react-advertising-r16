import isMobileDevice from './isMobileDevice';

export default function calculateRootMargin({
  marginPercent,
  mobileScaling,
} = {}) {
  if (!marginPercent) {
    return undefined;
  }
  const finalMarginPercent =
    isMobileDevice() && mobileScaling !== undefined && mobileScaling !== -1
      ? marginPercent * mobileScaling
      : marginPercent;
  const rootMargin = `${(finalMarginPercent / 100) * window.innerHeight}px`;
  return rootMargin;
}
