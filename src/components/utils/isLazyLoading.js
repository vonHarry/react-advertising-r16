export default function isLazyLoading(config) {
  if (!config?.slots) {
    return false;
  }
  const slotConfig = config.slots.find((slot) => slot.id === id);
  if (!slotConfig) {
    return false;
  }
  return slotConfig.enableLazyLoad !== undefined && slotConfig.enableLazyLoad !== null;
}
