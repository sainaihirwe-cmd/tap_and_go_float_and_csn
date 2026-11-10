export function ReportsPage() {
  return (
    <section className="page-content alternate-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="pulse" /> REPORTS</div>
          <h1>Settlement and network reports</h1>
          <p>Review float approvals, events, and operational summaries.</p>
        </div>
      </div>

      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Settlement queue</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>AGENT</th><th>STATUS</th><th>AMOUNT</th><th>REFERENCE</th></tr>
            </thead>
            <tbody>
              <tr><td>Mary James</td><td>Pending</td><td>£1,250</td><td>REF-2181</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
