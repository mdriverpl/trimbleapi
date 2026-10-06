import { chromium,expect } from '@playwright/test';

// Read-only browser test: every API request is intercepted with synthetic data.
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 const end=Date.now()+60_000;
 const worker={id:1,name:'Worker testowy',idclient:'demo',user:'demo',active:true,serviceId:1,status:'idle',nextRun:end,lastRun:end-120_000,lastSuccess:end-120_000,failures:0,error:null,mark:'demo',dataIntervalSeconds:null,emptyIntervalSeconds:null};
 const service={id:1,name:'Trimble',active:true,mode:'trimble',intervalSeconds:60,dataIntervalSeconds:3,emptyIntervalSeconds:180};
 await page.route('**/api/**',route=>route.fulfill({json:route.request().url().includes('/status')?{enabled:true,capacity:10,running:0,uptime:100,workers:[worker],services:[service]}:[]}));
 await page.goto('http://127.0.0.1:3000');
 await page.getByLabel('Token administratora').fill('browser-test-token');
 await page.getByRole('button',{name:'Otwórz panel'}).click();
 for(const width of [1440,375]){
  await page.setViewportSize({width,height:900});
  for(const tab of ['Przegląd','Workery']){
   await page.getByRole('button',{name:tab,exact:true}).click();
   const region=page.getByRole('region',{name:'Postęp workerów'});
   await expect(region).toBeVisible();
   const bar=region.getByRole('progressbar');await expect(bar).toBeVisible();
   const box=await bar.boundingBox();
   if(!box||box.width<150||box.height<14||box.x<0||box.x+box.width>width)throw Error(`Progress outside viewport: ${width}, ${tab}`);
   await expect(region).toContainText('% pauzy');
  }
 }
 console.log('PASS: progress visible on overview and workers, desktop and mobile, without horizontal scrolling.');
}finally{await browser.close();}
