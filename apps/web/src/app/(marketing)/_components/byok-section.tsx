const llmProviders = ["OPENAI", "ANTHROPIC", "GEMINI", "DEEPSEEK", "OPENROUTER"] as const;
const webProviders = ["TAVILY", "EXA", "ARCHER SCOUT (FREE)"] as const;

export function BYOKSection() {
  return (
    <section className="grid-container section-border bg-accent">
      <div className="col-span-full border-b border-charcoal py-4 pad-box">
        <span className="mono">{"01 // BYOK & TRUST"}</span>
      </div>
      <div className="col-span-6 pad-box bg-accent">
        <h2 className="big-statement text-charcoal">
          No lock-in. No hidden margin. No surprise spend.
        </h2>
      </div>
      <div className="byok-copy-col col-span-6 col-last border-l border-charcoal bg-bone pad-box">
        <p className="mb-4 text-xl">
          Archer doesn&apos;t hide the model behind a black box. Connect your llm and web search
          provider keys, you own the access, and you see the cost where the work happens.
        </p>

        <div className="byok-provider-scroll mono">
          <p className="mono term-gray-text mb-2 mt-0 text-[0.8125rem]">LLM Providers</p>
          <ul className="provider-list mono mt-0">
            {llmProviders.map((name) => (
              <li key={name}>
                <span>{name}</span> <span>SUPPORTED</span>
              </li>
            ))}
          </ul>
          <p className="mono term-gray-text mb-2 mt-5 text-[0.8125rem]">Web Search</p>
          <ul className="provider-list mono mt-0">
            {webProviders.map((name) => (
              <li key={name}>
                <span>{name}</span> <span>SUPPORTED</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
