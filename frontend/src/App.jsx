import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import { Activity, BarChart3, Bell, ClipboardList, FileText, LayoutDashboard, MapPin, MessageSquare, MessagesSquare, RefreshCw, Search, Send, Settings, Truck, Users } from 'lucide-react';
import { OverviewPage, AgentsPage, DispatchPage, MessagesPage, ReportsPage, SettingsPage } from './dashboard/index.js';

const demoAgents = [
  ['Maya Patel','Soho',-0.133,51.514,'critical',18],['James Cole','Waterloo',-0.113,51.503,'critical',24],['Ella Brooks',"King's Cross",-0.123,51.531,'critical',32],['Oliver Reed','Shoreditch',-0.078,51.525,'warning',86],['Aisha Khan','Paddington',-0.176,51.516,'warning',110],['Noah Wright','London Bridge',-0.087,51.505,'warning',94],['Isla Green','Covent Garden',-0.123,51.512,'healthy',640],['Leo Turner','Islington',-0.103,51.537,'healthy',820],['Sofia Ali','Victoria',-0.144,51.496,'healthy',520],['Theo James','Camden',-0.143,51.539,'healthy',735]
].map(([name,place,lon,lat,risk,floatBalance],i)=>({_id:`demo-${i}`,name,place,zone:i<3?'Zone 1':'Zone 2',location:{type:'Point',coordinates:[lon,lat]},floatBalance,status:risk==='critical'?'at_risk':'active',demoRisk:risk}));
const demoDistributors=[{_id:'d1',name:'Daniel Carter',location:{coordinates:[-0.139,51.516]},status:'available'},{_id:'d2',name:'Priya Sharma',location:{coordinates:[-0.108,51.500]},status:'available'},{_id:'d3',name:'Marcus Lee',location:{coordinates:[-0.087,51.526]},status:'available'}];
const mapNames={overview:'Overview',agents:'Agent network',distributors:'Distributors',dispatch:'Dispatch',agentMessages:'Agent support',chats:'Chats',superagentRequests:'Superagent deletion requests',commuters:'Commuter map',liquidity:'Liquidity insights',reports:'Reports',settings:'Settings'};
const defaultRenderBackendUrl = 'https://tap-and-go-float-and-csn-backend.onrender.com';
const apiBaseUrl = (import.meta.env.VITE_API_URL || (window.location.hostname.endsWith('onrender.com') ? defaultRenderBackendUrl : '')).replace(/\/$/, '');
const apiUrl = path => apiBaseUrl ? `${apiBaseUrl}${path}` : path;
const adminSessionKey='tapgo_admin_session';
function readAdminSession(){
  try{
    const session=JSON.parse(sessionStorage.getItem(adminSessionKey)||'null');
    if(!session?.token||Number(session.expiresAt)<=Date.now()){sessionStorage.removeItem(adminSessionKey);return null}
    return session;
  }catch{return null}
}
function saveAdminSession(session){sessionStorage.setItem(adminSessionKey,JSON.stringify(session))}
function clearAdminSession(){sessionStorage.removeItem(adminSessionKey)}
const money=value=>new Intl.NumberFormat('en-RW',{style:'currency',currency:'RWF',currencyDisplay:'code',maximumFractionDigits:0}).format(Number(value)||0);
const displayRecordId=value=>String(value||'').replace(/[^a-zA-Z0-9]/g,'').slice(0,8).toUpperCase()||'N/A';
const formatShiftDuration=seconds=>{
  const minutes=Math.floor((Number(seconds)||0)/60);
  return `${Math.floor(minutes/60)}h ${minutes%60}m`;
};
const currentShiftDuration=agent=>agent.shiftStartedAt&&agent.status!=='offline'
  ?formatShiftDuration(Math.max(0,Math.floor((Date.now()-new Date(agent.shiftStartedAt).getTime())/1000)))
  :formatShiftDuration(agent.lastShiftSeconds);
