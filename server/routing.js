const fallbackDistance=(a,b)=>{
  const rad=n=>n*Math.PI/180;const [lon1,lat1]=a,[lon2,lat2]=b;const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};

async function getRoute(from,to){
  const base=process.env.ROUTING_BASE_URL;
  if(!base)return {coordinates:[from,to],distanceMeters:fallbackDistance(from,to),durationSeconds:null,source:'geodesic'};
  try{
    const url=`${base.replace(/\/$/,'')}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson&steps=false`;
    const response=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`Routing provider returned ${response.status}`);
    const result=await response.json();const route=result.routes?.[0];if(!route?.geometry?.coordinates?.length)throw new Error('Routing provider returned no route.');
    return {coordinates:route.geometry.coordinates,distanceMeters:route.distance,durationSeconds:route.duration,source:'road'};
  }catch(error){console.warn('Road routing unavailable; using straight-line fallback:',error.message);return {coordinates:[from,to],distanceMeters:fallbackDistance(from,to),durationSeconds:null,source:'geodesic'};}
}
module.exports={getRoute};
