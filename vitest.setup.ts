import "@testing-library/jest-dom/vitest";

// jsdom lacks matchMedia, which some Radix components call at mount.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

// jsdom lacks scrollTo used by dialogs.
if (typeof window !== "undefined" && !window.scrollTo) {
  (window as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
}
