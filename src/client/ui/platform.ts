// Every iPhone and iPad browser is WebKit, whatever its name. iPadOS reports a Mac with touch.
export const IS_IOS = typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
