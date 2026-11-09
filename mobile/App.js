import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Platform, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { io } from 'socket.io-client';

const expoHost = Constants.expoConfig?.hostUri?.split(':')[0] ||
  Constants.manifest?.debuggerHost?.split(':')[0];
const API = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '') ||
  (expoHost ? `http://${expoHost}:3000` :
    Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
const TRACKING_TASK = 'tap-and-go-location';
const LOCATION_PERMISSION_DENIED = 'TAPGO_LOCATION_PERMISSION_DENIED';
const london = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.085, longitudeDelta: 0.085 };
const currency = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
const commuterCopy = {
  en: {
    role: 'Commuter', title: 'Find an agent', subtitle: 'Nearby ticket top-ups, without the guesswork.',
    header: 'NETWORK SUPPORT', live: 'LIVE', footer: 'Tap & Go · London network', agentFallback: 'Tap & Go agent',
    guide: null,
    find: '◎  Find active agents near me', searching: 'Finding nearby agents…',
    nearby: 'Nearby agents', findTopUps: 'Find ticket top-ups nearby',
    noneTitle: 'No active agents found nearby',
    noneBody: 'Try again later or move closer to another area. Agents must be recently active and have float available.',
    active: 'Active now', away: 'away', directions: 'Get directions →',
    agentsFound: count => `${count} active agent${count === 1 ? '' : 's'} found within 500 m`,
    showingNearest: count => `Showing the ${count} nearest agents.`,
    availability: 'Float availability',
    legend: 'What the float colors mean',
    high: 'Green · High', highMeaning: 'Above twice the safe-float threshold; usually ready to serve.',
    medium: 'Yellow · Medium', mediumMeaning: 'Above the safe threshold, but getting lower; consider another agent if convenient.',
    low: 'Red · Low', lowMeaning: 'At or below the safe threshold; the agent may be unable to complete a top-up.',
    colorNote: 'Colors show an availability band only, not the agent’s exact float balance. Tap an agent for directions.',
    searchResult: count => `${count} active agents within 500 m.`,
    locationDenied: 'Allow location access to find nearby agents.',
    locationError: 'Could not find your location. Check location services and try again.',
    markerActive: 'Active', float: 'float', levelHigh: 'high', levelMedium: 'medium', levelLow: 'low',
    distanceUnavailable: 'Distance unavailable', radius: '500 m'
  },
  rw: {
    role: 'Umugenzi', title: 'Shaka umukozi', subtitle: 'Shaka aho wakwongera amafaranga yo kugura amatike hafi yawe.',
    header: 'UBUFASHA BW’URUSOBE', live: 'BIRI GUKORA', footer: 'Tap & Go · Urusobe rw’i Londres', agentFallback: 'Umukozi wa Tap & Go',
    guide: null,
    find: '◎  Shaka abakozi bakora hafi yanjye', searching: 'Turimo gushaka abakozi hafi yawe…',
    nearby: 'Abakozi bakwegereye', findTopUps: 'Shaka aho wakwongera amafaranga yo kugura amatike',
    noneTitle: 'Nta bakozi bakora babonetse hafi yawe',
    noneBody: 'Ongera ugerageze nyuma cyangwa wegere ahandi. Umukozi agomba kuba aherutse gukora kandi afite amafaranga yo kugurisha.',
    active: 'Arakora ubu', away: 'kuva aha', directions: 'Reba inzira →',
    agentsFound: count => `Abakozi bakora babonetse muri metero 500: ${count}`,
    showingNearest: count => `Hagaragajwe abakozi ${count} bakwegereye kurusha abandi.`,
    availability: 'Amafaranga yo kugurisha asigaye',
    legend: 'Ibisobanuro by’amabara y’amafaranga yo kugurisha',
    high: 'Icyatsi · Menshi', highMeaning: 'Ari hejuru yikubye kabiri igipimo fatizo; ashobora kuba yiteguye kugufasha.',
    medium: 'Umuhondo · Hagati', mediumMeaning: 'Ari hejuru y’igipimo fatizo ariko agenda agabanuka; ushobora kugerageza undi mukozi.',
    low: 'Umutuku · Make', lowMeaning: 'Ari ku gipimo fatizo cyangwa munsi yacyo; ashobora kutabasha kukugurishiriza.',
    colorNote: 'Amabara agaragaza urwego gusa, ntabwo agaragaza amafaranga nyayo. Kanda ku mukozi urebe inzira.',
    searchResult: count => `Abakozi bakora babonetse muri metero 500: ${count}.`,
    locationDenied: 'Emera ko porogaramu ikoresha aho uri kugira ngo ibone abakozi bakwegereye.',
    locationError: 'Ntitwabashije kubona aho uri. Reba niba GPS ifunguye wongere ugerageze.',
    markerActive: 'Arakora', float: 'amafaranga yo kugurisha', levelHigh: 'menshi', levelMedium: 'ari hagati', levelLow: 'make',
    distanceUnavailable: 'Intera ntizwi', radius: 'metero 500'
  },
  fr: {
    role: 'Voyageur', title: 'Trouver un agent', subtitle: 'Trouvez facilement un point de recharge de titres de transport à proximité.',
    header: 'ASSISTANCE RÉSEAU', live: 'EN DIRECT', footer: 'Tap & Go · Réseau de Londres', agentFallback: 'Agent Tap & Go',
    guide: null,
    find: '◎  Trouver des agents actifs près de moi', searching: 'Recherche des agents à proximité…',
    nearby: 'Agents à proximité', findTopUps: 'Trouver un point de recharge à proximité',
    noneTitle: 'Aucun agent actif trouvé à proximité',
    noneBody: 'Réessayez plus tard ou rapprochez-vous d’un autre quartier. Les agents doivent avoir été actifs récemment et disposer de fonds.',
    active: 'Actif maintenant', away: 'd’ici', directions: 'Itinéraire →',
    agentsFound: count => `${count} agent${count === 1 ? '' : 's'} actif${count === 1 ? '' : 's'} trouvé${count === 1 ? '' : 's'} dans un rayon de 500 m`,
    showingNearest: count => `Affichage des ${count} agents les plus proches.`,
    availability: 'Disponibilité des fonds',
    legend: 'Signification des couleurs des fonds',
    high: 'Vert · Élevé', highMeaning: 'Supérieur à deux fois le seuil de sécurité ; l’agent est généralement prêt à vous servir.',
    medium: 'Jaune · Moyen', mediumMeaning: 'Au-dessus du seuil de sécurité, mais en baisse ; vous pouvez choisir un autre agent.',
    low: 'Rouge · Faible', lowMeaning: 'Au niveau du seuil de sécurité ou en dessous ; l’agent pourrait ne pas pouvoir effectuer la recharge.',
    colorNote: 'Les couleurs indiquent une plage de disponibilité, pas le montant exact des fonds. Appuyez sur un agent pour obtenir l’itinéraire.',
    searchResult: count => `${count} agent(s) actif(s) dans un rayon de 500 m.`,
    locationDenied: 'Autorisez l’accès à votre position pour trouver des agents à proximité.',
    locationError: 'Impossible de déterminer votre position. Vérifiez la localisation et réessayez.',
    markerActive: 'Actif', float: 'fonds', levelHigh: 'élevés', levelMedium: 'moyens', levelLow: 'faibles',
    distanceUnavailable: 'Distance indisponible', radius: '500 m'
  }
};
const roleCopy = {
  en: {
    'guide': 'Tap below and allow location access to find active agents within {radius}. Choose an agent for directions.',
    'Create a commuter account':'Create a commuter account','Sign in to your commuter account':'Sign in to your commuter account',
    'Create an account to open the nearby-agent map. Agent and distributor access is created by an administrator.':'Create an account to open the nearby-agent map. Agent and distributor access is created by an administrator.',
    'Agent and distributor accounts cannot self-register; sign-in details are issued by an administrator.':'Agent and distributor accounts cannot self-register; sign-in details are issued by an administrator.',
    'Full name':'Full name','At least 12 characters':'At least 12 characters','Create account & open map':'Create account & open map',
    'Please wait…':'Please wait…','Already have an account? Sign in':'Already have an account? Sign in','New commuter? Create an account':'New commuter? Create an account',
    'Agent, Distributor or Superagent sign in':'Agent, Distributor or Superagent sign in','Back to commuter account':'Back to commuter account',
    'Home':'Home','Messages':'Messages','Settings':'Settings','Close settings':'Close settings','Messages & support':'Messages & support',
    'Superagent network':'Superagent network','Manage only the agents assigned to you. POS accounts remain administrator-managed.':'Manage only the agents assigned to you. POS accounts remain administrator-managed.',
    'Your assigned agents':'Your assigned agents','You can manage only agents assigned to your account. Their POS balance is shown here. Only an administrator can create agent sign-in and POS access.':'You can manage only agents assigned to your account. Their POS balance is shown here. Only an administrator can create agent sign-in and POS access.',
    'Add agent':'Add agent','Edit agent profile':'Edit agent profile','New agent profile':'New agent profile','Agent name':'Agent name','Operating area':'Operating area',
    'Zone':'Zone','Agent zone':'Agent zone','The agent profile starts with zero float. An administrator must create the sign-in and POS account and arrange float.':'The agent profile starts with zero float. An administrator must create the sign-in and POS account and arrange float.',
    'Save agent':'Save agent','Saving…':'Saving…','Agent details updated.':'Agent details updated.','Agent profile created. Ask an administrator to create the agent login and POS access.':'Agent profile created. Ask an administrator to create the agent login and POS access.',
    'Location not set':'Location not set','POS FLOAT':'POS FLOAT','Deletion request pending':'Deletion request pending','Request deletion':'Request deletion','Reason for deletion request':'Reason for deletion request',
    'Explain why this agent should be removed':'Explain why this agent should be removed','Send request':'Send request','Sending…':'Sending…',
    'Deletion request sent to an administrator. The agent remains active until approval.':'Deletion request sent to an administrator. The agent remains active until approval.',
    'No agents assigned yet':'No agents assigned yet','Ask an administrator to assign agents to your Superagent account.':'Ask an administrator to assign agents to your Superagent account.',
    'Deletion requests':'Deletion requests','Deletion request history':'Deletion request history','Your reason':'Your reason','Administrator response':'Administrator response',
    'You have not requested an agent deletion.':'You have not requested an agent deletion.','Admin approved the agent deletion request.':'Admin approved the agent deletion request.',
    'Admin rejected the agent deletion request.':'Admin rejected the agent deletion request.',
    'Login credentials':'Login credentials','Current password (required for credential changes)':'Current password (required for credential changes)',
    'New password (optional)':'New password (optional)','Confirm new password':'Confirm new password','Re-enter your new password':'Re-enter your new password',
    'Leave the new password blank to keep it unchanged. Changing your email or password signs out other active sessions.':'Leave the new password blank to keep it unchanged. Changing your email or password signs out other active sessions.',
    'New passwords do not match.':'New passwords do not match.','Enter your current password to change account credentials.':'Enter your current password to change account credentials.',
    'Name must be between 1 and 80 characters.':'Name must be between 1 and 80 characters.',
    'Enter a valid email address.':'Enter a valid email address.','Password must be at least 12 characters.':'Password must be at least 12 characters.',
    'An account with this email already exists. Sign in instead.':'An account with this email already exists. Sign in instead.',
    'Commuter account created. Welcome, {name}.':'Commuter account created. Welcome, {name}.','Signed in: {name}.':'Signed in: {name}.',
    'How to sell a ticket':'How to sell a ticket',
    'Enter the ticket amount and tap Record ticket sale. That amount is automatically deducted from your available float and the balance updates.':'Enter the ticket amount and tap Record ticket sale. That amount is automatically deducted from your available float and the balance updates.',
    'Example: £10 float − £2 ticket = £8 remaining. A sale above your available float is rejected.':'Example: £10 float − £2 ticket = £8 remaining. A sale above your available float is rejected.',
    'Recording sale…':'Recording sale…',
    'How tasks work':'How tasks work',
    'Refresh GPS now':'Refresh GPS now',
    'GPS refreshed. Operations can now find you nearby.':'GPS refreshed. Operations can now find you nearby.',
    'Live location is shared with operations.':'Live location is shared with operations.',
    'Operations inbox':'Operations inbox',
    'No direct messages yet. Send a message to operations if you need help.':'No direct messages yet. Send a message to operations if you need help.',
    'Message operations directly':'Message operations directly',
    '1. Go on duty and allow GPS so operations can see your position.':'1. Go on duty and allow GPS so operations can see your position.',
    '2. Operations assigns a nearby agent and sends the transfer instructions here.':'2. Operations assigns a nearby agent and sends the transfer instructions here.',
    '3. Open the route, contact the agent if needed, then enter the amount delivered and complete the task.':'3. Open the route, contact the agent if needed, then enter the amount delivered and complete the task.',
    'Enter only the amount actually delivered to the agent’s POS float. Completing this task automatically adds that amount to the agent’s available float.':'Enter only the amount actually delivered to the agent’s POS float. Completing this task automatically adds that amount to the agent’s available float.',
    'Tasks refresh automatically every 20 seconds. Use Refresh tasks to check now.':'Tasks refresh automatically every 20 seconds. Use Refresh tasks to check now.',
    'Refreshing tasks…':'Refreshing tasks…'
  },
  rw: {
    'NETWORK SUPPORT':'UBUFASHA BW’URUSOBE','LIVE':'BIRI GUKORA','Agent':'Umukozi','Distributor':'Utanga amafaranga',
    'Create a commuter account':'Fungura konti y’umugenzi','Sign in to your commuter account':'Injira muri konti y’umugenzi',
    'Create an account to open the nearby-agent map. Agent and distributor access is created by an administrator.':'Fungura konti kugira ngo urebe ikarita y’abakozi bakwegereye. Konti z’abakozi n’abatanga amafaranga zitangwa n’umuyobozi.',
    'Agent and distributor accounts cannot self-register; sign-in details are issued by an administrator.':'Abakozi n’abatanga amafaranga ntibifungurira konti; umuyobozi ni we ubaha amakuru yo kwinjira.',
    'Full name':'Amazina yose','At least 12 characters':'Inyuguti nibura 12','Create account & open map':'Fungura konti urebe ikarita',
    'Please wait…':'Tegereza…','Already have an account? Sign in':'Usanzwe ufite konti? Injira','New commuter? Create an account':'Uri umugenzi mushya? Fungura konti',
    'Name must be between 1 and 80 characters.':'Amazina agomba kugira inyuguti 1 kugeza kuri 80.',
    'Enter a valid email address.':'Andika imeyili yemewe.','Password must be at least 12 characters.':'Ijambo ry’ibanga rigomba kugira inyuguti nibura 12.',
    'An account with this email already exists. Sign in instead.':'Konti ifite iyi imeyili isanzwe ihari. Injira aho gufungura indi.',
    'Commuter account created. Welcome, {name}.':'Konti y’umugenzi yafunguwe. Murakaza neza, {name}.','Signed in: {name}.':'Winjiye neza, {name}.',
    'Agent float':'Amafaranga y’umukozi','Distributor tasks':'Imirimo y’utanga amafaranga','Keep your balance and support team in sync.':'Komeza umenye amafaranga usigaranye kandi uvugane n’itsinda rigufasha.',
    'Replenishment tasks assigned to your account.':'Imirimo yo kugeza amafaranga kuri agenti yagenewe konti yawe.',
    'Sign in to your Agent account':'Injira muri konti yawe y’umukozi','Sign in to your Distributor account':'Injira muri konti yawe y’utanga amafaranga','Accounts are created by your network administrator. Contact them if you need access.':'Konti itangwa n’umuyobozi w’urusobe. Muvugishe niba ukeneye ubufasha.',
    'Email':'Imeyili','Password':'Ijambo ry’ibanga','Your password':'Ijambo ry’ibanga ryawe','Sign in':'Injira','Signing in…':'Urimo kwinjira…',
    'Agent, Distributor or Superagent sign in':'Kwinjira kw’umukozi, utanga amafaranga cyangwa superagent','Back to commuter account':'Subira kuri konti y’umugenzi',
    'Home':'Ahabanza','Messages':'Ubutumwa','Settings':'Igenamiterere','Close settings':'Funga igenamiterere','Messages & support':'Ubutumwa n’ubufasha',
    'Superagent network':'Urusobe rwa superagent','Manage only the agents assigned to you. POS accounts remain administrator-managed.':'Ushobora gucunga abakozi bahawe konti yawe gusa. Umuyobozi ni we ucunga konti za POS.',
    'Your assigned agents':'Abakozi wagenewe','You can manage only agents assigned to your account. Their POS balance is shown here. Only an administrator can create agent sign-in and POS access.':'Ushobora gucunga abakozi wagenewe gusa. Amafaranga yabo ya POS agaragara hano. Umuyobozi ni we ufungura konti zabo.',
    'Add agent':'Ongeraho umukozi','Edit agent profile':'Hindura imyirondoro y’umukozi','New agent profile':'Konti nshya y’umukozi','Agent name':'Amazina y’umukozi','Operating area':'Aho akorera',
    'Zone':'Agace','Agent zone':'Agace k’umukozi','The agent profile starts with zero float. An administrator must create the sign-in and POS account and arrange float.':'Konti y’umukozi itangira idafite amafaranga. Umuyobozi agomba kumufungurira konti ya POS akayishyiraho amafaranga.',
    'Save agent':'Bika umukozi','Agent details updated.':'Amakuru y’umukozi yahinduwe.','Agent profile created. Ask an administrator to create the agent login and POS access.':'Konti y’umukozi yafunguwe. Saba umuyobozi kumufungurira konti yo kwinjiramo na POS.',
    'Location not set':'Aho ari ntiharashyirwaho','POS FLOAT':'AMAFARANGA YA POS','Deletion request pending':'Gusaba gusiba birategereje','Request deletion':'Saba gusiba','Reason for deletion request':'Impamvu yo gusaba gusiba',
    'Explain why this agent should be removed':'Sobanura impamvu uyu mukozi agomba kuvanwaho','Send request':'Ohereza ubusabe','Deletion request sent to an administrator. The agent remains active until approval.':'Ubusabe bwoherejwe ku muyobozi. Umukozi azakomeza gukora kugeza bwemejwe.',
    'No agents assigned yet':'Nta bakozi wagenewe','Ask an administrator to assign agents to your Superagent account.':'Saba umuyobozi kuguha abakozi.',
    'Deletion requests':'Ubusabe bwo gusiba','Deletion request history':'Amateka y’ubusabe bwo gusiba','Your reason':'Impamvu yawe','Administrator response':'Igisubizo cy’umuyobozi',
    'You have not requested an agent deletion.':'Nta mukozi wasabye ko avanwaho.','Admin approved the agent deletion request.':'Umuyobozi yemeye ubusabe bwo gusiba umukozi.',
    'Admin rejected the agent deletion request.':'Umuyobozi yanze ubusabe bwo gusiba umukozi.',
    'Login credentials':'Amakuru yo kwinjira','Current password (required for credential changes)':'Ijambo ry’ibanga usanganywe (risabwa)','New password (optional)':'Ijambo ry’ibanga rishya (si ngombwa)',
    'Confirm new password':'Emeza ijambo ry’ibanga rishya','Re-enter your new password':'Ongera wandike ijambo ry’ibanga rishya',
    'Leave the new password blank to keep it unchanged. Changing your email or password signs out other active sessions.':'Siga ijambo ry’ibanga rishya ubusa niba udashaka kurihindura. Guhindura imeyili cyangwa ijambo ry’ibanga bisohora izindi konti zinjiye.',
    'New passwords do not match.':'Amagambo y’ibanga mashya ntahura.','Enter your current password to change account credentials.':'Andika ijambo ry’ibanga usanganywe kugira ngo uhindure amakuru yo kwinjira.',
    'Signed in as Agent':'Winjiye nka Agenti','Signed in as Distributor':'Winjiye nk’utanga amafaranga','Sign out before accessing a different role.':'Sohokamo mbere yo gukoresha ubundi bwoko bwa konti.','Sign out':'Sohoka',
    'Back to dashboard':'Subira ku rupapuro rw’ibanze','Edit my profile':'Hindura imyirondoro yanjye','Edit your profile':'Hindura imyirondoro yawe','Profile details':'Imyirondoro','Name':'Amazina',
    'Your name':'Amazina yawe','Phone number':'Nimero ya telefone','Your phone number':'Nimero ya telefone yawe','Location / area':'Aho ukorera','Your area':'Aho ukorera',
    'Save profile':'Bika imyirondoro','Saving profile…':'Urimo kubika imyirondoro…','Profile updated successfully.':'Imyirondoro yahinduwe neza.',
    'AVAILABLE DIGITAL FLOAT':'AMAFARANGA AHARI YO KUGURISHA','Low-float alert threshold':'Igipimo cy’amafaranga make bwoherezwaho ubutumwa','Float exhausted — support alert sent':'Amafaranga yo kugurisha yashize — ubutumwa bwo gusaba ubufasha bwoherejwe',
    'Float is running low':'Amafaranga yo kugurisha ari kugabanuka','Low float is reported to operations automatically when a sale is recorded. Open Messages to explain a problem or request an urgent top-up.':'Iyo amafaranga yo kugurisha agabanutse, ubuyobozi burabimenyeshwa. Kanda Ubutumwa usobanure ikibazo cyangwa usabe kongererwa amafaranga byihuse.',
    'Commuter ticket sale (£)':'Amafaranga y’itike yagurishijwe (£)','Amount paid from float':'Amafaranga yakoreshejwe','Record ticket sale':'Andika itike yagurishijwe',
    'How to sell a ticket':'Uko wandika itike yagurishijwe','Enter the ticket amount and tap Record ticket sale. That amount is automatically deducted from your available float and the balance updates.':'Andika amafaranga y’itike, ukande Andika itike yagurishijwe. Ayo mafaranga ahita avanwa ku yo ufite kandi asigaranye akavugururwa.','Example: £10 float − £2 ticket = £8 remaining. A sale above your available float is rejected.':'Urugero: £10 wari ufite − £2 y’itike = £8 asigara. Ntushobora kwandika itike irenze amafaranga ufite.','Recording sale…':'Irimo kwandika itike…',
    'Recording a sale deducts it from your available float and helps operations see how much service each agent provides to commuters.':'Kwandika itike bigabanya amafaranga usigaranye kandi bifasha ubuyobozi kumenya serivisi uha abagenzi.',
    'Stop background location':'Hagarika kohereza aho uri','Enable background SOS monitoring':'Fungura gukurikirana ubutabazi',    'When enabled, this device sends GPS to operations. Float changes are recorded only through ticket sales and distributor top-ups; low balances trigger an SOS alert for an administrator to review and assign a distributor.':'Iyo bifunguye, telefone yohereza aho uri ku buyobozi. Amafaranga ahinduka iyo wanditse itike cyangwa kongererwa amafaranga; iyo agabanutse ubuyobozi buramenyeshwa kugira ngo umuyobozi abigenzure agene utanga amafaranga.',
    'Contact network operations':'Vugana n’ubuyobozi bw’urusobe','Request a float top-up or tell the admin what support you need. Your current GPS position is included so an available distributor can be assigned.':'Saba kongererwa amafaranga cyangwa ubwire umuyobozi ubufasha ukeneye. Aho uri hazoherezwa kugira ngo hagushakirwe ugufasha.',
    'Message (optional)':'Ubutumwa (si ngombwa)','Tell operations what you need':'Sobanurira ubuyobozi icyo ukeneye','Request float support':'Saba kongererwa amafaranga',
    'End-of-day bank settlement':'Raporo yo kubitsa amafaranga ya nimugoroba','Amount deposited (£)':'Amafaranga wabikije (£)','Bank deposit reference':'Kode yo kubitsa muri banki',
    'Notes (optional)':'Ibisobanuro (si ngombwa)','Attach bank-slip photo':'Ongeraho ifoto ya fagitire ya banki','Change bank-slip photo':'Hindura ifoto ya fagitire ya banki',
    'Submit end-of-day settlement':'Ohereza raporo yo kubitsa','Recent settlement reports':'Raporo ziheruka','No settlement reports submitted yet.':'Nta raporo watanga kugeza ubu.',
    'Assigned replenishments':'Imirimo yo kugeza amafaranga','No active assignments':'Nta mirimo ufite ubu','Stay on duty so operations can find you and assign a nearby agent.':'Komeza uri ku kazi kugira ngo ubuyobozi bukubone kandi bukugene ku agenti uri hafi.',
    'How tasks work':'Uko imirimo ikorwa','1. Go on duty and allow GPS so operations can see your position.':'1. Tangira akazi wemere GPS kugira ngo ubuyobozi bubone aho uri.','2. Operations assigns a nearby agent and sends the transfer instructions here.':'2. Ubuyobozi bugenera agenti uri hafi amafaranga kandi bukohereza amabwiriza hano.','3. Open the route, contact the agent if needed, then enter the amount delivered and complete the task.':'3. Fungura inzira, uhamagare agenti nibiba ngombwa, wandike amafaranga wamuhaye urangize umurimo.','Enter only the amount actually delivered to the agent’s POS float. Completing this task automatically adds that amount to the agent’s available float. The amount and updated POS balance appear in the admin system immediately.':'Andika gusa amafaranga wahaye agenti kuri POS ye. Iyo urangije uyu murimo, ayo mafaranga ahita yiyongera ku yo agenti ashobora gukoresha kandi umuyobozi ahita ayabona.','Tasks refresh automatically every 20 seconds. Use Refresh tasks to check now.':'Imirimo iravugururwa buri masegonda 20. Kanda Kongera kureba imirimo kugira ngo uyivugurure nonaha.','Refreshing tasks…':'Irimo kuvugurura imirimo…',
    'Operations inbox':'Ubutumwa buvuye ku buyobozi','No direct messages yet. Send a message to operations if you need help.':'Nta butumwa buraza. Ohereza ubutumwa ku buyobozi niba ukeneye ubufasha.','Message operations directly':'Andikira ubuyobozi',
    'Operations instruction':'Ubutumwa bw’ubuyobozi','No special instructions were provided.':'Nta mabwiriza yihariye yatanzwe.',
    'Route to agent':'Inzira igana kuri agenti','Estimated travel time':'Igihe cy’urugendo giteganyijwe',
    'Field dashboard':'Imirimo yo mu murima','ACTIVE TASKS':'IMIRIMO IKORA','ON SHIFT':'ARI KU KAZI','OFF SHIFT':'NTAKIRI KU KAZI',
    'Live location is shared with operations.':'Aho uri harerekanwa ku buyobozi.','You are ready to receive nearby tasks.':'Witeguye kwakira imirimo ikwegereye.',
    'Task briefing':'Amabwiriza y’umurimo','Message operations':'Andikira ubuyobozi','Write a reply…':'Andika igisubizo…',
    'Send reply':'Ohereza igisubizo','Send a message':'Ohereza ubutumwa','No messages yet. Ask operations if you need help.':'Nta butumwa buraza. Baza ubuyobozi niba ukeneye ubufasha.',
    'Call agent':'Hamagara agenti','Admin':'Ubuyobozi','You':'Wowe','New message from operations.':'Ubutumwa bushya buvuye ku buyobozi.',
    'Your shift':'Igihe cy’akazi','Go on duty & share GPS':'Tangira akazi wohereze aho uri','End shift':'Soza akazi','Refresh tasks':'Kongera kureba imirimo',
    'Refresh GPS now':'Ongera wohereze aho uri','GPS refreshed. Operations can now find you nearby.':'Aho uri havuguruwe. Ubuyobozi bushobora kukubona hafi yabo.',
    'Live location is shared with operations.':'Aho uri herekanwa ku buyobozi.',
    'Current float':'Amafaranga asigaranye','Float added (£)':'Amafaranga wongereye kuri POS (£)','Amount replenished':'Amafaranga wongeyeho','Open navigation':'Fungura inzira','Complete top-up':'Emeza ko wongereye amafaranga','Recording top-up…':'Irimo kwandika amafaranga…','Top-up recorded:':'Amafaranga wongeyeho yanditswe:','Agent POS float now:':'Amafaranga agenti afite kuri POS ubu:',
    'EN ROUTE':'ARI MU NZIRA','ASSIGNED':'YAGENEWE','Agent needing float':'Agenti ukeneye amafaranga','London':'Londres',
    'Status':'Uko ahagaze','offline':'ntari ku kazi','Tap & Go · London network':'Tap & Go · Urusobe rw’i Londres',
    'used':'yakoreshejwe','deposited':'yabikijwe','Admin':'Umuyobozi',
    'pending':'itegereje','approved':'yemejwe','rejected':'yanzwe',
    'Agent’s message':'Ubutumwa bwa agenti','Amount shown on the bank slip':'Amafaranga agaragara kuri fagitire','Reference printed on the slip':'Kode iri kuri fagitire',
    'Explain any discrepancy or issue':'Sobanura itandukaniro cyangwa ikibazo','Enter the bank-slip details and attach a photo. Reported float use is calculated from recorded ticket sales. Your balance will not change until an administrator verifies the slip and approves a float credit.':'Andika amakuru ya fagitire wongereho ifoto. Amafaranga wakoresheje abarwa hakurikijwe amatike wanditse. Amafaranga asigaranye ntazahinduka kugeza umuyobozi agenzuye fagitire akemeza kongera amafaranga.',
    'Settlement submitted. Recorded float use: {amount}. Admin approval is required before float is credited.':'Raporo yoherejwe. Amafaranga yakoreshejwe: {amount}. Agomba kubanza kwemezwa n’umuyobozi mbere yo kongerwa kuri konti.',
    'The agent location is not available yet.':'Aho agenti aherereye ntiharaboneka.',
    'Signed in':'Winjiye','Signed out, but status could not be updated':'Wasohotse, ariko uko uhagaze ntibyashoboye guhindurwa',
    'You are signed out.':'Wasohotse.','Background location sharing is on.':'Kohereza aho uri bikorera inyuma birafunguye.',
    'Tap & Go location active':'Tap & Go: aho uri harimo koherezwa','Sharing your position with network operations':'Turimo kohereza aho uri ku buyobozi bw’urusobe.',
    'Replenishment recorded and task completed.':'Amafaranga yongeweho kandi umurimo urangiye.',
    'New replenishment assigned for {agent}.':'Wahawe umurimo wo kugeza amafaranga kuri {agent}.',
    'Your session expired. Sign in again to continue.':'Igihe cyo kwinjira cyarangiye. Ongera winjire ukomeze.',
    'available':'arabonetse','busy':'ahuze','active':'ar gukora','at_risk':'ari mu kaga','low':'make','medium':'ari hagati','high':'menshi',
    'Ticket sale recorded. Your float is low; operations has been alerted.':'Itike yanditswe. Amafaranga yo kugurisha ni make; ubuyobozi bwamenyeshejwe.',
    'Ticket sale recorded and float balance updated.':'Itike yanditswe kandi amafaranga asigaranye avugururwa.',
    'Support request sent. {name} has been assigned to your location.':'Ubusabe bwo gufashwa bwoherejwe. {name} yoherejwe aho uri.',
    'Support request sent. An administrator will review it and assign a distributor.':'Ubusabe bwoherejwe ku buyobozi. Umuyobozi azagenzura ubusabe aguhe umucuruzi w’amafaranga yo kugurisha.',
    'Enter a positive ticket-sale amount.':'Andika amafaranga arenze zeru ku itike.',
    'Enter a positive replenishment amount.':'Andika amafaranga arenze zeru yo kongera.',
    'Allow location access to continue.':'Emera ko porogaramu ikoresha aho uri kugira ngo ukomeze.',
    'Allow background location to keep your GPS current.':'Emera kohereza aho uri inyuma kugira ngo GPS ihore ivuguruye.',
    'Allow photo-library access to attach your bank slip.':'Emera gukoresha amafoto kugira ngo wongereho fagitire ya banki.',
    'The selected bank-slip photo could not be opened.':'Ifoto ya fagitire wahisemo ntiyafungutse.',
    'Choose a bank-slip photo smaller than 2 MB.':'Hitamo ifoto ya fagitire itarenze MB 2.',
    'Enter the amount shown on your bank slip.':'Andika amafaranga agaragara kuri fagitire ya banki.',
    'Enter the bank deposit reference.':'Andika kode yo kubitsa muri banki.',
    'Attach a photo of the bank slip.':'Ongeraho ifoto ya fagitire ya banki.',
    'Location sharing stopped.':'Kohereza aho uri byahagaritswe.',
    'Location sharing stopped, but status could not be updated':'Kohereza aho uri byahagaritswe, ariko uko uhagaze ntibyashoboye guhindurwa',
    'Settlement awaiting admin review':'Raporo itegereje kwemezwa n’umuyobozi',
    guide: 'Kanda hasi wemere ko porogaramu ikoresha aho uri kugira ngo ibone abakozi bakora muri {radius}. Hitamo umukozi urebe inzira.'
  },
  fr: {
    'NETWORK SUPPORT':'ASSISTANCE RÉSEAU','LIVE':'EN DIRECT','Commuter':'Voyageur','Agent':'Agent','Distributor':'Distributeur',
    'Create a commuter account':'Créer un compte voyageur','Sign in to your commuter account':'Se connecter au compte voyageur',
    'Create an account to open the nearby-agent map. Agent and distributor access is created by an administrator.':'Créez un compte pour afficher la carte des agents à proximité. Les comptes agent et distributeur sont créés par un administrateur.',
    'Agent and distributor accounts cannot self-register; sign-in details are issued by an administrator.':'Les agents et distributeurs ne peuvent pas créer leur compte ; l’administrateur fournit leurs identifiants.',
    'Full name':'Nom complet','At least 12 characters':'12 caractères minimum','Create account & open map':'Créer un compte et afficher la carte',
    'Please wait…':'Veuillez patienter…','Already have an account? Sign in':'Vous avez déjà un compte ? Connectez-vous','New commuter? Create an account':'Nouveau voyageur ? Créez un compte',
    'Name must be between 1 and 80 characters.':'Le nom doit contenir entre 1 et 80 caractères.',
    'Enter a valid email address.':'Saisissez une adresse e-mail valide.','Password must be at least 12 characters.':'Le mot de passe doit contenir au moins 12 caractères.',
    'An account with this email already exists. Sign in instead.':'Un compte utilise déjà cet e-mail. Connectez-vous.',
    'Commuter account created. Welcome, {name}.':'Compte voyageur créé. Bienvenue, {name}.','Signed in: {name}.':'Connexion réussie : {name}.',
    'Agent float':'Fonds de l’agent','Distributor tasks':'Missions du distributeur','Keep your balance and support team in sync.':'Suivez votre solde et restez en contact avec l’équipe d’assistance.',
    'Replenishment tasks assigned to your account.':'Missions de réapprovisionnement attribuées à votre compte.',
    'Sign in to your Agent account':'Connectez-vous à votre compte agent','Sign in to your Distributor account':'Connectez-vous à votre compte distributeur','Accounts are created by your network administrator. Contact them if you need access.':'Votre compte est créé par l’administrateur du réseau. Contactez-le pour obtenir de l’aide.',
    'Email':'E-mail','Password':'Mot de passe','Your password':'Votre mot de passe','Sign in':'Se connecter','Signing in…':'Connexion…',
    'Agent, Distributor or Superagent sign in':'Connexion agent, distributeur ou Superagent','Back to commuter account':'Retour au compte voyageur',
    'Home':'Accueil','Messages':'Messages','Settings':'Paramètres','Close settings':'Fermer les paramètres','Messages & support':'Messages et assistance',
    'Superagent network':'Réseau Superagent','Manage only the agents assigned to you. POS accounts remain administrator-managed.':'Gérez uniquement les agents qui vous sont attribués. Les comptes POS restent gérés par l’administrateur.',
    'Your assigned agents':'Vos agents attribués','You can manage only agents assigned to your account. Their POS balance is shown here. Only an administrator can create agent sign-in and POS access.':'Vous gérez uniquement les agents attribués à votre compte. Leur solde POS apparaît ici. Seul un administrateur peut créer leurs accès.',
    'Add agent':'Ajouter un agent','Edit agent profile':'Modifier le profil agent','New agent profile':'Nouveau profil agent','Agent name':'Nom de l’agent','Operating area':'Zone d’activité',
    'Zone':'Zone','Agent zone':'Zone de l’agent','The agent profile starts with zero float. An administrator must create the sign-in and POS account and arrange float.':'Le profil démarre avec un solde nul. Un administrateur doit créer l’accès et le compte POS puis attribuer les fonds.',
    'Save agent':'Enregistrer l’agent','Agent details updated.':'Profil agent mis à jour.','Agent profile created. Ask an administrator to create the agent login and POS access.':'Profil agent créé. Demandez à un administrateur de créer l’accès et le compte POS.',
    'Location not set':'Lieu non défini','POS FLOAT':'SOLDE POS','Deletion request pending':'Demande de suppression en attente','Request deletion':'Demander la suppression','Reason for deletion request':'Motif de la demande de suppression',
    'Explain why this agent should be removed':'Expliquez pourquoi cet agent doit être retiré','Send request':'Envoyer la demande','Deletion request sent to an administrator. The agent remains active until approval.':'Demande envoyée à l’administrateur. L’agent reste actif jusqu’à son approbation.',
    'No agents assigned yet':'Aucun agent attribué','Ask an administrator to assign agents to your Superagent account.':'Demandez à un administrateur de vous attribuer des agents.',
    'Deletion requests':'Demandes de suppression','Deletion request history':'Historique des demandes','Your reason':'Votre motif','Administrator response':'Réponse de l’administrateur',
    'You have not requested an agent deletion.':'Vous n’avez demandé la suppression d’aucun agent.','Admin approved the agent deletion request.':'L’administrateur a approuvé la suppression de l’agent.',
    'Admin rejected the agent deletion request.':'L’administrateur a refusé la suppression de l’agent.',
    'Login credentials':'Identifiants de connexion','Current password (required for credential changes)':'Mot de passe actuel (obligatoire pour modifier les identifiants)',
    'New password (optional)':'Nouveau mot de passe (facultatif)','Confirm new password':'Confirmer le nouveau mot de passe','Re-enter your new password':'Saisissez à nouveau le nouveau mot de passe',
    'Leave the new password blank to keep it unchanged. Changing your email or password signs out other active sessions.':'Laissez le nouveau mot de passe vide pour le conserver. La modification de l’e-mail ou du mot de passe déconnecte les autres sessions.',
    'New passwords do not match.':'Les nouveaux mots de passe ne correspondent pas.','Enter your current password to change account credentials.':'Saisissez votre mot de passe actuel pour modifier vos identifiants.',
    'Signed in as Agent':'Connecté en tant qu’agent','Signed in as Distributor':'Connecté en tant que distributeur','Sign out before accessing a different role.':'Déconnectez-vous avant de choisir un autre rôle.','Sign out':'Déconnexion',
    'Back to dashboard':'Retour au tableau de bord','Edit my profile':'Modifier mon profil','Edit your profile':'Modifier votre profil','Profile details':'Profil','Name':'Nom',
    'Your name':'Votre nom','Phone number':'Téléphone','Your phone number':'Votre numéro de téléphone','Location / area':'Lieu / secteur','Your area':'Votre secteur',
    'Save profile':'Enregistrer le profil','Saving profile…':'Enregistrement du profil…','Profile updated successfully.':'Profil mis à jour.',
    'AVAILABLE DIGITAL FLOAT':'FONDS NUMÉRIQUES DISPONIBLES','Low-float alert threshold':'Seuil d’alerte de fonds faibles','Float exhausted — support alert sent':'Fonds épuisés — alerte envoyée',
    'Float is running low':'Fonds en baisse','Low float is reported to operations automatically when a sale is recorded. Open Messages to explain a problem or request an urgent top-up.':'Une faible réserve est signalée automatiquement après une vente. Ouvrez Messages pour expliquer un problème ou demander un réapprovisionnement urgent.',
    'Commuter ticket sale (£)':'Vente de titres de transport (£)','Amount paid from float':'Montant payé avec les fonds','Record ticket sale':'Enregistrer une vente',
    'How to sell a ticket':'Comment enregistrer une vente','Enter the ticket amount and tap Record ticket sale. That amount is automatically deducted from your available float and the balance updates.':'Saisissez le montant du titre puis appuyez sur Enregistrer une vente. Le montant est automatiquement déduit de vos fonds disponibles et le solde est mis à jour.','Example: £10 float − £2 ticket = £8 remaining. A sale above your available float is rejected.':'Exemple : 10 £ de fonds − 2 £ de vente = 8 £ restants. Une vente supérieure à vos fonds disponibles est refusée.','Recording sale…':'Enregistrement de la vente…',
    'Recording a sale deducts it from your available float and helps operations see how much service each agent provides to commuters.':'Chaque vente est déduite de votre réserve et permet à l’équipe de suivre les services rendus aux voyageurs.',
    'Stop background location':'Arrêter le partage de position','Enable background SOS monitoring':'Activer le suivi SOS en arrière-plan','When enabled, this device sends GPS to operations. Float changes are recorded only through ticket sales and distributor top-ups; low balances trigger an SOS alert for an administrator to review and assign a distributor.':'Lorsque cette option est activée, votre position GPS est transmise à l’équipe. Les ventes et réapprovisionnements enregistrent les mouvements de fonds ; un solde faible déclenche une alerte SOS que l’administrateur examine avant d’affecter un distributeur.',
    'Contact network operations':'Contacter l’équipe réseau','Request a float top-up or tell the admin what support you need. Your current GPS position is included so an available distributor can be assigned.':'Demandez un réapprovisionnement ou décrivez l’aide nécessaire. Votre position GPS permet d’affecter un distributeur disponible.',
    'Message (optional)':'Message (facultatif)','Tell operations what you need':'Indiquez votre besoin à l’équipe','Request float support':'Demander un réapprovisionnement',
    'End-of-day bank settlement':'Dépôt bancaire de fin de journée','Amount deposited (£)':'Montant déposé (£)','Bank deposit reference':'Référence du dépôt bancaire',
    'Notes (optional)':'Notes (facultatif)','Attach bank-slip photo':'Joindre une photo du reçu bancaire','Change bank-slip photo':'Modifier la photo du reçu bancaire',
    'Submit end-of-day settlement':'Envoyer le rapport de dépôt','Recent settlement reports':'Rapports de dépôt récents','No settlement reports submitted yet.':'Aucun rapport de dépôt envoyé.',
    'Assigned replenishments':'Réapprovisionnements attribués','How tasks work':'Comment fonctionnent les missions','1. Go on duty and allow GPS so operations can see your position.':'1. Prenez votre service et autorisez le GPS pour partager votre position avec l’équipe.','2. Operations assigns a nearby agent and sends the transfer instructions here.':'2. L’équipe vous affecte un agent proche et envoie les consignes ici.','3. Open the route, contact the agent if needed, then enter the amount delivered and complete the task.':'3. Ouvrez l’itinéraire, contactez l’agent si besoin, puis saisissez le montant remis et terminez la mission.','Enter only the amount actually delivered to the agent’s POS float. Completing this task automatically adds that amount to the agent’s available float. The amount and updated POS balance appear in the admin system immediately.':'Saisissez uniquement le montant réellement remis sur le POS de l’agent. En terminant la mission, ce montant est ajouté à son solde et apparaît immédiatement dans le système administrateur.','Tasks refresh automatically every 20 seconds. Use Refresh tasks to check now.':'Les missions s’actualisent automatiquement toutes les 20 secondes. Appuyez sur Actualiser les missions pour vérifier maintenant.','Refreshing tasks…':'Actualisation des missions…','Operations inbox':'Boîte de réception de l’équipe','No direct messages yet. Send a message to operations if you need help.':'Aucun message. Écrivez à l’équipe si vous avez besoin d’aide.','Message operations directly':'Écrire directement à l’équipe',
    'Operations instruction':'Instruction de l’équipe','No special instructions were provided.':'Aucune instruction particulière.',
    'Route to agent':'Itinéraire vers l’agent','Estimated travel time':'Durée estimée du trajet',
    'Field dashboard':'Tableau de bord terrain','ACTIVE TASKS':'MISSIONS ACTIVES','ON SHIFT':'EN SERVICE','OFF SHIFT':'HORS SERVICE',
    'Live location is shared with operations.':'Votre position est partagée avec l’équipe.','You are ready to receive nearby tasks.':'Vous êtes prêt à recevoir des missions à proximité.',
    'Task briefing':'Consignes de mission','Message operations':'Écrire à l’équipe','Write a reply…':'Écrire une réponse…',
    'Send reply':'Envoyer la réponse','Send a message':'Envoyer un message','No messages yet. Ask operations if you need help.':'Aucun message. Contactez l’équipe si vous avez besoin d’aide.',
    'Call agent':'Appeler l’agent','Admin':'Équipe','You':'Vous','New message from operations.':'Nouveau message de l’équipe.',
    'Your shift':'Votre service','Go on duty & share GPS':'Prendre le service et partager le GPS','End shift':'Terminer le service','Refresh tasks':'Actualiser les missions',
    'Refresh GPS now':'Actualiser le GPS','GPS refreshed. Operations can now find you nearby.':'Position actualisée. L’équipe peut maintenant vous trouver à proximité.',
    'Live location is shared with operations.':'Votre position est partagée avec l’équipe.',
    'Stay on duty so operations can find you and assign a nearby agent.':'Restez en service pour que l’équipe puisse vous trouver et vous affecter à un agent proche.',
    'New replenishment assigned for {agent}.':'Nouvelle mission de réapprovisionnement pour {agent}.',
    'Current float':'Fonds actuels','Float added (£)':'Montant ajouté au POS (£)','Amount replenished':'Montant réapprovisionné','Open navigation':'Ouvrir la navigation','Complete top-up':'Terminer le réapprovisionnement','Recording top-up…':'Enregistrement du réapprovisionnement…','Top-up recorded:':'Réapprovisionnement enregistré :','Agent POS float now:':'Solde POS actuel de l’agent :',
    'EN ROUTE':'EN ROUTE','ASSIGNED':'ATTRIBUÉ','Agent needing float':'Agent ayant besoin de fonds','London':'Londres',
    'Status':'Statut','offline':'hors service','Tap & Go · London network':'Tap & Go · Réseau de Londres',
    'used':'utilisés','deposited':'déposés','Admin':'Administrateur','pending':'en attente','approved':'approuvé','rejected':'rejeté',
    'Agent’s message':'Message de l’agent','Amount shown on the bank slip':'Montant indiqué sur le reçu bancaire','Reference printed on the slip':'Référence imprimée sur le reçu',
    'Explain any discrepancy or issue':'Expliquez tout écart ou problème','Enter the bank-slip details and attach a photo. Reported float use is calculated from recorded ticket sales. Your balance will not change until an administrator verifies the slip and approves a float credit.':'Saisissez les informations du reçu bancaire et joignez une photo. Les fonds utilisés sont calculés à partir des ventes enregistrées. Votre solde ne changera pas avant la vérification du reçu et l’approbation du crédit par un administrateur.',
    'Replenishment recorded and task completed.':'Réapprovisionnement enregistré et mission terminée.','The agent location is not available yet.':'La position de l’agent n’est pas encore disponible.',
    'Signed in':'Connecté','Signed out, but status could not be updated':'Déconnecté, mais le statut n’a pas pu être mis à jour',
    'You are signed out.':'Vous êtes déconnecté.','Background location sharing is on.':'Le partage de position en arrière-plan est activé.',
    'Tap & Go location active':'Tap & Go : position active','Sharing your position with network operations':'Votre position est partagée avec l’équipe réseau.',
    'Your session expired. Sign in again to continue.':'Votre session a expiré. Reconnectez-vous pour continuer.',
    'Settlement submitted. Recorded float use: {amount}. Admin approval is required before float is credited.':'Rapport envoyé. Les fonds utilisés sont de {amount}. L’approbation de l’administrateur est nécessaire avant tout crédit.',
    'No active assignments':'Aucune mission en cours','Background location sharing stopped.':'Le partage de position en arrière-plan est arrêté.',
    'available':'disponible','busy':'occupé','active':'actif','at_risk':'à risque','low':'faibles','medium':'moyens','high':'élevés',
    'Ticket sale recorded. Your float is low; operations has been alerted.':'Vente enregistrée. Vos fonds sont faibles ; l’équipe a été alertée.',
    'Ticket sale recorded and float balance updated.':'Vente enregistrée et solde mis à jour.',
    'Support request sent. {name} has been assigned to your location.':'Demande envoyée. {name} a été affecté à votre position.',
    'Support request sent. An administrator will review it and assign a distributor.':'Demande envoyée à l’équipe. Un administrateur examinera la demande et affectera un distributeur.',
    'Enter a positive ticket-sale amount.':'Saisissez un montant de vente supérieur à zéro.',
    'Enter a positive replenishment amount.':'Saisissez un montant de réapprovisionnement supérieur à zéro.',
    'Allow location access to continue.':'Autorisez l’accès à votre position pour continuer.',
    'Allow background location to keep your GPS current.':'Autorisez la localisation en arrière-plan pour actualiser votre GPS.',
    'Allow photo-library access to attach your bank slip.':'Autorisez l’accès aux photos pour joindre votre reçu bancaire.',
    'The selected bank-slip photo could not be opened.':'Impossible d’ouvrir la photo du reçu sélectionné.',
    'Choose a bank-slip photo smaller than 2 MB.':'Choisissez une photo du reçu de moins de 2 Mo.',
    'Enter the amount shown on your bank slip.':'Saisissez le montant indiqué sur votre reçu bancaire.',
    'Enter the bank deposit reference.':'Saisissez la référence du dépôt bancaire.',
    'Attach a photo of the bank slip.':'Joignez une photo du reçu bancaire.',
    'Location sharing stopped.':'Le partage de position est arrêté.',
    'Location sharing stopped, but status could not be updated':'Le partage de position est arrêté, mais le statut n’a pas pu être mis à jour',
    'Settlement awaiting admin review':'Rapport en attente de vérification',
    guide: 'Appuyez ci-dessous et autorisez l’accès à votre position pour trouver des agents actifs dans un rayon de {radius}. Choisissez un agent pour obtenir l’itinéraire.'
  }
};
function translate(language, text) {
  const translated = roleCopy[language]?.[text] || text;
  return translated.replace(/\{(\w+)\}/g, (_match, key) => commuterCopy[language]?.[key] || `{${key}}`);
}
let onMobileSessionExpired = () => {};

