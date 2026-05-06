const footerLinks = [
  {
    href: "https://github.com/adarshaacharya/archer",
    label: "GitHub",
    external: true,
  },
  {
    href: "https://linkedin.com/in/adarshaacharya",
    label: "LinkedIn",
    external: true,
  },
  {
    href: "mailto:hi@adarsha.dev",
    label: "Contact",
    external: false,
  },
] as const;

export function SiteFooter() {
  return (
    <footer
      className="w-full bg-[var(--fg-charcoal)] text-[var(--bg-bone)]"
      style={{ borderTop: "1px solid rgba(244, 243, 239, 0.35)" }}
    >
      <div className="grid-container">
        <div className="col-span-full pad-box flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="mono space-y-1">
            <div>© 2026 Archer</div>
            <div style={{ color: "rgba(244, 243, 239, 0.72)" }}>MIT License</div>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-4">
            {footerLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="mono transition-colors hover:text-[var(--accent-green)]"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
