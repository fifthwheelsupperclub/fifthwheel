// The two kinds of email staff track. One nav item ("Emails"), two tabs.
export function EmailTabs({ current }: Readonly<{ current: "guest" | "invitations" }>) {
  return <nav className="tabs" aria-label="Email types">
    <a href="/admin/notices" aria-current={current === "guest" ? "page" : undefined}>Guest emails</a>
    <a href="/admin/table-invitations" aria-current={current === "invitations" ? "page" : undefined}>Table invitations</a>
  </nav>;
}
