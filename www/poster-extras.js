/* 海报手填值按日期保存；独立记录优先，历史快照兜底。 */
(function () {
 'use strict';
 const date=document.getElementById('pstDate'), f=document.getElementById('pstFiam'), p=document.getElementById('pstPeople');
 if(!date||!f||!p)return;
 let loadedDay='', serial=0, queue=Promise.resolve(), loading=Promise.resolve();
 const today=()=>todayStr();
 async function read(day){
  if(!app.db)throw new Error('财务数据库尚未就绪');
  const saved=await new Promise((resolve,reject)=>{
   const r=app.db.transaction('dailyData','readonly').objectStore('dailyData').get('poster-extra:'+day);
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  if(saved)return saved;
  const fr=await app.getFinanceRecordFor(day);
  const e=fr&&fr.data&&fr.data._posterExtras;
  return e&&e.date===day?e:{date:day,fiambreria:'',people:''};
 }
 function persist(){
  if(!loadedDay||f.disabled||(date.value||today())!==loadedDay)return queue;
  const record={id:'poster-extra:'+loadedDay,date:loadedDay,fiambreria:f.value.trim(),people:p.value.trim(),updated_at:Date.now()};
  queue=queue.catch(()=>{}).then(async()=>{
   // 空白表示不改已保存值；想设成零，明确输入 0。
   const previous=await read(record.date);
   if(!record.fiambreria)record.fiambreria=previous.fiambreria??'';
   if(!record.people)record.people=previous.people??'';
   if(!await app._putDailyRecord(record))throw new Error('保存失败');
  });
  queue.catch(()=>app.showToast('海报手填信息保存失败，请稍后重试','error'));
  return queue;
 }
 function load(){
  const day=date.value||today();date.value=day;
  const ticket=++serial;
  f.disabled=p.disabled=true;f.value=p.value='';loadedDay='';
  loading=(async()=>{
   const e=await readSaved(day);
   if(ticket!==serial)return;
   f.value=e.fiambreria??'';p.value=e.people??'';loadedDay=day;
   f.disabled=p.disabled=false;
  })();
  loading.catch(()=>{if(ticket===serial)app.showToast('日期信息读取失败，请重新选择日期','error');});
  return loading;
 }
 const save=document.getElementById('pstSaveExtras');
 if(save)save.addEventListener('click',async()=>{
  const day=date.value||today();
  save.disabled=true;
  try{
   if(day!==loadedDay)await loading;
   if(day!==loadedDay||f.disabled||(date.value||today())!==day)throw new Error('日期未就绪');
   await persist();
   app.showToast('已保存至 '+day,'success');
  }catch(e){app.showToast('未保存，请确认海报日期后重试','error');}
  finally{save.disabled=false;}
 });
 date.addEventListener('change',load);
 const archive=app.archiveCurrentDay.bind(app);
 app.archiveCurrentDay=async function(reason){
  await queue;
  const day=this.data.record_date||today();
  const e=await read(day);
  this.data._posterExtras={date:day,fiambreria:e.fiambreria??'',people:e.people??''};
  return archive(reason);
 };
 async function readSaved(day){
  await queue.catch(()=>{}); // 写入失败时仍可读取上次成功保存的值
  return read(day);
 }
 const switchTab=app.switchTab.bind(app);
 app.switchTab=function(name){
  const result=switchTab(name);
  if(name==='report'&&!loadedDay&&this.db)load();
  return result;
 };
 window.PosterExtras={readSaved};
 date.value=today();
})();
