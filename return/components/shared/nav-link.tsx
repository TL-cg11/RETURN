import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * A plain anchor standing in for `next/link`.
 *
 * vinext 1.0.0-beta.3 ships a Link whose click handler calls preventDefault()
 * and then throws inside its own RSC prefetch setup
 * (`TypeError: ee is not a function`), so the default navigation is cancelled
 * and the replacement never happens — every link on the page silently does
 * nothing. Upgrading through 1.0.0-beta.8 does not fix it.
 *
 * A full page load costs a round trip but always navigates. Swap this back to
 * `next/link` once the framework bug is fixed; every call site imports it as
 * `Link`, so the change is one import per file.
 */
export function NavLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return <a href={href} {...rest}>{children}</a>;
}
