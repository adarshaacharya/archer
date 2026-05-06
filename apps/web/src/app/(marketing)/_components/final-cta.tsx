import { ArrowRightIcon } from "@/app/(marketing)/_components/arrow-right-icon";

export function FinalCTA() {
  return (
    <section className="final-cta section-border">
      <h2>AI coding in your repo, on your terms.</h2>
      <p>Bring your own key. Keep control of the work.</p>

      <div className="cta-group">
        <a href="#install" className="btn btn-primary">
          Start Building
          <ArrowRightIcon className="arrow-icon" />
        </a>
        <a
          href="https://github.com"
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
