export default ({config})=>{
  const plugins=[...(config.plugins||[]),'expo-secure-store'];
  if(process.env.GOOGLE_MAPS_API_KEY)plugins.push(['react-native-maps',{androidGoogleMapsApiKey:process.env.GOOGLE_MAPS_API_KEY}]);
  const usesLocalHttp=(process.env.EXPO_PUBLIC_API_URL||'').startsWith('http://')||process.env.NODE_ENV!=='production';
  if(usesLocalHttp)plugins.push(['expo-build-properties',{android:{usesCleartextTraffic:true}}]);
  return {
    ...config,
    extra: {...config.extra,apiBaseUrl:process.env.EXPO_PUBLIC_API_URL||config.extra?.apiBaseUrl||''},
    plugins,
    ios:{...config.ios,infoPlist:{...config.ios?.infoPlist,...(usesLocalHttp?{NSAppTransportSecurity:{NSAllowsArbitraryLoadsLocalNetworking:true}}:{})}}
  };
};
