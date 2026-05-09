const steps = [
  {
    n: "1",
    title: "Ask",
    body: "Describe a coding task in plain English.",
  },
  {
    n: "2",
    title: "Read",
    body: "Archer inspects files, repo context, and the web when needed.",
  },
  {
    n: "3",
    title: "Approve",
    body: "Review risky commands and writes before they run.",
  },
  {
    n: "4",
    title: "Apply",
    body: "Accept patch-based edits instead of silent rewrites.",
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
