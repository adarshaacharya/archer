export function HeroTerminal() {
  return (
    <div
      className="col-span-6 col-last"
      style={{
        padding: "var(--pad)",
        background: "#e5e5e5",
        borderLeft: "var(--border)",
      }}
    >
      <div className="terminal-wrapper">
        <div className="term-header">
          <span>user@local: ~/projects/core-api</span>
          <span>archer-agent</span>
        </div>
        <div className="term-body">
          <div className="term-line">
            <span className="term-prompt">❯</span>
            <span className="term-highlight">archer</span>
          </div>
          <div className="term-line term-dim" style={{ marginTop: "1rem" }}>
            [SYS] Starting local session...
          </div>
          <div className="term-line term-dim">
            [SYS] Describe the task you want Archer to handle.
          </div>
          <div className="term-line" style={{ marginTop: "1rem" }}>
            <span className="term-prompt">&gt;</span>
            <span className="term-highlight">
              Refactor the auth middleware to support JWT rotation
            </span>
          </div>
          <div className="term-line term-dim">
            [SYS] Connecting to local context...
          </div>
          <div className="term-line term-dim">
            [SYS] Reading src/middleware/auth.ts (142 lines)
          </div>
          <div className="term-line term-dim">
            [SYS] Provider: OpenRouter (Claude Sonnet 4.6)
          </div>

          <div
            className="term-line"
            style={{ marginTop: "1rem", color: "#888" }}
          >
            {"// Proposed Changes:"}
          </div>
          <div className="term-line diff-sub">
            - const token = req.headers.authorization?.split(&apos; &apos;)[1];
          </div>
          <div className="term-line diff-add">
            + const token = extractToken(req);
          </div>
          <div className="term-line diff-add">
            + if (isExpired(token)) {"{"}
          </div>
          <div className="term-line diff-add">
            + await attemptRotation(req, res);
          </div>
          <div className="term-line diff-add">+ {"}"}</div>

          <div
            className="term-line"
            style={{
              marginTop: "1.5rem",
              borderTop: "1px dashed #333",
              paddingTop: "1rem",
            }}
          >
            <span className="term-highlight">ACTION REQUIRED:</span>
            Execute patch in local repository?
          </div>
          <div className="term-line">
            <span className="term-prompt">?</span>
            <span>
              [Y/n/edit/details]
              <span className="blinking-cursor" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
