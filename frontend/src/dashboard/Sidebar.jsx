export function Sidebar() {
  const items = ['Overview', 'Agents', 'Dispatch', 'Messages', 'Reports', 'Settings'];

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">T</span>
        <span className="brand-copy">tap<span>&go</span></span>
      </div>

      <nav className="main-nav">
        {items.map((item) => (
          <button key={item} className="nav-item" type="button">
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
