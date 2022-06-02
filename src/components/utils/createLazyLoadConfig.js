export default function createLazyLoadConfig(slots) {
  if (!slots) {
    return null;
  }
  const lazyConfigSlots = [];
  slots.forEach((slot) => {
    if (typeof slot.enableLazyLoad === 'object') {
      lazyConfigSlots.push({
        id: slot.id,
        data: slot.enableLazyLoad,
      });
    }
  });
  if (lazyConfigSlots.length === 0) {
    return null;
  }
  return lazyConfigSlots;
}
