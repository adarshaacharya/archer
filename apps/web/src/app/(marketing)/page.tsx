import { BYOKSection } from "@/app/(marketing)/_components/byok-section";
import { FinalCTA } from "@/app/(marketing)/_components/final-cta";
import { HeroLead } from "@/app/(marketing)/_components/hero-lead";
import { HeroTerminal } from "@/app/(marketing)/_components/hero-terminal";
import { MetaBar } from "@/app/(marketing)/_components/meta-bar";
import { PipelineSection } from "@/app/(marketing)/_components/pipeline-section";
import { ProofSection } from "@/app/(marketing)/_components/proof-section";

export default function Home() {
  return (
    <>
      <MetaBar />
      <div className="grid-container section-border">
        <HeroLead />
        <HeroTerminal />
      </div>
      <BYOKSection />
      <PipelineSection />
      <ProofSection />
      <FinalCTA />
    </>
  );
}
