export function MetaBar() {
  return (
    <header className="meta-bar mono">
      <div>{"SYS.ARCHER // V.1.0.4"}</div>
      <div className="text-accent font-bold" style={{ color: "#666" }}>
        STATUS: LOCAL_ONLY
      </div>
      <div style={{ display: "none" }} aria-hidden>
        [ENCRYPTED]
      </div>
      <div className="hide-mobile">BYOK_VERIFIED</div>
    </header>
  );
}
