export function MessagesPage() {
  return (
    <section className="page-content alternate-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="pulse" /> MESSAGES</div>
          <h1>Agent and distributor inbox</h1>
          <p>Support requests and conversations are centralized here.</p>
        </div>
      </div>

      <section className="panel agent-inbox">
        <article className="agent-inbox-message">
          <div className="agent-inbox-message-head">
            <div><b>Mary James</b><small>Zone 1 · Agent support</small></div>
            <span className="table-status warning">Open</span>
          </div>
          <p>Low float alert: Need urgent top-up before the next commuter rush.</p>
        </article>
      </section>
    </section>
  );
}
