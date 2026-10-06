<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
type Worker={id:number;name:string;idclient:string;user:string;active:boolean;serviceId:number;status:string;nextRun:number;lastRun:number|null;lastSuccess:number|null;failures:number;error:string|null;mark:string;dataIntervalSeconds:number|null;emptyIntervalSeconds:number|null};
type Service={id:number;name:string;active:boolean;mode:string;intervalSeconds:number;dataIntervalSeconds:number;emptyIntervalSeconds:number};
type Run={id:number;started:number;finished:number;success:boolean;error:string|null};
const props=defineProps<{workers:Worker[];services:Service[];enabled:boolean;busy:boolean;api:(path:string,method?:string,body?:unknown)=>Promise<any>}>();
const emit=defineEmits<{create:[];createService:[];edit:[worker:Worker];remove:[id:number];run:[id:number];refresh:[]}>();
const search=ref(''),serviceId=ref(''),filter=ref('all'),selectedId=ref<number|null>(null),pending=ref<number|null>(null),error=ref(''),historyError=ref(''),history=ref<Run[]>([]),now=ref(Date.now());
const selected=computed(()=>props.workers.find(w=>w.id===selectedId.value));
const service=(w:Worker)=>props.services.find(s=>s.id===w.serviceId);
function state(w:Worker){
  if(w.status==='running')return w.active?'Pobieranie':'Kończy pobieranie';
  if(!w.active)return 'Wyłączony';
  if(!props.enabled)return 'Harmonogram wstrzymany';
  if(!service(w)?.active)return 'Usługa wyłączona';
  return w.status==='error'?'Błąd · ponowienie':'Oczekuje';
}
const filtered=computed(()=>props.workers.filter(w=>{
  const query=search.value.trim().toLocaleLowerCase();
  return (!query||[w.name,w.idclient,w.user,String(w.id)].some(v=>v.toLocaleLowerCase().includes(query)))
    &&(!serviceId.value||w.serviceId===Number(serviceId.value))
    &&(filter.value==='all'||filter.value==='active'&&w.active||filter.value==='off'&&!w.active||filter.value==='error'&&!!w.failures||filter.value==='running'&&w.status==='running');
}));
function canRun(w:Worker){return props.enabled&&w.active&&!!service(w)?.active&&w.status!=='running';}
function waiting(w:Worker){return canRun(w)&&w.nextRun>now.value;}
function progress(w:Worker){
  if(!w.lastRun||w.nextRun<=w.lastRun)return 0;
  return Math.min(100,Math.max(0,(now.value-w.lastRun)/(w.nextRun-w.lastRun)*100));
}
function date(value:number|null){return value?new Date(value).toLocaleString('pl-PL'):'—';}
function next(w:Worker){
  if(w.status==='running')return 'W trakcie';
  if(!canRun(w))return 'Wstrzymane';
  const seconds=Math.max(0,Math.ceil((w.nextRun-now.value)/1000));
  return seconds?`Za ${Math.floor(seconds/60)} min ${seconds%60} s`:'W kolejce';
}
async function toggle(w:Worker){
  pending.value=w.id;error.value='';
  try{await props.api(`/workers/${w.id}/active`,'PATCH',{active:!w.active});emit('refresh');}
  catch(e){error.value=e instanceof Error?e.message:'Nie udało się zmienić aktywności.';}
  finally{pending.value=null;}
}
let generation=0;
async function loadHistory(){
  const worker=selectedId.value,id=++generation;
  if(worker===null)return;
  try{const rows=await props.api(`/runs?workerId=${worker}&limit=20`);if(id===generation){history.value=rows;historyError.value='';}}
  catch(e){if(id===generation)historyError.value=e instanceof Error?e.message:'Błąd historii.';}
}
watch(selectedId,()=>{history.value=[];historyError.value='';void loadHistory();});
watch(()=>selected.value?.lastRun,()=>{void loadHistory();});
const timer=setInterval(()=>now.value=Date.now(),250);
onUnmounted(()=>{clearInterval(timer);generation++;});
</script>

