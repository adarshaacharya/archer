import Image from "next/image";
import { useId } from "react";
import { ArrowRightIcon } from "@/app/(marketing)/_components/arrow-right-icon";

export function HeroLead() {
  const installId = useId();

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
        <div className="relative h-16 w-16 shrink-0 overflow-hidden sm:h-20 sm:w-20 md:h-20 md:w-20">
          <Image
            src="/logos/logo-cropped.png"
            alt="Archer logo"
            fill
            priority
            sizes="(min-width: 768px) 5rem, (min-width: 640px) 5rem, 4rem"
            className="object-contain object-center"
          />
        </div>
        <div className="hidden h-16 w-px bg-[#111]/40 sm:block sm:h-20" aria-hidden />
        <h1
          className="font-[var(--font-archer-display)] text-[clamp(3.1rem,6vw,5.2rem)] leading-none tracking-[0.02em] uppercase"
          aria-label="Archer"
        >
          Archer
        </h1>
      </div>
      <p className="hero-lead">The terminal-first AI coding agent for real local work.</p>
      <p className="mb-2">
        Bring your own API key. Review patches, approve risky actions, and keep control over how the
        agent works inside your repo.
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

      <div id={installId} className="install-block scroll-mt-28">
        <div className="install-header mono">
          <span>INSTALLATION</span>
          <span>macOS, Linux, WSL</span>
        </div>
        <div className="install-code">{`curl -fsSL https://usearcher.vercel.app/install.sh | bash
archer --help`}</div>
      </div>
    </div>
  );
}
