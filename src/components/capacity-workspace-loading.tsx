export function CapacityWorkspaceLoading() {
  return <div className="ops-command-center capacity-workspace capacity-loading-view" aria-live="polite" aria-busy="true">
    <div className="capacity-loading-title"><span/><span/></div>
    <div className="performance-tabs capacity-loading-tabs"><i/><i/><i/><i/></div>
    <div className="performance-summary-grid">
      {[0, 1, 2, 3].map((item) => <article key={item}><span className="capacity-loading-line"/><strong className="capacity-loading-line"/></article>)}
    </div>
    <section className="panel"><div className="panel-head"><div className="capacity-loading-line"/></div>
      <div className="capacity-loading-rows">{[0, 1, 2, 3, 4, 5].map((item) => <span key={item}/>)}</div>
    </section>
  </div>;
}
