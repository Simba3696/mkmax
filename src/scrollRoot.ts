/** The app's one scrolling area (the page itself never scrolls; see styles.css). */
export const scrollRoot = () => document.querySelector<HTMLElement>('[data-scroll-root]');

/** Current scroll offset of the content area. */
export const scrollTop = () => scrollRoot()?.scrollTop ?? 0;
