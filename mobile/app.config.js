export default ({config})=>{
  const plugins=[...(config.plugins||[]),'expo-secure-store'];
  if(process.env.GOOGLE_MAPS_API_KEY)plugins.push(['react-native-maps',{androidGoogleMapsApiKey:process.env.GOOGLE_MAPS_API_KEY}]);
  const apiBaseUrl=process.env.EXPO_PUBLIC_API_URL||config.extra?.apiBaseUrl||'https://tap-and-go-float-and-csn-backend.onrender.com';
  const usesLocalHttp=apiBaseUrl.startsWith('http://')||process.env.NODE_ENV!=='production';
  if(usesLocalHttp)plugins.push(['expo-build-properties',{android:{usesCleartextTraffic:true}}]);
  return {
    ...config,
    extra: {...config.extra,apiBaseUrl},
    plugins,
    ios:{...config.ios,infoPlist:{...config.ios?.infoPlist,...(usesLocalHttp?{NSAppTransportSecurity:{NSAllowsArbitraryLoadsLocalNetworking:true}}:{})}}
  };
};