const validAgentLocation=location=>location?.type==='Point'&&Array.isArray(location.coordinates)&&location.coordinates.length===2&&Number.isFinite(location.coordinates[0])&&Number.isFinite(location.coordinates[1])&&location.coordinates[0]>=-180&&location.coordinates[0]<=180&&location.coordinates[1]>=-90&&location.coordinates[1]<=90;
const dispatchInstructionFor=agent=>`URGENT float transfer for ${agent?.name||'the selected agent'}${agent?.place||agent?.zone?` (${agent.place||agent.zone})`:''}. Please contact the agent now, confirm the amount needed, arrange the transfer as soon as possible, and record the actual amount delivered in the app.`;
const agentLowFloatThreshold=agent=>Math.max(10000,Number(agent.floatReference||0)*0.1,Number(agent.safeThreshold||40));
const getRisk=agent=>agent.demoRisk||(agent.floatBalance<=agentLowFloatThreshold(agent)?'critical':agent.floatBalance<=agentLowFloatThreshold(agent)*2?'warning':'healthy');
const accountDisplayName=email=>String(email||'').split('@')[0].replace(/[._-]+/g,' ').trim().split(/\s+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Administrator';
async function apiFetch(input,options={}){
  const resolvedInput = typeof input === 'string' && input.startsWith('/')
    ? apiUrl(input)
    : input;
  const headers=new Headers(options.headers||{});
  const session=readAdminSession();
  if(session?.token)headers.set('Authorization',`Bearer ${session.token}`);
  const response=await fetch(resolvedInput,{...options,headers,credentials:'omit'});
  if(response.status===401){clearAdminSession();window.dispatchEvent(new Event('tapgo:session-expired'));throw Error('Your session expired. Please sign in again.')}
  return response;
}
async function responseData(response,service){
  const body=await response.text();
  if(!body.trim())throw Error(`${service} returned an empty response (HTTP ${response.status}). Check the backend terminal for startup errors and confirm the API is running.`);
  try{return JSON.parse(body)}catch{
    if(!response.ok)throw Error(`${service} is unavailable (HTTP ${response.status}). Check the backend terminal for startup errors and confirm the API is running.`);
    throw Error(`${service} returned an invalid response. Please try again.`);
  }
}

const navigationIcons={overview:LayoutDashboard,agents:Users,distributors:Truck,dispatch:Send,agentMessages:MessageSquare,chats:MessagesSquare,superagentRequests:ClipboardList,commuters:MapPin,liquidity:BarChart3,reports:FileText,settings:Settings};
function Icon({name}){const Component=navigationIcons[name]||LayoutDashboard;return <Component className="nav-icon" size={16} strokeWidth={1.8} aria-hidden="true"/>}
function MapArtwork({agents,distributors,onSelect}){
  const project=([lon,lat])=>({x:((lon+0.29)/0.27)*780,y:((51.57-lat)/0.19)*385});
  const streets=['M-10 66L793 304','M20 365L732 10','M45-10L520 395','M256-10L117 390','M591-10L388 390','M780 112L-10 207','M676 395L99-10','M0 130L787 226','M337-10L742 385','M-10 333L791 67'];
  return <svg className="map-art" viewBox="0 0 780 385" preserveAspectRatio="xMidYMid slice" aria-label="Map of agent and distributor locations"><defs><radialGradient id="heat-critical"><stop offset="0" stopColor="#d96b5f" stopOpacity=".42"/><stop offset="1" stopColor="#d96b5f" stopOpacity="0"/></radialGradient><radialGradient id="heat-warning"><stop offset="0" stopColor="#e2a054" stopOpacity=".38"/><stop offset="1" stopColor="#e2a054" stopOpacity="0"/></radialGradient><radialGradient id="heat-healthy"><stop offset="0" stopColor="#4e9a72" stopOpacity=".22"/><stop offset="1" stopColor="#4e9a72" stopOpacity="0"/></radialGradient></defs>
    <path className="water" d="M-10 286C76 264 105 301 175 286s95-42 159-26 82 50 139 28 67-37 115-22 88 39 137 18 69-39 116-25v150H-10Z"/>
    <g className="park-shape"><path d="M83 35l117-28 49 48-19 49-88 11-52-30z"/><path d="M445 19l72-8 39 35-22 43-78-8-30-32z"/><path d="M645 120l81 6 25 43-44 27-66-18-20-34z"/><path d="M264 180l56-17 41 32-29 36-65-10z"/><path d="M524 192l51-19 34 29-18 38-62-4z"/></g>
    <g className="roads">{streets.map((d,i)=><path key={d} d={d} className={i<2?'major-road':''}/>)}<path d="M-10 176C158 124 215 250 357 194S580 80 793 147" className="tube-line"/><path d="M-10 246C160 229 206 116 348 160s240 137 445 103" className="tube-line tube-green"/><path d="M179-10C210 70 362 90 380 182s-80 134 34 223" className="tube-line tube-blue"/></g>
    <g className="place-labels"><text x="358" y="132">KING'S CROSS</text><text x="298" y="209">SOHO</text><text x="402" y="217">COVENT GARDEN</text><text x="512" y="266">LONDON BRIDGE</text><text x="161" y="165">PADDINGTON</text><text x="576" y="126">SHOREDITCH</text><text x="334" y="285">WATERLOO</text><text x="427" y="83">ISLINGTON</text></g>
    <g>{agents.map(agent=>{if(!agent.location?.coordinates)return null;const {x,y}=project(agent.location.coordinates);const risk=getRisk(agent);return <g key={agent._id} className={`marker ${risk}`} transform={`translate(${x} ${y})`} role="button" tabIndex="0" aria-label={`${agent.name}, ${agent.place||agent.zone}, ${money(agent.floatBalance)} float`} onClick={e=>onSelect(e,agent)} onKeyDown={e=>e.key==='Enter'&&onSelect(e,agent)}><circle className="heat-spot" r={risk==='critical'?48:risk==='warning'?38:24} fill={`url(#heat-${risk})`}/><circle className="halo" r={risk==='critical'?13:9}/><circle className="core" r="6"/></g>})}{distributors.map((d,i)=>{if(!d.location?.coordinates)return null;const {x,y}=project(d.location.coordinates);return <g key={d._id||i} className="marker distributor" transform={`translate(${x} ${y})`}><circle className="halo" r="11"/><circle className="core" r="7"/><text y=".5"></text></g>})}</g>
  </svg>
}

function Dashboard({admin,onLogout,onProfileSaved}){
  const [clock,setClock]=useState(()=>new Date());
  const [sessionRemaining,setSessionRemaining]=useState(()=>Math.max(0,Math.ceil((Number(admin.expiresAt)-Date.now())/1000))||0);
  const [view,setView]=useState('overview');const [mobileAccountRole,setMobileAccountRole]=useState('agent');const [agents,setAgents]=useState(demoAgents);const [distributors,setDistributors]=useState(demoDistributors);const [alerts,setAlerts]=useState([]);const [agentMessages,setAgentMessages]=useState([]);const [agentConversations,setAgentConversations]=useState([]);const [distributorConversations,setDistributorConversations]=useState([]);const [superagentConversations,setSuperagentConversations]=useState([]);const [superagentDeletionRequests,setSuperagentDeletionRequests]=useState([]);const [dispatches,setDispatches]=useState([]);const [completedDispatches,setCompletedDispatches]=useState([]);const [summary,setSummary]=useState(null);const [heatmap,setHeatmap]=useState(null);const [analytics,setAnalytics]=useState(null);const [connected,setConnected]=useState(false);const [modal,setModal]=useState(false);const [selectedAgent,setSelectedAgent]=useState('');const [toast,setToast]=useState('');const [mapFilter,setMapFilter]=useState('all');const [popup,setPopup]=useState(null);const [loading,setLoading]=useState(true);
  const [settlements,setSettlements]=useState([]);
  const [dispatching,setDispatching]=useState(false);
  const [dispatchInstructions,setDispatchInstructions]=useState('');
  const [dispatchDistributorOptions,setDispatchDistributorOptions]=useState([]);
  const [selectedDistributorId,setSelectedDistributorId]=useState('');
  const [loadingDispatchDistributors,setLoadingDispatchDistributors]=useState(false);
  const [dispatchOptionsError,setDispatchOptionsError]=useState('');
  const [dispatchOptionsRefresh,setDispatchOptionsRefresh]=useState(0);
  const [gpsRequestingDistributorId,setGpsRequestingDistributorId]=useState('');
  const [supportOpen,setSupportOpen]=useState(false);
  useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),60000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{
    const expiresAt=Number(admin.expiresAt);
    if(!Number.isFinite(expiresAt))return;
    const updateCountdown=()=>{
      const remaining=Math.max(0,Math.ceil((expiresAt-Date.now())/1000));
      setSessionRemaining(remaining);
      if(remaining===0&&!expired){expired=true;onLogout(true)}
    };
    let expired=false;
    updateCountdown();
    const timer=setInterval(updateCountdown,1000);
    return()=>clearInterval(timer);
  },[admin.expiresAt,onLogout]);
  const refresh=useCallback(async()=>{
    try{
      const [health,agentData,alertData,messageData,agentInboxData,distributorInboxData,superagentInboxData,deleteRequestData,dispatchData,completedDispatchData,summaryData,heatmapData,analyticsData,distributorData,settlementData]=await Promise.all(['/api/health','/api/agents','/api/alerts?state=open','/api/agent-messages','/api/admin/agent-inbox','/api/admin/distributor-inbox','/api/admin/superagent-inbox','/api/admin/superagent-deletion-requests','/api/dispatches','/api/dispatches?status=completed','/api/summary','/api/liquidity/heatmap?hours=24','/api/analytics?days=7','/api/distributors','/api/float-settlements'].map(url=>apiFetch(url).then(r=>{if(!r.ok)throw Error('API unavailable');return r.json()})));
      if(health.database==='connected'){setConnected(true);setAgents(agentData);setAlerts(alertData);setAgentMessages(messageData);setAgentConversations(agentInboxData);setDistributorConversations(distributorInboxData);setSuperagentConversations(superagentInboxData);setSuperagentDeletionRequests(deleteRequestData);setDispatches(dispatchData);setCompletedDispatches(completedDispatchData);setSummary(summaryData);setHeatmap(heatmapData);setAnalytics(analyticsData);setDistributors(distributorData);setSettlements(settlementData)}
      else setConnected(false);
    }catch{setConnected(false)}finally{setLoading(false)}
  },[]);
  useEffect(()=>{refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer)},[refresh]);
  useEffect(()=>{
    if(!modal||!selectedAgent)return;
    let active=true;
    const [targetType,targetId]=selectedAgent.split(':',2);
    const query=targetType==='alert'?`alertId=${encodeURIComponent(targetId)}`:`agentId=${encodeURIComponent(targetId)}`;
    setDispatchDistributorOptions([]);
    setSelectedDistributorId('');
    setDispatchOptionsError('');
    setLoadingDispatchDistributors(true);
    const url=`/api/dispatch-options?${query}`;
    const loadOptions=async refreshGps=>{
      const response=await apiFetch(`${url}${refreshGps?'&refreshGps=true':''}`);
      const result=await responseData(response,'Distributor matching');
      if(!response.ok)throw Error(result.error);
      return result;
    };
    const updateOptions=result=>{
      if(!active)return;
      setDispatchDistributorOptions(result.options);
      setSelectedDistributorId(result.options[0]?._id||'');
      return result;
    };
    const search=async()=>{
      try{
        let result=updateOptions(await loadOptions(true));
        if(result.options.length)return;
        if(result.diagnostics?.onDuty>result.diagnostics?.recentGps){
          const refreshDeadline=Date.now()+10000;
          while(active&&Date.now()<refreshDeadline){
            await new Promise(resolve=>setTimeout(resolve,1500));
            if(!active)return;
            result=updateOptions(await loadOptions(false));
            if(result.options.length)return;
          }
        }
        if(!active)return;
        const diagnostics=result.diagnostics;
        const gpsHelp=diagnostics?.onDuty>0&&diagnostics.recentGps===0
          ? ' The on-duty distributor did not send a fresh GPS fix. Ask them to open the distributor app, allow location access, and tap "Refresh GPS now".'
          : ' Ask an available distributor to go on duty and share GPS, or check the agent location.';
        setDispatchOptionsError(diagnostics
          ? `No distributor matched within 500 m. Active logins: ${diagnostics.activeLogins}; on duty: ${diagnostics.onDuty}; GPS updated within 15 min: ${diagnostics.recentGps}; within 500 m: ${diagnostics.withinRange}.${gpsHelp}`
          : 'No on-duty distributor with an active mobile login and recent GPS was found within 500 m. Check the agent location and distributor availability, then refresh.');
      }catch(error){if(active)setDispatchOptionsError(error.message)}
      finally{if(active)setLoadingDispatchDistributors(false)}
    };
    search();
    return()=>{active=false};
  },[modal,selectedAgent,dispatchOptionsRefresh]);
  useEffect(()=>{
    const socket = io(apiBaseUrl || window.location.origin, {
      autoConnect: false,
      auth: { token: admin.token },
      withCredentials: true,
      transports: ['websocket', 'polling']
    });
    socket.on('connect',()=>setConnected(true));
    socket.on('disconnect',()=>setConnected(false));
    socket.on('agent:telemetry',agent=>setAgents(current=>current.map(a=>a._id===agent._id?agent:a)));
    socket.on('distributor:location',distributor=>setDistributors(current=>current.map(item=>item._id===distributor._id?{...item,...distributor}:item)));
    socket.on('distributor:shift-started',event=>{setDistributors(current=>current.map(item=>item._id===event._id?{...item,...event}:item));setToast(`${event.name} is on duty  -  started ${new Date(event.dutyStartedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`)});
    socket.on('sos:created',event=>{const messageAlert={...event.alert,agent:event.agent};setAlerts(current=>[messageAlert,...current.filter(a=>a._id!==messageAlert._id)]);if(messageAlert.message)setAgentMessages(current=>[messageAlert,...current.filter(alert=>alert._id!==messageAlert._id)]);setToast(`${event.agent?.name||'Agent'}: ${event.alert?.message||'needs a float top-up'}`)});
    socket.on('dispatch:created',dispatch=>setDispatches(current=>[dispatch,...current.filter(item=>item._id!==dispatch._id)]));
    socket.on('dispatch:updated',dispatch=>{
      if(dispatch.status==='completed'){
        setDispatches(current=>current.filter(item=>item._id!==dispatch._id));
        setCompletedDispatches(current=>[dispatch,...current.filter(item=>item._id!==dispatch._id)].slice(0,50));
        setToast(`${dispatch.distributor?.name||'Distributor'} collected ${money(dispatch.salesCollected||0)} in sales and delivered ${money(dispatch.amountAdded)} replacement float to ${dispatch.agent?.name||'agent'}.`);
        refresh();
      }else setDispatches(current=>current.map(item=>item._id===dispatch._id?dispatch:item));
    });
    socket.on('dispatch:message',event=>{setDispatches(current=>current.map(item=>item._id===event.dispatchId?{...item,messages:[...(item.messages||[]).filter(message=>message.sentAt!==event.message.sentAt),event.message]}:item));setToast(`${event.message.senderName}: ${event.message.text}`)});
    socket.on('distributor:inbox-message',event=>{setDistributorConversations(current=>current.map(conversation=>String(conversation.distributor?._id)===String(event.distributorId)?{...conversation,messages:[...(conversation.messages||[]).filter(message=>message.sentAt!==event.message.sentAt),event.message],updatedAt:event.message.sentAt}:conversation));setToast(`${event.message.senderName}: ${event.message.text}`)});
    socket.on('superagent:inbox-message',event=>{setSuperagentConversations(current=>current.map(conversation=>String(conversation.superagent?._id)===String(event.superagentId)?{...conversation,messages:[...(conversation.messages||[]).filter(message=>message.sentAt!==event.message.sentAt),event.message],updatedAt:event.message.sentAt}:conversation));setToast(`${event.message.senderName}: ${event.message.text}`)});
    socket.on('agent:admin-inbox-message',event=>{setAgentConversations(current=>current.map(conversation=>String(conversation.agent?._id)===String(event.agentId)?{...conversation,messages:[...(conversation.messages||[]).filter(message=>message.sentAt!==event.message.sentAt),event.message],updatedAt:event.message.sentAt}:conversation));setToast(`${event.message.senderName}: ${event.message.text}`)});
    socket.on('superagent:deletion-request',request=>{setSuperagentDeletionRequests(current=>[request,...current.filter(item=>item._id!==request._id)]);setView('superagentRequests');setToast(`${request.superagent?.name||request.superagent?.email||'Superagent'} requested deletion of ${request.agent?.name||'an agent'}: ${request.reason}`)});
    socket.on('superagent:deletion-request-updated',request=>{setSuperagentDeletionRequests(current=>[request,...current.filter(item=>item._id!==request._id)]);setToast(`${request.agent?.name||'Agent'} deletion request ${request.status}.`)});
    socket.connect();
    return()=>socket.disconnect();
  },[refresh,admin.token]);
  useEffect(()=>{if(!toast)return;const timeout=setTimeout(()=>setToast(''),3300);return()=>clearTimeout(timeout)},[toast]);
  const activeAgents=summary?.agents?.active??agents.filter(a=>a.status==='active').length;const atRisk=summary?.agents?.atRisk??agents.filter(a=>getRisk(a)!=='healthy').length;const liquidity=summary?.agents?.liquidity??agents.reduce((sum,a)=>sum+(a.floatBalance||0),0);const shownAgents=useMemo(()=>agents.filter(a=>mapFilter==='all'||(mapFilter==='risk'&&getRisk(a)!=='healthy')), [agents,mapFilter]);
  const greeting=`Good ${clock.getHours()<12?'morning':clock.getHours()<17?'afternoon':'evening'}, ${accountDisplayName(admin.name||admin.email)}`;
  const openDispatch=async()=>{
    if(!connected||selectedAgent.includes('demo-')){setToast('Demo mode: connect MongoDB and add agents to create a live dispatch.');setModal(false);return}
    if(!selectedAgent)return;
    setDispatching(true);
    try{
      const [targetType,targetId]=selectedAgent.split(':',2);
      const url=targetType==='alert'?`/api/alerts/${targetId}/dispatch`:`/api/admin/agents/${targetId}/dispatch`;
      const selectedAgentRecord=targetType==='alert'?alertRows.find(alert=>String(alert._id)===targetId)?.agent:agents.find(agent=>String(agent._id)===targetId);
      const instructions=dispatchInstructions.trim()||dispatchInstructionFor(selectedAgentRecord);
      const response=await apiFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instructions,distributorId:selectedDistributorId})});
      const result=await responseData(response,'Dispatch service');
      if(!response.ok)throw Error(result.error);
      setToast(`Distributor ${result.distributor?.name||''} dispatched to ${result.agent?.name||'agent'}.`);
      setModal(false);
      refresh();
    }catch(error){setToast(error.message);if(/distributor|dispatch/i.test(error.message))setDispatchOptionsRefresh(value=>value+1)}
    finally{setDispatching(false)}
  };
  const sendDistributorMessage=async(distributorId,text)=>{
    try{
      const response=await apiFetch(`/api/admin/distributor-inbox/${encodeURIComponent(distributorId)}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const result=await responseData(response,'Distributor inbox');
      if(!response.ok)throw Error(result.error||'Unable to send message.');
      setDistributorConversations(current=>current.map(conversation=>String(conversation.distributor?._id)===String(distributorId)?{...conversation,messages:[...(conversation.messages||[]).filter(message=>message.sentAt!==result.message.sentAt),result.message],updatedAt:result.updatedAt}:conversation));
      setToast('Message sent to distributor.');
      return true;
    }catch(error){setToast(error.message);return false}
  };
  const sendSuperagentMessage=async(superagentId,text)=>{
    try{
      const response=await apiFetch(`/api/admin/superagent-inbox/${encodeURIComponent(superagentId)}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const result=await responseData(response,'Superagent inbox');
      if(!response.ok)throw Error(result.error||'Unable to send message.');
      setSuperagentConversations(current=>current.map(conversation=>String(conversation.superagent?._id)===String(superagentId)?{...conversation,messages:[...(conversation.messages||[]).filter(message=>message.sentAt!==result.message.sentAt),result.message],updatedAt:result.updatedAt}:conversation));
      setToast('Message sent to Superagent.');
      return true;
    }catch(error){setToast(error.message);return false}
  };
  const sendAgentAdminMessage=async(agentId,text)=>{
    try{
      const response=await apiFetch(`/api/admin/agent-inbox/${encodeURIComponent(agentId)}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const result=await responseData(response,'Agent inbox');
      if(!response.ok)throw Error(result.error||'Unable to send message.');
      setAgentConversations(current=>current.map(conversation=>String(conversation.agent?._id)===String(agentId)?{...conversation,messages:[...(conversation.messages||[]).filter(message=>message.sentAt!==result.message.sentAt),result.message],updatedAt:result.updatedAt}:conversation));
      setToast('Message sent to agent.');
      return true;
    }catch(error){setToast(error.message);return false}
  };
  const requestDistributorGps=async distributor=>{
    setGpsRequestingDistributorId(distributor._id);
    try{
      const message='Operations needs to assign you a nearby agent for an urgent float transfer. Please open the Distributor app, go on duty, allow location access, and tap "Refresh GPS now". The admin will retry assignment after your fresh location is shared.';
      const response=await apiFetch(`/api/admin/distributor-inbox/${encodeURIComponent(distributor._id)}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:message})});
      const result=await responseData(response,'Distributor inbox');
      if(!response.ok)throw Error(result.error||'Unable to request a GPS refresh.');
      setToast(`GPS refresh request sent to ${distributor.name}. Ask them to open the Distributor app and share a fresh location.`);
      setDispatchOptionsRefresh(value=>value+1);
      refresh();
    }catch(error){setToast(error.message)}
    finally{setGpsRequestingDistributorId('')}
  };
  const reviewSettlement=async(report,status)=>{
    let amountAdded;
    let reviewNote='';
    if(status==='approved'){
      const value=window.prompt(`Verified float amount to credit ${report.agent?.name||'this agent'} (RWF)`,String(report.depositAmount));
      if(value===null)return;
      amountAdded=Number(value);
      if(!Number.isFinite(amountAdded)||amountAdded<=0){setToast('Enter a positive approved float amount.');return}
      reviewNote=window.prompt('Optional note for the agent','')||'';
    }else{
      reviewNote=window.prompt('Explain why the report was rejected so the agent can correct it.','')||'';
      if(!reviewNote.trim()){setToast('A rejection reason is required.');return}
    }
    try{
      const response=await apiFetch(`/api/float-settlements/${report._id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,amountAdded,reviewNote})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      setToast(status==='approved'?`Settlement approved. ${money(data.approvedFloat)} float credited to ${data.agent?.name||'agent'}.`:'Settlement rejected; the agent can review your reason.');
      refresh();
    }catch(error){setToast(error.message)}
  };
  const alertRows=alerts.length?alerts:!connected?demoAgents.filter(a=>getRisk(a)==='critical').map((agent,i)=>({_id:agent._id,agent,triggeredAt:new Date(Date.now()-i*180000).toISOString(),balanceAtTrigger:agent.floatBalance,state:'open'})):[];
  const dispatchAgents=agents.filter(agent=>validAgentLocation(agent.location));
  const gpsRefreshCandidates=distributors.filter(distributor=>{
    const lastSeenAt=Date.parse(distributor.lastSeenAt||'');
    return distributor.status==='available'&&distributor.mobileLoginActive&&
      (!validAgentLocation(distributor.location)||!Number.isFinite(lastSeenAt)||lastSeenAt<Date.now()-15*60*1000);
  });
  const beginDispatch=(alert,agentOverride)=>{
    const target=agentOverride||alert||alertRows[0]||dispatchAgents[0];
    const isAlert=Boolean(target&&!agentOverride&&(alert||alertRows.includes(target)));
    const targetAgent=isAlert?target.agent:target;
    setSelectedAgent(target?(isAlert?`alert:${target._id}`:`agent:${target._id}`):'');
    setDispatchInstructions(dispatchInstructionFor(targetAgent));
    setDispatchDistributorOptions([]);
    setSelectedDistributorId('');
    setDispatchOptionsError('');
    setModal(true);
  };
  const activeDispatchRows=dispatches.length?dispatches:[];
  const title=mapNames[view]||'Overview';
  const sessionTime=`${String(Math.floor(sessionRemaining/3600)).padStart(2,'0')}:${String(Math.floor(sessionRemaining%3600/60)).padStart(2,'0')}:${String(sessionRemaining%60).padStart(2,'0')}`;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setView('overview')}}><span className="brand-mark"><svg viewBox="0 0 32 32"><path d="M7 8.5h18M16 8.5v16M8.5 16H23"/><circle cx="16" cy="16" r="12"/></svg></span><span className="brand-copy">tap<span>&go</span><small>NETWORK OPS</small></span></a>
      <div className="workspace-switch"><span className="workspace-icon">L</span><span><b>London network</b><small>Operations workspace</small></span><span className="chevron"></span></div>
      <div className="nav-label">WORKSPACE</div><nav className="main-nav">{['overview','agents','distributors','dispatch','agentMessages','chats','superagentRequests','commuters'].map(name=><button key={name} className={`nav-item ${view===name?'active':''}`} onClick={()=>setView(name)}><Icon name={name}/>{mapNames[name]}{name==='agents'&&<span className="nav-count">{agents.length}</span>}{name==='distributors'&&<span className="nav-count">{distributors.length}</span>}{name==='dispatch'&&<span className="nav-count alert-count">{alertRows.length}</span>}{name==='agentMessages'&&agentMessages.length>0&&<span className="nav-count alert-count">{agentMessages.length>99?'99+':agentMessages.length}</span>}{name==='chats'&&[...agentConversations,...distributorConversations,...superagentConversations].some(conversation=>conversation.messages?.length>0)&&<span className="nav-count">{[...agentConversations,...distributorConversations,...superagentConversations].filter(conversation=>conversation.messages?.length>0).length}</span>}{name==='superagentRequests'&&superagentDeletionRequests.some(request=>request.status==='pending')&&<span className="nav-count alert-count">{superagentDeletionRequests.filter(request=>request.status==='pending').length}</span>}</button>)}</nav>
      <div className="nav-label second-label">MANAGEMENT</div><nav className="main-nav">{['liquidity','reports'].map(name=><button key={name} className={`nav-item ${view===name?'active':''}`} onClick={()=>setView(name)}><Icon name={name}/>{mapNames[name]}{name==='reports'&&settlements.some(report=>report.status==='pending')&&<span className="nav-count alert-count">{settlements.filter(report=>report.status==='pending').length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-spark"></span><b>Need a hand?</b><p>Call our operations support line.</p><button onClick={()=>setSupportOpen(true)}>Contact support <span></span></button></div><button className="nav-item" onClick={()=>{setMobileAccountRole('superagent');setView('settings')}}><span className="nav-icon" aria-hidden="true"></span>Add Superagent</button><button className={`nav-item settings ${view==='settings'?'active':''}`} onClick={()=>setView('settings')}><Icon name="settings"/>Settings</button><div className="profile"><div className="avatar">{accountDisplayName(admin.name||admin.email).slice(0,1)}</div><span><b>{accountDisplayName(admin.name||admin.email)}</b><small>Network administrator</small></span><span className="dots"> -  -  - </span></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">Network operations <span>/</span> <b>{title}</b></div><div className="top-actions"><div className="live-pill"><i className={connected?'':'offline-dot'}/>{connected?'Systems operational':'Demo data'}</div><div className={`session-timer ${sessionRemaining<=300?'expiring':''}`} role="timer" aria-label={`Automatic logout in ${sessionTime}`}><span>SESSION</span><b>{sessionTime}</b></div><button className="icon-button" aria-label="Search" title="Search" onClick={()=>setToast('Search agents, zones, and dispatches')}><Search size={17} strokeWidth={1.8} aria-hidden="true"/></button><button className="icon-button notification-button" aria-label="Notifications" title="Notifications" onClick={()=>setToast(`${alertRows.length} priority alerts need attention.`)}><Bell size={17} strokeWidth={1.8} aria-hidden="true"/><i/></button><span className="top-avatar">{accountDisplayName(admin.name||admin.email).slice(0,1)}</span><button className="logout-button" onClick={onLogout}>Log out</button></div></header>
    {view==='overview'?<section className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="pulse"/>{new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'}).format(new Date()).toUpperCase()}<span className="heading-dot"> - </span> LIVE NETWORK</div><h1>{greeting} <span className="wave"></span></h1><p>Here's what's happening across your London network today.</p></div><button className="primary-button" onClick={()=>beginDispatch()}><span></span> New dispatch</button></div>
      <div className="metrics-grid"><article className="metric-card"><div className="metric-top">Active agents<span className="metric-symbol green"></span></div><div className="metric-value">{activeAgents} <span className="metric-unit">/ {summary?.agents?.total||260}</span></div><div className="metric-foot"><span className="trend positive"> 4.8 increase</span><span>vs. last week</span><span className="metric-note"><i className="mini-dot"/>{Math.max(0,(summary?.agents?.total||260)-activeAgents)} offline</span></div><div className="metric-progress"><span style={{width:`${Math.min(100,(activeAgents/(summary?.agents?.total||260))*100)}%`}}/></div></article>
        <article className="metric-card"><div className="metric-top">Network liquidity<span className="metric-symbol blue"></span></div><div className="metric-value">{money(liquidity)}<span className="metric-unit"> total</span></div><div className="metric-foot"><span className="trend positive"> 8.2 increase</span><span>vs. last week</span><span className="metric-note">Across 6 zones</span></div><div className="sparkline"><svg viewBox="0 0 180 28" preserveAspectRatio="none"><path d="M0 22C14 21 15 14 30 17S48 24 62 13 82 20 98 10 116 13 129 7 151 15 162 5 173 7 180 2"/><path className="spark-fill" d="M0 22C14 21 15 14 30 17S48 24 62 13 82 20 98 10 116 13 129 7 151 15 162 5 173 7 180 2V28H0Z"/></svg></div></article>
        <article className="metric-card"><div className="metric-top">Agents at risk<span className="metric-symbol orange"></span></div><div className="metric-value">{String(atRisk).padStart(2,'0')} <span className="risk-label">needs attention</span></div><div className="metric-foot"><span className="trend negative">{alertRows.length} SOS</span><span>requiring response</span><span className="metric-note">{alertRows.length} active</span></div><div className="risk-bars">{Array.from({length:12},(_,i)=><i key={i}/>)}</div></article>
        <article className="metric-card"><div className="metric-top">Today's transactions<span className="metric-symbol purple"></span></div><div className="metric-value">{(summary?.transactions24h||0).toLocaleString('en-GB')}</div><div className="metric-foot"><span className="trend positive"> live</span><span>last 24 hours</span><span className="metric-note">{money(summary?.transactionValue24h)} total value</span></div><div className="sparkline purple-line"><svg viewBox="0 0 180 28" preserveAspectRatio="none"><path d="M0 24C15 20 22 18 32 21S47 13 59 17 75 8 87 15 102 4 115 11 131 4 143 9 159 2 170 6 177 2 180 1"/><path className="spark-fill" d="M0 24C15 20 22 18 32 21S47 13 59 17 75 8 87 15 102 4 115 11 131 4 143 9 159 2 170 6 177 2 180 1V28H0Z"/></svg></div></article></div>
      <div className="dashboard-grid"><section className="panel map-panel"><div className="panel-heading"><div><h2>Live network map</h2><p>Agent availability and liquidity across London</p></div><button className="subtle-button" onClick={()=>setMapFilter(mapFilter==='all'?'risk':'all')}>{mapFilter==='all'?'All zones':'At-risk agents'} <span></span></button></div><div className="map-wrap"><div className="map-canvas"><MapArtwork agents={shownAgents} distributors={distributors} onSelect={(e,agent)=>{const rect=e.currentTarget.getBoundingClientRect(),wrap=e.currentTarget.closest('.map-canvas').getBoundingClientRect();setPopup({name:agent.name,place:agent.place||agent.zone,float:money(agent.floatBalance),left:Math.min(rect.left-wrap.left,wrap.width-155),top:Math.max(8,rect.top-wrap.top-45)})}}/>{popup&&<div className="map-popup" style={{left:popup.left,top:popup.top}}><b>{popup.name}</b><span>{popup.place}  -  {popup.float}</span><button aria-label="Close map popup" onClick={()=>setPopup(null)}>x</button></div>}<div className="map-zoom"><button aria-label="Zoom in" onClick={e=>e.currentTarget.closest('.map-canvas').querySelector('.map-art').style.transform='scale(1.1)'}>+</button><button aria-label="Zoom out" onClick={e=>e.currentTarget.closest('.map-canvas').querySelector('.map-art').style.transform='scale(.95)'}>-</button><span/><button aria-label="Locate me" onClick={()=>setToast('Map centred on the London network.')}></button></div><div className="map-legend"><div><i className="legend-dot available"/>High float <b>{agents.filter(a=>getRisk(a)==='healthy').length}</b></div><div><i className="legend-dot warning"/>Medium float <b>{agents.filter(a=>getRisk(a)==='warning').length}</b></div><div><i className="legend-dot critical"/>Low float <b>{agents.filter(a=>getRisk(a)==='critical').length}</b></div><div><i className="legend-dot distributor"/>Distributors <b>{distributors.length}</b></div></div><div className="map-scale"><i/>1 km</div></div></div></section>
        <section className="panel alerts-panel"><div className="panel-heading"><div><h2>Priority alerts <span className="heading-count">{alertRows.length}</span></h2><p>Agents that need support now</p></div><button className="text-button" onClick={()=>setView('dispatch')}>View all <span></span></button></div><div className="alert-list">{alertRows.slice(0,4).map((alert,i)=>{const agent=alert.agent||{};return <article className="alert-row" key={alert._id}><span className={`alert-icon ${getRisk(agent)==='critical'?'critical':'warning'}`}>{i===0?'':''}</span><div className="alert-copy"><b>{agent.name||'Network agent'}</b><span>{agent.place||agent.zone||'London'}  -  {money(alert.balanceAtTrigger??agent.floatBalance)} remaining</span></div><span className="alert-age">{alert.triggeredAt?new Date(alert.triggeredAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'Just now'}<b className="severity critical">SOS ALERT</b></span><button className="alert-action" onClick={()=>beginDispatch(alert)}> Dispatch distributor</button></article>})}</div><button className="all-alerts-button" onClick={()=>setView('dispatch')}>View dispatch queue <span></span></button></section></div>
      <div className="lower-grid"><section className="panel activity-panel"><div className="panel-heading"><div><h2>Network activity</h2><p>Transactions and agent top-ups over time</p></div><button className="subtle-button" onClick={()=>setToast('Activity window: last 24 hours')}>Last 24h <span></span></button></div><div className="chart-legend"><span><i className="legend-line transaction"/>Transactions</span><span><i className="legend-line topup"/>Float top-ups</span><strong>{(summary?.transactions24h||0).toLocaleString()} <small>transactions</small></strong></div><div className="chart"><div className="chart-y"><span>1,500</span><span>1,000</span><span>500</span><span>0</span></div><svg viewBox="0 0 750 165" preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2c8a69" stopOpacity=".13"/><stop offset="1" stopColor="#2c8a69" stopOpacity="0"/></linearGradient></defs><path className="grid-line" d="M0 15H750M0 58H750M0 101H750M0 144H750"/><path className="chart-area" d="M0 128C35 124 39 99 78 108S126 136 166 92 221 104 252 82 295 98 335 70 379 88 417 54 456 76 497 46 538 66 577 39 622 60 659 31 710 35 730 22 750 19V150H0Z"/><path className="chart-main" d="M0 128C35 124 39 99 78 108S126 136 166 92 221 104 252 82 295 98 335 70 379 88 417 54 456 76 497 46 538 66 577 39 622 60 659 31 710 35 730 22 750 19"/><path className="chart-secondary" d="M0 141C45 130 50 137 85 124S130 135 166 120 214 124 252 111 296 119 335 101 378 116 417 92 463 106 497 82 545 96 577 74 624 82 659 67 710 61 733 65 750 51"/></svg><div className="chart-x"><span>00:00</span><span>04:00</span><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span><span>Now</span></div></div></section>
        <section className="panel dispatch-panel"><div className="panel-heading"><div><h2>Active dispatches <span className="heading-count neutral">{activeDispatchRows.length}</span></h2><p>Field teams currently on the move</p></div><button className="text-button" onClick={()=>setView('dispatch')}>View all <span></span></button></div><div className="dispatch-list">{activeDispatchRows.length?activeDispatchRows.slice(0,3).map(dispatch=><article className="dispatch-row" key={dispatch._id}><div className="dispatch-icon"></div><div className="dispatch-copy"><b>{dispatch.distributor?.name||'Field distributor'} <span className="route-pill">EN ROUTE</span></b><span>Heading to {dispatch.agent?.name||'agent'}  -  {dispatch.agent?.place||dispatch.agent?.zone}</span></div><div className="eta"><b>Active</b><span>STATUS</span></div></article>):<div className="empty-dispatch"><span></span><b>All clear for now</b><small>New dispatches will appear here.</small></div>}</div><button className="all-alerts-button dispatch-action" onClick={()=>setView('dispatch')}>Open dispatch board <span></span></button></section></div>
      <footer className="page-footer"><span>Tap & Go Network Operations</span><span><i/> {loading?'Connecting...':connected?'Live connection':'Demo data'} <span className="footer-sep"> - </span> Refreshes every 30s</span></footer></section>:view==='settings'?<ProfileSettings admin={admin} onSaved={onProfileSaved} onMessage={setToast} mobileAccountRole={mobileAccountRole} onMobileAccountRoleChange={setMobileAccountRole}/>:<AlternateView view={view} title={title} agents={agents} distributors={distributors} alerts={alertRows} agentMessages={agentMessages} agentConversations={agentConversations} distributorConversations={distributorConversations} superagentConversations={superagentConversations} superagentDeletionRequests={superagentDeletionRequests} dispatches={activeDispatchRows} completedDispatches={completedDispatches} settlements={settlements} onReviewSettlement={reviewSettlement} heatmap={heatmap} analytics={analytics} connected={connected} onNewDispatch={()=>beginDispatch()} onAssignAgent={agent=>beginDispatch(null,agent)} onSelectAlert={beginDispatch} onOpenDispatch={()=>setView('dispatch')} onSendAgentAdminMessage={sendAgentAdminMessage} onSendDistributorMessage={sendDistributorMessage} onSendSuperagentMessage={sendSuperagentMessage} onRefresh={refresh} onMessage={setToast}/>}
      </main>
    {modal&&<div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setModal(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><button className="modal-close" onClick={()=>setModal(false)} aria-label="Close">x</button><div className="modal-icon"></div><h2 id="modalTitle">Create a dispatch</h2><p>Assign an available distributor to the selected agent.</p>
      <label htmlFor="agentSelect">Agent requiring support</label><select id="agentSelect" value={selectedAgent} onChange={event=>{const value=event.target.value;setSelectedAgent(value);const [type,id]=value.split(':',2);const record=type==='alert'?alertRows.find(alert=>String(alert._id)===id)?.agent:agents.find(agent=>String(agent._id)===id);setDispatchInstructions(dispatchInstructionFor(record))}}>{alertRows.length>0&&<optgroup label="Open support alerts">{alertRows.map(alert=><option key={alert._id} value={`alert:${alert._id}`}>{alert.agent?.name||'Agent'}  -  {alert.agent?.place||alert.agent?.zone||'London'}  -  {money(alert.balanceAtTrigger??alert.agent?.floatBalance)} float</option>)}</optgroup>}<optgroup label="Create support alert">{dispatchAgents.map(agent=><option key={agent._id} value={`agent:${agent._id}`}>{agent.name}  -  {agent.place||agent.zone||'Location available'}  -  {money(agent.floatBalance)} float</option>)}</optgroup></select>
      <div className="dispatch-options-heading"><label htmlFor="distributorSelect">Nearby available distributors</label><button className="text-button" type="button" onClick={()=>setDispatchOptionsRefresh(value=>value+1)} disabled={loadingDispatchDistributors||!selectedAgent}>{loadingDispatchDistributors?'Searching...':'Refresh matches'}</button></div><select id="distributorSelect" value={selectedDistributorId} onChange={event=>setSelectedDistributorId(event.target.value)} disabled={loadingDispatchDistributors||!dispatchDistributorOptions.length}><option value="">{loadingDispatchDistributors?'Finding nearby distributors...':dispatchDistributorOptions.length?'Select a distributor':'No nearby distributor matches'}</option>{dispatchDistributorOptions.map(distributor=><option key={distributor._id} value={distributor._id}>{distributor.name}  -  {distributor.zoneMatch?'Same zone  -  ':''}{(distributor.routeDistanceMeters/1000).toFixed(1)} km{distributor.routeDurationSeconds!==null?`  -  ${Math.ceil(distributor.routeDurationSeconds/60)} min`:''}{distributor.routeSource==='road'?'  -  road route':'  -  direct distance'}</option>)}</select><small style={{display:'block',marginTop:5,color:'#89938a',fontSize:9}}>Only on-duty distributors with active logins and a recent GPS location are listed. Same-zone matches are prioritized; route time is used when available.</small>{dispatchOptionsError&&<p className="dispatch-options-error" role="alert">{dispatchOptionsError}</p>}
      {dispatchOptionsError&&/^No distributor matched|^No on-duty distributor/.test(dispatchOptionsError)&&gpsRefreshCandidates.length>0&&<div className="dispatch-gps-help"><b>Available distributors need a fresh GPS fix</b><span>Ask them to open the Distributor app, go on duty, and share their current location. They cannot be assigned until GPS is recent and within 500 m.</span>{gpsRefreshCandidates.map(distributor=><button type="button" key={distributor._id} disabled={Boolean(gpsRequestingDistributorId)} onClick={()=>requestDistributorGps(distributor)}>{gpsRequestingDistributorId===distributor._id?'Sending request...':`Message ${distributor.name} to refresh GPS`}</button>)}</div>}
      <label htmlFor="dispatchInstructions" style={{marginTop:12}}>Urgent transfer message (sent with the task)</label><textarea id="dispatchInstructions" value={dispatchInstructions} onChange={event=>setDispatchInstructions(event.target.value)} maxLength={500} placeholder="Please contact the agent now and arrange an urgent float transfer." style={{width:'100%',minHeight:70,resize:'vertical',border:'1px solid #e5eae4',borderRadius:6,padding:'9px',font:'inherit',fontSize:10,color:'#465248',outlineColor:'#75a888'}}/>
      <div className="dispatch-match"><span className="match-icon"></span><span><b>Distributor is notified immediately</b><small>The selected distributor receives the task and this transfer message in the mobile app, with directions to the agent.</small></span><span className="match-check"></span></div><button className="primary-button modal-submit" disabled={!selectedAgent||!selectedDistributorId||dispatching||loadingDispatchDistributors} onClick={openDispatch}>{dispatching?'Creating dispatch...':'Assign distributor & send message'} <span></span></button></section></div>}
    {supportOpen&&<div className="modal-backdrop" onMouseDown={event=>event.target===event.currentTarget&&setSupportOpen(false)}><section className="modal support-modal" role="dialog" aria-modal="true" aria-labelledby="supportTitle"><button className="modal-close" onClick={()=>setSupportOpen(false)} aria-label="Close support contacts">x</button><div className="modal-icon" aria-hidden="true">?</div><h2 id="supportTitle">Contact support</h2><p>Call our operations team for help with the Tap &amp; Go network.</p><a className="primary-button support-call-button" href="tel:6655">Call 6655</a></section></div>}
    {toast&&<div className="toast show" role="status">{toast}</div>}
  </div>
}

function DashboardApp(){
 const [session,setSession]=useState(undefined);const [sessionNotice,setSessionNotice]=useState('');
 useEffect(()=>{
  let mounted=true;
  const storedSession=readAdminSession();
  if(!storedSession?.token){setSession(null);return()=>{mounted=false}}
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  const expired=()=>{clearAdminSession();setSessionNotice('Your session expired. Please sign in again.');setSession(null)};
  window.addEventListener('tapgo:session-expired',expired);
  fetch(apiUrl('/api/auth/me'),{headers:{Authorization:`Bearer ${storedSession.token}`},credentials:'omit',signal:controller.signal})
   .then(response=>{
    if(response.status===401){clearAdminSession();setSessionNotice('Your session expired. Please sign in again.');return null}
    if(!response.ok)throw new Error(`Session check failed (HTTP ${response.status}).`);
    return response.json();
   })
   .then(value=>{if(mounted)setSession(value?{...storedSession,...value}:null)})
   .catch(error=>{
    if(!mounted)return;
    setSessionNotice(error.name==='AbortError'
     ?'Secure session check timed out. Check the backend connection, then sign in again.'
     :'Unable to verify your secure session. Check the backend connection, then sign in again.');
    setSession(null);
   })
   .finally(()=>clearTimeout(timeout));
  return()=>{mounted=false;clearTimeout(timeout);controller.abort();window.removeEventListener('tapgo:session-expired',expired)};
 },[]);
 const logout=useCallback(async(expired=false)=>{clearAdminSession();setSessionNotice(expired?'Your session expired. Please sign in again.':'');setSession(null);await fetch(apiUrl('/api/auth/logout'),{method:'POST',credentials:'include'}).catch(()=>{})},[]);
 const login=sessionData=>{saveAdminSession(sessionData);setSessionNotice('');setSession(sessionData)};
 const updateSession=sessionData=>{const current=readAdminSession();const updated={...current,...sessionData,token:sessionData.token||current?.token};saveAdminSession(updated);setSession(updated)};
 if(session===undefined)return <main className="login-screen"><div className="login-loading">Tap &amp; Go <span>Checking secure session...</span></div></main>;
 return session?<Dashboard admin={session} onLogout={logout} onProfileSaved={updateSession}/>:<LoginScreen onLogin={login} notice={sessionNotice}/>;
}

function App(){
 const setupToken=new URLSearchParams(window.location.hash.slice(1)).get('setupToken');
 return setupToken?<AccountSetupScreen token={setupToken}/>:<DashboardApp/>;
}

function AccountSetupScreen({token}){
 const [password,setPassword]=useState('');
 const [confirmPassword,setConfirmPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [complete,setComplete]=useState(false);
 const submit=async event=>{
  event.preventDefault();setError('');
  if(password!==confirmPassword){setError('Passwords do not match.');return}
  setBusy(true);
  try{
   const response=await fetch(apiUrl('/api/auth/mobile/activate'),{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password})});
   const data=await responseData(response,'Account setup');
   if(!response.ok)throw Error(data.error||'Unable to set up your account.');
   setComplete(true);setPassword('');setConfirmPassword('');
   window.history.replaceState({},'',window.location.pathname);
  }catch(problem){setError(problem instanceof TypeError?'Cannot reach the account service. Check your connection and try again.':problem.message)}
  finally{setBusy(false)}
 };
 return <main className="login-screen"><section className="login-card"><a className="brand login-brand" href="/"><span className="brand-mark"><svg viewBox="0 0 32 32"><path d="M7 8.5h18M16 8.5v16M8.5 16H23"/><circle cx="16" cy="16" r="12"/></svg></span><span className="brand-copy">tap<span>&go</span><small>NETWORK OPS</small></span></a><div className="login-eyebrow"><span className="pulse"/> STAFF ACCOUNT SETUP</div><h1>{complete?'Your account is ready':'Set your password'}</h1>{complete?<><p>Your password has been set. Open the Tap &amp; Go mobile app and sign in with the email address that received this invitation.</p><a className="primary-button login-submit" href="/">Continue to sign in</a></>:<><p>This one-time link expires after 24 hours. Choose a password of at least 12 characters.</p><form onSubmit={submit}><label htmlFor="setup-password">New password</label><input id="setup-password" type="password" autoComplete="new-password" minLength="12" maxLength="1024" required value={password} onChange={event=>setPassword(event.target.value)} placeholder="At least 12 characters"/><label htmlFor="setup-confirm-password">Confirm password</label><input id="setup-confirm-password" type="password" autoComplete="new-password" minLength="12" maxLength="1024" required value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} placeholder="Enter the same password again"/>{error&&<div className="login-error" role="alert">{error}</div>}<button className="primary-button login-submit" disabled={busy}>{busy?'Saving password...':'Set password securely'} <span></span></button></form></>}<div className="login-foot"><span>Secure one-time account invitation</span><span>Never share this link</span></div></section><div className="login-background-mark">T&amp;G</div></main>;
}

function LoginScreen({onLogin,notice}){
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const submit=async event=>{event.preventDefault();setError('');setBusy(true);try{const response=await fetch(apiUrl('/api/auth/login'),{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const data=await responseData(response,'Login service');if(!response.ok)throw Error(data.error||`Unable to sign in (HTTP ${response.status}).`);if(!data.expiresAt||!data.token)throw Error('Login service did not return a secure session. Please try again.');onLogin(data)}catch(problem){setError(problem instanceof TypeError?'Cannot reach the login service. Check the backend connection and try again.':problem.message)}finally{setBusy(false)}};
 return <main className="login-screen"><section className="login-card"><a className="brand login-brand" href="#"><span className="brand-mark"><svg viewBox="0 0 32 32"><path d="M7 8.5h18M16 8.5v16M8.5 16H23"/><circle cx="16" cy="16" r="12"/></svg></span><span className="brand-copy">tap<span>&go</span><small>NETWORK OPS</small></span></a><div className="login-eyebrow"><span className="pulse"/> SECURE OPERATIONS PORTAL</div><h1>Welcome back</h1><p>Sign in to monitor your network and coordinate field support.</p>{notice&&<div className="login-error" role="status">{notice}</div>}<form onSubmit={submit}><label htmlFor="admin-email">Work email</label><input id="admin-email" type="email" autoComplete="username" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@company.com"/><label htmlFor="admin-password">Password</label><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)} placeholder="Enter your password"/>{error&&<div className="login-error" role="alert">{error}</div>}<button className="primary-button login-submit" disabled={busy}>{busy?'Signing in...':'Sign in securely'} <span></span></button></form><div className="login-foot"><span>Protected network access</span><span>Sessions expire after 8 hours</span></div></section><div className="login-background-mark">T&amp;G</div></main>;
}

function ProfileSettings({admin,onSaved,onMessage,mobileAccountRole,onMobileAccountRoleChange}){
 const [name,setName]=useState(admin.name||'');const [email,setEmail]=useState(admin.email||'');const [currentPassword,setCurrentPassword]=useState('');const [newPassword,setNewPassword]=useState('');const [confirmPassword,setConfirmPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const submit=async event=>{
  event.preventDefault();setError('');
  if((newPassword||confirmPassword)&&newPassword!==confirmPassword){setError('New password and confirmation do not match.');return}
  setBusy(true);
  try{
   const response=await apiFetch('/api/auth/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,currentPassword,...(newPassword?{newPassword}:{})})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to update profile.');
   onSaved(data);setCurrentPassword('');setNewPassword('');setConfirmPassword('');onMessage('Profile updated successfully.');
  }catch(problem){setError(problem.message)}finally{setBusy(false)}
 };
 return <section className="page-content alternate-view"><div className="page-heading"><div><div className="eyebrow"><span className="pulse"/> ACCOUNT SETTINGS</div><h1>Your profile</h1><p>Manage your administrator name, sign-in email, and password.</p></div></div><div className="profile-settings-layout"><section className="panel profile-settings-card"><div className="panel-heading"><div><h2>Profile information</h2><p>Your updated details are saved to your account.</p></div></div><form className="profile-form" onSubmit={submit}><label htmlFor="profile-name">Full name</label><input id="profile-name" type="text" autoComplete="name" maxLength="80" required value={name} onChange={event=>setName(event.target.value)} placeholder="Your name"/><label htmlFor="profile-email">Work email</label><input id="profile-email" type="email" autoComplete="email" maxLength="254" required value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@company.com"/><div className="profile-form-divider"><b>Change password</b><span>Leave the new password blank to keep your current one.</span></div><label htmlFor="profile-current-password">Current password</label><input id="profile-current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} placeholder="Confirm your identity"/><label htmlFor="profile-new-password">New password</label><input id="profile-new-password" type="password" autoComplete="new-password" minLength="12" value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="At least 12 characters"/><label htmlFor="profile-confirm-password">Confirm new password</label><input id="profile-confirm-password" type="password" autoComplete="new-password" minLength="12" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} placeholder="Re-enter the new password"/>{error&&<div className="profile-form-error" role="alert">{error}</div>}<div className="profile-form-actions"><button className="primary-button" disabled={busy}>{busy?'Saving...':'Save changes'}</button></div></form></section><aside className="panel profile-security-card"><span className="metric-symbol green"></span><h2>Account security</h2><p>Confirm your current password before changing profile details. Saving changes refreshes this session and signs out other active sessions.</p></aside></div><MobileAccounts onMessage={onMessage} role={mobileAccountRole} onRoleChange={onMobileAccountRoleChange}/></section>
}

function MobileAccounts({onMessage,role,onRoleChange}){
 const [data,setData]=useState({accounts:[],agents:[],distributors:[]});
 const [recordId,setRecordId]=useState('');
 const [email,setEmail]=useState('');
 const [superagentName,setSuperagentName]=useState('');const [managedAgentIds,setManagedAgentIds]=useState([]);
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
    ?{role,name:superagentName,managedAgentIds,email}
    :{role,recordId,email};
   const response=await apiFetch('/api/admin/mobile-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json();
   if(!response.ok){
    if(result.accountCreated)await refresh();
    throw Error(result.error||'Unable to create mobile account.');
   }
   setEmail('');setSuperagentName('');setManagedAgentIds([]);await refresh();onMessage(`Account created. A secure setup link was emailed to ${result.email}.`);
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
   const body={name:editingSuperagent.name,email:editingSuperagent.email};
   if(editingSuperagent.password)body.password=editingSuperagent.password;
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
 return <section className="panel profile-settings-card mobile-accounts-panel"><div className="panel-heading"><div><h2>Agent, distributor &amp; Superagent logins</h2><p>Creating an account emails a one-time password setup link that expires after 24 hours. Superagents can see only agents assigned here. They may create and edit agent profiles, but the admin must provision each agent's login and POS account. Staff cannot self-register.</p></div></div>
  <form className="profile-form" onSubmit={create}>
   <label htmlFor="mobile-account-role">Account type</label><select id="mobile-account-role" value={role} onChange={event=>onRoleChange(event.target.value)}><option value="agent">Agent</option><option value="distributor">Distributor</option><option value="superagent">Superagent</option></select>
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
   {error&&<div className="profile-form-error" role="alert">{error}</div>}
   <div className="profile-form-actions"><button className="primary-button" disabled={busy||(role==='superagent'?false:!available.length)}>{busy?'Creating...':role==='superagent'?'Create Superagent account':'Create mobile login'}</button></div>
  </form>
  <div className="mobile-account-list-heading"><h3>Existing mobile accounts</h3><span>{data.accounts.length}</span></div>
  <div className="mobile-account-list">{data.accounts.length?data.accounts.map(account=><div className="mobile-account-row" key={account.id}><div className="mobile-account-copy"><b>{account.profile?.name||'Profile'}</b><small>{account.role}  -  {account.email}  -  {account.setupPending?'Pending password setup':account.active?'Active':'Disabled'}{account.role==='superagent'?`  -  ${account.managedAgents?.length||0} assigned agent(s)`:''}</small>
   {account.role==='superagent'&&<details className="superagent-scope"><summary>Edit Superagent account</summary>
    {editingSuperagent?.accountId===account.id?<div className="profile-form">
     <label>Name</label><input maxLength="80" value={editingSuperagent.name} onChange={event=>setEditingSuperagent(current=>({...current,name:event.target.value}))}/>
     <label>Sign-in email</label><input type="email" maxLength="254" value={editingSuperagent.email} onChange={event=>setEditingSuperagent(current=>({...current,email:event.target.value}))}/>
     <label>Reset password (optional)</label><input type="password" autoComplete="new-password" minLength="12" maxLength="1024" placeholder="Leave blank to keep current password" value={editingSuperagent.password} onChange={event=>setEditingSuperagent(current=>({...current,password:event.target.value}))}/>
     {error&&<div className="profile-form-error" role="alert">{error}</div>}
     <button className="row-action" type="button" disabled={busy||!editingSuperagent.name.trim()||!editingSuperagent.email.trim()} onClick={saveSuperagent}>Save account</button>
     <button className="row-action" type="button" onClick={()=>setEditingSuperagent(null)}>Cancel</button>
    </div>:<button className="row-action" type="button" onClick={()=>setEditingSuperagent({accountId:account.id,name:account.profile?.name||'',email:account.email,password:''})}>Edit details and credentials</button>}
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
   </details>}</div><div className="mobile-account-actions">{account.setupPending&&<button className="subtle-button" disabled={busy} onClick={()=>resendInvitation(account)}>Resend invitation</button>}<button className="subtle-button" onClick={()=>toggle(account)}>{account.active?'Disable':'Enable'}</button>{account.role==='superagent'&&<button className="subtle-button" disabled={busy} onClick={()=>removeSuperagent(account)}>Delete</button>}</div></div>):<p className="mobile-account-empty">No mobile accounts have been created yet.</p>}</div>
 </section>
}

function NetworkProfileForm({role,record,onCancel,onSaved,onMessage,zoneOptions=[]}){
 const [name,setName]=useState(record?.name||'');
 const [phone,setPhone]=useState(record?.phone||'');
 const [place,setPlace]=useState(record?.place||'');
 const [zone,setZone]=useState(record?.zone||'');
 const [customZone,setCustomZone]=useState(Boolean(record?.zone&&!zoneOptions.includes(record.zone)));
 useEffect(()=>{if(zone&&zoneOptions.includes(zone))setCustomZone(false)},[zone,zoneOptions]);
 const [openingFloat,setOpeningFloat]=useState('0');
 const [superagents,setSuperagents]=useState([]);
 const [superagentId,setSuperagentId]=useState('');
 const [email,setEmail]=useState(record?.mobileEmail||'');
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
   const body={name,phone,place,zone,email};
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
   onMessage(record?`${role==='agent'?'Agent':'Distributor'} updated. Updated credentials will require a new sign-in.`:`${role==='agent'?'Agent':'Distributor'} created. A secure password setup link was emailed to ${email}.`);
  }catch(problem){setError(problem.message)}finally{setBusy(false)}
 };
 return <section className="panel profile-settings-card network-profile-form">
  <div className="panel-heading"><div><h2>{record?`Edit ${role}`:`Add ${role}`}</h2><p>{record?'Update contact details and mobile sign-in. Location is updated automatically from the mobile app. Float balance remains ledger-controlled.':'Create the profile and linked mobile login together. Location will be updated automatically when the user shares GPS from the mobile app. A one-time password setup link will be sent to the sign-in email.'}</p></div></div>
  <form className="profile-form" onSubmit={submit}>
   <label htmlFor="network-name">Full name</label><input id="network-name" required maxLength="80" value={name} onChange={event=>setName(event.target.value)} autoComplete="name"/>
   <label htmlFor="network-phone">Phone number</label><input id="network-phone" maxLength="32" value={phone} onChange={event=>setPhone(event.target.value)} autoComplete="tel"/>
   <label htmlFor="network-place">Location / area</label><input id="network-place" maxLength="100" value={place} onChange={event=>setPlace(event.target.value)} placeholder="Town or operating area"/>
   {role==='agent'&&<><label htmlFor="network-zone">Agent zone</label><select id="network-zone" value={customZone?'__custom__':zone} onChange={event=>{const custom=event.target.value==='__custom__';setCustomZone(custom);setZone(custom?'':event.target.value)}}><option value="">Select an agent zone</option>{zoneOptions.map(option=><option key={option} value={option}>{option}</option>)}<option value="__custom__">Add a new zone...</option></select>{customZone&&<input aria-label="New operational zone" required maxLength="80" value={zone} onChange={event=>setZone(event.target.value)} placeholder="Enter new zone"/>}</>}
  {!record&&role==='agent'&&<><label htmlFor="network-opening-float">Opening float (RWF)</label><input id="network-opening-float" type="number" min="0" step="1" value={openingFloat} onChange={event=>setOpeningFloat(event.target.value)}/></>}
  {!record&&role==='agent'&&<><label htmlFor="network-superagent">Assign Superagent (optional)</label><select id="network-superagent" value={superagentId} onChange={event=>setSuperagentId(event.target.value)}><option value="">Leave unassigned</option>{superagents.map(account=><option key={account.id} value={account.id}>{account.profile?.name||account.email}</option>)}</select><p className="form-hint">A distributor is assigned to a replenishment task after the agent and distributor share recent GPS locations.</p></>}
   <label htmlFor="network-email">Sign-in email</label><input id="network-email" type="email" autoComplete="email" maxLength="254" required value={email} onChange={event=>setEmail(event.target.value)}/>
   {error&&<div className="profile-form-error" role="alert">{error}</div>}
   <div className="profile-form-actions"><button type="button" className="subtle-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy}>{busy?'Saving...':record?'Save changes':`Create ${role} & login`}</button></div>
  </form>
 </section>
}

function AdminCommuterMap(){
 const [location,setLocation]=useState(null);
 const [agents,setAgents]=useState([]);
 const [count,setCount]=useState(0);
 const [searchedAt,setSearchedAt]=useState(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [leaflet,setLeaflet]=useState(null);
 const mapElement=useRef(null);
 const mapInstance=useRef(null);
 useEffect(()=>{
  let active=true;
  let map;
  let resizeTimer;
  import('leaflet').then(({default:Leaflet})=>{
   if(!active||!mapElement.current)return;
   map=Leaflet.map(mapElement.current,{scrollWheelZoom:true}).setView([-1.9441,30.0619],13);
   Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
   }).addTo(map);
   mapInstance.current=map;
   setLeaflet(Leaflet);
   resizeTimer=setTimeout(()=>map.invalidateSize(),0);
  }).catch(problem=>{if(active)setError(`Unable to load interactive map: ${problem.message}`)});
  return()=>{
   active=false;
   if(resizeTimer)clearTimeout(resizeTimer);
   if(map){
    if(mapInstance.current===map)mapInstance.current=null;
    map.remove();
   }
  };
 },[]);
 useEffect(()=>{
  const map=mapInstance.current;
  if(!map||!leaflet)return;
  if(!location){
   map.setView([-1.9441,30.0619],13);
   return;
  }
  const center=[location.latitude,location.longitude];
  map.flyTo(center,16,{duration:0.6});
  const overlay=leaflet.layerGroup().addTo(map);
  leaflet.circle(center,{radius:500,color:'#287a5e',weight:1,dashArray:'5 6',fillColor:'#287a5e',fillOpacity:0.035}).addTo(overlay);
  const home=leaflet.circleMarker(center,{radius:8,color:'#fff',weight:3,fillColor:'#176247',fillOpacity:1}).addTo(overlay);
  home.bindPopup('Your location');
  agents.forEach(agent=>{
   const coordinates=agent.location?.coordinates;
   if(!Array.isArray(coordinates)||coordinates.length!==2)return;
   const level=agent.liquidityLevel||'high';
   const colors={low:'#d96b5f',medium:'#e2a054',high:'#4e9a72'};
   const marker=leaflet.circleMarker([coordinates[1],coordinates[0]],{
    radius:8,color:'#fff',weight:2,fillColor:colors[level]||colors.high,fillOpacity:1
   }).addTo(overlay);
   const popup=document.createElement('div');
   const name=document.createElement('strong');
   name.textContent=agent.name||'Nearby agent';
   const details=document.createElement('div');
   details.textContent=`${agent.place||agent.zone||'Nearby'} · ${level==='low'?'Low':level==='medium'?'Medium':'High'} float · ${Math.round(agent.distanceMeters)} m away`;
   popup.append(name,details);
   marker.bindPopup(popup);
  });
  return()=>overlay.remove();
 },[leaflet,location,agents]);
 const search=()=>{
  if(!navigator.geolocation){setError('Location is not supported by this browser.');return}
  setLoading(true);setError('');
  navigator.geolocation.getCurrentPosition(async position=>{
   const center={latitude:position.coords.latitude,longitude:position.coords.longitude};
   setLocation(center);
   setAgents([]);
   setCount(0);
   setSearchedAt(null);
   try{
    const query=new URLSearchParams({latitude:String(center.latitude),longitude:String(center.longitude),radius:'500'});
    const response=await apiFetch(`/api/commuter/nearby?${query}`);
    const result=await responseData(response,'Nearby agent search');
    if(!response.ok)throw Error(result.error||'Unable to search for nearby agents.');
    setAgents(result.agents||[]);setCount(result.count||0);setSearchedAt(new Date());
   }catch(problem){setError(problem.message)}
   finally{setLoading(false)}
  },problem=>{
   setError(problem.code===1?'Allow location access in your browser, then try again.':problem.code===3?'Location request timed out. Check GPS and try again.':'Unable to get your location. Check your browser location settings.');
   setLoading(false);
  },{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
 };
 return <section className="page-content alternate-view commuter-search-page">
  <div className="page-heading"><div><div className="eyebrow"><span className="pulse"/> NETWORK OPERATIONS</div><h1>Commuter map</h1><p>Find active ticket agents near your current location.</p></div><button className="primary-button commuter-search-button" onClick={search} disabled={loading}>{loading?'Finding agents...':location?'Refresh my location':'Find agents near me'}</button></div>
  {error&&<p className="commuter-map-error" role="alert">{error}</p>}
  <section className="panel commuter-map-panel commuter-live-map-panel">
   <div className="panel-heading"><div><h2>Live nearby agent map</h2><p>{searchedAt?`Updated ${searchedAt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · ${count} active agent${count===1?'':'s'} within 500 m`:'Select “Find agents near me” to center the map on your location and search within 500 m.'}</p></div></div>
   <div ref={mapElement} className="commuter-live-map" aria-label="Interactive map showing nearby ticket agents" role="application"/>
   <div className="commuter-map-legend"><span><i className="commuter-location-dot"/>Your location</span><span><i className="commuter-dot low"/>Low float</span><span><i className="commuter-dot medium"/>Medium float</span><span><i className="commuter-dot high"/>High float</span>{searchedAt&&count===0&&<b>No active agents found within 500 m. Try refreshing your location.</b>}{count>agents.length&&<b>Showing the {agents.length} nearest of {count} agents.</b>}</div>
  </section>
 </section>;
}

function CommuterMap(){
 const [stats,setStats]=useState(null);
 const [selectedId,setSelectedId]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const response=await apiFetch('/api/admin/commuter-map/stats');
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Unable to load commuter map activity.');
   setStats(result);
   setSelectedId(current=>result.agents.some(agent=>String(agent._id)===current)?current:String(result.agents[0]?._id||''));
  }catch(problem){setError(problem.message)}finally{setLoading(false)}
 };
 useEffect(()=>{
  load();
  const timer=setInterval(load,15000);
  return()=>clearInterval(timer);
 },[]);
 const agents=stats?.agents||[];
 const locatedAgents=agents.filter(agent=>validAgentLocation(agent.location));
 const bounds=locatedAgents.reduce((value,agent)=>{
  const [longitude,latitude]=agent.location.coordinates;
  return {minLongitude:Math.min(value.minLongitude,longitude),maxLongitude:Math.max(value.maxLongitude,longitude),minLatitude:Math.min(value.minLatitude,latitude),maxLatitude:Math.max(value.maxLatitude,latitude)};
 },{minLongitude:Infinity,maxLongitude:-Infinity,minLatitude:Infinity,maxLatitude:-Infinity});
 const selected=agents.find(agent=>String(agent._id)===selectedId);
 const markerPosition=agent=>{
  const [longitude,latitude]=agent.location.coordinates;
  const longitudeRange=bounds.maxLongitude-bounds.minLongitude;
  const latitudeRange=bounds.maxLatitude-bounds.minLatitude;
  return {left:`${longitudeRange?8+(longitude-bounds.minLongitude)/longitudeRange*84:50}%`,top:`${latitudeRange?8+(bounds.maxLatitude-latitude)/latitudeRange*84:50}%`};
 };
 const agentDetails=agent=>[
  `Name: ${agent.name||'Agent'}`,
  `Username: ${agent.agent_id||'Not assigned'}`,
  `Email: ${agent.mobileEmail||'No mobile login'}`,
  `Phone: ${agent.phone||'Not provided'}`,
  `Area: ${agent.place||'Not provided'}`,
  `Zone: ${agent.zone||'Not assigned'}`,
  `Status: ${agent.mobileLoginActive?'Login enabled':'Login disabled'} - ${agent.status||'unknown'}`
 ].join('\n');
 return <section className="page-content alternate-view commuter-admin-page">
  <div className="page-heading"><div><div className="eyebrow"><span className="pulse"/> COMMUTER ACTIVITY</div><h1>Commuter map</h1><p>Live agent locations update every 15 seconds; map usage is aggregated to protect commuter privacy.</p></div><button className="subtle-button commuter-refresh" onClick={load} disabled={loading}><RefreshCw size={14} aria-hidden="true"/>{loading?'Refreshing':'Refresh'}</button></div>
  {error&&<p className="commuter-map-error" role="alert">{error}</p>}
  <div className="metrics-grid commuter-admin-metrics">
   <article className="metric-card"><div className="metric-top">Map accesses, 30 days<span className="metric-symbol blue"><Activity size={15} aria-hidden="true"/></span></div><div className="metric-value">{stats?.mapAccesses??'-'}</div><div className="metric-foot">Recorded commuter map searches</div></article>
   <article className="metric-card"><div className="metric-top">Tracked commuter sessions<span className="metric-symbol purple"><Users size={15} aria-hidden="true"/></span></div><div className="metric-value">{stats?.commuterSessions??'-'}</div><div className="metric-foot">Distinct app sessions, 30 days</div></article>
   <article className="metric-card"><div className="metric-top">Active agents<span className="metric-symbol green"><MapPin size={15} aria-hidden="true"/></span></div><div className="metric-value">{stats?.activeAgents??'-'}</div><div className="metric-foot">{stats?.locatedAgents??0} with a mappable location</div></article>
  </div>
  <div className="commuter-admin-layout">
   <section className="panel commuter-admin-map-panel"><div className="panel-heading"><div><h2>Active agent locations</h2><p>Markers show agent positions reported in the last 15 minutes. Hover or select a pin to view the login profile.</p></div><span className="live-pill"><i/>{stats?.generatedAt?`Live · ${new Date(stats.generatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`:'Waiting for data'}</span></div>
    <div className="commuter-admin-map" aria-label={`${locatedAgents.length} active agent locations`}>
     {locatedAgents.map(agent=>{const risk=getRisk(agent);const details=agentDetails(agent);return <button key={agent._id} type="button" className={`commuter-admin-pin ${risk} ${String(agent._id)===selectedId?'selected':''}`} style={markerPosition(agent)} title={details} aria-label={details} onMouseEnter={()=>setSelectedId(String(agent._id))} onFocus={()=>setSelectedId(String(agent._id))} onClick={()=>setSelectedId(String(agent._id))}><MapPin size={22} strokeWidth={2} aria-hidden="true"/></button>})}
     {!loading&&!locatedAgents.length&&<div className="commuter-admin-empty">No recently active agents have a mapped location.</div>}
     <div className="commuter-admin-map-note">Last 15 minutes - agent login emails are visible to administrators only.</div>
    </div>
   </section>
   <aside className="panel commuter-admin-agent-panel"><div className="panel-heading"><div><h2>Agent details</h2><p>{selected?'Selected agent login profile':'Hover over a map pin'}</p></div></div>
    {selected?<dl className="commuter-agent-details"><div><dt>Name</dt><dd>{selected.name||'Agent'}</dd></div><div><dt>Username</dt><dd>{selected.agent_id||'Not assigned'}</dd></div><div><dt>Login email</dt><dd>{selected.mobileEmail||'No mobile login'}</dd></div><div><dt>Phone</dt><dd>{selected.phone||'Not provided'}</dd></div><div><dt>Area</dt><dd>{selected.place||'Not provided'}</dd></div><div><dt>Zone</dt><dd>{selected.zone||'Not assigned'}</dd></div><div><dt>Account</dt><dd><span className={`table-status ${selected.mobileLoginActive?'healthy':'offline'}`}>{selected.mobileLoginActive?'Enabled':'Disabled'}</span></dd></div><div><dt>Agent status</dt><dd>{selected.status||'Unknown'}</dd></div><div><dt>Last seen</dt><dd>{selected.lastSeenAt?new Date(selected.lastSeenAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Not available'}</dd></div></dl>:<p className="commuter-admin-empty-details">Agent login details will appear here when you select a map pin.</p>}
   </aside>
  </div>
 </section>;
}

function SettlementReports({reports,onReview}) {
 return <section className="panel table-panel settlement-report-panel">
  <div className="panel-heading"><div><h2>Agent bank-slip settlements</h2><p>Verify the bank slip before approving replacement float. Reported use is calculated from recorded ticket sales.</p></div></div>
  <div className="table-scroll"><table><thead><tr><th>SUBMITTED</th><th>AGENT</th><th>RECORDED USE</th><th>BANK DEPOSIT</th><th>BANK REFERENCE</th><th>STATUS</th><th>PROOF / REVIEW</th></tr></thead><tbody>
   {reports.map(report=><tr key={report._id}>
    <td>{new Date(report.createdAt).toLocaleString('en-GB')}</td>
    <td><b>{report.agent?.name||'Agent'}</b><small>{report.agent?.agent_id||report.agent?.place||report.agent?.zone||''}</small></td>
    <td><strong>{money(report.usedFloat)}</strong></td>
    <td><strong>{money(report.depositAmount)}</strong></td>
    <td>{report.bankReference}{report.notes&&<small>{report.notes}</small>}</td>
    <td><span className={`table-status ${report.status==='approved'?'healthy':report.status==='rejected'?'critical':'warning'}`}>{report.status}</span>{report.approvedFloat>0&&<small>Credited {money(report.approvedFloat)}</small>}{report.reviewNote&&<small>{report.reviewNote}</small>}</td>
    <td><a className="row-action" href={`/api/float-settlements/${report._id}/bank-slip`} target="_blank" rel="noreferrer">View bank slip</a>{report.status==='pending'&&<div className="settlement-actions"><button className="row-action" onClick={()=>onReview(report,'approved')}>Verify &amp; credit</button><button className="row-action reject-action" onClick={()=>onReview(report,'rejected')}>Reject</button></div>}</td>
   </tr>)}
  </tbody></table>{!reports.length&&<p className="empty-table">No agent settlement reports submitted.</p>}</div>
 </section>
}

function AgentMessagesInbox({messages,dispatches,onAssign,onOpenDispatch}){
 const activeDispatchForAlert=alert=>dispatches.find(dispatch=>String(dispatch.alert?._id||dispatch.alert)===String(alert._id));
 return <section className="panel agent-inbox">
  <div className="panel-heading"><div><h2>Messages from agents</h2><p>Support requests and automatic low-float alerts. Admins review requests and choose a distributor to assign.</p></div><span className="heading-count">{messages.length}</span></div>
  {messages.length?messages.map(alert=>{
   const assigned=activeDispatchForAlert(alert);
   const agent=alert.agent||{};
   return <article className="agent-inbox-message" key={alert._id}>
    <div className="agent-inbox-message-head">
     <div><b>{agent.name||'Agent'}</b><small>{agent.place||agent.zone||'Location not provided'}{agent.phone?`  -  ${agent.phone}`:''}</small></div>
     <div className="agent-inbox-meta"><span className={`table-status ${alert.state==='resolved'?'healthy':alert.state==='dispatched'?'warning':'critical'}`}>{alert.state==='dispatched'?'Assigned':alert.state==='open'?'Awaiting admin':alert.state}</span><time>{alert.triggeredAt?new Date(alert.triggeredAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'-'}</time></div>
    </div>
    <p>{alert.message}</p>
    <div className="agent-inbox-footer"><span>Float at alert: <b>{money(alert.balanceAtTrigger??agent.floatBalance)}</b>{assigned?.distributor?.name?`  -  Assigned to ${assigned.distributor.name}`:''}</span>
    {alert.state==='open'?<button className="inbox-assign-button" type="button" onClick={()=>onAssign(alert)}>Choose &amp; assign distributor</button>:assigned?<button className="inbox-view-button" type="button" onClick={onOpenDispatch}>View dispatch</button>:null}
    </div>
   </article>;
  }):<p className="empty-table">Agent support messages and low-float alerts will appear here. New messages arrive in real time.</p>}
 </section>
}

function AdminChatCenter({agents,distributors,superagents,onSendMessage}){
 const [selectedContact,setSelectedContact]=useState('');
 const [text,setText]=useState('');
 const [sending,setSending]=useState(false);
 const contacts=[
  ...agents.map(conversation=>({key:`agent:${conversation.agent?._id}`,type:'agent',field:'agent',conversation,name:conversation.agent?.name||'Agent',detail:conversation.agent?.place||conversation.email})),
  ...distributors.map(conversation=>({key:`distributor:${conversation.distributor?._id}`,type:'distributor',field:'distributor',conversation,name:conversation.distributor?.name||'Distributor',detail:conversation.distributor?.place||conversation.email})),
  ...superagents.map(conversation=>({key:`superagent:${conversation.superagent?._id}`,type:'superagent',field:'superagent',conversation,name:conversation.superagent?.name||'Superagent',detail:conversation.superagent?.email}))
 ];
 const selected=contacts.find(contact=>contact.key===selectedContact)||contacts[0];
 useEffect(()=>{if(selected&&!contacts.some(contact=>contact.key===selectedContact))setSelectedContact(selected.key)},[selectedContact,agents,distributors,superagents]);
 const send=async event=>{
  event.preventDefault();
  const message=text.trim();
  if(!message||!selected||sending)return;
  setSending(true);
  if(await onSendMessage(selected.type,selected.conversation[selected.field]?._id,message))setText('');
  setSending(false);
 };
 return <section className="panel distributor-inbox admin-chat-center">
  <aside className="distributor-inbox-list">
   <div className="panel-heading"><div><h2>Network contacts</h2><p>Select an agent, distributor, or Superagent to open their private chat.</p></div></div>
   <label className="profile-form">Recipient
    <select aria-label="Choose chat recipient" value={selected?.key||''} onChange={event=>setSelectedContact(event.target.value)}>
     {!contacts.length&&<option value="">No active staff accounts</option>}
     {agents.length>0&&<optgroup label="Agents">{agents.map(item=><option key={`agent:${item.agent?._id}`} value={`agent:${item.agent?._id}`}>{item.agent?.name||item.email}</option>)}</optgroup>}
     {distributors.length>0&&<optgroup label="Distributors">{distributors.map(item=><option key={`distributor:${item.distributor?._id}`} value={`distributor:${item.distributor?._id}`}>{item.distributor?.name||item.email}</option>)}</optgroup>}
     {superagents.length>0&&<optgroup label="Superagents">{superagents.map(item=><option key={`superagent:${item.superagent?._id}`} value={`superagent:${item.superagent?._id}`}>{item.superagent?.name||item.superagent?.email}</option>)}</optgroup>}
    </select>
   </label>
  </aside>
  {selected?<div className="distributor-inbox-thread">
   <header className="distributor-inbox-thread-head"><span className="distributor-inbox-avatar">{selected.name.slice(0,1).toUpperCase()}</span><div><b>{selected.name}</b><small>{selected.detail}</small></div></header>
   <div className="distributor-inbox-thread-body" aria-live="polite">
    {selected.conversation.messages?.length?selected.conversation.messages.map((message,index)=><div className={`dispatch-message ${message.sender==='admin'?'admin-message':'distributor-message'}`} key={`${message.sentAt}-${index}`}><b>{message.senderName|| (message.sender==='admin'?'Operations':selected.type)}</b><span>{message.text}</span><small>{message.sentAt?new Date(message.sentAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):''}</small></div>):<p className="distributor-inbox-empty">No messages yet. Send a message to start the private conversation.</p>}
   </div>
   <form className="distributor-inbox-compose" onSubmit={send}><input aria-label={`Message to ${selected.name}`} value={text} onChange={event=>setText(event.target.value)} maxLength={500} placeholder={`Message ${selected.name}...`}/><button className="primary-button" type="submit" disabled={!text.trim()||sending}>{sending?'Sending...':'Send'}</button></form>
  </div>:<div className="distributor-inbox-thread distributor-inbox-empty">No active staff contacts are available.</div>}
 </section>
}

function SuperagentDeletionRequests({requests,onRefresh,onMessage}){
 const [notes,setNotes]=useState({});const [busyId,setBusyId]=useState('');
 const review=async(request,status)=>{
  const reviewNote=(notes[request._id]||'').trim();
  if(status==='rejected'&&!reviewNote){onMessage('Give a reason before rejecting the deletion request.');return}
  setBusyId(request._id);
  try{
   const response=await apiFetch(`/api/admin/superagent-deletion-requests/${request._id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,reviewNote})});
   const result=await responseData(response,'Superagent deletion review');if(!response.ok)throw Error(result.error||'Unable to review deletion request.');
   onMessage(status==='approved'?`Deletion request approved for ${result.agent?.name||'Agent'}. The Superagent can now delete the agent.`:'Deletion request rejected; the agent remains active.');
   await onRefresh();
  }catch(error){onMessage(error.message)}finally{setBusyId('')}
 };
 return <section className="panel superagent-requests-panel">
  <div className="panel-heading"><div><h2>Agent deletion requests</h2><p>Review the Superagent's reason. Approval gives that Superagent permission to archive the agent; the agent remains active until the Superagent confirms deletion.</p></div><span className="table-status warning">{requests.filter(request=>request.status==='pending').length} pending</span></div>
  {requests.map(request=><article className="superagent-request-card" key={request._id}>
   <header><div><b>{request.agent?.name||'Agent profile'}</b><small>{request.agent?.agent_id||'-'}  -  Requested by {request.superagent?.name||request.superagent?.email||'Superagent'}</small></div><span className={`table-status ${request.status==='pending'?'warning':request.status==='approved'?'healthy':'critical'}`}>{request.status}</span></header>
   <p><b>Reason:</b> {request.reason}</p>
   {request.reviewNote&&<p><b>Admin response:</b> {request.reviewNote}</p>}
   <small>{request.createdAt?new Date(request.createdAt).toLocaleString('en-GB'):''}</small>
   {request.status==='pending'&&<div className="superagent-review-actions">
    <label>Rejection reason (required to reject)<textarea maxLength="500" value={notes[request._id]||''} onChange={event=>setNotes(current=>({...current,[request._id]:event.target.value}))} placeholder="Explain why this agent should remain active."/></label>
    <div><button className="row-action reject-action" disabled={busyId===request._id||!notes[request._id]?.trim()} onClick={()=>review(request,'rejected')}>{busyId===request._id?'Saving...':'Reject request'}</button><button className="row-action" disabled={busyId===request._id} onClick={()=>review(request,'approved')}>{busyId===request._id?'Saving...':'Approve deletion'}</button></div>
   </div>}
  </article>)}
  {!requests.length&&<p className="empty-table">No Superagent deletion requests yet.</p>}
 </section>
}

