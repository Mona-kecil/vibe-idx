import { useEffect, useRef } from 'react';

export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let target: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warmUntil = 0;
    let focusFrame = 0;
    const hide = () => {
      clearTimeout(timer);
      if (ref.current && !ref.current.hidden) warmUntil = performance.now() + 600;
      target?.removeAttribute('aria-describedby');
      target = null;
      if (ref.current) {
        ref.current.hidden = true;
        delete ref.current.dataset.open;
      }
    };
    const open = (element: Element, instant: boolean) => {
      const tooltip = ref.current;
      if (!tooltip || !element.isConnected) return;
      target = element;
      tooltip.textContent = element.getAttribute('data-tip');
      tooltip.hidden = false;
      tooltip.dataset.instant = String(instant);
      element.setAttribute('aria-describedby', 'ui-tooltip');
      const box = element.getBoundingClientRect(),
        size = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - size.width - 8, box.left + box.width / 2 - size.width / 2))}px`;
      tooltip.style.top = `${box.top > size.height + 12 ? box.top - size.height - 8 : box.bottom + 8}px`;
      if (instant) tooltip.dataset.open = '';
      else
        requestAnimationFrame(() => {
          if (target === element) tooltip.dataset.open = '';
        });
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
      const element = event.target.closest('[data-tip]');
      if (
        !element ||
        element === target ||
        (event.relatedTarget instanceof Node && element.contains(event.relatedTarget))
      )
        return;
      const instant =
        performance.now() < warmUntil || (ref.current !== null && !ref.current.hidden);
      hide();
      target = element;
      if (instant) open(element, true);
      else
        timer = setTimeout(() => {
          if (target === element) open(element, false);
        }, 450);
    };
    const out = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-tip]') === target &&
        !(event.relatedTarget instanceof Node && target?.contains(event.relatedTarget))
      )
        hide();
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        const element = event.target.closest('[data-tip]');
        if (element) {
          hide();
          focusFrame = requestAnimationFrame(() => {
            if (element === document.activeElement || element.contains(document.activeElement))
              open(element, true);
          });
        }
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelAnimationFrame(focusFrame);
        hide();
      }
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', out);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancelAnimationFrame(focusFrame);
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', out);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);
  return <div ref={ref} id="ui-tooltip" role="tooltip" hidden />;
}