async function api(path, options = {}) {
  const { token: suppliedToken, ...request } = options;
  const token = suppliedToken ?? await SecureStore.getItemAsync('mobile_token');
  const isFormData = typeof FormData !== 'undefined' && request.body instanceof FormData;
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...request,
      headers: {
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(request.headers || {})
      }
    });
  } catch (problem) {
    throw new Error(`Cannot reach the Tap & Go server at ${API}. Connect your phone and computer to the same Wi-Fi, or set EXPO_PUBLIC_API_URL to the computer's LAN address. ${problem.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token && !path.includes('/auth/mobile/login')) {
    await SecureStore.deleteItemAsync('mobile_token');
    await SecureStore.deleteItemAsync('mobile_expires_at');
    onMobileSessionExpired();
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function postTrackedLocation(location) {
  const role = await AsyncStorage.getItem('tracking_role');
  const id = await AsyncStorage.getItem('tracking_id');
  if (!id || !location?.coords) return;
  const point = { type: 'Point', coordinates: [location.coords.longitude, location.coords.latitude] };
  if (role === 'agent') {
    await api(`/api/agents/${encodeURIComponent(id)}/telemetry`, {
      method: 'POST', body: JSON.stringify({ location: point })
    });
  } else if (role === 'distributor') {
    await api(`/api/distributors/${encodeURIComponent(id)}/location`, {
      method: 'PATCH', body: JSON.stringify({ location: point })
    });
  }
}

async function clearTrackingState() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) {
      await Location.stopLocationUpdatesAsync(TRACKING_TASK);
    }
  } catch (problem) {
    console.warn('Unable to stop background location after sign-out:', problem.message);
  }
  try {
    await AsyncStorage.multiRemove(['tracking_role', 'tracking_id', 'agent_float']);
  } catch (problem) {
    console.warn('Unable to clear saved tracking state:', problem.message);
  }
}

TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    await postTrackedLocation(data.locations[data.locations.length - 1]);
  } catch (problem) {
    console.warn('Background telemetry will retry on next location update:', problem.message);
  }
});

function ActionButton({ children, onPress, secondary = false, disabled = false }) {
  return (
    <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={[styles.button, secondary && styles.secondaryButton, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{children}</Text>
    </TouchableOpacity>
  );
}

function Input({ label, value, onChangeText, ...props }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} style={[styles.input, props.multiline && styles.multilineInput]}
      autoCapitalize="none" {...props} />
  </View>;
}

export default function App() {
  const [role, setRole] = useState('commuter');
  const [commuterLanguage, setCommuterLanguage] = useState('rw');
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [commuterName, setCommuterName] = useState('');
  const [commuterAuthMode, setCommuterAuthMode] = useState('register');
  const [staffLoginOpen, setStaffLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [nearby, setNearby] = useState([]);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [nearbySearched, setNearbySearched] = useState(false);
  const [location, setLocation] = useState(null);
  const [floatBalance, setFloatBalance] = useState('');
  const [saleAmount, setSaleAmount] = useState('');
  const [ticketSaleBusy, setTicketSaleBusy] = useState(false);
  const ticketSaleInProgress = useRef(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [bankSlip, setBankSlip] = useState(null);
  const [settlements, setSettlements] = useState([]);
  const [settlementBusy, setSettlementBusy] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [tasksRefreshing, setTasksRefreshing] = useState(false);
  const tasksRefreshInProgress = useRef(false);
  const [inboxMessages, setInboxMessages] = useState([]);
  const [inboxDraft, setInboxDraft] = useState('');
  const [inboxSending, setInboxSending] = useState(false);
  const inboxSendInProgress = useRef(false);
  const locationRefreshInProgress = useRef(false);
  const commuterMapLoaded = useRef('');
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [staffTab, setStaffTab] = useState('home');
  const [socketRefresh, setSocketRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const commuter = commuterCopy[commuterLanguage];

  useEffect(() => {
    AsyncStorage.getItem('commuter_language').then(value => {
      if (value === 'rw' || value === 'en' || value === 'fr') setCommuterLanguage(value);
    }).catch(problem => console.warn('Unable to load commuter language preference:', problem.message));
  }, []);

  async function changeCommuterLanguage(language) {
    setCommuterLanguage(language);
    setLanguagePickerOpen(false);
    try {
      await AsyncStorage.setItem('commuter_language', language);
    } catch (problem) {
      console.warn('Unable to save commuter language preference:', problem.message);
    }
  }

  const flash = text => {
    setMessage(text);
    setTimeout(() => setMessage(''), 4200);
  };
  const profile = account?.entity;
  const profileId = profile?._id;

  const loadAccount = useCallback(async token => {
    const value = await api('/api/auth/mobile/me', token ? { token } : {});
    setAccount(value);
    setRole(value.role);
    setFloatBalance(String(value.entity.floatBalance ?? 0));
    return value;
  }, []);

  useEffect(() => {
    let active = true;
    onMobileSessionExpired = () => {
      if (!active) return;
      setAccount(null);
      setRole('commuter');
      setStaffLoginOpen(true);
      setProfileOpen(false);
      setTasks([]);
      setNearby([]);
      setNearbyCount(0);
      setNearbySearched(false);
      commuterMapLoaded.current = '';
      setTracking(false);
      clearTrackingState();
      flash(translate(commuterLanguage, 'Your session expired. Sign in again to continue.'));
    };
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('mobile_token');
        if (token) {
          const expiresAt = Number(await SecureStore.getItemAsync('mobile_expires_at'));
          if (expiresAt && expiresAt <= Date.now()) throw new Error('Mobile session expired.');
          const value = await api('/api/auth/mobile/me', { token });
          if (active) {
            setAccount(value);
            setRole(value.role);
            setFloatBalance(String(value.entity.floatBalance ?? 0));
          }
        }
      } catch {
        await SecureStore.deleteItemAsync('mobile_token');
        await SecureStore.deleteItemAsync('mobile_expires_at');
        await clearTrackingState();
        if (active) setTracking(false);
      } finally {
        if (active) setAuthReady(true);
      }
    })();
    Location.hasStartedLocationUpdatesAsync(TRACKING_TASK).then(setTracking).catch(() => {});
    return () => { active = false; onMobileSessionExpired = () => {}; };
  }, []);

  const loadTasks = useCallback(async () => {
    if (!profileId || account?.role !== 'distributor' || tasksRefreshInProgress.current) return;
    tasksRefreshInProgress.current = true;
    setTasksRefreshing(true);
    try {
      setTasks(await api(`/api/distributors/${encodeURIComponent(profileId)}/tasks`));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    } finally {
      tasksRefreshInProgress.current = false;
      setTasksRefreshing(false);
    }
  }, [account?.role, profileId, commuterLanguage]);

  const loadDistributorInbox = useCallback(async () => {
    if (account?.role !== 'distributor') return;
    try {
      const inbox = await api('/api/distributor-inbox');
      setInboxMessages(inbox.messages || []);
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    }
  }, [account?.role, commuterLanguage]);

  async function sendInboxMessage() {
    const text = inboxDraft.trim();
    if (!text || inboxSendInProgress.current) return;
    inboxSendInProgress.current = true;
    setInboxSending(true);
    try {
      const result = await api('/api/distributor-inbox', {
        method: 'POST', body: JSON.stringify({ text })
      });
      setInboxMessages(current => [...current.filter(item => item.sentAt !== result.message.sentAt), result.message].slice(-200));
      setInboxDraft('');
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    } finally {
      inboxSendInProgress.current = false;
      setInboxSending(false);
    }
  }

  async function sendTaskMessage(task, text) {
    try {
      const result = await api(`/api/dispatches/${task._id}/messages`, {
        method: 'POST', body: JSON.stringify({ text })
      });
      setTasks(current => current.map(item => item._id === task._id
        ? { ...item, messages: [...(item.messages || []), result.message] }
        : item));
      return true;
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
      return false;
    }
  }

  useEffect(() => {
    if (account?.role !== 'distributor') return undefined;
    loadTasks();
    const timer = setInterval(loadTasks, 20000);
    return () => clearInterval(timer);
  }, [account?.role, loadTasks]);

  useEffect(() => {
    if (account?.role !== 'distributor') return undefined;
    loadDistributorInbox();
    const timer = setInterval(loadDistributorInbox, 20000);
    return () => clearInterval(timer);
  }, [account?.role, loadDistributorInbox]);

  useEffect(() => {
    if (account?.role !== 'distributor') return undefined;
    let active = true;
    let socket;
    SecureStore.getItemAsync('mobile_token').then(token => {
      if (!active || !token) return;
      socket = io(API, { auth: { token }, reconnection: true });
      socket.on('dispatch:created', dispatch => {
        const agentName = dispatch.agent?.name || translate(commuterLanguage, 'Agent');
        flash(translate(commuterLanguage, 'New replenishment assigned for {agent}.').replace('{agent}', agentName));
        loadTasks();
      });
      socket.on('dispatch:message', event => {
        if (event.message?.sender === 'admin') {
          flash(`${translate(commuterLanguage, 'New message from operations.')} ${event.message.text}`);
        }
        loadTasks();
      });
      socket.on('distributor:inbox-message', event => {
        if (event.distributorId !== profileId) return;
        setInboxMessages(current => [...current.filter(item => item.sentAt !== event.message.sentAt), event.message].slice(-200));
        if (event.message?.sender === 'admin') {
          flash(`${translate(commuterLanguage, 'New message from operations.')} ${event.message.text}`);
        }
      });
      socket.on('distributor:refresh-location-request', async event => {
        if (event.distributorId !== String(profileId) || locationRefreshInProgress.current) return;
        locationRefreshInProgress.current = true;
        try {
          const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const point = { type: 'Point', coordinates: [current.coords.longitude, current.coords.latitude] };
          await api(`/api/distributors/${encodeURIComponent(profileId)}/location`, {
            method: 'PATCH', body: JSON.stringify({ location: point })
          });
          flash(translate(commuterLanguage, 'GPS refreshed. Operations can now find you nearby.'));
        } catch (problem) {
          flash(translate(commuterLanguage, problem.message));
        } finally {
          locationRefreshInProgress.current = false;
        }
      });
    }).catch(problem => console.warn('Unable to connect for distributor dispatch updates:', problem.message));
    return () => {
      active = false;
      socket?.disconnect();
    };
  }, [account?.role, profileId, commuterLanguage, loadTasks, socketRefresh]);

  const loadSettlements = useCallback(async () => {
    if (!profileId || account?.role !== 'agent') return;
    try {
      setSettlements(await api(`/api/agents/${encodeURIComponent(profileId)}/float-settlements`));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    }
  }, [account?.role, profileId, commuterLanguage]);

  useEffect(() => {
    if (account?.role !== 'agent') return undefined;
    loadSettlements();
    const timer = setInterval(loadSettlements, 30000);
    return () => clearInterval(timer);
  }, [account?.role, loadSettlements]);

  async function locate() {
    const permission = await Location.requestForegroundPermissionsAsync().catch(() => {
      throw new Error(commuter.locationError);
    });
    if (permission.status !== 'granted') throw new Error(LOCATION_PERMISSION_DENIED);
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => {
      throw new Error(commuter.locationError);
    });
    setLocation(current.coords);
    return current;
  }

  async function signIn() {
    setLoginError('');
    setLoginBusy(true);
    try {
      const result = await api('/api/auth/mobile/login', {
        token: '',
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password })
      });
      await SecureStore.setItemAsync('mobile_token', result.token);
      await SecureStore.setItemAsync('mobile_expires_at', String(result.expiresAt));
      const value = await loadAccount(result.token);
      setPassword('');
      setLoginError('');
      setStaffLoginOpen(false);
      setStaffTab('home');
      flash(`${translate(commuterLanguage, 'Signed in')}: ${value.entity.name}.`);
    } catch (problem) {
      setLoginError(translate(commuterLanguage, problem.message));
    } finally {
      setLoginBusy(false);
    }
  }

  async function authenticateCommuter(register) {
    setLoginError('');
    setLoginBusy(true);
    try {
      const result = await api(`/api/auth/commuter/${register ? 'register' : 'login'}`, {
        token: '',
        method: 'POST',
        body: JSON.stringify({ name: commuterName.trim(), email: email.trim(), password })
      });
      await SecureStore.setItemAsync('mobile_token', result.token);
      await SecureStore.setItemAsync('mobile_expires_at', String(result.expiresAt));
      const value = await loadAccount(result.token);
      setRole('commuter');
      setPassword('');
      setLoginError('');
      flash(translate(commuterLanguage, register ? 'Commuter account created. Welcome, {name}.' : 'Signed in: {name}.').replace('{name}', value.entity.name));
    } catch (problem) {
      setLoginError(problem.message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function signOut() {
    let statusError = '';
    try {
      if (tracking) {
        const kind = account?.role === 'agent' ? 'agents' : 'distributors';
        const status = account?.role === 'agent' ? { availability: 'offline' } : { status: 'offline' };
        try {
          await api(`/api/${kind}/${encodeURIComponent(profileId)}/status`, {
            method: 'PATCH', body: JSON.stringify(status)
          });
        } catch (problem) {
          statusError = problem.message;
        }
        await Location.stopLocationUpdatesAsync(TRACKING_TASK).catch(() => {});
      }
      await api('/api/auth/mobile/logout', { method: 'POST' }).catch(() => {});
      await SecureStore.deleteItemAsync('mobile_token');
      await SecureStore.deleteItemAsync('mobile_expires_at');
      await AsyncStorage.multiRemove(['tracking_role', 'tracking_id', 'agent_float']);
      setTracking(false);
      setAccount(null);
      setTasks([]);
      setNearby([]);
      setNearbyCount(0);
      setNearbySearched(false);
      commuterMapLoaded.current = '';
      setRole('commuter');
      setProfileOpen(false);
      setStaffTab('home');
      setStaffLoginOpen(false);
      setCommuterAuthMode('register');
      flash(statusError
        ? `${translate(commuterLanguage, 'Signed out, but status could not be updated')}: ${translate(commuterLanguage, statusError)}`
        : translate(commuterLanguage, 'You are signed out.'));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    }
  }

  async function findNearby() {
    try {
      setLoading(true);
      const current = await locate();
      const sessionId = account?.role === 'commuter' ? `&sessionId=${encodeURIComponent(account.id)}` : '';
      const result = await api(`/api/commuter/nearby?longitude=${current.coords.longitude}&latitude=${current.coords.latitude}&radius=500${sessionId}`, { token: '' });
      setNearby(result.agents);
      setNearbyCount(Number.isInteger(result.count) ? result.count : result.agents.length);
      setNearbySearched(true);
      flash(commuter.searchResult(Number.isInteger(result.count) ? result.count : result.agents.length));
    } catch (problem) {
      flash(problem.message === LOCATION_PERMISSION_DENIED ? commuter.locationDenied : translate(commuterLanguage, problem.message));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (account?.role !== 'commuter' || commuterMapLoaded.current === String(account.id)) return;
    commuterMapLoaded.current = String(account.id);
    findNearby();
  }, [account?.role, account?.id]);

  async function navigateToAgent(agent) {
    const coordinates = agent?.location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      flash(translate(commuterLanguage, 'The agent location is not available yet.'));
      return;
    }
    const [longitude, latitude] = coordinates;
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${latitude},${longitude}`,
      android: `google.navigation:q=${latitude},${longitude}`
    });
    if (url && await Linking.canOpenURL(url)) await Linking.openURL(url);
    else await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`);
  }

  async function toggleTracking() {
    let startingShift = false;
    try {
      if (tracking) {
        const kind = role === 'agent' ? 'agents' : 'distributors';
        const status = role === 'agent' ? { availability: 'offline' } : { status: 'offline' };
        let statusError = '';
        try {
          await api(`/api/${kind}/${encodeURIComponent(profileId)}/status`, { method: 'PATCH', body: JSON.stringify(status) });
        } catch (problem) {
          statusError = problem.message;
        }
        await Location.stopLocationUpdatesAsync(TRACKING_TASK);
        setTracking(false);
        flash(statusError
          ? `${translate(commuterLanguage, 'Location sharing stopped, but status could not be updated')}: ${translate(commuterLanguage, statusError)}`
          : translate(commuterLanguage, 'Location sharing stopped.'));
        return;
      }
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') throw new Error('Allow location access to continue.');
      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.status !== 'granted') throw new Error('Allow background location to keep your GPS current.');
      const kind = role === 'agent' ? 'agents' : 'distributors';
      const status = role === 'agent' ? { availability: 'active' } : { status: 'available' };
      startingShift = true;
      const currentLocation = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await AsyncStorage.multiSet([
        ['tracking_role', role], ['tracking_id', String(profileId)]
      ]);
      if (!await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) {
        await Location.startLocationUpdatesAsync(TRACKING_TASK, {
          accuracy: Location.Accuracy.Highest, timeInterval: 30000, distanceInterval: 0,
          pausesUpdatesAutomatically: false,
          foregroundService: {
            notificationTitle: translate(commuterLanguage, 'Tap & Go location active'),
            notificationBody: translate(commuterLanguage, 'Sharing your position with network operations'),
            notificationColor: '#287a5e'
          }
        });
      }
      await postTrackedLocation(currentLocation);
      await api(`/api/${kind}/${encodeURIComponent(profileId)}/status`, { method: 'PATCH', body: JSON.stringify(status) });
      setTracking(true);
      startingShift = false;
      flash(translate(commuterLanguage, 'Background location sharing is on.'));
    } catch (problem) {
      if (startingShift) {
        try {
          if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
        } catch (cleanupProblem) {
          console.warn('Unable to stop location updates after shift startup failed:', cleanupProblem.message);
        }
        try {
          await AsyncStorage.multiRemove(['tracking_role', 'tracking_id']);
        } catch (cleanupProblem) {
          console.warn('Unable to clear location tracking after shift startup failed:', cleanupProblem.message);
        }
      }
      flash(translate(commuterLanguage, problem.message));
    }
  }

  async function refreshDistributorLocation() {
    try {
      const current = await locate();
      const point = { type: 'Point', coordinates: [current.coords.longitude, current.coords.latitude] };
      await api(`/api/distributors/${encodeURIComponent(profileId)}/location`, {
        method: 'PATCH', body: JSON.stringify({ location: point })
      });
      flash(translate(commuterLanguage, 'GPS refreshed. Operations can now find you nearby.'));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    }
  }

  async function recordTicketSale() {
    if (ticketSaleInProgress.current) return;
    ticketSaleInProgress.current = true;
    try {
      setTicketSaleBusy(true);
      const amount = Number(saleAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive ticket-sale amount.');
      const current = await locate();
      const result = await api(`/api/agents/${encodeURIComponent(profileId)}/ticket-sales`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          location: { type: 'Point', coordinates: [current.coords.longitude, current.coords.latitude] }
        })
      });
      setFloatBalance(String(result.agent.floatBalance));
      setAccount(value => ({ ...value, entity: result.agent }));
      setSaleAmount('');
      flash(translate(commuterLanguage, result.sos?.triggered
        ? 'Ticket sale recorded. Your float is low; operations has been alerted.'
        : 'Ticket sale recorded and float balance updated.'));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    } finally {
      ticketSaleInProgress.current = false;
      setTicketSaleBusy(false);
    }
  }

  async function requestFloatSupport() {
    try {
      const current = await locate();
      const result = await api(`/api/agents/${encodeURIComponent(profileId)}/support`, {
        method: 'POST',
        body: JSON.stringify({
          location: { type: 'Point', coordinates: [current.coords.longitude, current.coords.latitude] },
          message: supportMessage.trim()
        })
      });
      setSupportMessage('');
      flash(result.distributor
        ? translate(commuterLanguage, 'Support request sent. {name} has been assigned to your location.')
          .replace('{name}', result.distributor.name)
        : translate(commuterLanguage, 'Support request sent. An administrator will review it and assign a distributor.'));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    }
  }

  async function chooseBankSlip() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo-library access to attach your bank slip.');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.65
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error('The selected bank-slip photo could not be opened.');
      if (asset.fileSize > 2 * 1024 * 1024) throw new Error('Choose a bank-slip photo smaller than 2 MB.');
      setBankSlip(asset);
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    }
  }

  async function submitFloatSettlement() {
    try {
      const deposit = Number(depositAmount);
      if (!Number.isFinite(deposit) || deposit <= 0) throw new Error('Enter the amount shown on your bank slip.');
      if (!bankReference.trim()) throw new Error('Enter the bank deposit reference.');
      if (!bankSlip?.uri) throw new Error('Attach a photo of the bank slip.');
      setSettlementBusy(true);
      const form = new FormData();
      form.append('depositAmount', String(deposit));
      form.append('bankReference', bankReference.trim());
      form.append('notes', settlementNotes.trim());
      form.append('bankSlip', {
        uri: bankSlip.uri,
        name: bankSlip.fileName || 'bank-slip.jpg',
        type: bankSlip.mimeType || 'image/jpeg'
      });
      const report = await api(`/api/agents/${encodeURIComponent(profileId)}/float-settlements`, {
        method: 'POST',
        body: form
      });
      setSettlements(current => [report, ...current.filter(item => item._id !== report._id)]);
      setDepositAmount('');
      setBankReference('');
      setSettlementNotes('');
      setBankSlip(null);
      flash(translate(commuterLanguage, 'Settlement submitted. Recorded float use: {amount}. Admin approval is required before float is credited.')
        .replace('{amount}', currency(report.usedFloat)));
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
    } finally {
      setSettlementBusy(false);
    }
  }

  async function finishTask(task, amountAdded) {
    try {
      const amount = Number(amountAdded);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive replenishment amount.');
      const completed = await api(`/api/dispatches/${task._id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'completed', amountAdded: amount })
      });
      flash(`${translate(commuterLanguage, 'Replenishment recorded and task completed.')} ${translate(commuterLanguage, 'Top-up recorded:')} ${currency(amount)} · ${translate(commuterLanguage, 'Agent POS float now:')} ${currency(completed.agent?.floatBalance)}`);
      loadTasks();
      return true;
    } catch (problem) {
      flash(translate(commuterLanguage, problem.message));
      return false;
    }
  }

  async function saveProfile(result) {
    if (result.token) {
      await SecureStore.setItemAsync('mobile_token', result.token);
      await SecureStore.setItemAsync('mobile_expires_at', String(result.expiresAt));
      setSocketRefresh(value => value + 1);
    }
    setAccount(value => ({ ...value, ...result.account, entity: result.entity }));
    setProfileOpen(false);
    flash(translate(commuterLanguage, 'Profile updated successfully.'));
  }

  if (!authReady) {
    return <SafeAreaView style={styles.safe}><ActivityIndicator style={styles.loading} color="#287a5e"/></SafeAreaView>;
  }

  const screenTitle = role === 'commuter' ? commuter.title : translate(commuterLanguage,
    role === 'agent' ? 'Agent float' : role === 'distributor' ? 'Distributor tasks' : 'Superagent network');
  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor="#f4f7f3"/>
    <View style={styles.header}>
      <View><Text style={styles.brand}>tap<Text style={styles.brandAccent}>&go</Text></Text><Text style={styles.kicker}>{role === 'commuter' ? commuter.header : translate(commuterLanguage, 'NETWORK SUPPORT')}</Text></View>
      <View style={styles.live}><View style={styles.liveDot}/><Text style={styles.liveText}>{role === 'commuter' ? commuter.live : translate(commuterLanguage, 'LIVE')}</Text></View>
    </View>
    {role === 'commuter' && <View style={styles.languageControls}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: languagePickerOpen }}
        onPress={() => setLanguagePickerOpen(value => !value)} style={styles.languageTrigger}>
        <Text style={styles.languageOptionText}>
          {commuterLanguage === 'rw' ? 'Ururimi' : commuterLanguage === 'fr' ? 'Langue' : 'Language'} · {commuterLanguage === 'en' ? 'English' : commuterLanguage === 'rw' ? 'Kinyarwanda' : 'Français'}
        </Text>
      </TouchableOpacity>
      {languagePickerOpen && <View style={styles.languagePicker}>
        {['rw', 'en', 'fr'].map(language => <TouchableOpacity key={language} accessibilityRole="button"
          accessibilityState={{ selected: commuterLanguage === language }}
          onPress={() => changeCommuterLanguage(language)}
          style={[styles.languageOption, commuterLanguage === language && styles.languageOptionActive]}>
          <Text style={[styles.languageOptionText, commuterLanguage === language && styles.languageOptionTextActive]}>
            {language === 'en' ? 'English' : language === 'rw' ? 'Kinyarwanda' : 'Français'}
          </Text>
        </TouchableOpacity>)}
      </View>}
    </View>}
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{profileOpen ? translate(commuterLanguage, 'Edit your profile') : screenTitle}</Text>
      <Text style={styles.subtitle}>
        {role === 'commuter' ? commuter.subtitle :
          translate(commuterLanguage, role === 'agent' ? 'Keep your balance and support team in sync.' :
            role === 'distributor' ? 'Replenishment tasks assigned to your account.' : 'Manage only the agents assigned to you. POS accounts remain administrator-managed.')}
      </Text>

      {role === 'commuter' && !account && !staffLoginOpen && <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{translate(commuterLanguage, commuterAuthMode === 'register' ? 'Create a commuter account' : 'Sign in to your commuter account')}</Text>
        <Text style={styles.help}>{translate(commuterLanguage, 'Create an account to open the nearby-agent map. Agent and distributor access is created by an administrator.')}</Text>
        {commuterAuthMode === 'register' && <Input label={translate(commuterLanguage, 'Full name')} value={commuterName} onChangeText={setCommuterName} placeholder={translate(commuterLanguage, 'Your name')} autoCapitalize="words" maxLength={80}/>}
        <Input label={translate(commuterLanguage, 'Email')} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" maxLength={254}/>
        <Input label={translate(commuterLanguage, 'Password')} value={password} onChangeText={setPassword} placeholder={translate(commuterLanguage, 'At least 12 characters')} secureTextEntry maxLength={1024}/>
        {loginError ? <Text style={styles.error}>{translate(commuterLanguage, loginError)}</Text> : null}
        <ActionButton onPress={() => authenticateCommuter(commuterAuthMode === 'register')} disabled={loginBusy}>
          {translate(commuterLanguage, loginBusy ? 'Please wait…' : commuterAuthMode === 'register' ? 'Create account & open map' : 'Sign in')}
        </ActionButton>
        <TouchableOpacity accessibilityRole="button" onPress={() => { setCommuterAuthMode(value => value === 'register' ? 'login' : 'register'); setLoginError(''); }} style={styles.authSwitch}>
          <Text style={styles.authSwitchText}>{translate(commuterLanguage, commuterAuthMode === 'register' ? 'Already have an account? Sign in' : 'New commuter? Create an account')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => { setStaffLoginOpen(true); setLoginError(''); }} style={styles.authSwitch}>
          <Text style={styles.authSwitchText}>{translate(commuterLanguage, 'Agent, Distributor or Superagent sign in')}</Text>
        </TouchableOpacity>
      </View>}

      {role === 'commuter' && !account && staffLoginOpen && <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{translate(commuterLanguage, 'Agent, Distributor or Superagent sign in')}</Text>
        <Text style={styles.help}>{translate(commuterLanguage, 'Accounts are created by your network administrator. Contact them if you need access.')}</Text>
        <Input label={translate(commuterLanguage, 'Email')} value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" maxLength={254}/>
        <Input label={translate(commuterLanguage, 'Password')} value={password} onChangeText={setPassword} placeholder={translate(commuterLanguage, 'Your password')} secureTextEntry maxLength={1024}/>
        {loginError ? <Text style={styles.error}>{translate(commuterLanguage, loginError)}</Text> : null}
        <ActionButton onPress={signIn} disabled={loginBusy}>{translate(commuterLanguage, loginBusy ? 'Signing in…' : 'Sign in')}</ActionButton>
        <TouchableOpacity accessibilityRole="button" onPress={() => { setStaffLoginOpen(false); setLoginError(''); }} style={styles.authSwitch}>
          <Text style={styles.authSwitchText}>{translate(commuterLanguage, 'Back to commuter account')}</Text>
        </TouchableOpacity>
      </View>}

      {role === 'commuter' && account?.role === 'commuter' && <>
        <View style={styles.accountBar}>
          <View style={styles.flex}><Text style={styles.cardTitle}>{profile?.name}</Text><Text style={styles.cardSub}>{account.email}</Text></View>
          <TouchableOpacity accessibilityRole="button" onPress={signOut}><Text style={styles.signOut}>{translate(commuterLanguage, 'Sign out')}</Text></TouchableOpacity>
        </View>
        <View style={styles.mapCard}>
          <MapView provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} style={styles.map}
            initialRegion={london}
            region={location ? { ...location, latitudeDelta: 0.008, longitudeDelta: 0.008 } : undefined}
            showsUserLocation={Boolean(location)}>
            {nearby.map(agent => {
              const level = floatLevel(agent);
              return <Marker key={agent._id}
                pinColor={level === 'high' ? '#368461' : level === 'medium' ? '#e2a72e' : '#d9534f'}
                coordinate={{ latitude: agent.location.coordinates[1], longitude: agent.location.coordinates[0] }}
                title={agent.name}
                description={`${agent.place || agent.zone || commuter.agentFallback} · ${commuter.markerActive} · ${commuter[`level${level[0].toUpperCase()}${level.slice(1)}`]} ${commuter.float}`}/>;
            })}
          </MapView>
        </View>
        <Text style={styles.commuterGuide}>{translate(commuterLanguage, 'guide')}</Text>
        <ActionButton onPress={findNearby} disabled={loading}>{loading ? commuter.searching : commuter.find}</ActionButton>
        {nearbySearched && <View style={styles.resultsSummary}>
          <View style={styles.flex}>
            <Text style={styles.resultsEyebrow}>{commuter.nearby}</Text>
            <Text style={styles.resultsCount}>{nearbyCount}</Text>
            <Text style={styles.cardSub}>{commuter.searchResult(nearbyCount)}</Text>
            {nearbyCount > nearby.length && <Text style={styles.showingNearest}>{commuter.showingNearest(nearby.length)}</Text>}
          </View>
          <View style={styles.resultsBadge}><View style={styles.liveDot}/><Text style={styles.resultsBadgeText}>{commuter.active}</Text></View>
        </View>}
        {!nearbySearched && <Text style={styles.sectionTitle}>{commuter.findTopUps}</Text>}
        {nearbySearched && !nearby.length && <View style={styles.empty}>
          <Text style={styles.cardTitle}>{commuter.noneTitle}</Text>
          <Text style={styles.cardSub}>{commuter.noneBody}</Text>
        </View>}
        {nearby.map(agent => {
          return <TouchableOpacity key={agent._id} accessibilityRole="button"
          accessibilityLabel={`${agent.name || commuter.agentFallback}, ${formatAgentDistance(agent.distanceMeters, commuterLanguage)} ${commuter.away}`}
          onPress={() => navigateToAgent(agent)} style={[styles.card, styles.agentResultCard]}>
          <View style={styles.flex}><Text style={styles.cardTitle}>{agent.name}</Text>
            <Text style={styles.cardSub}>{agent.place || agent.zone || commuter.agentFallback} · {commuter.active}</Text>
            <Text style={styles.cardSub}>{formatAgentDistance(agent.distanceMeters, commuterLanguage)} {commuter.away}</Text></View>
          <View style={styles.alignRight}><Text style={styles.cardSub}>{commuter.directions}</Text></View>
        </TouchableOpacity>;
        })}
        <View style={styles.legend}>
          <Text style={styles.cardTitle}>{commuter.availability}</Text>
          <Text style={styles.legendLine}><Text style={styles.highText}>{commuter.high}</Text> — {commuter.highMeaning}</Text>
          <Text style={styles.legendLine}><Text style={styles.mediumText}>{commuter.medium}</Text> — {commuter.mediumMeaning}</Text>
          <Text style={styles.legendLine}><Text style={styles.lowText}>{commuter.low}</Text> — {commuter.lowMeaning}</Text>
          <Text style={styles.help}>{commuter.colorNote}</Text>
        </View>
      </>}

      {role !== 'commuter' && account && account.role !== role && <View style={styles.panel}>
        <Text style={styles.cardTitle}>{translate(commuterLanguage, account.role === 'agent' ? 'Signed in as Agent' : 'Signed in as Distributor')}</Text>
        <Text style={styles.help}>{translate(commuterLanguage, 'Sign out before accessing a different role.')}</Text>
        <ActionButton secondary onPress={signOut}>{translate(commuterLanguage, 'Sign out')}</ActionButton>
      </View>}

      {role !== 'commuter' && account?.role === role && <>
        <View style={styles.accountBar}>
          <View style={styles.avatar}><Text style={styles.avatarText}>👤</Text></View>
          <View style={styles.accountIdentity}>
            <Text style={styles.cardTitle} numberOfLines={1}>{profile?.name}</Text>
            <Text style={styles.cardSub} numberOfLines={1}>{account.email}</Text>
          </View>
          <View style={styles.accountActions}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setProfileOpen(value => !value)} style={styles.accountAction}>
              <Text style={styles.settingsText}>{translate(commuterLanguage, profileOpen ? 'Close settings' : 'Settings')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={signOut} style={styles.accountAction}>
              <Text style={styles.signOut}>{translate(commuterLanguage, 'Sign out')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {profileOpen && <ProfileEditor role={role} profile={profile} email={account.email} language={commuterLanguage} onSaved={saveProfile}/>}
        {!profileOpen && <View style={styles.staffTabs}>
          {(role === 'superagent' ? [['home', 'Home'], ['requests', 'Deletion requests']] : [['home', 'Home'], ['messages', 'Messages']]).map(([key, label]) =>
            <TouchableOpacity key={key} accessibilityRole="button" accessibilityState={{ selected: staffTab === key }}
              onPress={() => setStaffTab(key)} style={[styles.staffTab, staffTab === key && styles.staffTabActive]}>
              <Text style={[styles.staffTabText, staffTab === key && styles.staffTabTextActive]}>{translate(commuterLanguage, label)}</Text>
            </TouchableOpacity>
          )}
        </View>}

        {role === 'superagent' && !profileOpen && <SuperagentDashboard
          language={commuterLanguage}
          activeTab={staffTab}
          onMessage={flash}
        />}

        {role === 'agent' && !profileOpen && staffTab === 'home' && <>
          <View style={styles.balancePanel}>
            <Text style={styles.panelEyebrow}>{translate(commuterLanguage, 'AVAILABLE DIGITAL FLOAT')}</Text>
            <Text style={styles.bigBalance}>{currency(Number(floatBalance))}</Text>
            <Text style={styles.cardSub}>{translate(commuterLanguage, 'Low-float alert threshold')} · {currency(profile?.lowFloatThreshold ?? Math.max(10000, Number(profile?.floatReference || 0) * 0.1, Number(profile?.safeThreshold || 40)))}</Text>
          </View>
          {Number(floatBalance) <= Math.max(10000, Number(profile?.floatReference || 0) * 0.1, Number(profile?.safeThreshold || 40)) && <View style={styles.panel}>
            <Text style={styles.cardTitle}>{translate(commuterLanguage, Number(floatBalance) <= 0 ? 'Float exhausted — support alert sent' : 'Float is running low')}</Text>
            <Text style={styles.help}>{translate(commuterLanguage, 'Low float is reported to operations automatically when a sale is recorded. Open Messages to explain a problem or request an urgent top-up.')}</Text>
          </View>}
          <View style={styles.panel}>
            <Text style={styles.cardTitle}>{translate(commuterLanguage, 'How to sell a ticket')}</Text>
            <Text style={styles.cardSub}>{translate(commuterLanguage, 'Enter the ticket amount and tap Record ticket sale. That amount is automatically deducted from your available float and the balance updates.')}</Text>
            <Text style={styles.help}>{translate(commuterLanguage, 'Example: £10 float − £2 ticket = £8 remaining. A sale above your available float is rejected.')}</Text>
          </View>
          <Input label={translate(commuterLanguage, 'Commuter ticket sale (£)')} value={saleAmount} onChangeText={setSaleAmount}
            placeholder={translate(commuterLanguage, 'Amount paid from float')} keyboardType="decimal-pad"/>
          <ActionButton secondary onPress={recordTicketSale} disabled={ticketSaleBusy}>
            {translate(commuterLanguage, ticketSaleBusy ? 'Recording sale…' : 'Record ticket sale')}
          </ActionButton>
          <Text style={styles.help}>{translate(commuterLanguage, 'Recording a sale deducts it from your available float and helps operations see how much service each agent provides to commuters.')}</Text>
          <ActionButton secondary onPress={toggleTracking}>
            {translate(commuterLanguage, tracking ? 'Stop background location' : 'Enable background SOS monitoring')}
          </ActionButton>
          <Text style={styles.help}>{translate(commuterLanguage, 'When enabled, this device sends GPS to operations. Float changes are recorded only through ticket sales and distributor top-ups; low balances trigger an SOS alert for an administrator to review and assign a distributor.')}</Text>
          <View style={styles.panel}>
            <Text style={styles.cardTitle}>{translate(commuterLanguage, 'End-of-day bank settlement')}</Text>
            <Text style={styles.help}>{translate(commuterLanguage, 'Enter the bank-slip details and attach a photo. Reported float use is calculated from recorded ticket sales. Your balance will not change until an administrator verifies the slip and approves a float credit.')}</Text>
            <Input label={translate(commuterLanguage, 'Amount deposited (£)')} value={depositAmount} onChangeText={setDepositAmount}
              placeholder={translate(commuterLanguage, 'Amount shown on the bank slip')} keyboardType="decimal-pad"/>
            <Input label={translate(commuterLanguage, 'Bank deposit reference')} value={bankReference} onChangeText={setBankReference}
              placeholder={translate(commuterLanguage, 'Reference printed on the slip')} maxLength={100}/>
            <Input label={translate(commuterLanguage, 'Notes (optional)')} value={settlementNotes} onChangeText={setSettlementNotes}
              placeholder={translate(commuterLanguage, 'Explain any discrepancy or issue')} multiline maxLength={500}/>
            <TouchableOpacity accessibilityRole="button" onPress={chooseBankSlip} style={styles.slipButton}>
              {bankSlip ? <Image source={{ uri: bankSlip.uri }} style={styles.slipPreview}/> : null}
              <Text style={styles.slipButtonText}>{translate(commuterLanguage, bankSlip ? 'Change bank-slip photo' : 'Attach bank-slip photo')}</Text>
            </TouchableOpacity>
            <ActionButton onPress={submitFloatSettlement} disabled={settlementBusy || settlements.some(item => item.status === 'pending')}>
              {translate(commuterLanguage, settlementBusy ? 'Submitting report…' : settlements.some(item => item.status === 'pending') ? 'Settlement awaiting admin review' : 'Submit end-of-day settlement')}
            </ActionButton>
            <Text style={styles.sectionTitle}>{translate(commuterLanguage, 'Recent settlement reports')}</Text>
            {settlements.length ? settlements.slice(0, 5).map(report => <View key={report._id} style={styles.settlementRow}>
              <View style={styles.flex}>
                  <Text style={styles.cardSub}>{new Date(report.createdAt).toLocaleDateString()} · {translate(commuterLanguage, 'used')} {currency(report.usedFloat)} · {translate(commuterLanguage, 'deposited')} {currency(report.depositAmount)}</Text>
                {report.reviewNote ? <Text style={styles.cardSub}>{translate(commuterLanguage, 'Admin')}: {report.reviewNote}</Text> : null}
              </View>
              <Text style={styles.cardTitle}>{translate(commuterLanguage, report.status)}</Text>
            </View>) : <Text style={styles.help}>{translate(commuterLanguage, 'No settlement reports submitted yet.')}</Text>}
          </View>
        </>}

        {role === 'agent' && !profileOpen && staffTab === 'messages' && <View style={styles.panel}>
          <Text style={styles.sectionTitle}>{translate(commuterLanguage, 'Messages & support')}</Text>
          <Text style={styles.help}>{translate(commuterLanguage, 'Send a support request to network operations. Your current GPS position is included so an available distributor can be assigned.')}</Text>
          <Input label={translate(commuterLanguage, 'Message (optional)')} value={supportMessage} onChangeText={setSupportMessage}
            placeholder={translate(commuterLanguage, 'Tell operations what you need')} multiline maxLength={500}/>
          <ActionButton onPress={requestFloatSupport}>{translate(commuterLanguage, 'Request float support')}</ActionButton>
        </View>}

        {role === 'distributor' && !profileOpen && staffTab === 'home' && <>
          <View style={styles.distributorHero}>
            <Text style={styles.heroEyebrow}>{translate(commuterLanguage, 'Field dashboard')}</Text>
            <Text style={styles.heroTitle}>{profile?.name || translate(commuterLanguage, 'Distributor')}</Text>
            <Text style={styles.heroSub}>{profile?.place || profile?.zone || translate(commuterLanguage, 'London')} · {translate(commuterLanguage, tracking ? 'ON SHIFT' : 'OFF SHIFT')}</Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}><Text style={styles.heroStatValue}>{tasks.length}</Text><Text style={styles.heroStatLabel}>{translate(commuterLanguage, 'ACTIVE TASKS')}</Text></View>
              <View style={styles.heroStatDivider}/>
              <View style={styles.heroStat}><Text style={styles.heroStatValue}>{tracking ? '●' : '○'}</Text><Text style={styles.heroStatLabel}>{tracking ? translate(commuterLanguage, 'ON SHIFT') : translate(commuterLanguage, 'OFF SHIFT')}</Text></View>
            </View>
          </View>
          <View style={styles.panel}>
            <Text style={styles.cardTitle}>{translate(commuterLanguage, 'Your shift')}</Text>
            <Text style={styles.cardSub}>{translate(commuterLanguage, tracking ? 'Live location is shared with operations.' : 'You are ready to receive nearby tasks.')}</Text>
            <ActionButton onPress={toggleTracking}>{translate(commuterLanguage, tracking ? 'End shift' : 'Go on duty & share GPS')}</ActionButton>
            {tracking && <ActionButton secondary onPress={refreshDistributorLocation}>{translate(commuterLanguage, 'Refresh GPS now')}</ActionButton>}
          </View>
          <View style={styles.panel}>
            <Text style={styles.cardTitle}>{translate(commuterLanguage, 'How tasks work')}</Text>
            <Text style={styles.cardSub}>{translate(commuterLanguage, '1. Go on duty and allow GPS so operations can see your position.')}</Text>
            <Text style={styles.cardSub}>{translate(commuterLanguage, '2. Operations assigns a nearby agent and sends the transfer instructions here.')}</Text>
            <Text style={styles.cardSub}>{translate(commuterLanguage, '3. Open the route, contact the agent if needed, then enter the amount delivered and complete the task.')}</Text>
            <Text style={styles.help}>{translate(commuterLanguage, 'Tasks refresh automatically every 20 seconds. Use Refresh tasks to check now.')}</Text>
          </View>
          <ActionButton secondary onPress={loadTasks} disabled={tasksRefreshing}>
            {translate(commuterLanguage, tasksRefreshing ? 'Refreshing tasks…' : 'Refresh tasks')}
          </ActionButton>
          <Text style={styles.sectionTitle}>{translate(commuterLanguage, 'Assigned replenishments')}</Text>
          {tasks.length ? tasks.map(task => <TaskCard key={task._id} task={task}
            language={commuterLanguage} onNavigate={() => navigateToAgent(task.agent)}
            onCall={() => task.agent?.phone && Linking.openURL(`tel:${encodeURIComponent(task.agent.phone)}`)}
            onSendMessage={text => sendTaskMessage(task, text)}
            onComplete={amount => finishTask(task, amount)}/>) :
            <View style={styles.empty}><Text style={styles.cardTitle}>{translate(commuterLanguage, 'No active assignments')}</Text>
              <Text style={styles.cardSub}>{translate(commuterLanguage, 'Stay on duty so operations can find you and assign a nearby agent.')}</Text></View>}
        </>}

        {role === 'distributor' && !profileOpen && staffTab === 'messages' && <DistributorInboxPanel
          language={commuterLanguage}
          messages={inboxMessages}
          draft={inboxDraft}
          onDraftChange={setInboxDraft}
          onSend={sendInboxMessage}
          sending={inboxSending}
        />}
      </>}
      {message ? <View style={styles.message}><Text style={styles.messageText}>{message}</Text></View> : null}
      <Text style={styles.footer}>{role === 'commuter' ? commuter.footer : translate(commuterLanguage, 'Tap & Go · London network')}</Text>
    </ScrollView>
  </SafeAreaView>;
}

