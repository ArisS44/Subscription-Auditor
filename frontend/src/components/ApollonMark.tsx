import { cn } from '@/lib/utils';

/** Apollon's mark — the assistant's face in the chat surface.
 *
 *  Rendered as a CSS-masked box over the shared `/apollon.svg` asset so the mark
 *  paints in `currentColor` and follows the theme (light ink on dark, dark ink on
 *  light) without inlining the path data or shipping a second colour variant. The
 *  figure is the Noun Project "apollo" mark (see the credit in Settings / NOTICE).
 *
 *  Size is set by the caller through `className` (e.g. `size-10`). Decorative by
 *  default; pass `label` when the mark stands in for the assistant's name so it is
 *  announced, otherwise it is hidden from assistive tech. */
export function ApollonMark({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block shrink-0 bg-current', className)}
      style={{
        maskImage: 'url(/apollon.svg)',
        WebkitMaskImage: 'url(/apollon.svg)',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  );
}
