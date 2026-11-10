export function SettingsPage() {
  return (
    <section className="page-content alternate-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span className="pulse" /> SETTINGS</div>
          <h1>Account and access settings</h1>
          <p>Manage your admin profile, passwords, and mobile account access.</p>
        </div>
      </div>

      <section className="panel profile-settings-card">
        <div className="panel-heading"><div><h2>Profile information</h2></div></div>
        <form className="profile-form">
          <label>Full name</label>
          <input type="text" defaultValue="Admin User" />
          <label>Email</label>
          <input type="email" defaultValue="admin@tapandgo.local" />
          <button className="primary-button" type="button">Save profile</button>
        </form>
      </section>
    </section>
  );
}
