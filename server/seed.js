require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const { Agent, Distributor, Alert, Transaction } = require('./models');

const agents = [
  ['Maya Patel','Soho','Zone 1',-0.133,51.514,18],
  ['James Cole','Waterloo','Zone 2',-0.113,51.503,24],
  ['Ella Brooks',"King’s Cross",'Zone 1',-0.123,51.531,32],
  ['Oliver Reed','Shoreditch','Zone 1',-0.078,51.525,86],
  ['Aisha Khan','Paddington','Zone 1',-0.176,51.516,110],
  ['Noah Wright','London Bridge','Zone 2',-0.087,51.505,94],
  ['Isla Green','Covent Garden','Zone 1',-0.123,51.512,640],
  ['Leo Turner','Islington','Zone 2',-0.103,51.537,820],
  ['Sofia Ali','Victoria','Zone 1',-0.144,51.496,520],
  ['Theo James','Camden','Zone 2',-0.143,51.539,735]
];
const distributors = [
  ['Daniel Carter',-0.139,51.516],['Priya Sharma',-0.108,51.500],
  ['Marcus Lee',-0.087,51.526],['Grace Wilson',-0.16,51.53],['Ethan Brown',-0.10,51.48]
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tap_and_go');
  const threshold=Number(process.env.SOS_THRESHOLD_RWF||process.env.SOS_THRESHOLD_GBP||40);
  const alertAgents=[];
  for (const [index,[name,place,zone,longitude,latitude,floatBalance]] of agents.entries()) {
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    const agentType=index<5?'mobile':'fixed';
    const floatReference=floatBalance;
    const lowThreshold=Math.max(10000,floatReference*0.1,threshold);
    const agent=await Agent.findOneAndUpdate({name},{ $setOnInsert:{agent_id:`agent-${id}`,agentType,agent_type:agentType,place,zone,floatBalance,current_float:floatBalance,floatReference,liquidityStatus:floatBalance<=0?'empty':floatBalance<=lowThreshold?'low':'high',safeThreshold:threshold,status:floatBalance<=lowThreshold?'at_risk':'active',location:{type:'Point',coordinates:[longitude,latitude]},lastSeenAt:new Date(),last_updated:new Date()} },{upsert:true,new:true,setDefaultsOnInsert:true});
    if(agent.floatBalance<=Math.max(10000,(agent.floatReference||0)*0.1,agent.safeThreshold||threshold))alertAgents.push(agent);
    await Transaction.updateOne({agent:agent._id,kind:'ticket_sale',amount:4.8},{ $setOnInsert:{occurredAt:new Date()} },{upsert:true});
  }
  for(const [name,longitude,latitude] of distributors){const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-');await Distributor.findOneAndUpdate({name},{ $setOnInsert:{distributor_id:`dist-${id}`,full_name:name,status:'available',duty_state:'active',assigned_tasks:[],location:{type:'Point',coordinates:[longitude,latitude]},live_location:{type:'Point',coordinates:[longitude,latitude]},lastSeenAt:new Date()} },{upsert:true,new:true,setDefaultsOnInsert:true})}
  for(const agent of alertAgents){const existing=await Alert.findOne({agent:agent._id,state:{$in:['open','dispatched']}});if(!existing)await Alert.create({alert_id:require('crypto').randomUUID(),agent:agent._id,agent_ref_id:String(agent._id),balanceAtTrigger:agent.floatBalance,location:agent.location,severity:agent.floatBalance<=0?'critical':'warning'});}
  console.log(`Seeded ${agents.length} agents, ${distributors.length} distributors, and open SOS alerts for at-risk agents.`);
  await mongoose.disconnect();
}
seed().catch(async error=>{console.error(error);await mongoose.disconnect().catch(()=>{});process.exitCode=1});
