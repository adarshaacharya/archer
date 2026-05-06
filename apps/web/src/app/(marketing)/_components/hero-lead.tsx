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
        <div className="relative h-20 w-20 shrink-0 overflow-hidden sm:h-24 sm:w-24 md:h-24 md:w-24">
          <Image
            src="/logos/logo-transparent.png"
            alt="Archer logo"
            fill
            priority
            sizes="(min-width: 768px) 6rem, (min-width: 640px) 6rem, 5rem"
            className="object-contain scale-[1.58] object-center"
          />
        </div>
        <div className="hidden h-20 w-px bg-[#111]/40 sm:block sm:h-24" aria-hidden />
        <h1
          className="font-[var(--font-archer-display)] text-[clamp(2.9rem,5.6vw,4.8rem)] leading-none tracking-[0.03em] uppercase"
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
        <div className="install-code">{`curl -fsSL https://usearcher.vercel.app/install.sh | bash
npm install -g @adarshaacharya/archer`}</div>
      </div>
    </div>
  );
}
