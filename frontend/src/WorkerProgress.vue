<script setup lang="ts">
import { ref,onUnmounted } from 'vue';
type Worker={id:number;name:string;active:boolean;serviceId:number;status:string;nextRun:number;lastRun:number|null;failures:number};
const props=defineProps<{workers:Worker[];services:{id:number;active:boolean}[];enabled:boolean}>();
const now=ref(Date.now());
const timer=setInterval(()=>now.value=Date.now(),250);
onUnmounted(()=>clearInterval(timer));
function mode(w:Worker){
 if(w.status==='running')return 'running';
 if(!w.active||!props.enabled||!props.services.find(s=>s.id===w.serviceId)?.active)return 'paused';
 return w.nextRun>now.value?'waiting':'queued';
}
function percent(w:Worker){
 if(!w.lastRun||w.nextRun<=w.lastRun)return 0;
 return Math.min(100,Math.max(0,100*(now.value-w.lastRun)/(w.nextRun-w.lastRun)));
}
function label(w:Worker){
 if(mode(w)==='running')return 'Pobieranie danych…';
 if(mode(w)==='queued')return 'W kolejce do pobrania';
 if(!w.active)return 'Worker wyłączony';
 if(!props.enabled)return 'Harmonogram wstrzymany';
 if(mode(w)==='paused')return 'Usługa wyłączona';
 const seconds=Math.max(0,Math.ceil((w.nextRun-now.value)/1000));
 return `${w.failures?'Ponowienie po błędzie':'Następne pobranie'} za ${Math.floor(seconds/60)} min ${seconds%60} s`;
}
</script>

<template>
 <section v-if="workers.length" class="card progress-overview" aria-label="Postęp workerów">
  <div class="card-head"><div><h2>Postęp workerów</h2><p>Pobieranie danych i odliczanie do następnego zapytania.</p></div></div>
  <div class="progress-list">
   <article v-for="w in workers" :key="w.id" class="worker-progress" :class="[mode(w),{retry:w.failures&&mode(w)==='waiting'}]">
    <div class="progress-heading"><strong>{{w.name}} <small>#{{w.id}}</small></strong><span>{{mode(w)==='waiting'&&w.lastRun?Math.floor(percent(w))+'% pauzy':mode(w)==='running'?'Pobieranie':mode(w)==='paused'?'Pauza':'Kolejka'}}</span></div>
    <div class="visible-progress-track" role="progressbar" :aria-label="w.name+': '+label(w)" :aria-valuenow="mode(w)==='waiting'&&w.lastRun?Math.floor(percent(w)):undefined" :aria-valuemin="0" :aria-valuemax="100">
     <span :style="mode(w)==='waiting'?{width:percent(w)+'%'}:{}"></span>
    </div>
    <p>{{label(w)}}</p>
   </article>
  </div>
 </section>
</template>

<style scoped>
.progress-list{padding:0 24px 24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}.worker-progress{min-width:0;padding:16px;border:1px solid #d9e6e4;background:#f8fcfb;border-radius:9px}.progress-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:13px}.progress-heading strong{overflow-wrap:anywhere;min-width:0}.progress-heading span{flex-shrink:0;color:#087f79;font-variant-numeric:tabular-nums;font-weight:600}.visible-progress-track{width:100%;height:16px;background:#dcebe7;border:1px solid #ccdfd9;border-radius:8px;overflow:hidden;margin-top:12px}.visible-progress-track>span{display:block;height:100%;background:linear-gradient(90deg,#087f79,#26b6a0);border-radius:inherit;transition:width .25s linear}.worker-progress p{font-size:12px;margin:8px 0 0;font-variant-numeric:tabular-nums}.running .visible-progress-track>span{width:40%;background:#4680b6;animation:visible-download 1.3s ease-in-out infinite}.running .progress-heading span{color:#3975aa}.queued .visible-progress-track>span{width:100%;animation:queue-pulse 1.5s ease-in-out infinite}.paused .visible-progress-track{background:#e6e9ed;border-color:#d5dbe1}.paused .visible-progress-track>span{width:0}.paused .progress-heading span{color:#758591}.retry .visible-progress-track>span{background:#bf7950}.retry .progress-heading span{color:#a45c34}
@keyframes visible-download{from{transform:translateX(-110%)}to{transform:translateX(350%)}}@keyframes queue-pulse{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.visible-progress-track>span{animation:none!important;transition:none}}
</style>
