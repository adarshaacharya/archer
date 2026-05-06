import { ArrowRightIcon } from "@/app/(marketing)/_components/arrow-right-icon";

export function HeroLead() {
  return (
    <div className="col-span-6 pad-box">
      <div
        className="mono mb-2"
        style={{
          paddingBottom: "1rem",
          borderBottom: "1px solid #111",
          display: "inline-block",
        }}
      >
        AGENT_INIT
      </div>
      <h1 className="hero-title">Archer</h1>
      <p className="hero-lead">
        The terminal-first AI coding agent for real local work.
      </p>
      <p className="mb-2">
        Bring your own API key. Review patches, approve risky actions, and keep
        control over how the agent works inside your repo.
      </p>

      <div className="hero-support">YOUR KEYS. YOUR PROVIDER. YOUR SPEND.</div>

      <div className="cta-group" style={{ justifyContent: "flex-start" }}>
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

      <div id="install" className="install-block scroll-mt-28">
        <div className="install-header mono">
          <span>INSTALLATION</span>
          <span>macOS, Linux, WSL</span>
        </div>
        <div className="install-code">{`curl -fsSL https://archer.dev/install.sh | bash
npm install -g archer-ai`}</div>
      </div>
    </div>
  );
}