function floatLevel(agent) {
  if (['high', 'medium', 'low'].includes(agent?.liquidityLevel)) return agent.liquidityLevel;
  const balance = Number(agent?.floatBalance ?? agent?.current_float ?? 0);
  const threshold = Math.max(Number(agent?.safeThreshold) || 40, 10000, Number(agent?.floatReference || 0) * 0.1);
  return balance <= threshold ? 'low' : balance <= threshold * 2 ? 'medium' : 'high';
}

function formatAgentDistance(distanceMeters, language = 'en') {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance) || distance < 0) return commuterCopy[language]?.distanceUnavailable || commuterCopy.en.distanceUnavailable;
  return distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
}

function FloatBadge({ agent, language = 'en' }) {
  const level = floatLevel(agent);
  const label = language === 'rw'
    ? ({ high: 'Amafaranga menshi', medium: 'Amafaranga ari hagati', low: 'Amafaranga make' })[level]
    : language === 'fr'
      ? ({ high: 'FONDS ÉLEVÉS', medium: 'FONDS MOYENS', low: 'FONDS FAIBLES' })[level]
      : `${level.toUpperCase()} FLOAT`;
  return <View style={[styles.floatBadge, styles[`floatBadge_${level}`]]}>
    <Text style={[styles.floatBadgeText, styles[`${level}Text`]]}>{label}</Text>
  </View>;
}