function AlternateView({view,title,agents,distributors,alerts,agentMessages,agentConversations,distributorConversations,superagentConversations,superagentDeletionRequests,dispatches,completedDispatches,settlements,onReviewSettlement,heatmap,analytics,connected,onNewDispatch,onAssignAgent,onSelectAlert,onOpenDispatch,onSendAgentAdminMessage,onSendDistributorMessage,onSendSuperagentMessage,onRefresh,onMessage}){
 const [zoneFilter,setZoneFilter]=useState('all');const [agentSort,setAgentSort]=useState('float-low');
 const [profileEditor,setProfileEditor]=useState(null);const [includeArchived,setIncludeArchived]=useState(false);const [archivedRecords,setArchivedRecords]=useState([]);
 const [zoneAgents,setZoneAgents]=useState([]);
 useEffect(()=>{
  if(view!=='agents')return;
  let active=true;
  apiFetch('/api/agents?includeArchived=true').then(response=>{if(!response.ok)throw Error('Unable to load the complete agent zone list.');return response.json()}).then(records=>{if(active)setZoneAgents(records)}).catch(error=>onMessage(error.message));
  return()=>{active=false};
 },[view,onMessage]);
 const zones=useMemo(()=>[...new Set(['Zone 1','Zone 2',...agents.map(a=>a.zone),...zoneAgents.map(a=>a.zone),...archivedRecords.map(a=>a.zone)].filter(Boolean))].sort((a,b)=>a.localeCompare(b)),[agents,zoneAgents,archivedRecords]);
 const role=view==='agents'?'agent':'distributor';const kind=role==='agent'?'agents':'distributors';
 useEffect(()=>{setProfileEditor(null);setIncludeArchived(false);setArchivedRecords([])},[view]);
 useEffect(()=>{
  if(!includeArchived||!['agents','distributors'].includes(view))return;
  let active=true;
  apiFetch(`/api/${kind}?includeArchived=true`).then(response=>{if(!response.ok)throw Error('Unable to load archived profiles.');return response.json()}).then(records=>{if(active)setArchivedRecords(records)}).catch(error=>onMessage(error.message));
  return()=>{active=false};
 },[includeArchived,view,kind,onMessage]);
 const listed=includeArchived?archivedRecords:(role==='agent'?agents:distributors);
 const filtered=useMemo(()=>agents.filter(a=>zoneFilter==='all'||a.zone===zoneFilter).sort((a,b)=>{
  if(agentSort==='float-high')return (b.floatBalance??0)-(a.floatBalance??0);
  if(agentSort==='commuter-sales')return (b.commuterSales30d??0)-(a.commuterSales30d??0);
  if(agentSort==='name')return a.name.localeCompare(b.name);
  return (a.floatBalance??0)-(b.floatBalance??0);
 }),[agents,zoneFilter,agentSort]);
 const archiveProfile=async record=>{
  const action=record.archivedAt?'restore':'archive';
  if(!window.confirm(`${action==='archive'?'Archive':'Restore'} ${record.name}? ${action==='archive'?'This disables their mobile login and keeps their financial history.':'Their mobile login will remain disabled until an admin re-enables it.'}`))return;
  try{
   const url=`/api/admin/${kind}/${record._id}/archive`;
   const response=await apiFetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:action==='archive'})});
   const data=await response.json();if(!response.ok)throw Error(data.error||`Unable to ${action} profile.`);
   onMessage(action==='archive'?'Profile archived; login disabled and history retained.':'Profile restored; re-enable mobile access in Settings if needed.');
   if(includeArchived){const refreshed=await apiFetch(`/api/${kind}?includeArchived=true`);setArchivedRecords(await refreshed.json())}
   onRefresh();
  }catch(error){onMessage(error.message)}
 };
 const sendDispatchMessage=async(dispatch,text)=>{try{const response=await apiFetch(`/api/dispatches/${dispatch._id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});const data=await responseData(response,'Dispatch messaging');if(!response.ok)throw Error(data.error);onMessage('Message sent to distributor.');onRefresh();return true}catch(error){onMessage(error.message);return false}};
 return <section className="page-content alternate-view"><div className="page-heading"> <div><div className="eyebrow"><span className="pulse"/> NETWORK OPERATIONS</div><h1>{title}</h1><p>{view==='agents'?'Create and manage agent profiles, mobile credentials, and operating locations.':view==='distributors'?'Create and manage distributor profiles, mobile credentials, and operating locations.':view==='dispatch'?'Approve agent float requests by assigning a distributor, then review collected sales and delivered replacement float.':view==='agentMessages'?'Review float-support requests and low-float alerts sent by agents.':view==='chats'?'Choose an agent, distributor, or Superagent to open a private conversation.':view==='superagentRequests'?'Review deletion requests submitted by Superagents. Admin approval grants permission to archive; the Superagent must confirm deletion before the agent is archived.':view==='liquidity'?'Identify low-float clusters and network demand by operating zone.':view==='reports'?'Review bank settlements, operational events, and regional liquidity.':'Commuters use the Tap & Go mobile app to locate active nearby agents.'}</p></div>{view==='agents'||view==='distributors'?<button className="primary-button" onClick={()=>setProfileEditor({role,record:null})}><span></span> Add {role}</button>:view==='agentMessages'||view==='chats'||view==='superagentRequests'?<button className="subtle-button" onClick={onRefresh}>Refresh</button>:view!=='commuters'&&<button className="primary-button" onClick={onNewDispatch}><span></span> New dispatch</button>}</div>
 {view==='agentMessages'&&<AgentMessagesInbox messages={agentMessages} dispatches={dispatches} onAssign={onSelectAlert} onOpenDispatch={onOpenDispatch}/>}
 {view==='chats'&&<AdminChatCenter agents={agentConversations} distributors={distributorConversations} superagents={superagentConversations} onSendMessage={(type,id,text)=>type==='agent'?onSendAgentAdminMessage(id,text):type==='distributor'?onSendDistributorMessage(id,text):onSendSuperagentMessage(id,text)}/>}
 {view==='superagentRequests'&&<SuperagentDeletionRequests requests={superagentDeletionRequests} onRefresh={onRefresh} onMessage={onMessage}/>}
 {(view==='agents'||view==='distributors')&&profileEditor&&<NetworkProfileForm key={`${profileEditor.role}-${profileEditor.record?._id||'new'}`} role={profileEditor.role} record={profileEditor.record} zoneOptions={zones} onCancel={()=>setProfileEditor(null)} onSaved={async savedProfile=>{setProfileEditor(null);if(savedProfile?.zone)setZoneAgents(current=>[...current.filter(agent=>agent._id!==savedProfile._id),savedProfile]);onRefresh();if(includeArchived){try{const response=await apiFetch(`/api/${kind}?includeArchived=true`);if(!response.ok)throw Error('Profile saved, but the archived list could not be refreshed.');setArchivedRecords(await response.json())}catch(error){onMessage(error.message)}}}} onMessage={onMessage}/>}
 {(view==='agents'||view==='distributors')&&<section className="panel table-panel network-crud-panel">
  <div className="panel-heading"><div><h2>{role==='agent'?'Agent':'Distributor'} profiles &amp; mobile logins</h2><p>Create a profile with email/password access, update it, or archive it while keeping historical records.</p></div><label className="archive-toggle"><input type="checkbox" checked={includeArchived} onChange={event=>setIncludeArchived(event.target.checked)}/> Show archived</label></div>
  <div className="table-scroll"><table><thead><tr><th>NAME / ID</th><th>PHONE</th><th>AREA</th><th>ZONE</th><th>MOBILE LOGIN</th><th>STATUS</th>{role==='distributor'&&<th>SHIFT STARTED</th>}<th>ADMIN ACTIONS</th></tr></thead><tbody>
   {listed.map(record=><tr key={record._id}>
    <td><b>{record.name}</b><small>ID {displayRecordId(role==='agent'?record.agent_id||record._id:record.distributor_id||record._id)}</small></td>
    <td>{record.phone||'-'}</td><td>{record.place||'-'}</td><td>{record.zone||'-'}</td>
    <td>{record.mobileEmail?<><b className="network-login-email">{record.mobileEmail}</b><small>{record.mobileLoginActive?'Enabled':'Disabled'}</small></>:'Not provisioned'}</td>
    <td>{record.archivedAt?'Archived':record.status}</td>
    {role==='distributor'&&<td>{record.dutyStartedAt?new Date(record.dutyStartedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'-'}{record.dutyStartedAt&&<small>{record.status==='offline'?'Last shift started':'On duty since'}</small>}</td>}
    <td className="crud-actions">{!record.archivedAt&&<button className="row-action" onClick={()=>setProfileEditor({role,record})}>Edit</button>}<button className={`row-action ${record.archivedAt?'':'reject-action'}`} onClick={()=>archiveProfile(record)}>{record.archivedAt?'Restore':'Archive'}</button></td>
   </tr>)}
  </tbody></table>{!listed.length&&<p className="empty-table">No {role} profiles yet. Use Add {role} to create a profile and linked login.</p>}</div>
 </section>}
 {view==='agents'&&<><div className="panel table-panel agent-directory-panel"><div className="panel-heading"><div><h2>Agent directory</h2><p>{agents.length} registered devices  -  {agents.filter(a=>a.status==='active'||a.status==='at_risk').length} currently active  -  green / yellow / red indicate high / medium / low float. Shift time starts when an agent goes on duty; the last shift and cumulative tracked hours are shown.</p></div><div className="row-filters"><select aria-label="Filter agents by zone" className="table-filter" value={zoneFilter} onChange={e=>setZoneFilter(e.target.value)}><option value="all">All zones</option>{zones.map(zone=><option key={zone}>{zone}</option>)}</select><select aria-label="Sort agents" className="table-filter" value={agentSort} onChange={e=>setAgentSort(e.target.value)}><option value="float-low">Lowest float first</option><option value="float-high">Highest float first</option><option value="commuter-sales">Most commuter sales (30d)</option><option value="name">Name A-Z</option></select></div></div><div className="table-scroll"><table><thead><tr><th>AGENT</th><th>LOCATION</th><th>FLOAT BALANCE</th><th>LIQUIDITY</th><th>COMMUTER SALES (30D)</th><th>DEVICE STATUS</th><th>SHIFT DURATION</th><th>LAST SEEN</th><th>FLOAT SUPPORT</th></tr></thead><tbody>{filtered.map(agent=>{const assigned=dispatches.find(item=>String(item.agent?._id||item.agent)===String(agent._id));const hasLocation=validAgentLocation(agent.location);return <tr key={agent._id}><td><b>{agent.name}</b><small>{agent.agent_id||agent._id}</small></td><td>{agent.place||agent.zone||'-'}</td><td><strong>{money(agent.floatBalance??agent.current_float)}</strong></td><td><span className={`table-status ${getRisk(agent)}`}>{getRisk(agent)==='critical'?'Low':getRisk(agent)==='warning'?'Medium':'High'}</span></td><td title={`${agent.commuterTransactions30d||0} recorded ticket sales in the last 30 days`}><strong>{money(agent.commuterSales30d||0)}</strong><small>{agent.commuterTransactions30d||0} ticket sales</small></td><td>{agent.status==='offline'?'Offline':agent.status==='at_risk'?'At risk':'Active'}</td><td><strong>{currentShiftDuration(agent)}</strong><small>{agent.shiftStartedAt&&agent.status!=='offline'?'Current shift':Number(agent.lastShiftSeconds)>0?'Last shift':'No tracked shift'}  -  total {formatShiftDuration(agent.shiftSeconds)}</small></td><td>{agent.lastSeenAt?new Date(agent.lastSeenAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'-'}</td><td>{assigned?<button className="row-action" onClick={onOpenDispatch}>Assigned  -  view</button>:<button className="row-action" disabled={!hasLocation} title={!hasLocation?'Agent location is required to find a nearby distributor.':'Assign a nearby distributor and send an urgent float-transfer message.'} onClick={()=>onAssignAgent(agent)}>Assign distributor</button>}</td></tr>})}</tbody></table>{!filtered.length&&<p className="empty-table">No matching agents yet. Seed the database or register agents from the API.</p>}</div></div></>}
 {view==='dispatch'&&<>
  <div className="metrics-grid dispatch-metrics"><Metric label="Open SOS alerts" value={alerts.length} accent="orange"/><Metric label="Active assignments" value={dispatches.length} accent="green"/><Metric label="Available distributors" value={distributors.filter(d=>d.status==='available').length} accent="blue"/><Metric label="Assignment control" value="Admin selects" accent="purple"/></div>
  {alerts.length>0&&<div className="dispatch-admin-tip"><b>Admin action required</b><span>Choose <strong>Choose &amp; assign</strong> on an open SOS. Eligible distributors must be on duty, signed in, sharing recent GPS, and within 500 m. Assignments are never automatic.</span></div>}
  <div className="panel table-panel dispatch-board"><div className="panel-heading"><div><h2>Field dispatch board</h2><p>Choose an eligible distributor within 500 m; they enter the amount actually delivered in the mobile app.</p></div></div><div className="table-scroll"><table><thead><tr><th>STATUS</th><th>AGENT</th><th>DISTRIBUTOR</th><th>ROUTE DISTANCE</th><th>ASSIGNED</th><th>ACTION</th></tr></thead><tbody>{dispatches.map(item=><tr key={item._id}><td><span className="table-status warning">{item.status.replace('_',' ')}</span></td><td><b>{item.agent?.name||'Agent'}</b><small>{item.agent?.place||item.agent?.zone}</small>{item.alert?.message&&<small>Agent message: {item.alert.message}</small>}</td><td>{item.distributor?.name||'Distributor'}</td><td>{item.routeDistanceMeters?`${(item.routeDistanceMeters/1000).toFixed(1)} km`:`${(item.distanceMeters/1000).toFixed(1)} km`}<small>{item.routeSource==='road'?'Road route':'Direct distance'}</small></td><td>{new Date(item.assignedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td><span className="table-status warning">Awaiting distributor</span></td></tr>)}{alerts.map(alert=><tr key={alert._id}><td><span className="table-status critical">SOS  -  AWAITING ADMIN</span></td><td><b>{alert.agent?.name||'Agent'}</b><small>{alert.agent?.place||alert.agent?.zone}</small>{alert.message&&<small>Agent message: {alert.message}</small>}</td><td>Not assigned</td><td>-</td><td>{new Date(alert.triggeredAt||alert.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td><button className="row-action" onClick={()=>onSelectAlert(alert)}>Choose &amp; assign</button></td></tr>)}</tbody></table>{!dispatches.length&&!alerts.length&&<p className="empty-table">No active dispatches or SOS alerts.</p>}</div></div>
  <div className="panel table-panel dispatch-board"><div className="panel-heading"><div><h2>Recent completed top-ups</h2><p>Collected sales are recorded as ticket sales; only replacement float delivered is credited to agent POS.</p></div></div><div className="table-scroll"><table><thead><tr><th>COMPLETED</th><th>AGENT</th><th>DISTRIBUTOR</th><th>SALES COLLECTED</th><th>REPLACEMENT FLOAT</th><th>POS FLOAT AFTER</th></tr></thead><tbody>{completedDispatches.map(item=><tr key={`completed-${item._id}`}><td>{item.completedAt?new Date(item.completedAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'-'}</td><td><b>{item.agent?.name||'Agent'}</b><small>{item.agent?.place||item.agent?.zone||''}</small></td><td>{item.distributor?.name||'Distributor'}</td><td><strong>{money(item.salesCollected||0)}</strong></td><td><strong>{Number.isFinite(item.amountAdded)?money(item.amountAdded):'Amount unavailable'}</strong></td><td>{Number.isFinite(item.floatBalanceAfter)?money(item.floatBalanceAfter):'-'}</td></tr>)}</tbody></table>{!completedDispatches.length&&<p className="empty-table">Completed distributor reports will appear here with collected sales, delivered replacement float, and updated POS.</p>}</div></div>
 </>}
 {view==='dispatch'&&<section className="panel table-panel dispatch-messages-panel"><div className="panel-heading"><div><h2>Messages with distributors</h2><p>Reply to field updates and coordinate each float transfer.</p></div></div>{dispatches.length?dispatches.map(item=><article className="dispatch-conversation-row" key={`conversation-${item._id}`}><div className="dispatch-conversation-heading"><b>{item.distributor?.name||'Distributor'} <span>to</span> {item.agent?.name||'Agent'}</b><small>{item.agent?.zone||item.agent?.place||'Agent location'}  -  {item.messages?.length||0} messages</small></div><DispatchConversation dispatch={item} onSendMessage={sendDispatchMessage}/></article>):<p className="empty-table">Messages will appear when a distributor is assigned.</p>}</section>}
 {view==='liquidity'&&<><div className="panel map-panel liquidity-map-panel"><div className="panel-heading"><div><h2>Live liquidity heatmap</h2><p>Agent float distribution and recent transaction activity</p></div><span className="live-pill"><i/>Updated {heatmap?.generatedAt?new Date(heatmap.generatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'-'}</span></div><div className="map-wrap"><div className="map-canvas"><MapArtwork agents={agents} distributors={distributors} onSelect={()=>{}}/><div className="heatmap-caption"><span className="heat-low"/>Low float <span className="heat-mid"/>Medium float <span className="heat-high"/>High float</div></div></div></div><div className="zone-grid">{(analytics?.zoneRisks||[]).map(zone=><div className="zone-card" key={zone._id||'unassigned'}><span>{zone._id||'Unassigned zone'}</span><b>{money(zone.float)}</b><small>{zone.agents} agents  -  {zone.atRisk} at risk</small><div className="zone-bar"><i style={{width:`${Math.min(100,zone.float/Math.max(1,analytics.zoneRisks.reduce((max,z)=>Math.max(max,z.float),0))*100)}%`}}/></div></div>)}</div></>}
 {view==='reports'&&<><SettlementReports reports={settlements} onReview={onReviewSettlement}/><div className="metrics-grid"><Metric label="Events in period" value={analytics?.eventCount||0} accent="blue"/><Metric label="Completed dispatches" value={analytics?.dispatchResponse?.count||0} accent="green"/><Metric label="Average response" value={analytics?.dispatchResponse?.averageResponseMinutes?`${Math.round(analytics.dispatchResponse.averageResponseMinutes)} min`:'-'} accent="purple"/><Metric label="Reporting window" value={`${analytics?.days||7} days`} accent="orange"/></div><div className="panel table-panel"><div className="panel-heading"><div><h2>Operational event timeline</h2><p>Alert, dispatch, replenishment, and commuter search events</p></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>EVENT TYPE</th><th>COUNT</th></tr></thead><tbody>{(analytics?.timeline||[]).map(item=><tr key={`${item._id.day}-${item._id.type}`}><td>{item._id.day}</td><td>{item._id.type.replaceAll('_',' ')}</td><td><b>{item.count}</b></td></tr>)}</tbody></table>{!analytics?.timeline?.length&&<p className="empty-table">Operational analytics will populate as network events arrive.</p>}</div></div><div className="zone-grid">{(analytics?.zoneRisks||[]).map(zone=><div className="zone-card" key={zone._id}><span>{zone._id||'Unassigned zone'}</span><b>{zone.atRisk} agents at risk</b><small>{money(zone.float)} float across {zone.agents} agents</small></div>)}</div></>}
 {view==='commuters'&&<AdminCommuterMap/>}
 </section>
}
function Metric({label,value,accent}){return <article className="metric-card"><div className="metric-top">{label}<span className={`metric-symbol ${accent}`}></span></div><div className="metric-value">{value}</div></article>}

function DispatchConversation({dispatch,onSendMessage}){
 const [text,setText]=useState('');
 const [sending,setSending]=useState(false);
 const send=async event=>{
  event.preventDefault();
  if(!text.trim()||sending)return;
  setSending(true);
  if(await onSendMessage(dispatch,text.trim()))setText('');
  setSending(false);
 };
 return <div className="dispatch-conversation">
  <div className="dispatch-message-list">{(dispatch.messages||[]).slice(-5).map((message,index)=><div className={`dispatch-message ${message.sender==='admin'?'admin-message':'distributor-message'}`} key={`${message.sentAt}-${index}`}><b>{message.senderName|| (message.sender==='admin'?'Operations':'Distributor')}</b><span>{message.text}</span><small>{message.sentAt?new Date(message.sentAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):''}</small></div>)}</div>
  <form className="dispatch-reply-form" onSubmit={send}><input aria-label="Message to distributor" value={text} onChange={event=>setText(event.target.value)} maxLength={500} placeholder="Reply to distributor..."/><button className="row-action" type="submit" disabled={!text.trim()||sending}>{sending?'Sending...':'Send'}</button></form>
 </div>;
}

export default App;
