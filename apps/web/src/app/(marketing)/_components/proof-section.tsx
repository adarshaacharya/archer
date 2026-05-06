export function ProofSection() {
  return (
    <section className="grid-container section-border">
      <div
        className="col-span-4 pad-box"
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div>
          <span className="mono mb-2 block">{"03 // CONTROL & SAFETY"}</span>
          <h2 style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>Built for real repositories.</h2>
          <p>
            Archer asks before risky actions and routes file and shell operations through explicit
            policy checks.
          </p>
        </div>
        <div style={{ marginTop: "4rem" }}>
          <svg
            width="100%"
            height="60"
            viewBox="0 0 200 60"
            preserveAspectRatio="none"
            role="img"
            aria-label="Diagram: policy boundary with control point"
          >
            <title>Policy boundary diagram</title>
            <path
              d="M0,30 L200,30"
              stroke="#111"
              strokeWidth="1"
              strokeDasharray="4 4"
              fill="none"
            />
            <circle cx="100" cy="30" r="4" fill="#111" />
            <rect
              x="90"
              y="20"
              width="20"
              height="20"
              fill="none"
              stroke="#E0FF3E"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      <div className="col-span-8 col-last p-0">
        <div className="proof-grid">
          <div className="proof-item">
            <div className="proof-icon">
              <svg viewBox="0 0 24 24" role="img" aria-label="Shield">
                <title>Shield</title>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3 className="mb-1">Approval Controls</h3>
            <p className="term-gray-text" style={{ fontSize: "0.875rem" }}>
              Choose how much autonomy Archer gets. Safe reads can flow, while risky writes and
              shell actions stay gated.
            </p>
          </div>
          <div className="proof-item">
            <div className="proof-icon">
              <svg viewBox="0 0 24 24" role="img" aria-label="Grid layout">
                <title>Grid layout</title>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <h3 className="mb-1">Sandboxed Context</h3>
            <p className="term-gray-text" style={{ fontSize: "0.875rem" }}>
              File and shell actions operate inside explicit boundaries. Control which paths and
              commands Archer can touch.
            </p>
          </div>
          <div className="proof-item">
            <div className="proof-icon">
              <svg viewBox="0 0 24 24" role="img" aria-label="Document">
                <title>Document</title>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <h3 className="mb-1">Patch-First Editing</h3>
            <p className="term-gray-text" style={{ fontSize: "0.875rem" }}>
              Changes are proposed as reviewable patches instead of silent rewrites, so they fit
              normal developer workflows.
            </p>
          </div>
          <div className="proof-item">
            <div className="proof-icon">
              <svg viewBox="0 0 24 24" role="img" aria-label="Terminal prompt">
                <title>Terminal prompt</title>
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <h3 className="mb-1">Terminal-First Workflow</h3>
            <p className="term-gray-text" style={{ fontSize: "0.875rem" }}>
              Works where you already code, run tests, inspect diffs, and manage git.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
