export function AgentsPage() {
  return (
    <section className="page-content alternate-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="pulse" /> AGENT NETWORK</div>
          <h1>Agent directory</h1>
          <p>Track agent balance, zone status, and on-duty shifts.</p>
        </div>
        <button className="primary-button" type="button">Add agent</button>
      </div>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Network roster</h2></div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>AGENT</th>
                <th>ZONE</th>
                <th>FLOAT</th>
                <th>STATUS</th>
                <th>SHIFT</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Mary James</td><td>Zone 1</td><td>FRW 18,240</td><td>Healthy</td><td>03h 42m</td></tr>
              <tr><td>Kenji Patel</td><td>Zone 2</td><td>FRW 9,800</td><td>Warning</td><td>02h 15m</td></tr>
              <tr><td>Hugo Santos</td><td>Zone 5</td><td>FRW 4,200</td><td>Critical</td><td>01h 10m</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
