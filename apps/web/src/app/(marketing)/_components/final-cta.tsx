import { ArrowRightIcon } from "@/app/(marketing)/_components/arrow-right-icon";

export function FinalCTA() {
  return (
    <section className="final-cta section-border">
      <h2>Code locally. Research when needed. Approve what matters.</h2>
      <p>Use your own provider keys and keep the agent inside clear repo boundaries.</p>

      <div className="cta-group">
        <a href="#install" className="btn btn-primary">
          Start Building
          <ArrowRightIcon className="arrow-icon" />
        </a>
        <a
          href="https://github.com/adarshaacharya/archer"
          className="btn btn-secondary"
          rel="noopener noreferrer"
          target="_blank"
        >
          View on GitHub
        </a>
      </div>
    </section>
  );
}
