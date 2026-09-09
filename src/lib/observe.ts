import { useEffect, useRef, useState } from "react";

/** Returns a ref to attach to a scroll container; children with data-reveal
 *  get sequenced in/out as that container scrolls into view. Mark a child
 *  with data-reveal to be animated and data-reveal-visible="true" to be
 *  pinned (no fade). Children may also carry data-reveal-delay="<s>". */
export function useRevealScroll(containerRef: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [containerRef]);
  return { visible, containerRef };
}

export function animateChildrenOnce(container: HTMLElement, opts: { timing?: string } = {}) {
  const timing = opts.timing ?? "forwards";
  const root = container.animate(
    [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
  );
  root.play();
}