function SuperagentDashboard({ language, activeTab, onMessage }) {
  const [agents, setAgents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [place, setPlace] = useState('');
  const [zone, setZone] = useState('');
  const [requestingId, setRequestingId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const [agentRows, deletionRequests] = await Promise.all([
      api('/api/agents'),
      api('/api/superagent/deletion-requests')
    ]);
    setAgents(agentRows);
    setRequests(deletionRequests);
  }

  useEffect(() => {
    let active = true;
    let socket;
    const load = async () => {
      try {
        const [agentRows, deletionRequests] = await Promise.all([
          api('/api/agents'),
          api('/api/superagent/deletion-requests')
        ]);
        if (active) {
          setAgents(agentRows);
          setRequests(deletionRequests);
        }
      } catch (problem) {
        if (active) onMessage(translate(language, problem.message));
      }
    };
    load();
    const timer = setInterval(load, 30000);
    SecureStore.getItemAsync('mobile_token').then(token => {
      if (!active || !token) return;
      socket = io(API, { auth: { token }, reconnection: true });
      socket.on('superagent:deletion-request-updated', request => {
        setRequests(current => [request, ...current.filter(item => item._id !== request._id)]);
        onMessage(translate(language, request.status === 'approved' ? 'Admin approved the agent deletion request.' : 'Admin rejected the agent deletion request.'));
        load();
      });
    }).catch(problem => console.warn('Unable to connect for Superagent updates:', problem.message));
    return () => {
      active = false;
      clearInterval(timer);
      socket?.disconnect();
    };
  }, []);

  function startCreate() {
    setEditing(null);
    setName('');
    setPhone('');
    setPlace('');
    setZone('');
    setError('');
    setFormOpen(true);
  }

  function startEdit(agent) {
    setEditing(agent);
    setName(agent.name || '');
    setPhone(agent.phone || '');
    setPlace(agent.place || '');
    setZone(agent.zone || '');
    setError('');
    setFormOpen(true);
  }

  async function saveAgent() {
    try {
      setSaving(true);
      setError('');
      const path = editing ? `/api/superagent/agents/${encodeURIComponent(editing._id)}` : '/api/superagent/agents';
      const result = await api(path, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, phone, place, zone })
      });
      setFormOpen(false);
      await refresh();
      onMessage(translate(language, editing ? 'Agent details updated.' : 'Agent profile created. Ask an administrator to create the agent login and POS access.'));
    } catch (problem) {
      setError(translate(language, problem.message));
    } finally {
      setSaving(false);
    }
  }

  async function requestDeletion(agent) {
    const text = reason.trim();
    if (!text || requestingId) return;
    try {
      setSaving(true);
      setError('');
      const request = await api(`/api/superagent/agents/${encodeURIComponent(agent._id)}/deletion-requests`, {
        method: 'POST',
        body: JSON.stringify({ reason: text })
      });
      setRequests(current => [request, ...current.filter(item => item._id !== request._id)]);
      setReason('');
      setRequestingId('');
      onMessage(translate(language, 'Deletion request sent to an administrator. The agent remains active until approval.'));
    } catch (problem) {
      setError(translate(language, problem.message));
    } finally {
      setSaving(false);
    }
  }

  const pendingAgentIds = new Set(requests.filter(request => request.status === 'pending').map(request => String(request.agent?._id || request.agent)));
  return <View style={styles.superagentContent}>
    {activeTab === 'home' ? <>
      <View style={styles.panel}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{translate(language, 'Your assigned agents')}</Text>
            <Text style={styles.help}>{translate(language, 'You can manage only agents assigned to your account. Their POS balance is shown here. Only an administrator can create agent sign-in and POS access.')}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={startCreate} style={styles.smallAction}>
            <Text style={styles.settingsText}>＋ {translate(language, 'Add agent')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {formOpen && <View style={styles.panel}>
        <Text style={styles.sectionTitle}>{translate(language, editing ? 'Edit agent profile' : 'New agent profile')}</Text>
        <Input label={translate(language, 'Name')} value={name} onChangeText={setName} placeholder={translate(language, 'Agent name')} autoCapitalize="words" maxLength={80}/>
        <Input label={translate(language, 'Phone number')} value={phone} onChangeText={setPhone} placeholder={translate(language, 'Phone number')} keyboardType="phone-pad" maxLength={32}/>
        <Input label={translate(language, 'Location / area')} value={place} onChangeText={setPlace} placeholder={translate(language, 'Operating area')} autoCapitalize="words" maxLength={100}/>
        <Input label={translate(language, 'Zone')} value={zone} onChangeText={setZone} placeholder={translate(language, 'Agent zone')} maxLength={80}/>
        <Text style={styles.help}>{translate(language, 'The agent profile starts with zero float. An administrator must create the sign-in and POS account and arrange float.')}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actionRow}>
          <View style={styles.actionFlex}><ActionButton secondary onPress={() => setFormOpen(false)}>{translate(language, 'Cancel')}</ActionButton></View>
          <View style={styles.actionFlex}><ActionButton onPress={saveAgent} disabled={saving || !name.trim()}>{translate(language, saving ? 'Saving…' : 'Save agent')}</ActionButton></View>
        </View>
      </View>}
      {agents.map(agent => <View key={agent._id} style={styles.agentManageCard}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{agent.name}</Text>
            <Text style={styles.cardSub}>{agent.agent_id} · {agent.place || agent.zone || translate(language, 'Location not set')}</Text>
          </View>
          <View style={styles.alignRight}>
            <Text style={styles.panelEyebrow}>{translate(language, 'POS FLOAT')}</Text>
            <Text style={styles.amount}>{currency(agent.floatBalance)}</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <View style={styles.actionFlex}><ActionButton secondary onPress={() => startEdit(agent)}>{translate(language, 'Edit')}</ActionButton></View>
          {pendingAgentIds.has(String(agent._id))
            ? <View style={styles.actionFlex}><Text style={styles.pendingLabel}>{translate(language, 'Deletion request pending')}</Text></View>
            : <View style={styles.actionFlex}><ActionButton secondary onPress={() => { setRequestingId(agent._id); setReason(''); setError(''); }}>{translate(language, 'Request deletion')}</ActionButton></View>}
        </View>
        {requestingId === agent._id && <View style={styles.requestReasonBox}>
          <Input label={translate(language, 'Reason for deletion request')} value={reason} onChangeText={setReason}
            placeholder={translate(language, 'Explain why this agent should be removed')} multiline maxLength={500}/>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actionRow}>
            <View style={styles.actionFlex}><ActionButton secondary onPress={() => setRequestingId('')}>{translate(language, 'Cancel')}</ActionButton></View>
            <View style={styles.actionFlex}><ActionButton onPress={() => requestDeletion(agent)} disabled={!reason.trim() || saving}>{translate(language, saving ? 'Sending…' : 'Send request')}</ActionButton></View>
          </View>
        </View>}
      </View>)}
      {!agents.length && !formOpen && <View style={styles.empty}>
        <Text style={styles.cardTitle}>{translate(language, 'No agents assigned yet')}</Text>
        <Text style={styles.cardSub}>{translate(language, 'Ask an administrator to assign agents to your Superagent account.')}</Text>
      </View>}
    </> : <>
      <Text style={styles.sectionTitle}>{translate(language, 'Deletion request history')}</Text>
      {requests.map(request => <View key={request._id} style={styles.panel}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{request.agent?.name || translate(language, 'Agent')}</Text>
          <Text style={[styles.requestStatus, request.status === 'pending' && styles.requestStatusPending]}>{translate(language, request.status)}</Text>
        </View>
        <Text style={styles.cardSub}>{translate(language, 'Your reason')}: {request.reason}</Text>
        {request.reviewNote ? <Text style={styles.help}>{translate(language, 'Administrator response')}: {request.reviewNote}</Text> : null}
        <Text style={styles.help}>{request.createdAt ? new Date(request.createdAt).toLocaleString() : ''}</Text>
      </View>)}
      {!requests.length && <View style={styles.empty}><Text style={styles.cardSub}>{translate(language, 'You have not requested an agent deletion.')}</Text></View>}
    </>}
  </View>;
}

