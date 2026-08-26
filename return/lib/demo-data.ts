export type Authority = 'submitted'|'verified';
export type Consent = 'private'|'research_only'|'public_anonymous'|'public_attributed';
export type Visibility = 'public'|'restricted'|'sealed';
export type AssertionMode = 'verified_fact'|'attributed_claim'|'open_question';
export const museum = { id:'museum_demo_01', name:'The Halcyon Museum of Material Memory' };
export const collection = [
  { id:'moonbird-mask', accession:'RT.1930.014', title:'Moonbird Mask', date:'c. 1930', material:'Carved nightwood, shell pigment', region:'Aru coast · place attribution under review', gap:'1959–1968', status:'Record open', tone:'clay' },
  { id:'riverstone-vessel', accession:'RT.1912.006', title:'Riverstone Vessel', date:'c. 1912', material:'River clay, mineral slip', region:'Upper Vale', gap:null, status:'Context added', tone:'stone' },
  { id:'woven-signal-cloth', accession:'RT.1946.031', title:'Woven Signal Cloth', date:'1946', material:'Dyed bast fibre', region:'North Channel', gap:'1946–1952', status:'Under review', tone:'indigo' },
  { id:'tide-listening-stone', accession:'RT.1888.019', title:'Tide Listening Stone', date:'late 19th c.', material:'Basalt, copper', region:'West Shoals', gap:null, status:'Record stable', tone:'charcoal' },
  { id:'reed-memory-box', accession:'RT.1921.044', title:'Reed Memory Box', date:'1921', material:'Reed, cedar, cotton', region:'Aru delta', gap:'1921–1934', status:'Record open', tone:'reed' },
  { id:'four-winds-bowl', accession:'RT.1904.008', title:'Four Winds Bowl', date:'c. 1904', material:'Hammered brass', region:'Lowland route', gap:null, status:'Context added', tone:'brass' },
  { id:'dawn-marker', accession:'RT.1962.027', title:'Dawn Marker', date:'1962', material:'Painted cedar', region:'East Ridge', gap:null, status:'Record stable', tone:'oxide' },
  { id:'harbor-thread-map', accession:'RT.1938.012', title:'Harbor Thread Map', date:'1938', material:'Linen, cotton thread', region:'Old Harbor', gap:'1939–1951', status:'Under review', tone:'linen' },
];
export const moonbird = { ...collection[0], version:3,
  label:'Carved ceremonial mask, made around 1930. The museum acquired the mask from Lorne Gallery in 1968. Its movement and use before acquisition are not yet fully documented.',
  questions:['Who photographed the mask in Aru village in 1959?','How did it move between the village and Lorne Gallery?','What language should describe its ceremonial use?'],
  timeline:[
    { year:'c. 1930', title:'Mask made', detail:'Material analysis supports an early 20th-century date.', authority:'verified' as Authority },
    { year:'1959', title:'Community photograph', detail:'A newly submitted photograph appears to show the mask in Aru village.', authority:'submitted' as Authority },
    { year:'1959–68', title:'Movement unknown', detail:'No verified transfer or custody records have been identified.', authority:'submitted' as Authority, gap:true },
    { year:'1968', title:'Museum acquisition', detail:'Purchased from Lorne Gallery; prior owner is not listed on the invoice.', authority:'verified' as Authority },
    { year:'2026', title:'Joint research opened', detail:'Community and curatorial review is in progress.', authority:'verified' as Authority },
  ],
};
export const seedSubmissions = [
  { id:'SUB-1042', objectId:'moonbird-mask', title:'1959 Aru village photograph', kind:'Photograph', contributor:'Ena Varo', consent:'public_attributed' as Consent, status:'received', time:'18 min ago', requested:'Correct the public label', note:'The reverse reads “Moonbird dancers, first rains, 1959.”', authority:'submitted' as Authority },
  { id:'SUB-1041', objectId:'moonbird-mask', title:'Oral history recording', kind:'Oral history', contributor:'Community archive', consent:'research_only' as Consent, status:'needs information', time:'Yesterday', requested:'Add cultural context', note:'Ceremonial context described; speaker attribution needs confirmation.', authority:'submitted' as Authority },
  { id:'SUB-1039', objectId:'woven-signal-cloth', title:'Harbor registry excerpt', kind:'Document', contributor:'S. Leto', consent:'public_anonymous' as Consent, status:'under review', time:'2 days ago', requested:'Investigate provenance', note:'Registry entry places a related cloth at North Channel in 1948.', authority:'submitted' as Authority },
];
export const activities = [
  { actor:'Community Agent', action:'submitted new evidence', detail:'1959 Aru village photograph', time:'18 min' },
  { actor:'Curator Agent', action:'identified a provenance gap', detail:'Moonbird Mask · 1959–1968', time:'14 min' },
  { actor:'Policy Gateway', action:'denied unsupported official change', detail:'Submitted evidence cannot authorize publication', time:'11 min' },
  { actor:'Mina, Curator', action:'opened evidence comparison', detail:'Case RC-014', time:'8 min' },
  { actor:'System', action:'prepared label revision 4', detail:'Awaiting human approval', time:'3 min' },
];
export const officialEvidence = [
  { id:'EV-068', title:'1968 gallery invoice', date:'18 Jun 1968', place:'Lorne Gallery', detail:'Seller: Lorne Gallery · Prior owner: not listed', authority:'verified' as Authority, consent:'public_attributed' as Consent },
  { id:'EV-059', title:'1959 community photograph', date:'Aug 1959', place:'Aru village', detail:'Photographer: under review · Reverse inscription recorded', authority:'submitted' as Authority, consent:'public_attributed' as Consent },
];
