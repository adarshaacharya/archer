const steps = [
  {
    n: "1",
    title: "Prompt",
    body: "Turn plain-language requests into real repository work.",
  },
  {
    n: "2",
    title: "Plan",
    body: "Archer analyzes context and proposes a structured execution plan.",
  },
  {
    n: "3",
    title: "Approve",
    body: "Review risky actions before they run.",
  },
  {
    n: "4",
    title: "Patch",
    body: "Inspect proposed code changes as standard patches before applying them.",
  },
] as const;

export function PipelineSection() {
  return (
    <section className="grid-container section-border">
      <div
        className="col-span-full pad-box"
        style={{
          borderBottom: "var(--border)",
          paddingTop: "1rem",
          paddingBottom: "1rem",
        }}
      >
        <span className="mono">{"02 // EXECUTION PIPELINE"}</span>
      </div>
      <div className="col-span-full p-0">
        <div className="pipeline-container">
          {steps.map((step) => (
            <div key={step.n} className="pipeline-step">
              <span className="step-num mono">{step.n}</span>
              <h3 className="mb-1 uppercase-heading">{step.title}</h3>
              <p className="term-gray-text" style={{ fontSize: "0.875rem" }}>
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
