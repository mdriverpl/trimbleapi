<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
type Vehicle={worker_id:number;worker_name:string;idclient:string;source:string;lat:number|null;lon:number|null;speed:number|null;tfu:number|null;mileage:number|null;heading:number|null;trace_type:number;read_at:string;received_at:string;properties:{key:string;value:string}[]};
const props=defineProps<{api:(path:string)=>Promise<Vehicle[]>;workers:{id:number;name:string}[]}>();
const rows=ref<Vehicle[]>([]),workerId=ref(''),source=ref(''),offset=ref(0),error=ref(''),loading=ref(false),selected=ref<Vehicle|null>(null);
let timer:ReturnType<typeof setInterval>,requestId=0;
async function refresh(){
  const id=++requestId;loading.value=true;
  const query=new URLSearchParams({limit:'100',offset:String(offset.value)});
  if(workerId.value)query.set('workerId',workerId.value);
  if(source.value.trim())query.set('source',source.value.trim());
  try{const result=await props.api('/vehicles?'+query);if(id===requestId){rows.value=result;error.value='';}}
  catch(e){if(id===requestId)error.value=e instanceof Error?e.message:'Błąd pobierania danych.';}
  finally{if(id===requestId)loading.value=false;}
}
function filter(){offset.value=0;selected.value=null;void refresh();}
function date(value:string){return new Date(value).toLocaleString('pl-PL',{timeZone:'UTC'});}
watch(offset,()=>{selected.value=null;void refresh();});
onMounted(()=>{void refresh();timer=setInterval(()=>{if(!loading.value)void refresh();},3000);});
onUnmounted(()=>{clearInterval(timer);requestId++;});
</script>

<template>
  <section class="card">
    <div class="card-head"><div><h2>Bieżące dane pojazdów</h2><p>Najnowszy trace dla każdego source w obrębie workera. Daty w UTC.</p></div><span class="badge">Odświeżanie co 3 s</span></div>
    <form class="vehicle-filters" @submit.prevent="filter">
      <label>Worker<select v-model="workerId" @change="filter"><option value="">Wszystkie konta</option><option v-for="w in workers" :key="w.id" :value="String(w.id)">{{w.name}}</option></select></label>
      <label>ID pojazdu (source)<input v-model="source" placeholder="Dokładny identyfikator"></label>
      <button :disabled="loading">Filtruj</button>
    </form>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <div v-if="!rows.length" class="empty">{{loading?'Pobieranie…':'Brak danych. Pojazdy pojawią się po pobraniu zdarzeń Trimble.'}}</div>
    <div v-else class="table-wrap"><table>
      <thead><tr><th>Source / klient</th><th>Lat / lon</th><th>Speed</th><th>Data odczytu (UTC)</th><th>TFU · zużycie całkowite</th><th>Przebieg</th><th>Kierunek</th><th></th></tr></thead>
      <tbody><tr v-for="v in rows" :key="v.worker_id+':'+v.source">
        <td><b>{{v.source}}</b><small>{{v.worker_name}} · {{v.idclient}}</small></td>
        <td>{{v.lat??'—'}}<small>{{v.lon??'—'}}</small></td><td>{{v.speed??'—'}}</td>
        <td>{{date(v.read_at)}}</td><td>{{v.tfu??'—'}}</td><td>{{v.mileage??'—'}}</td><td>{{v.heading??'—'}}</td>
        <td><button class="quiet" @click="selected=v">Szczegóły</button></td>
      </tr></tbody>
    </table></div>
    <div class="card-head"><p>Jednostki liczb zgodne z Trimble. „—” oznacza brak wartości w najnowszym trace.</p><div class="actions"><button class="quiet" :disabled="offset===0||loading" @click="offset=Math.max(0,offset-100)">← Poprzednie</button><span>{{rows.length?offset+1:0}}–{{rows.length?offset+rows.length:0}}</span><button class="quiet" :disabled="rows.length<100||loading" @click="offset+=100">Następne →</button></div></div>
    <template v-if="selected"><div class="card-head"><h3>{{selected.source}} · pełny odczyt</h3><button class="quiet" @click="selected=null">Zamknij</button></div><pre>{{JSON.stringify(selected,null,2)}}</pre></template>
  </section>
</template>

<style scoped>
.vehicle-filters{display:flex;gap:16px;align-items:end;padding:0 24px 20px;flex-wrap:wrap}.vehicle-filters label{margin:0;min-width:200px;flex:1}.vehicle-filters button{margin-bottom:1px}
</style>
