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
              <tr><td>Mary James</td><td>Zone 1</td><td>RWF 18,240</td><td>Healthy</td><td>03h 42m</td></tr>
              <tr><td>Kenji Patel</td><td>Zone 2</td><td>RWF 9,800</td><td>Warning</td><td>02h 15m</td></tr>
              <tr><td>Hugo Santos</td><td>Zone 5</td><td>RWF 4,200</td><td>Critical</td><td>01h 10m</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function MobileAccounts({onMessage,role,onRoleChange,standalone=false}){
  const [data,setData]=useState({accounts:[],agents:[],distributors:[]});
  const [recordId,setRecordId]=useState('');
  const [email,setEmail]=useState('');
  const [superagentName,setSuperagentName]=useState('');const [managedAgentIds,setManagedAgentIds]=[];
  const [password,setPassword]=useState('');
  const [editingScope,setEditingScope]=useState(null);
  const [editingSuperagent,setEditingSuperagent]=useState(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const refresh=async()=>{
   const response=await apiFetch('/api/admin/mobile-accounts');
   const value=await response.json();if(!response.ok)throw Error(value.error||'Unable to load mobile accounts.');
   setData(value);
  };
  useEffect(()=>{refresh().catch(problem=>setError(problem.message))},[]);
  const records=role==='agent'?data.agents:data.distributors;
  const visibleAccounts=standalone?data.accounts.filter(account=>account.role==='superagent'):data.accounts;
  const linked=new Set(data.accounts.filter(account=>account.role===role).map(account=>account.profile?._id));
  const available=records.filter(record=>!linked.has(record._id));
  const assignedAgentIds=new Set(data.accounts.filter(account=>account.role==='superagent'&&account.active&&account.id!==editingScope?.accountId)
   .flatMap(account=>(account.managedAgents||[]).map(agent=>String(agent._id||agent))));
  const availableSuperagentAgents=data.agents.filter(agent=>!assignedAgentIds.has(String(agent._id)));
  useEffect(()=>{setRecordId(available[0]?._id||'')},[role,data]);
  const create=async event=>{
   event.preventDefault();setError('');setBusy(true);
   try{
    const body=role==='superagent'
     ?{role,name:superagentName,managedAgentIds,email,password}
     :{role,recordId,email,password};
    const response=await apiFetch('/api/admin/mobile-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok){
     if(result.accountCreated){
      setEmail('');setSuperagentName('');setManagedAgentIds([]);setPassword('');
      onMessage(result.error||'The account was created, but its invitation could not be sent.');
      try{await refresh()}catch(problem){setError(`The account was created, but the account list could not be refreshed: ${problem.message}`)}
      return;
     }
     throw Error(result.error||'Unable to create mobile account.');
    }
    setEmail('');setSuperagentName('');setManagedAgentIds([]);setPassword('');
    onMessage(`Account created. A secure setup link was emailed to ${result.email}.`);
    try{await refresh()}catch(problem){setError(`The account was created, but the account list could not be refreshed: ${problem.message}`)}
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const resendInvitation=async account=>{
   setError('');setBusy(true);
   try{
    const response=await apiFetch(`/api/admin/mobile-accounts/${account.id}/invitation`,{method:'POST'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to send the invitation email.');
    await refresh();onMessage(`A new setup link was emailed to ${result.email}.`);
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const resetPassword=async account=>{
   if(!window.confirm(`Send a secure password reset link to ${account.email}? Their current password will stop working immediately.`))return;
   setError('');setBusy(true);
   try{
    const response=await apiFetch(`/api/admin/mobile-accounts/${account.id}/password-reset`,{method:'POST'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to send the password reset email.');
    await refresh();onMessage(result.setupPending?`A new setup link was emailed to ${result.email}.`:`A password reset link was emailed to ${result.email}.`);
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const setPassword=async account=>{
   const newPassword=window.prompt(`Set new password for ${account.email} (min 12 chars):`);
   if(!newPassword||newPassword.length<12){if(newPassword!==null)alert('Password must be at least 12 characters.');return;}
   setError('');setBusy(true);
   try{
    const response=await apiFetch(`/api/admin/mobile-accounts/${account.id}/password-reset`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:newPassword})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to set password.');
    await refresh();onMessage(`Password updated for ${result.email}. Share it securely.`);
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const saveScope=async()=>{
   if(!editingScope)return;
   setError('');setBusy(true);
   try{
    const response=await apiFetch(`/api/admin/mobile-accounts/${editingScope.accountId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({managedAgentIds:editingScope.ids})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to update Superagent assignments.');
    setEditingScope(null);await refresh();onMessage('Superagent agent assignments updated.');
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const saveSuperagent=async()=>{
   if(!editingSuperagent)return;
   setError('');setBusy(true);
   try{
    const body={name:editingSuperagent.name,email:editingSuperagent.email,password:editingSuperagent.password};
    const response=await apiFetch(`/api/admin/mobile-accounts/${editingSuperagent.accountId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to update Superagent account.');
    setEditingSuperagent(null);await refresh();onMessage('Superagent account updated; active sessions were revoked.');
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const removeSuperagent=async account=>{
   if(!window.confirm(`Permanently remove the Superagent account for ${account.profile?.name||account.email}? Agent profiles and deletion history will be retained.`))return;
   setError('');setBusy(true);
   try{
    const response=await apiFetch(`/api/admin/mobile-accounts/${account.id}`,{method:'DELETE'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to remove Superagent account.');
    await refresh();onMessage('Superagent account removed.');
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  const toggle=async account=>{
   try{
    const response=await apiFetch(`/api/admin/mobile-accounts/${account.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!account.active})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to update mobile account.');
    await refresh();onMessage(result.active?'Mobile account enabled.':'Mobile account disabled; active sessions were revoked.');
   }catch(problem){setError(problem.message)}
  };
  return <section className="panel profile-settings-card mobile-accounts-panel"><div className="panel-heading"><div><h2>{standalone?'Superagent accounts':'Agent, distributor & Superagent logins'}</h2><p>{standalone?'Create Superagent sign-in accounts, assign each agent to one Superagent, and manage existing Superagent access.':'Creating an account emails a one-time password setup link that expires after 24 hours. Superagents can see only agents assigned here. They may create and edit agent profiles, but the admin must provision each agent login and POS account. Staff cannot self-register.'}</p></div></div>
   <form className="profile-form" onSubmit={create}>
    {!standalone&&<><label htmlFor="mobile-account-role">Account type</label><select id="mobile-account-role" value={role} onChange={event=>onRoleChange(event.target.value)}><option value="agent">Agent</option><option value="distributor">Distributor</option><option value="superagent">Superagent</option></select></>}
    {role==='superagent'?<>
     <label htmlFor="superagent-name">Superagent name</label><input id="superagent-name" required maxLength="80" value={superagentName} onChange={event=>setSuperagentName(event.target.value)} placeholder="Full name"/>
     <fieldset className="superagent-agent-picker"><legend>Assign agents (each agent belongs to one active Superagent)</legend>
      {availableSuperagentAgents.map(agent=><label key={agent._id}><input type="checkbox" checked={managedAgentIds.includes(agent._id)} onChange={event=>setManagedAgentIds(current=>event.target.checked?[...current,agent._id]:current.filter(id=>id!==agent._id))}/>{agent.name}  -  {agent.agent_id}</label>)}
      {!availableSuperagentAgents.length&&<p>No unassigned agents are available.</p>}
     </fieldset>
    </>:<>
     <label htmlFor="mobile-account-profile">Link to profile</label><select id="mobile-account-profile" required value={recordId} onChange={event=>setRecordId(event.target.value)}><option value="">Select a {role}</option>{available.map(record=><option key={record._id} value={record._id}>{record.name}  -  {role==='agent'?record.agent_id:record.distributor_id}</option>)}</select>
     {!available.length&&<p>No unlinked {role} profiles available.</p>}
    </>}
    <label htmlFor="mobile-account-email">Sign-in email</label><input id="mobile-account-email" type="email" required maxLength="254" value={email} onChange={event=>setEmail(event.target.value)} placeholder="user@company.com"/>
    <label htmlFor="mobile-account-password">Password (optional, min 12 chars)</label><input id="mobile-account-password" type="password" maxLength="1024" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Leave blank to send setup link via email" />
    {error&&<div className="profile-form-error" role="alert">{error}</div>}
    <div className="profile-form-actions"><button className="primary-button" disabled={busy||(role==='superagent'?false:!available.length)}>{busy?'Creating...':role==='superagent'?'Create Superagent account':'Create mobile login'}</button></div>
   </form>
   <div className="mobile-account-list-heading"><h3>{standalone?'Existing Superagents':'Existing mobile accounts'}</h3><span>{visibleAccounts.length}</span></div>
   {standalone?<div className="table-scroll mobile-account-table-wrap"><table className="mobile-account-table"><thead><tr><th>SUPERAGENT</th><th>SIGN-IN EMAIL</th><th>ASSIGNED AGENTS</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{visibleAccounts.map(account=><tr key={account.id}><td><b>{account.profile?.name||'Profile'}</b></td><td>{account.email}</td><td><details className="superagent-scope"><summary>{account.managedAgents?.length||0} agent(s)</summary>
     {editingScope?.accountId===account.id?<>
      <p>Select any number of unassigned agents. An agent can belong to only one active Superagent.</p>
      {availableSuperagentAgents.map(agent=>{
       const currentIds=editingScope.ids;
       return <label key={agent._id}><input type="checkbox" checked={currentIds.includes(String(agent._id))} onChange={event=>setEditingScope({accountId:account.id,ids:event.target.checked?[...currentIds,String(agent._id)]:currentIds.filter(id=>id!==String(agent._id))})}/>{agent.name}  -  {agent.agent_id}</label>
      })}
      {!availableSuperagentAgents.length&&<p>No unassigned agents are available.</p>}
      <button className="row-action" type="button" disabled={busy} onClick={saveScope}>Save assigned agents</button>
      <button className="row-action" type="button" disabled={busy} onClick={()=>setEditingScope(null)}>Cancel</button>
     </>:<>
      {(account.managedAgents||[]).length
       ?data.agents.filter(agent=>(account.managedAgents||[]).some(item=>String(item._id||item)===String(agent._id))).map(agent=><p key={agent._id}>{agent.name}  -  {agent.agent_id}</p>)
       :<p>No agents assigned yet.</p>}
      <button className="row-action" type="button" disabled={busy} onClick={()=>setEditingScope({accountId:account.id,ids:(account.managedAgents||[]).map(item=>String(item._id||item))})}>Edit assignments</button>
     </>}
    </details></td><td>{account.setupPending?'Pending setup':account.active?'Active':'Disabled'}</td><td className="mobile-account-table-actions"><div className="mobile-account-action-grid">{account.setupPending?<button className="subtle-button" disabled={busy||!account.active} onClick={()=>resendInvitation(account)}>Resend setup link</button>:<button className="subtle-button" disabled={busy||!account.active} onClick={()=>resetPassword(account)}>Reset password via email</button>}<button className="subtle-button" disabled={busy||!account.active} onClick={()=>setPassword(account)}>Set password</button><button className="subtle-button" onClick={()=>toggle(account)}>{account.active?'Disable':'Enable'}</button><details className="superagent-scope mobile-account-edit-details"><summary>Edit details</summary>
     {editingSuperagent?.accountId===account.id?<div className="profile-form">
      <label>Name</label><input maxLength="80" value={editingSuperagent.name} onChange={event=>setEditingSuperagent(current=>({...current,name:event.target.value}))}/>
      <label>Sign-in email</label><input type="email" maxLength="254" value={editingSuperagent.email} onChange={event=>setEditingSuperagent(current=>({...current,email:event.target.value}))}/>
      <label>New password (optional, min 12 chars)</label><input type="password" maxLength="1024" value={editingSuperagent.password||''} onChange={event=>setEditingSuperagent(current=>({...current,password:event.target.value}))} placeholder="Leave blank to keep current password" />
      {error&&<div className="profile-form-error" role="alert">{error}</div>}
      <button className="row-action" type="button" disabled={busy||!editingSuperagent.name.trim()||!editingSuperagent.email.trim()} onClick={saveSuperagent}>Save account</button>
      <button className="row-action" type="button" onClick={()=>setEditingSuperagent(null)}>Cancel</button>
     </div>:<button className="row-action" type="button" onClick={()=>setEditingSuperagent({accountId:account.id,name:account.profile?.name||'',email:account.email})}>Edit details</button>}
    </details><button className="subtle-button" disabled={busy} onClick={()=>removeSuperagent(account)}>Delete</button></div></td></tr>)}</tbody></table>{!visibleAccounts.length&&<p className="empty-table">No Superagent accounts have been created yet.</p>}</div>:<div className="mobile-account-list">{visibleAccounts.length?visibleAccounts.map(account=><div className="mobile-account-row" key={account.id}><div className="mobile-account-copy"><b>{account.profile?.name||'Profile'}</b><small>{account.role}  -  {account.email}  -  {account.setupPending?'Pending password setup':account.active?'Active':'Disabled'}{account.role==='superagent'?`  -  ${account.managedAgents?.length||0} assigned agent(s)`:''}</small>
    {account.role==='superagent'&&<details className="superagent-scope"><summary>Edit Superagent account</summary>
     {editingSuperagent?.accountId===account.id?<div className="profile-form">
      <label>Name</label><input maxLength="80" value={editingSuperagent.name} onChange={event=>setEditingSuperagent(current=>({...current,name:event.target.value}))}/>
      <label>Sign-in email</label><input type="email" maxLength="254" value={editingSuperagent.email} onChange={event=>setEditingSuperagent(current=>({...current,email:event.target.value}))}/>
      <label>New password (optional, min 12 chars)</label><input type="password" maxLength="1024" value={editingSuperagent.password||''} onChange={event=>setEditingSuperagent(current=>({...current,password:event.target.value}))} placeholder="Leave blank to keep current password" />
      {error&&<div className="profile-form-error" role="alert">{error}</div>}
      <button className="row-action" type="button" disabled={busy||!editingSuperagent.name.trim()||!editingSuperagent.email.trim()} onClick={saveSuperagent}>Save account</button>
      <button className="row-action" type="button" onClick={()=>setEditingSuperagent(null)}>Cancel</button>
     </div>:<button className="row-action" type="button" onClick={()=>setEditingSuperagent({accountId:account.id,name:account.profile?.name||'',email:account.email})}>Edit details</button>}
    </details>}
    {account.role==='superagent'&&<details className="superagent-scope"><summary>Manage assigned agents</summary>
     {editingScope?.accountId===account.id?<>
      <p>Select any number of unassigned agents. An agent can belong to only one active Superagent.</p>
      {availableSuperagentAgents.map(agent=>{
       const currentIds=editingScope.ids;
       return <label key={agent._id}><input type="checkbox" checked={currentIds.includes(String(agent._id))} onChange={event=>setEditingScope({accountId:account.id,ids:event.target.checked?[...currentIds,String(agent._id)]:currentIds.filter(id=>id!==String(agent._id))})}/>{agent.name}  -  {agent.agent_id}</label>
      })}
      {!availableSuperagentAgents.length&&<p>No unassigned agents are available.</p>}
      <button className="row-action" type="button" disabled={busy} onClick={saveScope}>Save assigned agents</button>
      <button className="row-action" type="button" disabled={busy} onClick={()=>setEditingScope(null)}>Cancel</button>
     </>:<>
      {(account.managedAgents||[]).length
       ?data.agents.filter(agent=>(account.managedAgents||[]).some(item=>String(item._id||item)===String(agent._id))).map(agent=><p key={agent._id}>{agent.name}  -  {agent.agent_id}</p>)
       :<p>No agents assigned yet.</p>}
      <button className="row-action" type="button" disabled={busy} onClick={()=>setEditingScope({accountId:account.id,ids:(account.managedAgents||[]).map(item=>String(item._id||item))})}>Edit assignments</button>
     </>}
    </details>}</div><div className="mobile-account-actions">{account.setupPending?<button className="subtle-button" disabled={busy||!account.active} onClick={()=>resendInvitation(account)}>Resend setup link</button>:<button className="subtle-button" disabled={busy||!account.active} onClick={()=>resetPassword(account)}>Reset password via email</button>}<button className="subtle-button" disabled={busy||!account.active} onClick={()=>setPassword(account)}>Set password</button><button className="subtle-button" onClick={()=>toggle(account)}>{account.active?'Disable':'Enable'}</button>{account.role==='superagent'&&<button className="subtle-button" disabled={busy} onClick={()=>removeSuperagent(account)}>Delete</button>}</div></div>):<p className="mobile-account-empty">No mobile accounts have been created yet.</p>}</div>}
  </section>
}

function NetworkProfileForm({role,record,onCancel,onSaved,onMessage}){
  const [name,setName]=useState(record?.name||'');
  const [phone,setPhone]=useState(record?.phone||'');
  const [place,setPlace]=useState(record?.place||'');
  const [zone,setZone]=useState(record?.zone||'');
  const [openingFloat,setOpeningFloat]=useState('0');
  const [superagents,setSuperagents]=useState([]);
  const [superagentId,setSuperagentId]=useState('');
  const [email,setEmail]=useState(record?.mobileEmail||'');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const kind=role==='agent'?'agents':'distributors';
  useEffect(()=>{
   if(record||role!=='agent')return;
   let active=true;
   apiFetch('/api/admin/mobile-accounts').then(async response=>{
    const value=await response.json();if(!response.ok)throw Error(value.error||'Unable to load Superagent assignments.');
    if(active)setSuperagents(value.accounts.filter(account=>account.role==='superagent'&&account.active));
   }).catch(problem=>{if(active)setError(problem.message)});
   return()=>{active=false};
  },[record,role]);
  const submit=async event=>{
   event.preventDefault();setError('');setBusy(true);
   try{
    const body={name,phone,place,zone,email,password};
    let url=`/api/admin/${kind}`;
    let method='POST';
    if(record){url+=`/${record._id}`;method='PATCH'}
    else if(role==='agent'){body.openingFloat=Number(openingFloat);if(superagentId)body.superagentId=superagentId}
    const response=await apiFetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok){
     if(result.accountCreated){await onSaved(result.profile);onMessage(result.error||'The profile was created, but its invitation could not be sent. Resend it from Settings.');return}
     throw Error(result.error||'Unable to save profile.');
    }
    await onSaved(result.profile);
    onMessage(result.warning|| (result.existing?`This Agent account already exists.${result.setupLinkResent?' A new setup link was emailed to '+email: ''}`:record?`${role==='agent'?'Agent':'Distributor'} updated. Updated credentials will require a new sign-in.`:`${role==='agent'?'Agent':'Distributor'} created. A secure password setup link was emailed to ${email}.`));
   }catch(problem){setError(problem.message)}finally{setBusy(false)}
  };
  return <section className="panel profile-settings-card network-profile-form">
   <div className="panel-heading"><div><h2>{record?`Edit ${role}`:`Add ${role}`}</h2><p>{record?'Update contact details and mobile sign-in. Location is updated automatically from the mobile app. Float balance remains ledger-controlled.':'Create the profile and linked mobile login together. Location will be updated automatically when the user shares GPS from the mobile app. A one-time password setup link will be sent to the sign-in email.'}</p></div></div>
   <form className="profile-form" onSubmit={submit}>
    <label htmlFor="network-name">Full name</label><input id="network-name" required maxLength="80" value={name} onChange={event=>setName(event.target.value)} autoComplete="name"/>
    <label htmlFor="network-phone">Phone number</label><input id="network-phone" maxLength="32" value={phone} onChange={event=>setPhone(event.target.value)} autoComplete="tel"/>
    <label htmlFor="network-place">Location / area</label><input id="network-place" maxLength="100" value={place} onChange={event=>setPlace(event.target.value)} placeholder="Town or operating area"/>
    <label htmlFor="network-zone">{role==='agent'?'Agent zone':'Distributor zone'}</label><input id="network-zone" maxLength="80" value={zone} onChange={event=>setZone(event.target.value)} placeholder="Enter zone manually"/>
   {!record&&role==='agent'&&<><label htmlFor="network-opening-float">Opening float (RWF)</label><input id="network-opening-float" type="number" min="0" step="1" value={openingFloat} onChange={event=>setOpeningFloat(event.target.value)}/></>}
   {!record&&role==='agent'&&<><label htmlFor="network-superagent">Assign Superagent (optional)</label><select id="network-superagent" value={superagentId} onChange={event=>setSuperagentId(event.target.value)}><option value="">Leave unassigned</option>{superagents.map(account=><option key={account.id} value={account.id}>{account.profile?.name||account.email}</option>)}</select><p className="form-hint">A distributor is assigned to a replenishment task after the agent and distributor share recent GPS locations.</p></>}
    <label htmlFor="network-email">Sign-in email</label><input id="network-email" type="email" autoComplete="email" maxLength="254" required value={email} onChange={event=>setEmail(event.target.value)}/>
    <label htmlFor="network-password">Password (optional, min 12 chars)</label><input id="network-password" type="password" maxLength="1024" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Leave blank to send setup link via email" />
    {error&&<div className="profile-form-error" role="alert">{error}</div>}
    <div className="profile-form-actions"><button type="button" className="subtle-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving...':record?'Save changes':`Create ${role} & login`}</button></div>
   </form>
  </section>
}