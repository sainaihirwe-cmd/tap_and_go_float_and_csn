export function OverviewPage() {
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="pulse" /> LIVE NETWORK</div>
          <h1>Operations overview</h1>
          <p>Live status for agents, dispatches, and network liquidity.</p>
        </div>
        <button className="primary-button" type="button">New dispatch</button>
      </div>

      <div className="metrics-grid">
        <article className="metric-card">
          <div className="metric-top">Active agents <span className="metric-symbol green">◎</span></div>
          <div className="metric-value">148</div>
        </article>
        <article className="metric-card">
          <div className="metric-top">Network liquidity <span className="metric-symbol blue">◉</span></div>
          <div className="metric-value">RWF 645,000</div>
        </article>
        <article className="metric-card">
          <div className="metric-top">Agents at risk <span className="metric-symbol orange">⚠</span></div>
          <div className="metric-value">08</div>
        </article>
        <article className="metric-card">
          <div className="metric-top">Transactions <span className="metric-symbol purple">↗</span></div>
          <div className="metric-value">3,412</div>
        </article>
      </div>
    </section>
  );
}
