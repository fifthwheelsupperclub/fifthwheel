// Baked in at build time (client-safe); defaults to the marketing origin named in render.yaml.
const MARKETING = ((import.meta.env.VITE_MARKETING_ORIGIN as string | undefined)?.trim() || "https://fifthwheel.community").replace(/\/+$/, "");

export function LegalFooter() {
  return <footer className="legal-footer">
    <nav aria-label="Legal and support">
      <a href={`${MARKETING}/terms`}>Terms</a>
      <a href={`${MARKETING}/privacy`}>Privacy</a>
      <a href="mailto:hello@fifthwheel.community">hello@fifthwheel.community</a>
    </nav>
  </footer>;
}
