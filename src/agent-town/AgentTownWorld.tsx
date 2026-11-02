export default function AgentTownWorld({ workspaceId, locked = false }: { workspaceId: string; locked?: boolean }) {
  return <section aria-label="Agent Town"><h2>Agent Town</h2><p>{locked || !workspaceId ? 'Unlock your workspace to continue.' : 'The separate Agent Town world bundle is not included in this source release. No live agent activity is connected.'}</p></section>;
}