<template>
 <section class="card">
  <div class="card-head"><div><h2>Zarządzanie workerami</h2><p>Konta klientów, usługi i harmonogram pobierania.</p></div><button :disabled="busy||!services.length" @click="emit('create')">+ Dodaj worker</button></div>
  <div v-if="!services.length" class="empty"><h3>Najpierw dodaj usługę</h3><p>Worker potrzebuje usługi Trimble, SOAP lub demo.</p><button @click="emit('createService')">Dodaj usługę</button></div>
  <template v-else>
   <div class="filters">
    <label>Szukaj<input v-model="search" type="search" placeholder="Nazwa, idclient, użytkownik lub ID"></label>
    <label>Usługa<select v-model="serviceId"><option value="">Wszystkie usługi</option><option v-for="s in services" :key="s.id" :value="String(s.id)">{{s.name}}</option></select></label>
    <label>Status<select v-model="filter"><option value="all">Wszystkie</option><option value="active">Aktywne</option><option value="off">Wyłączone</option><option value="running">Pobierające</option><option value="error">Z błędami</option></select></label>
   </div>
   <div v-if="error" class="error" role="alert">{{error}}</div>
   <p class="explanation">Wyłączenie workera blokuje następne zapytania; bieżące pobranie zostanie dokończone. Włączenie zachowuje znacznik i zaplanowaną przerwę.</p>
   <div v-if="!filtered.length" class="empty">{{workers.length?'Brak workerów pasujących do filtrów.':'Brak workerów. Dodaj pierwsze konto klienta.'}}</div>
   <div v-else class="table-wrap"><table>
    <thead><tr><th>Worker / klient</th><th>Usługa / użytkownik</th><th>Status</th><th>Postęp</th><th>Następne pobranie</th><th>Ostatni sukces</th><th>Zarządzanie</th></tr></thead>
    <tbody><tr v-for="w in filtered" :key="w.id" :class="{chosen:selectedId===w.id}">
     <td><b>{{w.name}}</b><small>#{{w.id}} · {{w.idclient}}</small></td>
     <td>{{service(w)?.name??'—'}}<small>{{w.user||'Bez użytkownika'}}</small></td>
     <td><span class="badge activity-badge" :class="{bad:!!w.failures&&w.status!=='running',blue:w.status==='running'}">
      <span v-if="w.status==='running'" class="activity-spinner" aria-hidden="true"></span>
      <span v-else-if="canRun(w)" class="activity-pulse" aria-hidden="true"></span>
      <span v-else class="activity-paused" aria-hidden="true"></span>
      {{state(w)}}
     </span><small v-if="w.failures" class="red">Kolejne błędy: {{w.failures}}</small></td>
     <td class="progress-cell">
      <template v-if="w.status==='running'">
       <div class="progress-label"><span>Pobieranie danych</span></div>
       <div class="activity-track downloading" role="progressbar" aria-label="Pobieranie danych — postęp nieznany"><span></span></div>
      </template>
      <template v-else-if="canRun(w)&&w.lastRun&&w.nextRun>w.lastRun">
       <div class="progress-label"><span>{{waiting(w)?'Upływ pauzy':'W kolejce'}}</span><b>{{Math.floor(progress(w))}}%</b></div>
       <div class="activity-track" :class="{retry:!!w.failures}" role="progressbar" aria-label="Upływ przerwy przed kolejnym pobraniem" :aria-valuenow="Math.floor(progress(w))" :aria-valuemin="0" :aria-valuemax="100"><span :style="{width:progress(w)+'%'}"></span></div>
      </template>
      <template v-else>
       <div class="progress-label"><span>{{canRun(w)?'W kolejce':'Wstrzymane'}}</span></div>
       <div class="activity-track" :class="{downloading:canRun(w),paused:!canRun(w)}" aria-hidden="true"><span></span></div>
      </template>
     </td>
     <td class="activity-cell"><span class="countdown">{{next(w)}}</span>
      <small v-if="canRun(w)&&w.nextRun">{{date(w.nextRun)}}</small>
     </td><td>{{date(w.lastSuccess)}}</td>
     <td><div class="worker-actions">
      <button class="secondary" :disabled="busy||pending!==null" @click="toggle(w)">{{w.active?'Wyłącz':'Włącz'}}</button>
      <button class="quiet" :disabled="busy||pending!==null||!canRun(w)" @click="emit('run',w.id)">Pobierz teraz</button>
      <button class="quiet" :disabled="busy||w.status==='running'" @click="emit('edit',w)">Edytuj</button>
      <button class="quiet" @click="selectedId=selectedId===w.id?null:w.id">Szczegóły</button>
      <button class="quiet red" :disabled="busy||w.status==='running'" @click="emit('remove',w.id)">Usuń</button>
     </div></td>
    </tr></tbody>
   </table></div>
   <p class="explanation">Wyświetlono {{filtered.length}} z {{workers.length}} kont. Statusy odświeżają się co 3 sekundy.</p>
  </template>
 </section>
 <section v-if="selected" class="card">
  <div class="card-head"><div><h2>{{selected.name}} · szczegóły</h2><p>Worker #{{selected.id}} · {{selected.idclient}}</p></div><button class="quiet" @click="selectedId=null">Zamknij</button></div>
  <div class="details"><dl>
   <div><dt>Usługa</dt><dd>{{service(selected)?.name}}</dd></div>
   <div><dt>Ostatnia próba</dt><dd>{{date(selected.lastRun)}}</dd></div>
   <div><dt>Ostatni sukces</dt><dd>{{date(selected.lastSuccess)}}</dd></div>
   <div><dt>Harmonogram</dt><dd>{{service(selected)?.mode==='trimble'?'Pauza szybka: '+(selected.dataIntervalSeconds??service(selected)?.dataIntervalSeconds??3)+' s / pauza długa: '+(selected.emptyIntervalSeconds??service(selected)?.emptyIntervalSeconds??180)+' s':`Co ${service(selected)?.intervalSeconds} s`}}</dd></div>
   <div class="mark"><dt>Ostatni znacznik mark</dt><dd>{{selected.mark||'Pierwsze pobranie: doba wstecz (UTC)'}}</dd></div>
  </dl><p v-if="selected.error" class="error">{{selected.error}}</p></div>
  <div class="card-head"><h2>Ostatnie 20 prób tego workera</h2></div>
  <p v-if="historyError" class="error">{{historyError}}</p>
  <div v-else-if="!history.length" class="empty">Brak zapisanych prób.</div>
  <div v-else class="table-wrap"><table><thead><tr><th>Czas</th><th>Wynik</th><th>Czas trwania</th><th>Błąd</th></tr></thead><tbody><tr v-for="r in history" :key="r.id"><td>{{date(r.finished)}}</td><td><span class="badge" :class="{bad:!r.success}">{{r.success?'Sukces':'Błąd'}}</span></td><td>{{r.finished-r.started}} ms</td><td>{{r.error??'—'}}</td></tr></tbody></table></div>
 </section>
