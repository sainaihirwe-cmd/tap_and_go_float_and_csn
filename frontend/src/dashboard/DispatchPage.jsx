export function DispatchPage() {
  return (
    <section className="page-content alternate-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="pulse" /> DISPATCH CONTROL</div>
          <h1>Dispatch board</h1>
          <p>Send assigned distributors to resolve urgent float support issues.</p>
        </div>
        <button className="primary-button" type="button">New dispatch</button>
      </div>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Open assignments</h2></div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>AGENT</th>
                <th>DISTRIBUTOR</th>
                <th>STATUS</th>
                <th>ROUTE</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Mary James</td><td>Rosa Smith</td><td>Assigned</td><td>1.3 km</td></tr>
              <tr><td>Kenji Patel</td><td>Awaiting</td><td>Open SOS</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
