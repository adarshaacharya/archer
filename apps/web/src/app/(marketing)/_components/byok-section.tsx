const providers = ["OPENAI", "ANTHROPIC", "GEMINI", "OPENROUTER"] as const;

export function BYOKSection() {
  return (
    <section
      className="grid-container section-border"
      style={{ backgroundColor: "var(--accent-green)" }}
    >
      <div
        className="col-span-full pad-box"
        style={{
          borderBottom: "var(--border)",
          paddingTop: "1rem",
          paddingBottom: "1rem",
        }}
      >
        <span className="mono">{"01 // BYOK & TRUST"}</span>
      </div>
      <div className="col-span-6 pad-box bg-accent">
        <h2 className="big-statement text-charcoal">
          No lock-in. No hidden margin. No surprise spend.
        </h2>
      </div>
      <div
        className="col-span-6 col-last pad-box bg-bone"
        style={{
          backgroundColor: "var(--bg-bone)",
          borderLeft: "var(--border)",
        }}
      >
        <p style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
          Archer doesn&apos;t hide the model behind a black box. You choose the provider, you own
          the access, and you see the cost where the work happens.
        </p>
        <p className="term-gray-text">
          Connect your credentials. Keep billing under your control. Avoid lock-in. Work locally
          with clear approval boundaries.
        </p>

        <ul className="provider-list mono">
          {providers.map((name) => (
            <li key={name}>
              <span>{name}</span> <span>SUPPORTED</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