</template>

<style scoped>
.progress-cell{min-width:210px}.progress-label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:#557281;font-variant-numeric:tabular-nums}.progress-label b{color:#087f79}.progress-cell .activity-track{height:12px;width:100%;min-width:165px;margin-top:8px;border:1px solid #dbe7e5}.progress-cell .activity-track.paused{background:#edf0f2;border-color:#e0e6ea}.progress-cell .activity-track.paused>span{width:0}
.activity-badge{display:inline-flex;align-items:center;gap:7px}.activity-spinner{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:worker-spin .8s linear infinite;flex-shrink:0}.activity-pulse{width:7px;height:7px;background:currentColor;border-radius:50%;animation:worker-pulse 1.8s ease-in-out infinite;flex-shrink:0}.activity-paused{width:8px;height:10px;border-left:3px solid currentColor;border-right:3px solid currentColor;opacity:.55;flex-shrink:0}.activity-cell{min-width:170px}.countdown{font-variant-numeric:tabular-nums}.activity-track{height:5px;margin-top:9px;width:140px;max-width:100%;border-radius:6px;overflow:hidden;background:#e6efed}.activity-track>span{display:block;height:100%;background:#159d8e;border-radius:inherit;transition:width .25s linear}.activity-track.retry{background:#f8e9e3}.activity-track.retry>span{background:#bf7950}.activity-track.downloading{background:#e1edfb}.activity-track.downloading>span{background:#4680b6;width:45%;animation:worker-download 1.3s ease-in-out infinite}.queue-dots{display:flex;gap:4px;margin-top:8px}.queue-dots i{width:4px;height:4px;background:#159d8e;border-radius:50%;animation:worker-pulse 1.2s ease-in-out infinite}.queue-dots i:nth-child(2){animation-delay:.2s}.queue-dots i:nth-child(3){animation-delay:.4s}
@keyframes worker-spin{to{transform:rotate(360deg)}}
@keyframes worker-pulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
@keyframes worker-download{0%{transform:translateX(-110%)}100%{transform:translateX(330%)}}
@media(prefers-reduced-motion:reduce){.activity-spinner,.activity-pulse,.queue-dots i,.activity-track.downloading>span{animation:none}.activity-track>span{transition:none}}
.filters{display:flex;gap:16px;padding:0 24px;flex-wrap:wrap}.filters label{flex:1;min-width:180px}.filters label:first-child{flex:2}.explanation{margin:8px 24px 20px;font-size:12px}.worker-actions{display:flex;flex-wrap:wrap;gap:4px;min-width:200px}.worker-actions button{font-size:12px;padding:7px 10px}.chosen{background:#f0f9f7}.details{padding:0 24px}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}dt{font-size:12px;color:#758591}dd{margin:6px 0;font-size:14px;overflow-wrap:anywhere}.mark{grid-column:1/-1}@media(max-width:720px){dl{grid-template-columns:1fr}.card-head{flex-wrap:wrap}}
</style>
