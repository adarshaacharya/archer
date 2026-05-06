import Image from "next/image";
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

      <div className="mt-6 mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="relative h-24 w-24 shrink-0 overflow-hidden sm:h-32 sm:w-32 md:h-32 md:w-32">
          <Image
            src="/logos/logo-transparent.png"
            alt="Archer logo"
            fill
            priority
            sizes="(min-width: 768px) 8rem, (min-width: 640px) 8rem, 6rem"
            className="object-contain scale-[1.48] object-center"
          />
        </div>
        <div className="hidden h-24 w-px bg-[#111]/40 sm:block" aria-hidden />
        <h1
          className="font-[var(--font-archer-display)] text-[clamp(2.8rem,6.6vw,5.5rem)] leading-none tracking-[0.045em] uppercase"
          aria-label="Archer"
        >
          Archer
        </h1>
      </div>
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