function ProfileEditor({ role, profile, email: accountEmail, language, onSaved }) {
  const [name, setName] = useState(profile?.name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [place, setPlace] = useState(profile?.place || '');
  const [email, setEmail] = useState(accountEmail || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    try {
      setSaving(true);
      setError('');
      const emailChanged = email.trim().toLowerCase() !== accountEmail.trim().toLowerCase();
      const passwordChanged = Boolean(newPassword);
      if (passwordChanged && newPassword !== confirmPassword) {
        throw new Error('New passwords do not match.');
      }
      if ((emailChanged || passwordChanged) && !currentPassword) {
        throw new Error('Enter your current password to change account credentials.');
      }
      const body = role === 'superagent' ? { name } : { name, phone, place };
      if (emailChanged) body.email = email.trim();
      if (passwordChanged) body.newPassword = newPassword;
      if (emailChanged || passwordChanged) body.currentPassword = currentPassword;
      const result = await api('/api/auth/mobile/profile', {
        method: 'PATCH', body: JSON.stringify(body)
      });
      await onSaved(result);
    } catch (problem) {
      setError(translate(language, problem.message));
    } finally {
      setSaving(false);
    }
  }
  return <View style={styles.panel}>
    <Text style={styles.sectionTitle}>{translate(language, 'Profile details')}</Text>
    <Input label={translate(language, 'Name')} value={name} onChangeText={setName} placeholder={translate(language, 'Your name')} autoCapitalize="words" maxLength={80}/>
    {role !== 'superagent' && <>
      <Input label={translate(language, 'Phone number')} value={phone} onChangeText={setPhone} placeholder={translate(language, 'Your phone number')} keyboardType="phone-pad" maxLength={32}/>
      <Input label={translate(language, 'Location / area')} value={place} onChangeText={setPlace} placeholder={translate(language, 'Your area')} autoCapitalize="words" maxLength={100}/>
    </>}
    <Text style={styles.sectionTitle}>{translate(language, 'Login credentials')}</Text>
    <Input label={translate(language, 'Email')} value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" maxLength={254}/>
    <Input label={translate(language, 'Current password (required for credential changes)')} value={currentPassword} onChangeText={setCurrentPassword}
      placeholder={translate(language, 'Your current password')} secureTextEntry maxLength={1024}/>
    <Input label={translate(language, 'New password (optional)')} value={newPassword} onChangeText={setNewPassword}
      placeholder={translate(language, 'At least 12 characters')} secureTextEntry maxLength={1024}/>
    {newPassword ? <Input label={translate(language, 'Confirm new password')} value={confirmPassword} onChangeText={setConfirmPassword}
      placeholder={translate(language, 'Re-enter your new password')} secureTextEntry maxLength={1024}/> : null}
    <Text style={styles.help}>{translate(language, 'Leave the new password blank to keep it unchanged. Changing your email or password signs out other active sessions.')}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <ActionButton onPress={save} disabled={saving}>{translate(language, saving ? 'Saving profile…' : 'Save profile')}</ActionButton>
  </View>;
}

function TaskCard({ task, language = 'en', onNavigate, onCall, onSendMessage, onComplete }) {
  const [amount, setAmount] = useState('');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  async function completeTopUp() {
    if (!amount.trim() || completing) return;
    setCompleting(true);
    try {
      if (await onComplete(amount)) setAmount('');
    } finally {
      setCompleting(false);
    }
  }
  async function sendReply() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    if (await onSendMessage(text)) setReply('');
    setSending(false);
  }
  return <View style={styles.panel}>
    <View style={styles.row}><Text style={styles.cardTitle}>{task.agent?.name || translate(language, 'Agent needing float')}</Text>
      <Text style={styles.badge}>{translate(language, task.status === 'en_route' ? 'EN ROUTE' : 'ASSIGNED')}</Text></View>
    <Text style={styles.cardSub}>{task.agent?.place || task.agent?.zone || translate(language, 'London')} · {translate(language, 'Current float')} {currency(task.agent?.floatBalance)}</Text>
    {task.routeDistanceMeters ? <Text style={styles.cardSub}>{translate(language, 'Route to agent')}: {(task.routeDistanceMeters / 1000).toFixed(1)} km{task.routeDurationSeconds ? ` · ${translate(language, 'Estimated travel time')}: ${Math.ceil(task.routeDurationSeconds / 60)} min` : ''}</Text> : null}
    <View style={styles.taskBriefing}><Text style={styles.taskBriefingTitle}>{translate(language, 'Task briefing')}</Text><Text style={styles.taskBriefingText}>{task.instructions || translate(language, 'No special instructions were provided.')}</Text></View>
    {task.alert?.message ? <Text style={styles.help}>{translate(language, 'Agent’s message')}: {task.alert.message}</Text> : null}
    <Text style={styles.sectionTitle}>{translate(language, 'Message operations')}</Text>
    <View style={styles.conversation}>
      {(task.messages || []).slice(-8).map((item, index) => <View key={`${item.sentAt}-${index}`} style={[styles.chatBubble, item.sender === 'distributor' ? styles.chatBubbleMine : styles.chatBubbleOther]}>
        <Text style={styles.chatSender}>{item.sender === 'distributor' ? translate(language, 'You') : item.senderName || translate(language, 'Admin')}</Text>
        <Text style={styles.chatText}>{item.text}</Text>
      </View>)}
      {!task.messages?.length ? <Text style={styles.help}>{translate(language, 'No messages yet. Ask operations if you need help.')}</Text> : null}
    </View>
    <View style={styles.replyRow}>
      <TextInput value={reply} onChangeText={setReply} placeholder={translate(language, 'Write a reply…')} maxLength={500}
        style={[styles.input, styles.replyInput]} returnKeyType="send" onSubmitEditing={sendReply}/>
      <TouchableOpacity accessibilityRole="button" disabled={!reply.trim() || sending} onPress={sendReply} style={[styles.sendButton, (!reply.trim() || sending) && styles.disabled]}>
        <Text style={styles.sendButtonText}>{translate(language, sending ? 'Sending…' : 'Send reply')}</Text>
      </TouchableOpacity>
    </View>
    <Input label={translate(language, 'Float added (£)')} value={amount} onChangeText={setAmount} placeholder={translate(language, 'Amount replenished')} keyboardType="decimal-pad"/>
    <Text style={styles.help}>{translate(language, 'Enter only the amount actually delivered to the agent’s POS float. Completing this task automatically adds that amount to the agent’s available float. The amount and updated POS balance appear in the admin system immediately.')}</Text>
    <View style={styles.actionRow}>
      <View style={styles.actionFlex}><ActionButton secondary onPress={onNavigate}>{translate(language, 'Open navigation')}</ActionButton></View>
      {task.agent?.phone ? <View style={styles.actionFlex}><ActionButton secondary onPress={onCall}>{translate(language, 'Call agent')}</ActionButton></View> : null}
    </View>
    <ActionButton onPress={completeTopUp} disabled={!amount.trim() || completing}>{translate(language, completing ? 'Recording top-up…' : 'Complete top-up')}</ActionButton>
  </View>;
}

function DistributorInboxPanel({ language, messages, draft, onDraftChange, onSend, sending }) {
  return <View style={styles.panel}>
    <Text style={styles.cardTitle}>{translate(language, 'Operations inbox')}</Text>
    <View style={styles.conversation}>
      {messages.slice(-20).map((item, index) => <View key={`${item.sentAt}-${index}`} style={[styles.chatBubble, item.sender === 'distributor' ? styles.chatBubbleMine : styles.chatBubbleOther]}>
        <Text style={styles.chatSender}>{item.sender === 'distributor' ? translate(language, 'You') : item.senderName || translate(language, 'Admin')}</Text>
        <Text style={styles.chatText}>{item.text}</Text>
        <Text style={styles.chatSender}>{item.sentAt ? new Date(item.sentAt).toLocaleString() : ''}</Text>
      </View>)}
      {!messages.length ? <Text style={styles.help}>{translate(language, 'No direct messages yet. Send a message to operations if you need help.')}</Text> : null}
    </View>
    <View style={styles.replyRow}>
      <TextInput value={draft} onChangeText={onDraftChange}
        placeholder={translate(language, 'Message operations directly')} maxLength={500}
        style={[styles.input, styles.replyInput]} returnKeyType="send" onSubmitEditing={onSend}/>
      <TouchableOpacity accessibilityRole="button" disabled={!draft.trim() || sending} onPress={onSend}
        style={[styles.sendButton, (!draft.trim() || sending) && styles.disabled]}>
        <Text style={styles.sendButtonText}>{translate(language, sending ? 'Sending…' : 'Send reply')}</Text>
      </TouchableOpacity>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f7f3' }, loading: { flex: 1 },
  header: { height: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 20, fontWeight: '800', color: '#202923' }, brandAccent: { color: '#368461' },
  kicker: { fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: '#909b91' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#edf6ef', borderRadius: 20, padding: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#53a879' },
  liveText: { fontSize: 9, fontWeight: '800', color: '#538168' },
  tabs: { flexDirection: 'row', marginHorizontal: 14, marginBottom: 9, backgroundColor: '#e9eee8', padding: 3, borderRadius: 9 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 7 },
  tabActive: { backgroundColor: 'white', elevation: 1 },
  tabText: { fontSize: 11, color: '#788279', fontWeight: '600' },
  tabTextActive: { color: '#267653', fontWeight: '700' },
  languageControls: { alignItems: 'flex-end', marginHorizontal: 14, marginTop: -4, marginBottom: 7 },
  languagePicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, marginTop: 6 },
  languageTrigger: { paddingVertical: 6, paddingHorizontal: 9, borderWidth: 1, borderColor: '#dce5dc', borderRadius: 14, backgroundColor: 'white' },
  languageOption: { paddingVertical: 6, paddingHorizontal: 9, borderWidth: 1, borderColor: '#dce5dc', borderRadius: 14, backgroundColor: 'white' },
  languageOptionActive: { borderColor: '#287a5e', backgroundColor: '#edf6f0' },
  languageOptionText: { fontSize: 9, color: '#657168' },
  languageOptionTextActive: { color: '#287a5e', fontWeight: '700' },
  content: { paddingHorizontal: 14, paddingBottom: 24 },
  title: { fontSize: 22, fontWeight: '800', color: '#202923', marginTop: 6 },
  subtitle: { fontSize: 12, color: '#849086', marginTop: 4, marginBottom: 12 },
  mapCard: { height: 260, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e5eae3', marginBottom: 10 },
  resultsSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white', borderWidth: 1, borderColor: '#e5eae3', borderRadius: 10, padding: 11, marginTop: 12 },
  resultsEyebrow: { fontSize: 9, color: '#78857b', fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  resultsCount: { fontSize: 26, color: '#1d3528', fontWeight: '800', lineHeight: 32, marginTop: 2 },
  showingNearest: { fontSize: 9, color: '#89938b', marginTop: 4 },
  resultsBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#edf6ef', borderRadius: 15, paddingVertical: 6, paddingHorizontal: 8 },
  resultsBadgeText: { fontSize: 8, color: '#397a56', fontWeight: '800' },
  agentResultCard: { paddingLeft: 11 },
  authSwitch: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  authSwitchText: { color: '#287a5e', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  map: { flex: 1 }, button: { minHeight: 45, backgroundColor: '#287a5e', alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingHorizontal: 14, marginTop: 8 },
  secondaryButton: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e1e8e0' },
  buttonText: { color: 'white', fontSize: 12, fontWeight: '700' }, secondaryButtonText: { color: '#3e7254' },
  disabled: { opacity: 0.65 }, field: { marginTop: 9 }, label: { fontSize: 10, color: '#59665d', fontWeight: '700', marginBottom: 4 },
  input: { height: 42, borderWidth: 1, borderColor: '#e3e9e2', backgroundColor: 'white', borderRadius: 8, paddingHorizontal: 11, fontSize: 12, color: '#253129' },
  multilineInput: { minHeight: 76, height: 76, paddingTop: 10, textAlignVertical: 'top' },
  panel: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e7ece5', borderRadius: 10, padding: 12, marginTop: 10 },
  distributorHero: { backgroundColor: '#173f34', borderRadius: 15, padding: 16, marginTop: 10, overflow: 'hidden' },
  heroEyebrow: { color: '#b7d7c3', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  heroTitle: { color: 'white', fontSize: 22, fontWeight: '800', marginTop: 8 },
  heroSub: { color: '#d3e6d9', fontSize: 11, marginTop: 5 },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#ffffff30' },
  heroStat: { flex: 1 },
  heroStatValue: { color: 'white', fontSize: 19, fontWeight: '800' },
  heroStatLabel: { color: '#c4ddcb', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 4 },
  heroStatDivider: { width: 1, height: 34, backgroundColor: '#ffffff35', marginHorizontal: 12 },
  taskBriefing: { backgroundColor: '#f0f7f1', borderRadius: 8, padding: 9, marginTop: 10 },
  taskBriefingTitle: { color: '#287a5e', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  taskBriefingText: { color: '#34433a', fontSize: 11, lineHeight: 17, marginTop: 5 },
  conversation: { backgroundColor: '#f7f9f6', borderRadius: 8, padding: 8, gap: 6 },
  chatBubble: { maxWidth: '90%', borderRadius: 8, padding: 8 },
  chatBubbleOther: { alignSelf: 'flex-start', backgroundColor: 'white', borderWidth: 1, borderColor: '#e8ede7' },
  chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#eaf5ee' },
  chatSender: { color: '#718076', fontSize: 8, fontWeight: '800', marginBottom: 3 },
  chatText: { color: '#27342b', fontSize: 11, lineHeight: 16 },
  replyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginTop: 8 },
  replyInput: { flex: 1, marginTop: 0 },
  sendButton: { minHeight: 42, borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#287a5e', alignItems: 'center', justifyContent: 'center' },
  sendButtonText: { color: 'white', fontSize: 10, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionFlex: { flex: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#27342b', marginTop: 14, marginBottom: 7 },
  commuterGuide: { fontSize: 10, lineHeight: 15, color: '#657168', marginTop: 8, marginBottom: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'white', borderColor: '#e8ede7', borderWidth: 1, borderRadius: 9, padding: 10, marginBottom: 6 },
  flex: { flex: 1 }, alignRight: { alignItems: 'flex-end' }, cardTitle: { fontSize: 12, fontWeight: '700', color: '#253129' },
  cardSub: { fontSize: 10, color: '#89938b', marginTop: 3 }, amount: { fontSize: 12, fontWeight: '800', color: '#397a56' },
  floatBadge: { borderRadius: 16, paddingHorizontal: 9, paddingVertical: 5 },
  floatBadge_high: { backgroundColor: '#eaf5ee' }, floatBadge_medium: { backgroundColor: '#fff5dd' },
  floatBadge_low: { backgroundColor: '#fff0ed' }, highText: { color: '#287a5e', fontWeight: '700' },
  mediumText: { color: '#a87600', fontWeight: '700' }, lowText: { color: '#c44d45', fontWeight: '700' },
  floatBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  slipButton: { minHeight: 44, marginTop: 10, padding: 7, borderRadius: 8, borderWidth: 1, borderColor: '#dce6dc', backgroundColor: '#f8faf7', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  slipButtonText: { color: '#397a56', fontSize: 11, fontWeight: '700' },
  slipPreview: { width: 36, height: 36, borderRadius: 5 },
  settlementRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#edf0ed', gap: 8 },
  legend: { backgroundColor: 'white', borderRadius: 9, padding: 11, marginTop: 11, gap: 6 },
  legendLine: { fontSize: 10, color: '#657168', lineHeight: 15 },
  accountBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'white', padding: 10, borderRadius: 9, marginTop: 10, gap: 9 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#edf6ef', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20 },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountActions: { alignItems: 'flex-end', gap: 9 },
  accountAction: { paddingVertical: 4, paddingHorizontal: 5 },
  settingsText: { color: '#287a5e', fontSize: 10, fontWeight: '700' },
  staffTabs: { flexDirection: 'row', marginTop: 10, backgroundColor: '#e9eee8', padding: 3, borderRadius: 9 },
  staffTab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 7 },
  staffTabActive: { backgroundColor: 'white', elevation: 1 },
  staffTabText: { fontSize: 11, color: '#788279', fontWeight: '600' },
  staffTabTextActive: { color: '#267653', fontWeight: '700' },
  superagentContent: { marginTop: 3 },
  agentManageCard: { backgroundColor: 'white', borderWidth: 1, borderColor: '#e7ece5', borderRadius: 10, padding: 12, marginTop: 9, gap: 8 },
  smallAction: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#edf6ef' },
  pendingLabel: { color: '#8a6c1a', textAlign: 'center', fontSize: 10, fontWeight: '700', paddingVertical: 12 },
  requestReasonBox: { borderTopWidth: 1, borderTopColor: '#edf0ed', paddingTop: 7 },
  requestStatus: { color: '#287a5e', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  requestStatusPending: { color: '#a87600' },
  signOut: { color: '#a44d43', fontSize: 11, fontWeight: '700' },
  balancePanel: { backgroundColor: 'white', borderRadius: 11, padding: 14, borderWidth: 1, borderColor: '#e8ede7', marginTop: 11 },
  panelEyebrow: { fontSize: 9, letterSpacing: 1, color: '#859087', fontWeight: '700' },
  bigBalance: { fontSize: 30, fontWeight: '800', color: '#26342b', marginTop: 5 },
  help: { fontSize: 10, color: '#89938a', lineHeight: 15, marginTop: 8 },
  empty: { alignItems: 'center', backgroundColor: 'white', borderWidth: 1, borderColor: '#e8ede7', borderRadius: 10, padding: 20, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badge: { fontSize: 8, fontWeight: '800', color: '#488260', backgroundColor: '#eef6ef', padding: 6, borderRadius: 12 },
  error: { color: '#b84f44', fontSize: 10, marginTop: 10 },
  message: { marginTop: 10, backgroundColor: '#273e31', borderRadius: 8, padding: 9 },
  messageText: { color: 'white', fontSize: 10, lineHeight: 15 },
  footer: { textAlign: 'center', color: '#a3aaa3', fontSize: 9, marginVertical: 16 }
});
